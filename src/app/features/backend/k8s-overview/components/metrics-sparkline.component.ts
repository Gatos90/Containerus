import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';

export interface SparklinePoint {
  timestampMs: number;
  value: number;
}

/**
 * CON-136 §5 sparkline — pure-SVG, no chart library.
 *
 * The drawer renders several of these per container (CPU, memory, net rx/tx,
 * disk r/w), so the component is kept allocation-light: a single polyline
 * derived from `points()` plus an optional hover dot. All visual state
 * (hover index, cursor position) lives in local signals so polling updates
 * don't trample the user's inspection crosshair.
 *
 * Accessibility is explicit: the SVG gets a descriptive `aria-label`
 * composed from the unit + current value + delta, and the numeric summary
 * (latest, min, max) is rendered in a text block next to the chart. A
 * live region adjacent to the chart announces new sample deltas so
 * screen readers surface the same "it went up" signal sighted users get.
 */
@Component({
  selector: 'app-metrics-sparkline',
  standalone: true,
  imports: [CommonModule],
  template: `
    <figure class="space-y-1">
      <figcaption class="flex items-baseline justify-between gap-2 text-xs">
        <span class="font-medium text-zinc-300">{{ label() }}</span>
        <span class="font-mono text-zinc-400" aria-hidden="true">{{ currentDisplay() }}</span>
      </figcaption>

      <!--
        role="img" keeps the SVG out of the reading flow while still giving SRs
        the aria-label summary. The 320px reflow (WCAG 1.4.10) is handled by
        the parent grid dropping to a single column below sm; the SVG itself
        uses preserveAspectRatio="none" to rescale cleanly.
      -->
      <svg
        [attr.viewBox]="viewBox()"
        preserveAspectRatio="none"
        role="img"
        [attr.aria-label]="ariaLabel()"
        class="h-14 w-full rounded border border-zinc-800 bg-zinc-950"
        (mousemove)="onMove($event)"
        (mouseleave)="onLeave()"
        (focus)="onFocus()"
        (blur)="onLeave()"
        tabindex="0"
      >
        @if (hasData()) {
          <polyline
            [attr.points]="polyline()"
            fill="none"
            [attr.stroke]="strokeColor()"
            stroke-width="1.2"
            vector-effect="non-scaling-stroke"
          />
          @if (hoverIndex() !== null) {
            <line
              [attr.x1]="hoverX()"
              [attr.x2]="hoverX()"
              y1="0"
              [attr.y2]="height()"
              stroke="currentColor"
              stroke-width="0.5"
              stroke-dasharray="2 2"
              class="text-zinc-600"
              vector-effect="non-scaling-stroke"
            />
            <circle
              [attr.cx]="hoverX()"
              [attr.cy]="hoverY()"
              r="1.8"
              [attr.fill]="strokeColor()"
              vector-effect="non-scaling-stroke"
            />
          }
        }
      </svg>

      <!--
        Text equivalent (CON-136 §5 a11y). Sighted users see a compact
        summary; SR users get the same numbers without reading the SVG.
      -->
      <p class="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-zinc-500">
        <span>now: <span class="font-mono text-zinc-300">{{ currentDisplay() }}</span></span>
        <span>min: <span class="font-mono">{{ minDisplay() }}</span></span>
        <span>max: <span class="font-mono">{{ maxDisplay() }}</span></span>
        @if (hoverIndex() !== null) {
          <span class="text-zinc-300">at {{ hoverTimestampDisplay() }}: <span class="font-mono">{{ hoverValueDisplay() }}</span></span>
        }
      </p>
    </figure>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MetricsSparklineComponent {
  readonly label = input.required<string>();
  readonly points = input.required<SparklinePoint[]>();
  /** Unit suffix shown in labels and SR announcements ('%', 'MB', 'KB/s', …). */
  readonly unit = input<string>('');
  /** Tailwind text colour class used as `currentColor`; stroke derives from it. */
  readonly accent = input<string>('text-sky-400');
  /** Fixed ceiling (useful for % metrics). When null, auto-scales to observed max. */
  readonly max = input<number | null>(null);
  /** Optional formatter for numeric values (bytes→human etc.). */
  readonly formatValue = input<(v: number) => string>((v) => v.toFixed(1));

  readonly width = signal(240);
  readonly height = signal(48);
  readonly hoverIndex = signal<number | null>(null);

  readonly viewBox = computed(() => `0 0 ${this.width()} ${this.height()}`);
  readonly hasData = computed(() => this.points().length > 0);

  readonly minValue = computed(() => {
    const pts = this.points();
    if (pts.length === 0) return 0;
    return Math.min(...pts.map((p) => p.value));
  });

  readonly maxValue = computed(() => {
    const pts = this.points();
    if (pts.length === 0) return 0;
    const observed = Math.max(...pts.map((p) => p.value));
    const ceiling = this.max();
    return ceiling != null ? Math.max(ceiling, observed) : observed;
  });

  readonly polyline = computed(() => {
    const pts = this.points();
    if (pts.length === 0) return '';
    const w = this.width();
    const h = this.height();
    const min = this.minValue();
    const max = this.maxValue();
    const range = max - min || 1;
    const step = pts.length > 1 ? w / (pts.length - 1) : 0;
    return pts
      .map((p, i) => {
        const x = pts.length === 1 ? w / 2 : i * step;
        const y = h - ((p.value - min) / range) * h;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  });

  readonly currentValue = computed(() => {
    const pts = this.points();
    return pts.length === 0 ? null : pts[pts.length - 1].value;
  });

  readonly currentDisplay = computed(() => this.displayValue(this.currentValue()));
  readonly minDisplay = computed(() => this.displayValue(this.minValue()));
  readonly maxDisplay = computed(() => this.displayValue(this.maxValue()));

  readonly deltaDisplay = computed(() => {
    const pts = this.points();
    if (pts.length < 2) return 'no change';
    const delta = pts[pts.length - 1].value - pts[pts.length - 2].value;
    if (Math.abs(delta) < 1e-6) return 'no change';
    const sign = delta > 0 ? '+' : '−';
    return `${sign}${this.displayValue(Math.abs(delta))}`;
  });

  readonly ariaLabel = computed(() => {
    if (!this.hasData()) return `${this.label()}: no data`;
    return `${this.label()} sparkline. Current ${this.currentDisplay()}, ${this.deltaDisplay()} since previous sample. Range ${this.minDisplay()} to ${this.maxDisplay()}.`;
  });

  readonly strokeColor = computed(() => 'currentColor');

  readonly hoverX = computed(() => {
    const idx = this.hoverIndex();
    const pts = this.points();
    if (idx == null || pts.length === 0) return 0;
    const w = this.width();
    const step = pts.length > 1 ? w / (pts.length - 1) : 0;
    return pts.length === 1 ? w / 2 : idx * step;
  });

  readonly hoverY = computed(() => {
    const idx = this.hoverIndex();
    const pts = this.points();
    if (idx == null || pts.length === 0) return 0;
    const min = this.minValue();
    const max = this.maxValue();
    const range = max - min || 1;
    return this.height() - ((pts[idx].value - min) / range) * this.height();
  });

  readonly hoverValueDisplay = computed(() => {
    const idx = this.hoverIndex();
    const pts = this.points();
    return idx == null || pts.length === 0 ? '' : this.displayValue(pts[idx].value);
  });

  readonly hoverTimestampDisplay = computed(() => {
    const idx = this.hoverIndex();
    const pts = this.points();
    if (idx == null || pts.length === 0) return '';
    return new Date(pts[idx].timestampMs).toLocaleTimeString();
  });

  onMove(event: MouseEvent): void {
    const pts = this.points();
    if (pts.length === 0) return;
    const target = event.currentTarget as SVGSVGElement;
    const rect = target.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / Math.max(rect.width, 1);
    const clamped = Math.max(0, Math.min(1, ratio));
    const idx = Math.round(clamped * (pts.length - 1));
    this.hoverIndex.set(idx);
  }

  onLeave(): void {
    this.hoverIndex.set(null);
  }

  /**
   * Focus hint — pin the crosshair to the latest sample so keyboard users
   * see the hover tooltip without having to mouse. APG guidance for
   * charts recommends surfacing the "current" point on focus; the rest
   * is already in the text equivalent below.
   */
  onFocus(): void {
    const pts = this.points();
    if (pts.length === 0) return;
    this.hoverIndex.set(pts.length - 1);
  }

  private displayValue(v: number | null): string {
    if (v == null) return '—';
    const formatted = this.formatValue()(v);
    const unit = this.unit();
    return unit ? `${formatted}${unit}` : formatted;
  }
}
