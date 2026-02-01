import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  Search,
  RefreshCw,
  Plus,
  Circle,
  SlidersHorizontal,
} from 'lucide-angular';
import { Container } from '../../../core/models/container.model';
import { Network } from '../../../core/models/network.model';
import { NetworkState, NetworkDriverFilter } from '../../../state/network.state';
import { SystemState } from '../../../state/system.state';
import { ContainerState } from '../../../state/container.state';
import { SystemNetworkSectionComponent } from '../components/system-network-section/system-network-section.component';

@Component({
  selector: 'app-network-list',
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    SystemNetworkSectionComponent,
  ],
  templateUrl: './network-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NetworkListComponent implements OnInit {
  readonly networkState = inject(NetworkState);
  readonly systemState = inject(SystemState);
  readonly containerState = inject(ContainerState);

  readonly Search = Search;
  readonly RefreshCw = RefreshCw;
  readonly Plus = Plus;
  readonly Circle = Circle;
  readonly SlidersHorizontal = SlidersHorizontal;

  readonly showMobileFilters = signal(false);
  refreshing = false;
  showCreateDialog = false;

  createForm = {
    name: '',
    systemId: '',
    runtime: 'docker' as const,
    driver: '',
    subnet: '',
  };

  /** Networks grouped by system, filtered */
  readonly filteredNetworksBySystem = computed(() => {
    const filtered = this.networkState.filteredNetworks();
    const grouped: Record<string, Network[]> = {};

    for (const network of filtered) {
      if (!grouped[network.systemId]) {
        grouped[network.systemId] = [];
      }
      grouped[network.systemId].push(network);
    }

    return grouped;
  });

  async ngOnInit(): Promise<void> {
    await this.refresh();
    const connected = this.systemState.connectedSystems();
    if (connected.length > 0) {
      this.createForm.systemId = connected[0].id;
    }
  }

  async refresh(): Promise<void> {
    this.refreshing = true;
    try {
      const systemIds = this.systemState.connectedSystems().map((s) => s.id);
      await Promise.all([
        ...systemIds.map((id) => this.networkState.loadNetworks(id)),
        ...systemIds.map((id) => this.containerState.loadContainers(id)),
      ]);
    } finally {
      this.refreshing = false;
    }
  }

  async createNetwork(): Promise<void> {
    if (!this.createForm.name || !this.createForm.systemId) return;

    await this.networkState.createNetwork(
      this.createForm.systemId,
      this.createForm.name,
      this.createForm.runtime,
      this.createForm.driver || undefined,
      this.createForm.subnet || undefined
    );

    this.showCreateDialog = false;
    this.createForm = {
      name: '',
      systemId: this.createForm.systemId,
      runtime: 'docker',
      driver: '',
      subnet: '',
    };
  }

  async onContainerConnected(event: { container: Container; network: Network }): Promise<void> {
    await this.networkState.connectContainer(event.container, event.network);
  }

  async onContainerDisconnected(event: { container: Container; network: Network }): Promise<void> {
    await this.networkState.disconnectContainer(event.container, event.network);
  }

  setDriverFilter(filter: NetworkDriverFilter): void {
    this.networkState.setDriverFilter(filter);
  }
}
