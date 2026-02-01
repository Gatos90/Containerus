import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

/**
 * A progress bar component for displaying metric values (CPU, RAM, etc.)
 * with color coding based on usage level.
 *
 * Usage:
 * ```html
 * <app-metric-bar label="CPU" [value]="75" [animated]="true" />
 * <app-metric-bar label="RAM" [value]="metrics.memoryUsagePercent" size="sm" />
 * ```
 */
@Component({
  selector: 'app-metric-bar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="flex items-center gap-2" [class]="containerClass()">
      @if (showLabel()) {
        <span class="text-xs text-zinc-500 min-w-[2.5rem]">{{ label() }}</span>
      }
      <div class="flex-1 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
        <div
          class="h-full rounded-full"
          [class]="barClass()"
          [class.transition-all]="animated()"
          [class.duration-500]="animated()"
          [style.width.%]="clampedValue()"
        ></div>
      </div>
      @if (showPercent()) {
        <span
          class="text-xs font-medium min-w-[2.5rem] text-right"
          [class]="percentClass()"
        >
          {{ clampedValue() | number: '1.0-0' }}%
        </span>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MetricBarComponent {
  /** Label to display (e.g., "CPU", "RAM") */
  label = input<string>('');

  /** Value as a percentage (0-100) */
  value = input.required<number>();

  /** Size variant */
  size = input<'sm' | 'md' | 'lg'>('md');

  /** Whether to show the label */
  showLabel = input<boolean>(true);

  /** Whether to show the percentage value */
  showPercent = input<boolean>(true);

  /** Whether to animate value changes */
  animated = input<boolean>(true);

  /** Custom thresholds for color coding [warning, danger] */
  thresholds = input<[number, number]>([70, 85]);

  /** Clamped value between 0 and 100 */
  readonly clampedValue = computed(() => {
    const v = this.value();
    return Math.max(0, Math.min(100, v ?? 0));
  });

  /** Determine color level based on thresholds */
  readonly colorLevel = computed<'normal' | 'warning' | 'danger'>(() => {
    const v = this.clampedValue();
    const [warn, danger] = this.thresholds();

    if (v >= danger) return 'danger';
    if (v >= warn) return 'warning';
    return 'normal';
  });

  /** Container CSS classes based on size */
  readonly containerClass = computed(() => {
    const sizeClasses: Record<string, string> = {
      sm: '',
      md: '',
      lg: 'gap-3',
    };
    return sizeClasses[this.size()];
  });

  /** Progress bar CSS classes based on color level */
  readonly barClass = computed(() => {
    const colorClasses: Record<string, string> = {
      normal: 'bg-blue-500',
      warning: 'bg-amber-500',
      danger: 'bg-red-500',
    };
    return colorClasses[this.colorLevel()];
  });

  /** Percentage text CSS classes based on color level */
  readonly percentClass = computed(() => {
    const colorClasses: Record<string, string> = {
      normal: 'text-zinc-300',
      warning: 'text-amber-500',
      danger: 'text-red-500',
    };
    return colorClasses[this.colorLevel()];
  });
}
