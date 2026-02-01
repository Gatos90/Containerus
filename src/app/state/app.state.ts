import { computed, Injectable } from '@angular/core';
import { ContainerState } from './container.state';
import { ImageState } from './image.state';
import { NetworkState } from './network.state';
import { SystemState } from './system.state';
import { VolumeState } from './volume.state';

@Injectable({ providedIn: 'root' })
export class AppState {
  constructor(
    public readonly system: SystemState,
    public readonly container: ContainerState,
    public readonly image: ImageState,
    public readonly volume: VolumeState,
    public readonly network: NetworkState
  ) {}

  readonly isInitialized = computed(() => this.system.systems().length > 0);

  readonly globalError = computed(
    () =>
      this.system.error() ||
      this.container.error() ||
      this.image.error() ||
      this.volume.error() ||
      this.network.error()
  );

  readonly isLoading = computed(
    () =>
      this.system.loading() ||
      Object.values(this.container.loading()).some(Boolean) ||
      Object.values(this.image.loading()).some(Boolean) ||
      Object.values(this.volume.loading()).some(Boolean) ||
      Object.values(this.network.loading()).some(Boolean)
  );

  readonly globalStats = computed(() => ({
    systems: this.system.stats(),
    containers: this.container.stats(),
    images: this.image.stats(),
    volumes: this.volume.stats(),
    networks: this.network.stats(),
  }));

  async initialize(): Promise<void> {
    await this.system.loadSystems();

    // Auto-connect systems that have autoConnect enabled
    const systemsToAutoConnect = this.system.systems().filter((s) => s.autoConnect);
    for (const system of systemsToAutoConnect) {
      const success = await this.system.connectSystem(system.id);
      if (success) {
        await this.loadAllDataForSystem(system.id);
        await this.system.detectRuntimes(system.id);
      }
    }

    // Load data for any already connected systems
    const connectedSystems = this.system.connectedSystems();
    if (connectedSystems.length > 0) {
      await this.loadAllDataForSystems(connectedSystems.map((s) => s.id));
    }
  }

  async loadAllDataForSystems(systemIds: string[]): Promise<void> {
    await Promise.all([
      this.container.loadContainersForSystems(systemIds),
      ...systemIds.map((id) => this.image.loadImages(id)),
      ...systemIds.map((id) => this.volume.loadVolumes(id)),
      ...systemIds.map((id) => this.network.loadNetworks(id)),
    ]);
  }

  async loadAllDataForSystem(systemId: string): Promise<void> {
    await Promise.all([
      this.container.loadContainers(systemId),
      this.image.loadImages(systemId),
      this.volume.loadVolumes(systemId),
      this.network.loadNetworks(systemId),
    ]);
  }

  clearDataForSystem(systemId: string): void {
    this.container.clearContainersForSystem(systemId);
    this.image.clearImagesForSystem(systemId);
    this.volume.clearVolumesForSystem(systemId);
    this.network.clearNetworksForSystem(systemId);
  }

  clearAllErrors(): void {
    this.system.clearError();
    this.container.clearError();
    this.image.clearError();
    this.volume.clearError();
    this.network.clearError();
  }

  setSystemFilter(systemId: string | null): void {
    this.container.setSystemFilter(systemId);
    this.image.setSystemFilter(systemId);
    this.volume.setSystemFilter(systemId);
    this.network.setSystemFilter(systemId);
  }

  clearAllFilters(): void {
    this.container.clearFilters();
    this.image.clearFilters();
    this.volume.clearFilters();
    this.network.clearFilters();
  }
}
