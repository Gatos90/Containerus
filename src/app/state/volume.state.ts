import { computed, inject, Injectable, signal } from '@angular/core';
import { ContainerRuntime } from '../core/models/container.model';
import { Volume } from '../core/models/volume.model';
import { VolumeService } from '../core/services/volume.service';
import { ContainerState } from './container.state';

export type VolumeMountFilter = 'all' | 'mounted' | 'orphaned';

@Injectable({ providedIn: 'root' })
export class VolumeState {
  private containerState = inject(ContainerState);

  private _volumes = signal<Volume[]>([]);
  private _loading = signal<Record<string, boolean>>({});
  private _error = signal<string | null>(null);

  private _runtimeFilter = signal<ContainerRuntime | null>(null);
  private _searchQuery = signal<string>('');
  private _systemFilter = signal<string | null>(null);
  private _sortOption = signal<'name' | 'driver' | 'created'>('name');
  private _mountFilter = signal<VolumeMountFilter>('all');

  readonly volumes = this._volumes.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  readonly runtimeFilter = this._runtimeFilter.asReadonly();
  readonly searchQuery = this._searchQuery.asReadonly();
  readonly systemFilter = this._systemFilter.asReadonly();
  readonly sortOption = this._sortOption.asReadonly();
  readonly mountFilter = this._mountFilter.asReadonly();

  /** Get set of volume names currently mounted by containers */
  private getMountedVolumeNames(): Set<string> {
    const containers = this.containerState.containers();
    return new Set(
      containers
        .flatMap((c) => c.volumes.map((v) => v.volumeName))
        .filter((name): name is string => !!name)
    );
  }

  readonly filteredVolumes = computed(() => {
    let result = this._volumes();
    const mountedVolumeNames = this.getMountedVolumeNames();

    // Apply mount filter
    const mountFilter = this._mountFilter();
    if (mountFilter === 'mounted') {
      result = result.filter((v) => mountedVolumeNames.has(v.name));
    } else if (mountFilter === 'orphaned') {
      result = result.filter((v) => !mountedVolumeNames.has(v.name));
    }

    const runtimeFilter = this._runtimeFilter();
    if (runtimeFilter) {
      result = result.filter((v) => v.runtime === runtimeFilter);
    }

    const systemFilter = this._systemFilter();
    if (systemFilter) {
      result = result.filter((v) => v.systemId === systemFilter);
    }

    const query = this._searchQuery().toLowerCase();
    if (query) {
      result = result.filter(
        (v) =>
          v.name.toLowerCase().includes(query) ||
          v.driver.toLowerCase().includes(query)
      );
    }

    // Sort results - in-use (mounted) volumes first, then by selected option
    const sortOption = this._sortOption();
    result = [...result].sort((a, b) => {
      // First: sort by mounted status (mounted first)
      const aMounted = mountedVolumeNames.has(a.name);
      const bMounted = mountedVolumeNames.has(b.name);
      if (aMounted !== bMounted) {
        return aMounted ? -1 : 1;
      }

      // Then: sort by selected option
      switch (sortOption) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'driver':
          return a.driver.localeCompare(b.driver);
        case 'created':
          return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
        default:
          return 0;
      }
    });

    return result;
  });

  readonly stats = computed(() => {
    const volumes = this._volumes();
    const mountedVolumeNames = this.getMountedVolumeNames();

    const mounted = volumes.filter((v) => mountedVolumeNames.has(v.name)).length;

    return {
      total: volumes.length,
      mounted,
      orphaned: volumes.length - mounted,
    };
  });

  readonly volumesBySystem = computed(() => {
    const grouped: Record<string, Volume[]> = {};
    for (const volume of this._volumes()) {
      if (!grouped[volume.systemId]) {
        grouped[volume.systemId] = [];
      }
      grouped[volume.systemId].push(volume);
    }
    return grouped;
  });

  constructor(private volumeService: VolumeService) {}

  async loadVolumes(systemId: string): Promise<void> {
    this._loading.update((l) => ({ ...l, [systemId]: true }));
    this._error.set(null);

    try {
      const volumes = await this.volumeService.listVolumes(systemId);
      this._volumes.update((current) => {
        const filtered = current.filter((v) => v.systemId !== systemId);
        return [...filtered, ...volumes];
      });
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : 'Failed to load volumes');
    } finally {
      this._loading.update((l) => ({ ...l, [systemId]: false }));
    }
  }

  async createVolume(
    systemId: string,
    name: string,
    runtime: ContainerRuntime,
    driver?: string
  ): Promise<boolean> {
    this._loading.update((l) => ({ ...l, create: true }));
    this._error.set(null);

    try {
      await this.volumeService.createVolume(systemId, name, runtime, driver);
      await this.loadVolumes(systemId);
      return true;
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : 'Failed to create volume');
      return false;
    } finally {
      this._loading.update((l) => ({ ...l, create: false }));
    }
  }

  async removeVolume(volume: Volume): Promise<boolean> {
    this._loading.update((l) => ({ ...l, [volume.name]: true }));
    this._error.set(null);

    try {
      await this.volumeService.removeVolume(
        volume.systemId,
        volume.name,
        volume.runtime
      );
      this._volumes.update((volumes) =>
        volumes.filter(
          (v) => !(v.name === volume.name && v.systemId === volume.systemId)
        )
      );
      return true;
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : 'Failed to remove volume');
      return false;
    } finally {
      this._loading.update((l) => ({ ...l, [volume.name]: false }));
    }
  }

  setRuntimeFilter(runtime: ContainerRuntime | null): void {
    this._runtimeFilter.set(runtime);
  }

  setSystemFilter(systemId: string | null): void {
    this._systemFilter.set(systemId);
  }

  setSearchQuery(query: string): void {
    this._searchQuery.set(query);
  }

  setSortOption(option: 'name' | 'driver' | 'created'): void {
    this._sortOption.set(option);
  }

  setMountFilter(filter: VolumeMountFilter): void {
    this._mountFilter.set(filter);
  }

  clearFilters(): void {
    this._runtimeFilter.set(null);
    this._systemFilter.set(null);
    this._searchQuery.set('');
    this._sortOption.set('name');
    this._mountFilter.set('all');
  }

  /** Check if a volume is currently mounted by any container */
  isVolumeMounted(volume: Volume): boolean {
    const mountedVolumeNames = this.getMountedVolumeNames();
    return mountedVolumeNames.has(volume.name);
  }

  /** Get containers that are using a specific volume */
  getContainersUsingVolume(volumeName: string) {
    return this.containerState.containers().filter((c) =>
      c.volumes.some((v) => v.volumeName === volumeName || v.source === volumeName)
    );
  }

  clearVolumesForSystem(systemId: string): void {
    this._volumes.update((volumes) =>
      volumes.filter((v) => v.systemId !== systemId)
    );
  }

  isLoading(id: string): boolean {
    return this._loading()[id] ?? false;
  }

  clearError(): void {
    this._error.set(null);
  }
}
