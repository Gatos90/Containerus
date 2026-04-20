import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { BackendK8sService } from '../../../../core/services/backend-k8s.service';
import {
  ContainerMetricsResponse,
  ContainerMetricsWindow,
  ContainerStatsSample,
  MetricsUnavailableReason,
} from '../../../../core/models/backend.model';
import { StatusChipComponent } from '../../../../shared/components/a11y';
import {
  MetricsSparklineComponent,
  SparklinePoint,
} from './metrics-sparkline.component';

interface MetricsReasonDescriptor {
  readonly reason: MetricsUnavailableReason;
  readonly chipStatus: 'degraded' | 'failing' | 'unknown';
  readonly label: string;
  readonly description: string;
}

/**
 * CON-136 §4 — named-reason descriptors for per-container metrics. Reuses
 * the CON-126 chip pattern (distinct glyph + label, never color-alone) so
 * the UI surfaces *why* a chart is blank instead of collapsing every
 * failure into "loading…" or a generic error.
 */
const METRICS_REASONS: Record<MetricsUnavailableReason, MetricsReasonDescriptor> = {
  unavailable: {
    reason: 'unavailable',
    chipStatus: 'degraded',
    label: 'Unavailable',
    description: 'The metrics endpoint is not available for this pod.',
  },
  unauthorized: {
    reason: 'unauthorized',
    chipStatus: 'failing',
    label: 'Unauthorized',
    description:
      "You don't have permission to view metrics on this system. Ask an admin for the containers.metrics.view permission.",
  },
  not_found: {
    reason: 'not_found',
    chipStatus: 'unknown',
    label: 'No data',
    description: 'No samples have been recorded for this container yet.',
  },
  rate_limited: {
    reason: 'rate_limited',
    chipStatus: 'degraded',
    label: 'Throttled',
    description: 'Metrics refresh is throttled. Retrying shortly.',
  },
};

const WINDOW_OPTIONS: ReadonlyArray<{ key: ContainerMetricsWindow; label: string; intervalMs: number }> = [
  // Poll cadence scales with window — no point pounding the API every 10s
  // when the chart plots a 24h span; the samples back-end downsamples
  // anyway, and slowing down here keeps the shared SSH connection calm.
  { key: '1h', label: '1h', intervalMs: 10_000 },
  { key: '6h', label: '6h', intervalMs: 30_000 },
  { key: '24h', label: '24h', intervalMs: 60_000 },
];

/** Cache of per-container series keyed by container name within the panel. */
interface ContainerSeries {
  readonly containerId: string;
  readonly samples: ContainerStatsSample[];
}

