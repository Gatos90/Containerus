import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-empty-state',
  imports: [LucideAngularModule],
  template: `
    <div class="flex flex-col items-center justify-center py-16 text-center">
      @if (icon()) {
        <lucide-icon [img]="icon()" class="w-12 h-12 text-gray-400 mb-4" />
      }
      <h3 class="text-lg font-medium text-gray-200 mb-2">{{ headline() }}</h3>
      @if (description()) {
        <p class="text-sm text-gray-400 max-w-sm">{{ description() }}</p>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmptyStateComponent {
  icon = input<any>(null);
  headline = input<string>('');
  description = input<string>('');
}
