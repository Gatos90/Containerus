import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppModalDirective } from '../../directives/app-modal.directive';
import { AppButtonComponent } from '../ui-button/ui-button.component';

export type ConfirmDialogVariant = 'default' | 'destructive';

let confirmDialogSeq = 0;

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [CommonModule, AppModalDirective, AppButtonComponent],
  templateUrl: './confirm-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmDialogComponent {
  readonly open = input(false, { transform: booleanAttribute });
  readonly title = input<string>('Confirm');
  readonly message = input<string>('Are you sure?');
  readonly confirmText = input<string>('Confirm');
  readonly cancelText = input<string>('Cancel');
  readonly variant = input<ConfirmDialogVariant>('destructive');
  readonly busy = input(false, { transform: booleanAttribute });

  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  readonly titleId = `confirm-dialog-title-${++confirmDialogSeq}`;

  onConfirm(): void {
    if (this.busy()) return;
    this.confirmed.emit();
  }

  onCancel(): void {
    if (this.busy()) return;
    this.cancelled.emit();
  }
}
