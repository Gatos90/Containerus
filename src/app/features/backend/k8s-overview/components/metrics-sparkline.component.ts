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

let sparklineUid = 0;

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
 * (latest, min, max) is rendered in a text block next to the chart and
 * linked via `aria-describedby`. The SVG is intentionally not keyboard-
 * focusable — 6 metrics × N containers would explode the tab order, and
 * keyboard scrubbing isn't wired — so the adjacent text is canonical for
 * non-mouse users.
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
        The SVG is decorative for keyboard + screen-reader users: role="img"
        is kept so SR rotors can discover the chart with its descriptive
        aria-label, but the element is NOT tabbable. Per-sparkline tab stops
        added up to 18 focus targets per pod (6 metrics x 3 containers), and
        keyboard scrubbing isn't wired — the text summary beneath each chart
        is the canonical representation for non-mouse users. Mouse users
        still get the hover crosshair. 320px reflow (WCAG 1.4.10) is handled
        by the parent grid collapsing to a single column below sm.
      -->
      <svg
        [attr.viewBox]="viewBox()"
        preserveAspectRatio="none"
        role="img"
        [attr.aria-label]="ariaLabel()"
        [attr.aria-describedby]="summaryId"
        class="h-14 w-full rounded border border-zinc-800 bg-zinc-950"
        (mousemove)="onMove($event)"
        (mouseleave)="onLeave()"
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
        Associated to the SVG via aria-describedby so detailed values are
        programmatically connected to the chart element rather than a
        trailing, disconnected paragraph.
      -->
      <p [id]="summaryId" class="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-zinc-400">
        <span>now: <span class="font-mono text-zinc-200">{{ currentDisplay() }}</span></span>
        <span>min: <span class="font-mono">{{ minDisplay() }}</span></span>
        <span>max: <span class="font-mono">{{ maxDisplay() }}</span></span>
        @if (hoverIndex() !== null) {
          <span class="text-zinc-200">at {{ hoverTimestampDisplay() }}: <span class="font-mono">{{ hoverValueDisplay() }}</span></span>
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

  /** Stable id for aria-describedby linking the SVG to its text summary. */
  readonly summaryId = `metrics-sparkline-summary-${++sparklineUid}`;

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

  // Uses the words "up" / "down" instead of a +/− glyph. U+2212 reads
  // inconsistently on VoiceOver / JAWS and ASCII "-" is often dropped
  // entirely; words are unambiguous and also read more naturally than
  // "minus 1.2 percent".
  readonly deltaDisplay = computed(() => {
    const pts = this.points();
    if (pts.length < 2) return 'no change';
    const delta = pts[pts.length - 1].value - pts[pts.length - 2].value;
    if (Math.abs(delta) < 1e-6) return 'no change';
    const direction = delta > 0 ? 'up' : 'down';
    return `${direction} ${this.displayValue(Math.abs(delta))}`;
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

  private displayValue(v: number | null): string {
    if (v == null) return '—';
    const formatted = this.formatValue()(v);
    const unit = this.unit();
    return unit ? `${formatted}${unit}` : formatted;
  }
}
