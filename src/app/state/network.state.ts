import { computed, inject, Injectable, signal } from '@angular/core';
import { Container, ContainerRuntime } from '../core/models/container.model';
import { Network } from '../core/models/network.model';
import { NetworkService } from '../core/services/network.service';
import { ContainerState } from './container.state';

export type NetworkConnectionFilter = 'all' | 'active' | 'empty' | 'internal';
export type NetworkDriverFilter = 'all' | 'bridge' | 'host' | 'overlay' | 'custom';

@Injectable({ providedIn: 'root' })
export class NetworkState {
  private containerState = inject(ContainerState);

  private _networks = signal<Network[]>([]);
  private _loading = signal<Record<string, boolean>>({});
  private _error = signal<string | null>(null);

  private _runtimeFilter = signal<ContainerRuntime | null>(null);
  private _searchQuery = signal<string>('');
  private _systemFilter = signal<string | null>(null);
  private _sortOption = signal<'name' | 'driver' | 'scope'>('name');
  private _connectionFilter = signal<NetworkConnectionFilter>('all');
  private _driverFilter = signal<NetworkDriverFilter>('all');

  readonly networks = this._networks.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  readonly runtimeFilter = this._runtimeFilter.asReadonly();
  readonly searchQuery = this._searchQuery.asReadonly();
  readonly systemFilter = this._systemFilter.asReadonly();
  readonly sortOption = this._sortOption.asReadonly();
  readonly connectionFilter = this._connectionFilter.asReadonly();
  readonly driverFilter = this._driverFilter.asReadonly();

  /** Get set of network names that have connected containers */
  private getActiveNetworkNames(): Set<string> {
    const containers = this.containerState.containers();
    return new Set(
      containers.flatMap((c) => Object.keys(c.networkSettings.networks))
    );
  }

  /** Helper to check if driver matches a custom type (not standard) */
  private isCustomDriver(driver: string): boolean {
    const standardDrivers = ['bridge', 'host', 'overlay', 'none', 'null'];
    return !standardDrivers.includes(driver.toLowerCase());
  }

