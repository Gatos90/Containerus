import { computed, Injectable } from '@angular/core';
import { BackendService } from '../core/services/backend.service';
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
    public readonly network: NetworkState,
    private readonly backend: BackendService,
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
    // Wait for backend auto-reconnect before loading systems
    await this.backend.waitForReady();
    await this.system.loadSystems();

    // Auto-connect systems that have autoConnect enabled (in parallel)
    const systemsToAutoConnect = this.system.systems().filter((s) => s.autoConnect);
    const autoConnectedIds = new Set<string>();
    await Promise.all(
      systemsToAutoConnect.map(async (system) => {
        const success = await this.system.connectSystem(system.id);
        if (success) {
          autoConnectedIds.add(system.id);
          await this.loadAllDataForSystem(system.id);
          await this.system.detectRuntimes(system.id);
        }
      })
    );

    // Load data for any already connected systems (including backend systems auto-connected by server)
    const connectedSystems = this.system.connectedSystems().filter(s => !autoConnectedIds.has(s.id));
    if (connectedSystems.length > 0) {
      await this.loadAllDataForSystems(connectedSystems.map((s) => s.id));
      // Start monitoring + fetch extended info
      await Promise.all(
        connectedSystems.map(async (s) => {
          await this.system.ensureMonitoring(s.id);
          if (!this.system.getExtendedInfo(s.id)) {
            await this.system.fetchExtendedInfo(s.id);
          }
        })
      );
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

  /** Called after a backend login/register to load systems and their data. */
  async onBackendAuthenticated(): Promise<void> {
    await this.system.loadSystems();
    const connected = this.system.connectedSystems();
    if (connected.length > 0) {
      await this.loadAllDataForSystems(connected.map(s => s.id));
      await Promise.all(
        connected
          .filter(s => this.backend.isBackendSystem(s.id))
          .map(async s => {
            await this.system.ensureMonitoring(s.id);
            if (!this.system.getExtendedInfo(s.id)) {
              await this.system.fetchExtendedInfo(s.id);
            }
          })
      );
    }
  }

  /** Called after a backend logout to reload systems (clears backend-provided systems). */
  async onBackendLogout(): Promise<void> {
    const backendSystems = this.system.systems().filter(s => this.backend.isBackendSystem(s.id));
    for (const sys of backendSystems) {
      this.clearDataForSystem(sys.id);
    }
    await this.system.loadSystems();
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
