import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { StatusChipComponent, ChipStatus } from '../../../../shared/components/a11y';

export interface K8sTriageCardActivate {
  /** The triggering button element — used as a focus-restore target for any drawer the caller opens. */
  readonly element: HTMLElement;
}

/**
 * CON-131 §2 — triage card for cluster-overview drill-down (cluster → ns →
 * workload → pod). One card per row unit:
 *
 * - headline label (e.g. namespace or workload name)
 * - sub-line (kind / node / image hint)
 * - primary status chip via `StatusChipComponent` (reused from CON-123 a11y
 *   contract so color+glyph+text all carry the status)
 * - secondary counts rendered as `k/total` beside the chip
 *
 * The whole card is a single button so keyboard reach is one Tab stop per
 * row. We do NOT nest focusable controls — the Phase-1 a11y review flagged
 * nested buttons inside clickable cards as an announcement hazard for SRs
 * (each nested control got its own "button" role read on arrow-nav).
 */
@Component({
  selector: 'app-k8s-triage-card',
  standalone: true,
  imports: [StatusChipComponent],
  template: `
    <button
      type="button"
      class="group flex w-full items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-left hover:border-zinc-600 hover:bg-zinc-800/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
      [attr.aria-label]="ariaLabel()"
      (click)="onActivate($event)"
    >
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="truncate text-sm font-medium text-zinc-100">{{ headline() }}</span>
          @if (pinned()) {
            <span aria-hidden="true" class="text-[10px] text-amber-400">★</span>
            <span class="sr-only">Pinned</span>
          }
        </div>
        @if (sub()) {
          <div class="mt-0.5 truncate text-xs text-zinc-500">{{ sub() }}</div>
        }
      </div>
      <div class="flex shrink-0 items-center gap-2">
        @if (readyCounts()) {
          <span class="tabular-nums text-xs text-zinc-400">{{ readyCounts() }}</span>
        }
        <app-status-chip
          [status]="status()"
          [label]="chipLabel()"
          [count]="chipCount()"
        />
      </div>
    </button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class K8sTriageCardComponent {
  readonly headline = input.required<string>();
  readonly sub = input<string | null>(null);
  readonly status = input.required<ChipStatus>();
  readonly chipLabel = input<string | null>(null);
  readonly chipCount = input<number | null>(null);
  /** Pre-formatted ready counts, e.g. `3/3` or `128/256`. */
  readonly readyCounts = input<string | null>(null);
  readonly pinned = input(false);

  readonly activate = output<K8sTriageCardActivate>();

  onActivate(event: MouseEvent): void {
    const element = event.currentTarget as HTMLElement;
    this.activate.emit({ element });
  }

  readonly ariaLabel = computed(() => {
    const parts: string[] = [this.headline()];
    const sub = this.sub();
    if (sub) {
      // Visual sub-lines use " · " (middle dot) as a separator. Screen
      // readers read that glyph literally as "middle dot", so split on it
      // and let the comma-joined aria-label carry each fragment cleanly.
      for (const fragment of sub.split(/\s*·\s*/)) {
        if (fragment) parts.push(fragment);
      }
    }
    const ready = this.readyCounts();
    if (ready) parts.push(`ready ${ready}`);
    const label = this.chipLabel() ?? this.status();
    const count = this.chipCount();
    parts.push(count == null ? label : `${count} ${label}`);
    return parts.join(', ');
  });
}
