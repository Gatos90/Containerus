import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  input,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Loader2 } from 'lucide-angular';

export type AppButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'destructive';

export type AppButtonSize = 'sm' | 'md';

const VARIANT_CLASSES: Record<AppButtonVariant, string> = {
  primary:
    'bg-blue-600 text-white hover:bg-blue-500 focus-visible:ring-blue-500/60',
  secondary:
    'bg-zinc-800 text-zinc-100 hover:bg-zinc-700 focus-visible:ring-zinc-500/60',
  ghost:
    'bg-transparent text-zinc-200 hover:bg-zinc-800 focus-visible:ring-zinc-500/60',
  destructive:
    'bg-red-600 text-white hover:bg-red-500 focus-visible:ring-red-500/60',
};

const SIZE_CLASSES: Record<AppButtonSize, string> = {
  sm: 'px-2.5 py-1 text-xs gap-1.5',
  md: 'px-3 py-1.5 text-sm gap-2',
};

const BASE_CLASSES =
  'inline-flex items-center justify-center rounded-lg font-medium transition-colors ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

@Component({
  selector: 'app-button',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './ui-button.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'inline-flex',
  },
})
export class AppButtonComponent {
  readonly variant = input<AppButtonVariant>('primary');
  readonly size = input<AppButtonSize>('md');
  readonly type = input<'button' | 'submit' | 'reset'>('button');
  readonly loading = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly fullWidth = input(false, { transform: booleanAttribute });
  readonly ariaLabel = input<string | null>(null);
  readonly title = input<string | null>(null);

  readonly Loader2 = Loader2;

  readonly classes = computed(() => {
    const parts = [
      BASE_CLASSES,
      VARIANT_CLASSES[this.variant()],
      SIZE_CLASSES[this.size()],
    ];
    if (this.fullWidth()) parts.push('w-full');
    return parts.join(' ');
  });

  readonly isDisabled = computed(() => this.disabled() || this.loading());
}
