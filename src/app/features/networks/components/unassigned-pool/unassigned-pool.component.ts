import { ChangeDetectionStrategy, Component, computed, input, inject } from '@angular/core';
import { Container } from '../../../../core/models/container.model';
import { ContainerSystem } from '../../../../core/models/system.model';
import { ContainerChipComponent } from '../container-chip/container-chip.component';
import { LucideAngularModule, Box } from 'lucide-angular';
import { CdkDrag, CdkDropList, CdkDragPreview, CdkDragPlaceholder } from '@angular/cdk/drag-drop';
import { NetworkState } from '../../../../state/network.state';

interface SystemContainers {
  system: ContainerSystem;
  containers: Container[];
}

@Component({
  selector: 'app-unassigned-pool',
  imports: [LucideAngularModule, ContainerChipComponent, CdkDrag, CdkDropList, CdkDragPreview, CdkDragPlaceholder],
  templateUrl: './unassigned-pool.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnassignedPoolComponent {
  private networkState = inject(NetworkState);

  readonly systems = input.required<ContainerSystem[]>();
  readonly connectedDropListIds = input<string[]>([]);

  readonly Box = Box;

  readonly systemContainers = computed(() => {
    const result: SystemContainers[] = [];
    for (const system of this.systems()) {
      const containers = this.networkState.getContainersForSystem(system.id);
      if (containers.length > 0) {
        result.push({ system, containers });
      }
    }
    return result;
  });

  readonly hasContainers = computed(() =>
    this.systemContainers().some((sc) => sc.containers.length > 0)
  );

  getDropListId(systemId: string): string {
    return `unassigned-${systemId}`;
  }

  getNetworkCount(container: Container): number {
    return Object.keys(container.networkSettings.networks).length;
  }
}
