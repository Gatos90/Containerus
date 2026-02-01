import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Container } from '../../../../core/models/container.model';
import { Network } from '../../../../core/models/network.model';
import { ContainerChipComponent } from '../container-chip/container-chip.component';
import { LucideAngularModule, Info, Plus } from 'lucide-angular';
import { CdkDropList, CdkDrag, CdkDragDrop } from '@angular/cdk/drag-drop';

@Component({
  selector: 'app-network-card',
  imports: [LucideAngularModule, ContainerChipComponent, CdkDropList],
  templateUrl: './network-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NetworkCardComponent {
  readonly network = input.required<Network>();
  readonly containers = input.required<Container[]>();
  readonly isDefault = input(false);
  readonly dropListId = input.required<string>();
  readonly connectedDropLists = input<string[]>([]);

  readonly containerRemoved = output<Container>();
  readonly containerDropped = output<CdkDragDrop<Network, Container[], Container>>();

  readonly Info = Info;
  readonly Plus = Plus;

  readonly containerCount = computed(() => this.containers().length);

  readonly driverInfo = computed(() => {
    const n = this.network();
    const scope = n.scope.charAt(0).toUpperCase() + n.scope.slice(1);
    return `${n.driver.charAt(0).toUpperCase() + n.driver.slice(1)}, ${scope}`;
  });

  onContainerRemoved(container: Container): void {
    this.containerRemoved.emit(container);
  }

  onDrop(event: CdkDragDrop<Network, Container[], Container>): void {
    this.containerDropped.emit(event);
  }
}
