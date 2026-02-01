import { computed, Injectable, signal } from '@angular/core';
import {
  Container,
  ContainerAction,
  ContainerRuntime,
  ContainerStatus,
} from '../core/models/container.model';
import { ContainerService } from '../core/services/container.service';

export type SortOption = 'name' | 'status' | 'created';

@Injectable({ providedIn: 'root' })
export class ContainerState {
  private _containers = signal<Container[]>([]);
  private _loading = signal<Record<string, boolean>>({});
  private _error = signal<string | null>(null);
  private _selectedContainerId = signal<string | null>(null);

  private _statusFilter = signal<ContainerStatus | null>(null);
  private _runtimeFilter = signal<ContainerRuntime | null>(null);
  private _searchQuery = signal<string>('');
  private _systemFilter = signal<string | null>(null);
  private _sortOption = signal<SortOption>('name');

  readonly containers = this._containers.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly selectedContainerId = this._selectedContainerId.asReadonly();

  readonly statusFilter = this._statusFilter.asReadonly();
  readonly runtimeFilter = this._runtimeFilter.asReadonly();
  readonly searchQuery = this._searchQuery.asReadonly();
  readonly systemFilter = this._systemFilter.asReadonly();
  readonly sortOption = this._sortOption.asReadonly();

  readonly selectedContainer = computed(() => {
    const id = this._selectedContainerId();
    return id ? this._containers().find((c) => c.id === id) ?? null : null;
  });

  readonly filteredContainers = computed(() => {
    let result = this._containers();

    const statusFilter = this._statusFilter();
    if (statusFilter) {
      result = result.filter((c) => c.status === statusFilter);
    }

    const runtimeFilter = this._runtimeFilter();
    if (runtimeFilter) {
      result = result.filter((c) => c.runtime === runtimeFilter);
    }

    const systemFilter = this._systemFilter();
    if (systemFilter) {
      result = result.filter((c) => c.systemId === systemFilter);
    }

    const query = this._searchQuery().toLowerCase();
    if (query) {
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.image.toLowerCase().includes(query) ||
          c.id.toLowerCase().includes(query)
      );
    }

    // Apply sorting
    const sortOption = this._sortOption();
    result = [...result].sort((a, b) => {
      switch (sortOption) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'status':
          return a.status.localeCompare(b.status);
        case 'created':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        default:
          return 0;
      }
    });

    return result;
  });

  readonly stats = computed(() => {
    const containers = this._containers();
    return {
      total: containers.length,
      running: containers.filter((c) => c.status === 'running').length,
      stopped: containers.filter(
        (c) => c.status === 'exited' || c.status === 'dead'
      ).length,
      paused: containers.filter((c) => c.status === 'paused').length,
    };
  });

  readonly containersBySystem = computed(() => {
    const grouped: Record<string, Container[]> = {};
    for (const container of this._containers()) {
      if (!grouped[container.systemId]) {
        grouped[container.systemId] = [];
      }
      grouped[container.systemId].push(container);
    }
    return grouped;
  });

  constructor(private containerService: ContainerService) {}

  async loadContainers(systemId: string): Promise<void> {
    this._loading.update((l) => ({ ...l, [systemId]: true }));
    this._error.set(null);

    try {
      const containers = await this.containerService.listContainers(systemId);
      this._containers.update((current) => {
        const filtered = current.filter((c) => c.systemId !== systemId);
        return [...filtered, ...containers];
      });
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : 'Failed to load containers');
    } finally {
      this._loading.update((l) => ({ ...l, [systemId]: false }));
    }
  }

  async loadContainersForSystems(systemIds: string[]): Promise<void> {
    await Promise.all(systemIds.map((id) => this.loadContainers(id)));
  }

  async performAction(
    container: Container,
    action: ContainerAction
  ): Promise<boolean> {
    this._loading.update((l) => ({ ...l, [container.id]: true }));
    this._error.set(null);

    try {
      await this.containerService.performAction(
        container.systemId,
        container.id,
        action,
        container.runtime
      );

      if (action === 'remove') {
        this._containers.update((containers) =>
          containers.filter((c) => c.id !== container.id)
        );
      } else {
        await this.loadContainers(container.systemId);
      }

      return true;
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : `Failed to ${action} container`);
      return false;
    } finally {
      this._loading.update((l) => ({ ...l, [container.id]: false }));
    }
  }

  async getLogs(
    container: Container,
    tail: number = 100,
    timestamps: boolean = true
  ): Promise<string | null> {
    try {
      return await this.containerService.getLogs(
        container.systemId,
        container.id,
        container.runtime,
        tail,
        timestamps
      );
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : 'Failed to get logs');
      return null;
    }
  }

  selectContainer(containerId: string | null): void {
    this._selectedContainerId.set(containerId);
  }

  setStatusFilter(status: ContainerStatus | null): void {
    this._statusFilter.set(status);
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

  setSortOption(option: SortOption): void {
    this._sortOption.set(option);
  }

  clearFilters(): void {
    this._statusFilter.set(null);
    this._runtimeFilter.set(null);
    this._systemFilter.set(null);
    this._searchQuery.set('');
    this._sortOption.set('name');
  }

  clearContainersForSystem(systemId: string): void {
    this._containers.update((containers) =>
      containers.filter((c) => c.systemId !== systemId)
    );
  }

  isLoading(id: string): boolean {
    return this._loading()[id] ?? false;
  }

  clearError(): void {
    this._error.set(null);
  }
}
