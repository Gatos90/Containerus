import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

export type ChipStatus = 'healthy' | 'degraded' | 'failing' | 'unknown';

export interface StatusChipVariant {
  readonly status: ChipStatus;
  /** Tailwind classes for background + text. Pre-validated for AA contrast. */
  readonly chipClass: string;
  /** Distinct shape glyph — never color-alone carries status. */
  readonly glyph: string;
  /** Fallback label if the caller does not pass one. */
  readonly defaultLabel: string;
}

/**
 * The four chip variants, ordered healthy→unknown. Each uses a distinct
 * geometric glyph so the chip remains readable under monochrome rendering
 * (WCAG 1.4.1 Use of Color).
 */
export const CHIP_VARIANTS: Record<ChipStatus, StatusChipVariant> = {
  healthy: {
    status: 'healthy',
    chipClass: 'bg-emerald-700 text-white',
    glyph: '●',
    defaultLabel: 'Healthy',
  },
  degraded: {
    status: 'degraded',
    chipClass: 'bg-amber-600 text-zinc-950',
    glyph: '▲',
    defaultLabel: 'Degraded',
  },
  failing: {
    status: 'failing',
    chipClass: 'bg-red-700 text-white',
    glyph: '■',
    defaultLabel: 'Failing',
  },
  unknown: {
    status: 'unknown',
    chipClass: 'bg-zinc-700 text-zinc-100',
    glyph: '◇',
    defaultLabel: 'Unknown',
  },
};

/**
 * Text-first status chip. Renders `<shape> <label> [count]`. Color is never
 * the only channel — the geometric glyph is redundant with the variant. The
 * chip exposes a `role="status"` only when `count` changes, so SRs announce
 * deltas; static chips stay out of the live region to avoid announcement
 * floods on busy dashboards.
 */
@Component({
  selector: 'app-status-chip',
  standalone: true,
  templateUrl: './status-chip.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusChipComponent {
  readonly status = input.required<ChipStatus>();
  readonly label = input<string | null>(null);
  readonly count = input<number | null>(null);

  readonly variant = computed<StatusChipVariant>(() => CHIP_VARIANTS[this.status()] ?? CHIP_VARIANTS.unknown);
  readonly resolvedLabel = computed(() => this.label() ?? this.variant().defaultLabel);

  /**
   * Build the screen-reader text. We combine label + count into one span
   * rather than relying on visually-ordered DOM so SRs read "3 failing" as
   * a single phrase instead of "failing 3".
   */
  readonly srText = computed(() => {
    const count = this.count();
    const label = this.resolvedLabel();
    return count == null ? label : `${count} ${label}`;
  });
}
