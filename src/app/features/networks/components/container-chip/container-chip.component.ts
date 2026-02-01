import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Container, getStatusColor } from '../../../../core/models/container.model';
import { LucideAngularModule, X } from 'lucide-angular';

@Component({
  selector: 'app-container-chip',
  imports: [LucideAngularModule],
  templateUrl: './container-chip.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContainerChipComponent {
  readonly container = input.required<Container>();
  readonly removable = input(true);
  readonly networkCount = input<number>();
  readonly compact = input(false);

  readonly removed = output<void>();

  readonly X = X;

  readonly statusDotClass = computed(() => {
    const status = this.container().status;
    switch (status) {
      case 'running':
        return 'bg-green-500';
      case 'paused':
        return 'bg-yellow-500';
      case 'restarting':
        return 'bg-orange-500';
      case 'exited':
      case 'dead':
        return 'bg-red-500';
      case 'created':
        return 'bg-blue-500';
      default:
        return 'bg-zinc-500';
    }
  });

  readonly displayName = computed(() => {
    const c = this.container();
    return c.name?.length ? c.name : c.id.slice(0, 12);
  });

  onRemove(event: Event): void {
    event.stopPropagation();
    this.removed.emit();
  }
}
