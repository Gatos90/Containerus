import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';

export interface EmptyStateCta {
  label: string;
  variant?: 'primary' | 'secondary';
}

@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './empty-state.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmptyStateComponent {
  /** Lucide icon object */
  readonly icon = input.required<unknown>();
  readonly headline = input.required<string>();
  readonly description = input<string>('');
  readonly primaryCta = input<EmptyStateCta | null>(null);
  readonly secondaryCta = input<EmptyStateCta | null>(null);

  readonly primaryAction = output<void>();
  readonly secondaryAction = output<void>();
}