  readonly filteredNetworks = computed(() => {
    let result = this._networks();
    const activeNetworkNames = this.getActiveNetworkNames();

    // Apply driver filter
    const driverFilter = this._driverFilter();
    if (driverFilter !== 'all') {
      if (driverFilter === 'custom') {
        result = result.filter((n) => this.isCustomDriver(n.driver));
      } else {
        result = result.filter((n) => n.driver.toLowerCase() === driverFilter);
      }
    }

    // Apply connection filter
    const connectionFilter = this._connectionFilter();
    if (connectionFilter === 'active') {
      result = result.filter((n) => activeNetworkNames.has(n.name));
    } else if (connectionFilter === 'empty') {
      result = result.filter((n) => !activeNetworkNames.has(n.name));
    } else if (connectionFilter === 'internal') {
      result = result.filter((n) => n.internal);
    }

    const runtimeFilter = this._runtimeFilter();
    if (runtimeFilter) {
      result = result.filter((n) => n.runtime === runtimeFilter);
    }

    const systemFilter = this._systemFilter();
    if (systemFilter) {
      result = result.filter((n) => n.systemId === systemFilter);
    }

    const query = this._searchQuery().toLowerCase();
    if (query) {
      result = result.filter(
        (n) =>
          n.name.toLowerCase().includes(query) ||
          n.driver.toLowerCase().includes(query) ||
          n.id.toLowerCase().includes(query)
      );
    }

    // Sort results
    const sortOption = this._sortOption();
    result = [...result].sort((a, b) => {
      switch (sortOption) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'driver':
          return a.driver.localeCompare(b.driver);
        case 'scope':
          return a.scope.localeCompare(b.scope);
        default:
          return 0;
      }
    });

    return result;
  });

  readonly stats = computed(() => {
    const networks = this._networks();
    const activeNetworkNames = this.getActiveNetworkNames();

    const active = networks.filter((n) => activeNetworkNames.has(n.name)).length;
    const internal = networks.filter((n) => n.internal).length;
    const bridge = networks.filter((n) => n.driver.toLowerCase() === 'bridge').length;
    const host = networks.filter((n) => n.driver.toLowerCase() === 'host').length;
    const overlay = networks.filter((n) => n.driver.toLowerCase() === 'overlay').length;
    const custom = networks.filter((n) => this.isCustomDriver(n.driver)).length;

    return {
      total: networks.length,
      active,
      empty: networks.length - active,
      internal,
      bridge,
      host,
      overlay,
      custom,
    };
  });

  readonly networksBySystem = computed(() => {
    const grouped: Record<string, Network[]> = {};
    for (const network of this._networks()) {
      if (!grouped[network.systemId]) {
        grouped[network.systemId] = [];
      }
      grouped[network.systemId].push(network);
    }
    return grouped;
  });

  constructor(private networkService: NetworkService) {}

  async loadNetworks(systemId: string): Promise<void> {
    this._loading.update((l) => ({ ...l, [systemId]: true }));
    this._error.set(null);

    try {
      const networks = await this.networkService.listNetworks(systemId);
      this._networks.update((current) => {
        const filtered = current.filter((n) => n.systemId !== systemId);
        return [...filtered, ...networks];
      });
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : 'Failed to load networks');
    } finally {
      this._loading.update((l) => ({ ...l, [systemId]: false }));
    }
  }

  async createNetwork(
    systemId: string,
    name: string,
    runtime: ContainerRuntime,
    driver?: string,
    subnet?: string
  ): Promise<boolean> {
    this._loading.update((l) => ({ ...l, create: true }));
    this._error.set(null);

    try {
      await this.networkService.createNetwork(
        systemId,
        name,
        runtime,
        driver,
        subnet
      );
      await this.loadNetworks(systemId);
      return true;
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : 'Failed to create network');
      return false;
    } finally {
      this._loading.update((l) => ({ ...l, create: false }));
    }
  }

  async removeNetwork(network: Network): Promise<boolean> {
    this._loading.update((l) => ({ ...l, [network.id]: true }));
    this._error.set(null);

    try {
      await this.networkService.removeNetwork(
        network.systemId,
        network.name,
        network.runtime
      );
      this._networks.update((networks) =>
        networks.filter((n) => n.id !== network.id)
      );
      return true;
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : 'Failed to remove network');
      return false;
    } finally {
      this._loading.update((l) => ({ ...l, [network.id]: false }));
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

  setSortOption(option: 'name' | 'driver' | 'scope'): void {
    this._sortOption.set(option);
  }

  setConnectionFilter(filter: NetworkConnectionFilter): void {
    this._connectionFilter.set(filter);
  }

  setDriverFilter(filter: NetworkDriverFilter): void {
    this._driverFilter.set(filter);
  }

  clearFilters(): void {
    this._runtimeFilter.set(null);
    this._systemFilter.set(null);
    this._searchQuery.set('');
    this._sortOption.set('name');
    this._connectionFilter.set('all');
    this._driverFilter.set('all');
  }

  /** Check if a network has connected containers */
  isNetworkActive(network: Network): boolean {
    const activeNetworkNames = this.getActiveNetworkNames();
    return activeNetworkNames.has(network.name);
  }

  /** Get all containers connected to a specific network */
  getContainersInNetwork(network: Network): Container[] {
    const containers = this.containerState.containers();
    return containers.filter(
      (c) =>
        c.systemId === network.systemId &&
        Object.keys(c.networkSettings.networks).includes(network.name)
    );
  }

  /** Get containers not connected to any network (for unassigned pool) */
  getUnassignedContainers(systemId: string): Container[] {
    const containers = this.containerState.containers();
    return containers.filter(
      (c) =>
        c.systemId === systemId &&
        Object.keys(c.networkSettings.networks).length === 0
    );
  }

  /** Get all containers for a system (for drag source) */
  getContainersForSystem(systemId: string): Container[] {
    return this.containerState.containers().filter((c) => c.systemId === systemId);
  }

  /** Connect a container to a network */
  async connectContainer(container: Container, network: Network): Promise<boolean> {
    const key = `connect-${container.id}-${network.id}`;
    this._loading.update((l) => ({ ...l, [key]: true }));
    this._error.set(null);

    try {
      await this.networkService.connectContainerToNetwork(
        network.systemId,
        container.id,
        network.name,
        network.runtime
      );
      // Refresh containers to update their network settings
      await this.containerState.loadContainers(network.systemId);
      return true;
    } catch (err) {
      this._error.set(
        err instanceof Error ? err.message : 'Failed to connect container to network'
      );
      return false;
    } finally {
      this._loading.update((l) => ({ ...l, [key]: false }));
    }
  }

  /** Disconnect a container from a network */
  async disconnectContainer(container: Container, network: Network): Promise<boolean> {
    const key = `disconnect-${container.id}-${network.id}`;
    this._loading.update((l) => ({ ...l, [key]: true }));
    this._error.set(null);

    try {
      await this.networkService.disconnectContainerFromNetwork(
        network.systemId,
        container.id,
        network.name,
        network.runtime
      );
      // Refresh containers to update their network settings
      await this.containerState.loadContainers(network.systemId);
      return true;
    } catch (err) {
      this._error.set(
        err instanceof Error ? err.message : 'Failed to disconnect container from network'
      );
      return false;
    } finally {
      this._loading.update((l) => ({ ...l, [key]: false }));
    }
  }

  /** Check if container is already in network */
  isContainerInNetwork(container: Container, network: Network): boolean {
    return Object.keys(container.networkSettings.networks).includes(network.name);
  }

  clearNetworksForSystem(systemId: string): void {
    this._networks.update((networks) =>
      networks.filter((n) => n.systemId !== systemId)
    );
  }

  isLoading(id: string): boolean {
    return this._loading()[id] ?? false;
  }

  clearError(): void {
    this._error.set(null);
  }
}
