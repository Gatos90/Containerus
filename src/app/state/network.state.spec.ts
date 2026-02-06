import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { NetworkState } from './network.state';
import { ContainerState } from './container.state';
import { NetworkService } from '../core/services/network.service';
import type { Network } from '../core/models/network.model';
import type { Container } from '../core/models/container.model';

describe('NetworkState', () => {
  let state: NetworkState;
  let mockNetworkService: any;
  let mockContainerState: any;

  const makeNetwork = (overrides: Partial<Network> = {}): Network => ({
    id: 'net-1',
    name: 'my-network',
    driver: 'bridge',
    scope: 'local',
    createdAt: '2024-01-01T00:00:00Z',
    internal: false,
    attachable: true,
    labels: {},
    runtime: 'docker',
    systemId: 'sys-1',
    ...overrides,
  } as Network);

  const makeContainer = (overrides: Partial<Container> = {}): Container => ({
    id: 'c-1',
    name: 'test-container',
    image: 'nginx:latest',
    status: 'running',
    runtime: 'docker',
    systemId: 'sys-1',
    ports: [],
    volumes: [],
    networks: [],
    labels: {},
    env: [],
    networkSettings: { networks: {} },
    ...overrides,
  } as Container);

  beforeEach(() => {
    mockNetworkService = {
      listNetworks: vi.fn(),
      createNetwork: vi.fn(),
      removeNetwork: vi.fn(),
      connectContainerToNetwork: vi.fn(),
      disconnectContainerFromNetwork: vi.fn(),
    };
    mockContainerState = {
      containers: signal([]),
      loadContainers: vi.fn().mockResolvedValue(undefined),
    };

    const injector = Injector.create({
      providers: [
        { provide: ContainerState, useValue: mockContainerState },
      ],
    });

    state = runInInjectionContext(injector, () => new NetworkState(mockNetworkService));
  });

  it('should start with empty state', () => {
    expect(state.networks()).toEqual([]);
    expect(state.error()).toBeNull();
  });

  it('should load networks', async () => {
    mockNetworkService.listNetworks.mockResolvedValue([makeNetwork(), makeNetwork({ id: 'net-2', name: 'other' })]);

    await state.loadNetworks('sys-1');

    expect(state.networks()).toHaveLength(2);
  });

  it('should handle load error', async () => {
    mockNetworkService.listNetworks.mockRejectedValue(new Error('Connection failed'));

    await state.loadNetworks('sys-1');

    expect(state.error()).toBe('Connection failed');
  });

  it('should replace networks for same system', async () => {
    mockNetworkService.listNetworks.mockResolvedValue([makeNetwork()]);
    await state.loadNetworks('sys-1');

    mockNetworkService.listNetworks.mockResolvedValue([makeNetwork({ id: 'net-new', name: 'new-net' })]);
    await state.loadNetworks('sys-1');

    expect(state.networks()).toHaveLength(1);
    expect(state.networks()[0].name).toBe('new-net');
  });

  it('should create a network', async () => {
    mockNetworkService.createNetwork.mockResolvedValue(undefined);
    mockNetworkService.listNetworks.mockResolvedValue([makeNetwork()]);

    const result = await state.createNetwork('sys-1', 'my-network', 'docker', 'bridge');

    expect(result).toBe(true);
    expect(mockNetworkService.createNetwork).toHaveBeenCalled();
  });

  it('should handle create error', async () => {
    mockNetworkService.createNetwork.mockRejectedValue(new Error('Already exists'));

    const result = await state.createNetwork('sys-1', 'my-network', 'docker');

    expect(result).toBe(false);
    expect(state.error()).toBe('Already exists');
  });

  it('should remove a network', async () => {
    mockNetworkService.listNetworks.mockResolvedValue([makeNetwork()]);
    await state.loadNetworks('sys-1');

    mockNetworkService.removeNetwork.mockResolvedValue(undefined);

    const result = await state.removeNetwork(makeNetwork());

    expect(result).toBe(true);
    expect(state.networks()).toHaveLength(0);
  });

  it('should handle remove error', async () => {
    mockNetworkService.removeNetwork.mockRejectedValue(new Error('Has endpoints'));

    const result = await state.removeNetwork(makeNetwork());

    expect(result).toBe(false);
    expect(state.error()).toBe('Has endpoints');
  });

  it('should filter by driver - bridge', async () => {
    mockNetworkService.listNetworks.mockResolvedValue([
      makeNetwork({ id: 'n1', name: 'bridge-net', driver: 'bridge' }),
      makeNetwork({ id: 'n2', name: 'host-net', driver: 'host' }),
    ]);
    await state.loadNetworks('sys-1');

    state.setDriverFilter('bridge');
    expect(state.filteredNetworks()).toHaveLength(1);
    expect(state.filteredNetworks()[0].name).toBe('bridge-net');
  });

  it('should filter by driver - custom', async () => {
    mockNetworkService.listNetworks.mockResolvedValue([
      makeNetwork({ id: 'n1', name: 'bridge-net', driver: 'bridge' }),
      makeNetwork({ id: 'n2', name: 'macvlan-net', driver: 'macvlan' }),
    ]);
    await state.loadNetworks('sys-1');

    state.setDriverFilter('custom');
    expect(state.filteredNetworks()).toHaveLength(1);
    expect(state.filteredNetworks()[0].driver).toBe('macvlan');
  });

  it('should filter by connection - active', async () => {
    mockContainerState.containers.set([
      makeContainer({ networkSettings: { networks: { 'active-net': {} } } }),
    ]);
    mockNetworkService.listNetworks.mockResolvedValue([
      makeNetwork({ id: 'n1', name: 'active-net' }),
      makeNetwork({ id: 'n2', name: 'empty-net' }),
    ]);
    await state.loadNetworks('sys-1');

    state.setConnectionFilter('active');
    expect(state.filteredNetworks()).toHaveLength(1);
    expect(state.filteredNetworks()[0].name).toBe('active-net');
  });

  it('should filter by connection - empty', async () => {
    mockContainerState.containers.set([
      makeContainer({ networkSettings: { networks: { 'active-net': {} } } }),
    ]);
    mockNetworkService.listNetworks.mockResolvedValue([
      makeNetwork({ id: 'n1', name: 'active-net' }),
      makeNetwork({ id: 'n2', name: 'empty-net' }),
    ]);
    await state.loadNetworks('sys-1');

    state.setConnectionFilter('empty');
    expect(state.filteredNetworks()).toHaveLength(1);
    expect(state.filteredNetworks()[0].name).toBe('empty-net');
  });

  it('should filter by connection - internal', async () => {
    mockNetworkService.listNetworks.mockResolvedValue([
      makeNetwork({ id: 'n1', name: 'public-net', internal: false }),
      makeNetwork({ id: 'n2', name: 'internal-net', internal: true }),
    ]);
    await state.loadNetworks('sys-1');

    state.setConnectionFilter('internal');
    expect(state.filteredNetworks()).toHaveLength(1);
    expect(state.filteredNetworks()[0].name).toBe('internal-net');
  });

  it('should filter by runtime', async () => {
    mockNetworkService.listNetworks.mockResolvedValue([
      makeNetwork({ id: 'n1', runtime: 'docker' }),
      makeNetwork({ id: 'n2', name: 'podman-net', runtime: 'podman' }),
    ]);
    await state.loadNetworks('sys-1');

    state.setRuntimeFilter('podman');
    expect(state.filteredNetworks()).toHaveLength(1);
  });

  it('should filter by search query', async () => {
    mockNetworkService.listNetworks.mockResolvedValue([
      makeNetwork({ id: 'n1', name: 'frontend-net' }),
      makeNetwork({ id: 'n2', name: 'backend-net' }),
    ]);
    await state.loadNetworks('sys-1');

    state.setSearchQuery('backend');
    expect(state.filteredNetworks()).toHaveLength(1);
    expect(state.filteredNetworks()[0].name).toBe('backend-net');
  });

  it('should sort by name', async () => {
    mockNetworkService.listNetworks.mockResolvedValue([
      makeNetwork({ id: 'n1', name: 'zebra-net' }),
      makeNetwork({ id: 'n2', name: 'alpha-net' }),
    ]);
    await state.loadNetworks('sys-1');

    state.setSortOption('name');
    expect(state.filteredNetworks()[0].name).toBe('alpha-net');
  });

  it('should sort by driver', async () => {
    mockNetworkService.listNetworks.mockResolvedValue([
      makeNetwork({ id: 'n1', name: 'n1', driver: 'overlay' }),
      makeNetwork({ id: 'n2', name: 'n2', driver: 'bridge' }),
    ]);
    await state.loadNetworks('sys-1');

    state.setSortOption('driver');
    expect(state.filteredNetworks()[0].driver).toBe('bridge');
  });

  it('should sort by scope', async () => {
    mockNetworkService.listNetworks.mockResolvedValue([
      makeNetwork({ id: 'n1', name: 'n1', scope: 'swarm' }),
      makeNetwork({ id: 'n2', name: 'n2', scope: 'local' }),
    ]);
    await state.loadNetworks('sys-1');

    state.setSortOption('scope');
    expect(state.filteredNetworks()[0].scope).toBe('local');
  });

  it('should compute stats', async () => {
    mockContainerState.containers.set([
      makeContainer({ networkSettings: { networks: { 'net-a': {} } } }),
    ]);
    mockNetworkService.listNetworks.mockResolvedValue([
      makeNetwork({ id: 'n1', name: 'net-a', driver: 'bridge', internal: false }),
      makeNetwork({ id: 'n2', name: 'net-b', driver: 'host', internal: true }),
      makeNetwork({ id: 'n3', name: 'net-c', driver: 'overlay', internal: false }),
      makeNetwork({ id: 'n4', name: 'net-d', driver: 'macvlan', internal: false }),
    ]);
    await state.loadNetworks('sys-1');

    const stats = state.stats();
    expect(stats.total).toBe(4);
    expect(stats.active).toBe(1);
    expect(stats.empty).toBe(3);
    expect(stats.internal).toBe(1);
    expect(stats.bridge).toBe(1);
    expect(stats.host).toBe(1);
    expect(stats.overlay).toBe(1);
    expect(stats.custom).toBe(1);
  });

  it('should compute networks by system', async () => {
    mockNetworkService.listNetworks.mockResolvedValue([makeNetwork({ systemId: 'sys-1' })]);
    await state.loadNetworks('sys-1');
    mockNetworkService.listNetworks.mockResolvedValue([makeNetwork({ id: 'n2', name: 'other', systemId: 'sys-2' })]);
    await state.loadNetworks('sys-2');

    const grouped = state.networksBySystem();
    expect(Object.keys(grouped)).toHaveLength(2);
  });

  it('should clear filters', () => {
    state.setRuntimeFilter('docker');
    state.setSystemFilter('sys-1');
    state.setSearchQuery('test');
    state.setSortOption('driver');
    state.setConnectionFilter('active');
    state.setDriverFilter('bridge');

    state.clearFilters();

    expect(state.runtimeFilter()).toBeNull();
    expect(state.systemFilter()).toBeNull();
    expect(state.searchQuery()).toBe('');
    expect(state.sortOption()).toBe('name');
    expect(state.connectionFilter()).toBe('all');
    expect(state.driverFilter()).toBe('all');
  });

  it('should check if network is active', () => {
    mockContainerState.containers.set([
      makeContainer({ networkSettings: { networks: { 'my-network': {} } } }),
    ]);

    expect(state.isNetworkActive(makeNetwork({ name: 'my-network' }))).toBe(true);
    expect(state.isNetworkActive(makeNetwork({ name: 'other' }))).toBe(false);
  });

  it('should get containers in network', () => {
    mockContainerState.containers.set([
      makeContainer({ id: 'c1', systemId: 'sys-1', networkSettings: { networks: { 'my-network': {} } } }),
      makeContainer({ id: 'c2', systemId: 'sys-1', networkSettings: { networks: { 'other-net': {} } } }),
    ]);

    const result = state.getContainersInNetwork(makeNetwork({ name: 'my-network', systemId: 'sys-1' }));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('c1');
  });

  it('should get unassigned containers', () => {
    mockContainerState.containers.set([
      makeContainer({ id: 'c1', systemId: 'sys-1', networkSettings: { networks: { 'my-network': {} } } }),
      makeContainer({ id: 'c2', systemId: 'sys-1', networkSettings: { networks: {} } }),
    ]);

    const result = state.getUnassignedContainers('sys-1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('c2');
  });

  it('should get containers for system', () => {
    mockContainerState.containers.set([
      makeContainer({ id: 'c1', systemId: 'sys-1' }),
      makeContainer({ id: 'c2', systemId: 'sys-2' }),
    ]);

    const result = state.getContainersForSystem('sys-1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('c1');
  });

  it('should connect container to network', async () => {
    mockNetworkService.connectContainerToNetwork.mockResolvedValue(undefined);

    const container = makeContainer();
    const network = makeNetwork();
    const result = await state.connectContainer(container, network);

    expect(result).toBe(true);
    expect(mockNetworkService.connectContainerToNetwork).toHaveBeenCalledWith('sys-1', 'c-1', 'my-network', 'docker');
    expect(mockContainerState.loadContainers).toHaveBeenCalledWith('sys-1');
  });

  it('should handle connect container error', async () => {
    mockNetworkService.connectContainerToNetwork.mockRejectedValue(new Error('Already connected'));

    const result = await state.connectContainer(makeContainer(), makeNetwork());

    expect(result).toBe(false);
    expect(state.error()).toBe('Already connected');
  });

  it('should disconnect container from network', async () => {
    mockNetworkService.disconnectContainerFromNetwork.mockResolvedValue(undefined);

    const container = makeContainer();
    const network = makeNetwork();
    const result = await state.disconnectContainer(container, network);

    expect(result).toBe(true);
    expect(mockNetworkService.disconnectContainerFromNetwork).toHaveBeenCalledWith('sys-1', 'c-1', 'my-network', 'docker');
  });

  it('should handle disconnect error', async () => {
    mockNetworkService.disconnectContainerFromNetwork.mockRejectedValue(new Error('Not connected'));

    const result = await state.disconnectContainer(makeContainer(), makeNetwork());

    expect(result).toBe(false);
    expect(state.error()).toBe('Not connected');
  });

  it('should check if container is in network', () => {
    const container = makeContainer({ networkSettings: { networks: { 'my-network': {} } } });
    const network = makeNetwork({ name: 'my-network' });
    const otherNetwork = makeNetwork({ name: 'other' });

    expect(state.isContainerInNetwork(container, network)).toBe(true);
    expect(state.isContainerInNetwork(container, otherNetwork)).toBe(false);
  });

  it('should clear networks for system', async () => {
    mockNetworkService.listNetworks.mockResolvedValue([makeNetwork({ systemId: 'sys-1' })]);
    await state.loadNetworks('sys-1');

    state.clearNetworksForSystem('sys-1');
    expect(state.networks()).toHaveLength(0);
  });

  it('should check loading state', () => {
    expect(state.isLoading('net-1')).toBe(false);
  });

  it('should clear error', () => {
    state.clearError();
    expect(state.error()).toBeNull();
  });
});
