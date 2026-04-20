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
  /**
   * Structured list of destructive side-effects. When provided, renders as a
   * real `<ul role="list">` so screen readers expose list semantics and item
   * count instead of flattening bullet glyphs into the surrounding sentence.
   */
  readonly consequences = input<readonly string[]>([]);
  /**
   * Optional trailing reassurance/context paragraph rendered after the
   * consequences list (e.g. "ACLs are preserved...").
   */
  readonly note = input<string | null>(null);
  readonly confirmText = input<string>('Confirm');
  readonly cancelText = input<string>('Cancel');
  readonly variant = input<ConfirmDialogVariant>('destructive');
  readonly busy = input(false, { transform: booleanAttribute });

  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  // Shared seq across title + description keeps the pair stable per instance
  // so aria-labelledby and aria-describedby never cross-wire between dialogs.
  private readonly seq = ++confirmDialogSeq;
  readonly titleId = `confirm-dialog-title-${this.seq}`;
  readonly descriptionId = `confirm-dialog-desc-${this.seq}`;

  onConfirm(): void {
    if (this.busy()) return;
    this.confirmed.emit();
  }

  onCancel(): void {
    if (this.busy()) return;
    this.cancelled.emit();
  }
}
