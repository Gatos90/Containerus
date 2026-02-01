import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from '@angular/core';
import { LucideAngularModule, Copy } from 'lucide-angular';
import { ClipboardService } from '../../../core/services/clipboard.service';

@Component({
  selector: 'app-detail-field',
  imports: [LucideAngularModule],
  templateUrl: './detail-field.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetailFieldComponent {
  private clipboard = inject(ClipboardService);

  label = input.required<string>();
  value = input.required<string | number | null>();
  copyable = input(false);

  readonly Copy = Copy;
  readonly String = String;

  displayValue(): string {
    const val = this.value();
    return val != null ? String(val) : 'N/A';
  }

  async copyToClipboard(): Promise<void> {
    const val = this.value();
    if (val != null) {
      await this.clipboard.copyValue(val);
    }
  }
}
