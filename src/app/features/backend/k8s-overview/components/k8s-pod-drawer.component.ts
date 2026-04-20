import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { BackendK8sService } from '../../../../core/services/backend-k8s.service';
import { K8sPod, K8sEvent, mapEvent } from '../../../../core/models/backend.model';
import { DrawerDialogComponent } from '../../../../shared/components/a11y';

type PodTab = 'describe' | 'logs' | 'events';

/**
 * CON-131 §5 — pod drill-down slide-over with Describe / Logs / Events
 * tabs. Composes the Phase-1 `DrawerDialogComponent` for focus-trap + Esc
 * + backdrop semantics; tab panels follow WAI-ARIA 1.2 tab pattern
 * (tablist with `aria-selected`, panels with `aria-labelledby`). Logs and
 * events are fetched lazily per tab activation so the drawer open is
 * cheap; switching tabs re-uses cached content.
 *
 * Editing actions (exec, logs-follow stream, YAML edit) are intentionally
 * out of scope for Phase-2 — see ticket §Non-goals. They land in Phase 3.
 */
@Component({
  selector: 'app-k8s-pod-drawer',
  standalone: true,
  imports: [CommonModule, DrawerDialogComponent],
  template: `
    <app-drawer-dialog
      [open]="open()"
      [titleId]="titleId"
      [restoreFocusTo]="restoreFocusTo()"
      (closed)="close.emit()"
    >
      @if (pod(); as p) {
        <div class="flex h-full flex-col">
          <header class="border-b border-zinc-800 px-5 py-3">
            <div class="text-[10px] uppercase tracking-wide text-zinc-500">Pod</div>
            <h2 [id]="titleId" class="truncate text-base font-semibold text-zinc-100">{{ p.name }}</h2>
            <div class="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
              <span>{{ p.namespace }}</span>
              <span aria-hidden="true">·</span>
              <span>{{ p.status }}</span>
              @if (p.node) {
                <span aria-hidden="true">·</span>
                <span>on {{ p.node }}</span>
              }
            </div>
          </header>

          <div role="tablist" aria-label="Pod details" class="flex gap-1 border-b border-zinc-800 px-3 pt-2">
            @for (t of tabs; track t.key) {
              <button
                type="button"
                role="tab"
                [id]="tabId(t.key)"
                [attr.aria-controls]="panelId(t.key)"
                [attr.aria-selected]="activeTab() === t.key"
                [attr.tabindex]="focusedTab() === t.key ? 0 : -1"
                class="rounded-t px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
                [class.text-zinc-100]="activeTab() === t.key"
                [class.border-b-2]="activeTab() === t.key"
                [class.border-blue-400]="activeTab() === t.key"
                [class.text-zinc-400]="activeTab() !== t.key"
                (click)="setTab(t.key)"
                (keydown)="onTabKeydown($event, t.key)"
              >
                {{ t.label }}
              </button>
            }
          </div>

          <div class="flex-1 overflow-y-auto p-5">
            @if (activeTab() === 'describe') {
              <section
                role="tabpanel"
                [id]="panelId('describe')"
                [attr.aria-labelledby]="tabId('describe')"
                class="space-y-2 text-sm text-zinc-200"
              >
                <!--
                  min-w-0 + break-all on the value column let long mono tokens
                  (node DNS names, IPv6 pod IPs) wrap at 320 CSS px instead of
                  overflowing the drawer — WCAG 1.4.10 reflow.
                -->
                <div class="grid grid-cols-[10rem_1fr] gap-y-1.5 text-xs">
                  <div class="text-zinc-500">Phase</div><div class="min-w-0 break-all font-mono">{{ p.status }}</div>
                  <div class="text-zinc-500">Ready</div><div class="min-w-0 break-all font-mono">{{ p.ready }}</div>
                  <div class="text-zinc-500">Restarts</div><div class="min-w-0 break-all font-mono">{{ p.restarts }}</div>
                  <div class="text-zinc-500">Age</div><div class="min-w-0 break-all font-mono">{{ p.age }}</div>
                  @if (p.ip) {
                    <div class="text-zinc-500">Pod IP</div><div class="min-w-0 break-all font-mono">{{ p.ip }}</div>
                  }
                  @if (p.node) {
                    <div class="text-zinc-500">Node</div><div class="min-w-0 break-all font-mono">{{ p.node }}</div>
                  }
                </div>
                @if (p.containerNames && p.containerNames.length > 0) {
                  <div>
                    <div class="mb-1 text-xs font-medium text-zinc-400">Containers</div>
                    <ul class="space-y-1">
                      @for (name of p.containerNames; track name) {
                        <li class="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-xs">{{ name }}</li>
                      }
                    </ul>
                  </div>
                }
              </section>
            }

            @if (activeTab() === 'logs') {
              <!--
                tabindex="0" makes the scrollable log output reachable for
                keyboard-only users — the inner <pre> overflows on long logs
                and has no inherently focusable children.
              -->
              <section
                role="tabpanel"
                [id]="panelId('logs')"
                [attr.aria-labelledby]="tabId('logs')"
                tabindex="0"
                class="space-y-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
              >
                @if (logsLoading()) {
                  <div class="text-xs text-zinc-500">Loading logs…</div>
                } @else if (logsError()) {
                  <div class="text-xs text-red-400">{{ logsError() }}</div>
                } @else if (!logs()) {
                  <div class="text-xs text-zinc-500">No log output.</div>
                } @else {
                  <pre class="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded border border-zinc-800 bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-200">{{ logs() }}</pre>
                }
              </section>
            }

            @if (activeTab() === 'events') {
              <section
                role="tabpanel"
                [id]="panelId('events')"
                [attr.aria-labelledby]="tabId('events')"
                tabindex="0"
                class="space-y-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
              >
                @if (eventsLoading()) {
                  <div class="text-xs text-zinc-500">Loading events…</div>
                } @else if (eventsError()) {
                  <div class="text-xs text-red-400">{{ eventsError() }}</div>
                } @else if (events().length === 0) {
                  <div class="text-xs text-zinc-500">No events recorded.</div>
                } @else {
                  <ul class="space-y-1.5">
                    @for (ev of events(); track $index) {
                      <li class="rounded border border-zinc-800 bg-zinc-950 p-2 text-xs">
                        <div class="flex items-center justify-between">
                          <span
                            class="font-medium"
                            [class.text-amber-400]="ev.type === 'Warning'"
                            [class.text-zinc-300]="ev.type !== 'Warning'"
                          >{{ ev.reason }}</span>
                          <span class="text-[10px] text-zinc-500">{{ ev.age }}</span>
                        </div>
                        <div class="mt-0.5 text-zinc-400">{{ ev.message }}</div>
                      </li>
                    }
                  </ul>
                }
              </section>
            }
          </div>
        </div>
      }
    </app-drawer-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class K8sPodDrawerComponent {
  private readonly backend = inject(BackendK8sService);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = input(false);
  readonly pod = input<K8sPod | null>(null);
  readonly connectionId = input.required<string>();
  readonly clusterId = input.required<string>();
  readonly restoreFocusTo = input<HTMLElement | null>(null);
  readonly close = output<void>();

  readonly titleId = `k8s-pod-drawer-title-${Math.random().toString(36).slice(2, 9)}`;

  readonly tabs: ReadonlyArray<{ key: PodTab; label: string }> = [
    { key: 'describe', label: 'Describe' },
    { key: 'logs', label: 'Logs' },
    { key: 'events', label: 'Events' },
  ];

  readonly activeTab = signal<PodTab>('describe');

  /**
   * Roving tabindex target — the tab the keyboard is currently parked on.
   * Decoupled from `activeTab` so arrow-nav can move the focus ring across
   * the tablist without triggering panel activation (and its lazy fetches).
   * APG §Tabs "manual activation" pattern: arrows move focus, Enter/Space
   * commits. Kept in sync with `activeTab` on commit so mouse click + keyboard
   * selection converge on the same selected tab.
   */
  readonly focusedTab = signal<PodTab>('describe');

  readonly logs = signal<string>('');
  readonly logsLoading = signal(false);
  readonly logsError = signal<string | null>(null);

  readonly events = signal<K8sEvent[]>([]);
  readonly eventsLoading = signal(false);
  readonly eventsError = signal<string | null>(null);

  private readonly loadedKey = computed(() =>
    this.pod() ? `${this.clusterId()}/${this.pod()!.namespace}/${this.pod()!.name}` : null,
  );
  private lastLoadedKey: string | null = null;

  constructor() {
    // Reset cached per-pod content whenever the pod identity changes so the
    // drawer never leaks stale logs/events across drill-downs.
    effect(() => {
      const key = this.loadedKey();
      if (key !== this.lastLoadedKey) {
        this.lastLoadedKey = key;
        this.logs.set('');
        this.logsError.set(null);
        this.events.set([]);
        this.eventsError.set(null);
        this.activeTab.set('describe');
        this.focusedTab.set('describe');
      }
    });
  }

  tabId(key: PodTab): string {
    return `${this.titleId}-tab-${key}`;
  }
  panelId(key: PodTab): string {
    return `${this.titleId}-panel-${key}`;
  }

  setTab(tab: PodTab): void {
    this.activeTab.set(tab);
    this.focusedTab.set(tab);
    if (tab === 'logs' && !this.logs() && !this.logsLoading()) {
      void this.loadLogs();
    }
    if (tab === 'events' && this.events().length === 0 && !this.eventsLoading()) {
      void this.loadEvents();
    }
  }

  /** Move the roving tabindex without committing — no panel load fires. */
  private moveFocusTo(tab: PodTab, host: HTMLElement | null): void {
    this.focusedTab.set(tab);
    const container = host?.closest('[role="tablist"]');
    const target = container?.querySelector<HTMLElement>(`#${this.tabId(tab)}`);
    target?.focus();
  }

  /**
   * Manual-activation tablist (WAI-ARIA APG §Tabs). Arrow/Home/End only
   * reposition the roving tabindex so users can survey the tabs without
   * firing the lazy log/event fetches bound to `setTab`. Enter/Space
   * commits.
   */
  onTabKeydown(event: KeyboardEvent, current: PodTab): void {
    const order = this.tabs.map((t) => t.key);
    const idx = order.indexOf(current);
    const host = event.currentTarget as HTMLElement | null;
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        this.moveFocusTo(order[(idx + 1) % order.length], host);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        this.moveFocusTo(order[(idx - 1 + order.length) % order.length], host);
        return;
      case 'Home':
        event.preventDefault();
        this.moveFocusTo(order[0], host);
        return;
      case 'End':
        event.preventDefault();
        this.moveFocusTo(order[order.length - 1], host);
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.setTab(current);
        return;
    }
  }

  private async loadLogs(): Promise<void> {
    const pod = this.pod();
    if (!pod) return;
    this.logsLoading.set(true);
    this.logsError.set(null);
    try {
      const res = await this.backend.getPodLogsFor(
        this.connectionId(),
        this.clusterId(),
        pod.namespace,
        pod.name,
        { tailLines: 500 },
      );
      this.logs.set(res.logs ?? '');
    } catch (err: any) {
      this.logsError.set(err?.message ?? 'Failed to fetch logs');
    } finally {
      this.logsLoading.set(false);
    }
  }

  private async loadEvents(): Promise<void> {
    const pod = this.pod();
    if (!pod) return;
    this.eventsLoading.set(true);
    this.eventsError.set(null);
    try {
      const raw = await this.backend.getResourceEventsFor(
        this.connectionId(),
        this.clusterId(),
        pod.namespace,
        'Pod',
        pod.name,
      );
      this.events.set(raw.map(mapEvent));
    } catch (err: any) {
      this.eventsError.set(err?.message ?? 'Failed to fetch events');
    } finally {
      this.eventsLoading.set(false);
    }
  }
}
