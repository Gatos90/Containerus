import { ChangeDetectionStrategy, Component, computed, input, model, output } from '@angular/core';
import { Container, ContainerRuntime } from '../../../../core/models/container.model';
import { Network } from '../../../../core/models/network.model';
import { ContainerSystem } from '../../../../core/models/system.model';
import { NetworkCardComponent } from '../network-card/network-card.component';
import { ContainerChipComponent } from '../container-chip/container-chip.component';
import { LucideAngularModule, ChevronDown, ChevronRight, Globe, Server, Box } from 'lucide-angular';
import { CdkDropListGroup, CdkDragDrop, CdkDropList, CdkDrag, CdkDragPreview, CdkDragPlaceholder } from '@angular/cdk/drag-drop';
import { NetworkState } from '../../../../state/network.state';
import { inject } from '@angular/core';

@Component({
  selector: 'app-system-network-section',
  imports: [LucideAngularModule, NetworkCardComponent, ContainerChipComponent, CdkDropListGroup, CdkDropList, CdkDrag, CdkDragPreview, CdkDragPlaceholder],
  templateUrl: './system-network-section.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SystemNetworkSectionComponent {
  private networkState = inject(NetworkState);

  readonly system = input.required<ContainerSystem>();
  readonly networks = input.required<Network[]>();
  readonly expanded = model(false);

  readonly containerConnected = output<{ container: Container; network: Network }>();
  readonly containerDisconnected = output<{ container: Container; network: Network }>();

  readonly ChevronDown = ChevronDown;
  readonly ChevronRight = ChevronRight;
  readonly Globe = Globe;
  readonly Server = Server;
  readonly Box = Box;

  readonly networkCount = computed(() => this.networks().length);

  readonly unassignedContainers = computed(() =>
    this.networkState.getContainersForSystem(this.system().id)
  );

  readonly containerCount = computed(() => {
    const systemId = this.system().id;
    const containers = this.networkState.getContainersForSystem(systemId);
    return containers.length;
  });

  readonly runtimeIcon = computed(() => {
    switch (this.system().primaryRuntime) {
      case 'docker':
        return 'Docker';
      case 'podman':
        return 'Podman';
      case 'apple':
        return 'Apple';
      default:
        return 'Container';
    }
  });

  readonly dropListIds = computed(() =>
    this.networks().map((n) => `network-${n.id}`)
  );

  readonly unassignedDropListId = computed(() => `unassigned-${this.system().id}`);

  toggleExpanded(): void {
    this.expanded.update((v) => !v);
  }

  getDropListId(network: Network): string {
    return `network-${network.id}`;
  }

  getConnectedDropLists(network: Network): string[] {
    // Connect to all other network cards in this system + the unassigned pool
    const others = this.dropListIds().filter((id) => id !== `network-${network.id}`);
    return [...others, this.unassignedDropListId()];
  }

  getContainersInNetwork(network: Network): Container[] {
    return this.networkState.getContainersInNetwork(network);
  }

  isDefaultNetwork(network: Network): boolean {
    // Common default network names
    const defaults = ['bridge', 'host', 'none', 'podman'];
    return defaults.includes(network.name.toLowerCase());
  }

  onContainerRemoved(container: Container, network: Network): void {
    this.containerDisconnected.emit({ container, network });
  }

  onContainerDropped(event: CdkDragDrop<Network, Container[], Container>, network: Network): void {
    const container = event.item.data as Container;

    // Only emit if container is not already in this network
    if (!this.networkState.isContainerInNetwork(container, network)) {
      this.containerConnected.emit({ container, network });
    }
  }

  getNetworkCount(container: Container): number {
    return Object.keys(container.networkSettings.networks).length;
  }
}