@Component({
  selector: 'app-pod-metrics-panel',
  standalone: true,
  imports: [CommonModule, StatusChipComponent, MetricsSparklineComponent],
  template: `
    <section class="space-y-4">
      <!--
        Range + pause controls. The range group uses role="radiogroup" so
        screen readers announce "1h, selected, 1 of 3"; arrow keys move
        selection without needing custom handlers because native <input
        type="radio"> covers that, but we use buttons for visual parity
        with the rest of the app and wire keydown manually.
      -->
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div
          role="radiogroup"
          aria-label="Metrics time range"
          class="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900 p-0.5"
        >
          @for (opt of windowOptions; track opt.key; let i = $index) {
            <button
              type="button"
              role="radio"
              [attr.aria-checked]="window() === opt.key"
              [attr.tabindex]="window() === opt.key ? 0 : -1"
              class="rounded px-2 py-1 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-400"
              [class.bg-zinc-800]="window() === opt.key"
              [class.text-zinc-100]="window() === opt.key"
              [class.text-zinc-400]="window() !== opt.key"
              (click)="setWindow(opt.key)"
              (keydown)="onRangeKeydown($event, i)"
            >
              {{ opt.label }}
            </button>
          }
        </div>

        <div class="flex items-center gap-2">
          <!--
            Polite live region: announces pause/resume + cadence so users
            who toggle by keyboard hear confirmation without a visible toast.
          -->
          <span class="sr-only" aria-live="polite">{{ cadenceAnnouncement() }}</span>

          <span class="text-xs text-zinc-400" aria-hidden="true">
            every {{ cadenceSeconds() }}s
          </span>
          <button
            type="button"
            class="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-400"
            [attr.aria-pressed]="paused()"
            (click)="togglePause()"
          >
            {{ paused() ? 'Resume' : 'Pause' }}
          </button>
        </div>
      </div>

      @if (!canQuery()) {
        <!--
          No systemId mapping for this pod — show the named-reason chip and
          explain. Sits alongside the same chip pattern used in CON-126 so
          users see one consistent "why is this empty" language.
        -->
        <div class="flex flex-col gap-1 rounded border border-zinc-800 bg-zinc-950 p-4">
          <app-status-chip status="degraded" label="Unavailable" />
          <p class="text-xs text-zinc-400">
            Per-container metrics require a container runtime system linked to this pod. Ask an admin to register the node's runtime with Containerus.
          </p>
        </div>
      } @else if (error(); as reason) {
        <div class="flex flex-col gap-1 rounded border border-zinc-800 bg-zinc-950 p-4">
          <app-status-chip [status]="reasonDescriptor(reason).chipStatus" [label]="reasonDescriptor(reason).label" />
          <p class="text-xs text-zinc-400">{{ reasonDescriptor(reason).description }}</p>
        </div>
      } @else if (loading() && series().length === 0) {
        <!--
          prefers-reduced-motion (WCAG 2.3.3): spinner only animates when the
          user hasn't requested reduced motion; otherwise the static glyph
          plus text still signals "loading" without vestibular risk.
        -->
        <div role="status" aria-busy="true" class="flex items-center gap-2 text-xs text-zinc-400">
          <svg aria-hidden="true" class="h-3.5 w-3.5 motion-safe:animate-spin" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity=".25" stroke-width="3"></circle>
            <path d="M4 12a8 8 0 0 1 8-8" stroke="currentColor" stroke-width="3" stroke-linecap="round"></path>
          </svg>
          <span>Loading metrics…</span>
        </div>
      } @else if (series().length === 0) {
        <p class="rounded border border-dashed border-zinc-700 p-4 text-xs text-zinc-500">
          No samples recorded yet for this pod's containers. Check back in a moment.
        </p>
      } @else {
        <div class="space-y-6">
          @for (cs of series(); track cs.containerId) {
            <article class="space-y-3 rounded border border-zinc-800 bg-zinc-950 p-3">
              <header class="flex items-center justify-between gap-2">
                <h3 class="text-xs font-semibold text-zinc-200">
                  <span class="text-zinc-500">Container</span>
                  <span class="ml-1 font-mono text-zinc-100">{{ cs.containerId }}</span>
                </h3>
                <span class="text-xs text-zinc-400">{{ cs.samples.length }} samples · {{ window() }}</span>
              </header>

              <!--
                320px reflow: the grid collapses to a single column on narrow
                widths so each sparkline keeps ≥200px for legibility. WCAG
                1.4.10 — chart labels and values remain reflow-safe.
              -->
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <app-metrics-sparkline
                  label="CPU %"
                  unit="%"
                  accent="text-sky-400"
                  [points]="cpuPoints(cs)"
                  [max]="100"
                />
                <app-metrics-sparkline
                  label="Memory %"
                  unit="%"
                  accent="text-indigo-400"
                  [points]="memPercentPoints(cs)"
                  [max]="100"
                />
                <app-metrics-sparkline
                  label="Memory (MB)"
                  unit=" MB"
                  accent="text-violet-400"
                  [points]="memAbsolutePoints(cs)"
                />
                <app-metrics-sparkline
                  label="Net RX (KB/s)"
                  unit=" KB/s"
                  accent="text-emerald-400"
                  [points]="netRxRatePoints(cs)"
                />
                <app-metrics-sparkline
                  label="Net TX (KB/s)"
                  unit=" KB/s"
                  accent="text-amber-400"
                  [points]="netTxRatePoints(cs)"
                />
                <app-metrics-sparkline
                  label="Disk R+W (KB/s)"
                  unit=" KB/s"
                  accent="text-rose-400"
                  [points]="diskRatePoints(cs)"
                />
              </div>
            </article>
          }
        </div>
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PodMetricsPanelComponent {
  private readonly backend = inject(BackendK8sService);
  private readonly destroyRef = inject(DestroyRef);

  readonly connectionId = input.required<string>();
  readonly systemId = input<string | null>(null);
  readonly containerIds = input<ReadonlyArray<string>>([]);
  /** When false, polling halts even if not explicitly paused (drawer closed, different tab, …). */
  readonly active = input<boolean>(false);

  readonly windowOptions = WINDOW_OPTIONS;
  readonly window = signal<ContainerMetricsWindow>('1h');
  readonly paused = signal(false);
  readonly loading = signal(false);
  readonly error = signal<MetricsUnavailableReason | null>(null);

  private readonly seriesMap = signal<ReadonlyMap<string, ContainerSeries>>(new Map());
  readonly series = computed<ContainerSeries[]>(() => {
    const ids = this.containerIds();
    const map = this.seriesMap();
    return ids.map((id) => map.get(id) ?? { containerId: id, samples: [] });
  });

  readonly canQuery = computed(() => Boolean(this.systemId() && this.containerIds().length > 0));

  readonly cadenceSeconds = computed(() => {
    const opt = WINDOW_OPTIONS.find((w) => w.key === this.window());
    return Math.round((opt?.intervalMs ?? 10_000) / 1000);
  });

  // Announces only on state changes (pause/resume, range change) — the
  // string content flips when `paused()` toggles or when `cadenceSeconds()`
  // changes with the window. Per-sample value announcements intentionally
  // aren't emitted: at a 10s poll cadence they bury any other screen-reader
  // speech, and the visible sparkline plus the text summary beneath each
  // chart already provide the same numbers on demand.
  readonly cadenceAnnouncement = computed(() =>
    this.paused()
      ? 'Metrics polling paused.'
      : `Metrics polling every ${this.cadenceSeconds()} seconds at ${this.window()} range.`,
  );

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  /** Monotonic token to cancel in-flight fetches when inputs change. */
  private fetchToken = 0;

  constructor() {
    this.destroyRef.onDestroy(() => this.stopPolling());

    // Reset state + fetch whenever identity changes (different pod, new
    // container set, window change). Pause also stops polling but preserves
    // the displayed samples so the user can keep inspecting the crosshair.
    effect(() => {
      // Touch inputs that invalidate the series.
      const ids = this.containerIds();
      const sys = this.systemId();
      const window = this.window();
      const paused = this.paused();
      const active = this.active();

      this.stopPolling();

      if (!active || !sys || ids.length === 0) {
        // Inactive or not addressable — clear loading but keep last series
        // so reopening the tab feels instant.
        this.loading.set(false);
        return;
      }

      // Key changes invalidate the cached series.
      this.resetSeries(ids);

      if (paused) {
        this.loading.set(false);
        return;
      }

      void this.fetchAllOnce(sys, ids, window);
      this.startPolling(sys, ids, window);
    });
  }

  // ---------- Controls ----------

  setWindow(w: ContainerMetricsWindow): void {
    if (this.window() === w) return;
    this.window.set(w);
  }

  togglePause(): void {
    this.paused.update((p) => !p);
  }

  onRangeKeydown(event: KeyboardEvent, idx: number): void {
    const total = WINDOW_OPTIONS.length;
    let nextIdx: number | null = null;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIdx = (idx + 1) % total;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIdx = (idx - 1 + total) % total;
        break;
      case 'Home':
        nextIdx = 0;
        break;
      case 'End':
        nextIdx = total - 1;
        break;
    }
    if (nextIdx == null) return;
    event.preventDefault();
    const nextKey = WINDOW_OPTIONS[nextIdx].key;
    this.setWindow(nextKey);
    const host = event.currentTarget as HTMLElement | null;
    const group = host?.closest('[role="radiogroup"]');
    const buttons = group?.querySelectorAll<HTMLButtonElement>('button[role="radio"]');
    buttons?.[nextIdx]?.focus();
  }

  // ---------- Reason chip helpers ----------

  reasonDescriptor(reason: MetricsUnavailableReason): MetricsReasonDescriptor {
    return METRICS_REASONS[reason];
  }

  // ---------- Data transforms (sparkline projections) ----------

  cpuPoints(cs: ContainerSeries): SparklinePoint[] {
    return cs.samples.map((s) => ({ timestampMs: s.timestampMs, value: s.cpuPercent }));
  }

  memPercentPoints(cs: ContainerSeries): SparklinePoint[] {
    return cs.samples.map((s) => ({ timestampMs: s.timestampMs, value: s.memoryPercent }));
  }

  memAbsolutePoints(cs: ContainerSeries): SparklinePoint[] {
    return cs.samples.map((s) => ({
      timestampMs: s.timestampMs,
      value: s.memoryBytes / (1024 * 1024),
    }));
  }

  netRxRatePoints(cs: ContainerSeries): SparklinePoint[] {
    return this.deltaRateKbps(cs.samples, (s) => s.netRxBytes);
  }

  netTxRatePoints(cs: ContainerSeries): SparklinePoint[] {
    return this.deltaRateKbps(cs.samples, (s) => s.netTxBytes);
  }

  diskRatePoints(cs: ContainerSeries): SparklinePoint[] {
    return this.deltaRateKbps(cs.samples, (s) => s.blockReadBytes + s.blockWriteBytes);
  }

  /**
   * Convert a cumulative-bytes counter to per-sample kilobyte-per-second
   * deltas. The counter can reset when the container restarts (cumulative
   * counters go backwards); we clamp negative deltas to 0 so the spark
   * doesn't show a cliff. Only a non-trivial time gap between samples is
   * used as the denominator — adjacent samples with the same timestamp
   * would otherwise divide by zero.
   */
  private deltaRateKbps(
    samples: ContainerStatsSample[],
    pick: (s: ContainerStatsSample) => number,
  ): SparklinePoint[] {
    const out: SparklinePoint[] = [];
    for (let i = 1; i < samples.length; i++) {
      const prev = samples[i - 1];
      const cur = samples[i];
      const dt = (cur.timestampMs - prev.timestampMs) / 1000;
      if (dt <= 0) continue;
      const dBytes = Math.max(0, pick(cur) - pick(prev));
      out.push({ timestampMs: cur.timestampMs, value: dBytes / dt / 1024 });
    }
    return out;
  }

  // ---------- Polling + fetching ----------

  private startPolling(systemId: string, ids: ReadonlyArray<string>, window: ContainerMetricsWindow): void {
    const opt = WINDOW_OPTIONS.find((w) => w.key === window) ?? WINDOW_OPTIONS[0];
    this.pollTimer = setInterval(() => {
      void this.fetchAllOnce(systemId, ids, window);
    }, opt.intervalMs);
  }

  private stopPolling(): void {
    if (this.pollTimer != null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private resetSeries(ids: ReadonlyArray<string>): void {
    const seed = new Map<string, ContainerSeries>();
    for (const id of ids) seed.set(id, { containerId: id, samples: [] });
    this.seriesMap.set(seed);
    this.error.set(null);
  }

  private async fetchAllOnce(
    systemId: string,
    ids: ReadonlyArray<string>,
    window: ContainerMetricsWindow,
  ): Promise<void> {
    const token = ++this.fetchToken;
    this.loading.set(true);
    try {
      const responses = await Promise.allSettled(
        ids.map((id) =>
          this.backend.getContainerMetricsFor(this.connectionId(), systemId, id, window),
        ),
      );

      if (token !== this.fetchToken) return; // Superseded by a newer fetch.

      const map = new Map<string, ContainerSeries>(this.seriesMap());

      // The first rejection drives the named-reason chip, but other
      // containers that *did* return samples still render — partial
      // success is a better UX than hiding every chart because one
      // sidecar 404'd.
      let firstReason: MetricsUnavailableReason | null = null;
      for (let i = 0; i < responses.length; i++) {
        const res = responses[i];
        const id = ids[i];
        if (res.status === 'fulfilled') {
          map.set(id, { containerId: id, samples: res.value.samples });
        } else if (firstReason == null) {
          firstReason = this.classifyError(res.reason);
        }
      }

      // Only surface the named-reason chip when *every* container failed
      // — otherwise we'd hide working charts behind a global error.
      const hasAnyData = Array.from(map.values()).some((s) => s.samples.length > 0);
      this.error.set(hasAnyData ? null : firstReason);
      this.seriesMap.set(map);
    } finally {
      if (token === this.fetchToken) this.loading.set(false);
    }
  }

  private classifyError(err: unknown): MetricsUnavailableReason {
    const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
    if (msg.includes('401') || msg.includes('unauthorized')) return 'unauthorized';
    if (msg.includes('403') || msg.includes('forbidden')) return 'unauthorized';
    if (msg.includes('404') || msg.includes('not found')) return 'not_found';
    if (msg.includes('429') || msg.includes('rate')) return 'rate_limited';
    return 'unavailable';
  }
}

/** Exposed for spec files that assert on the descriptor text. */
export { METRICS_REASONS };
