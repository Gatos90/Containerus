import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContainerState } from './container.state';
import type { Container } from '../core/models/container.model';

describe('ContainerState', () => {
  let state: ContainerState;
  let mockService: any;

  const makeContainer = (overrides: Partial<Container> = {}): Container => ({
    id: 'c-1',
    name: 'test-container',
    image: 'nginx:latest',
    status: 'running',
    runtime: 'docker',
    systemId: 'sys-1',
    createdAt: '2024-01-01T00:00:00Z',
    ports: [],
    volumes: [],
    networks: [],
    labels: {},
    env: [],
    networkSettings: { networks: {} },
    ...overrides,
  } as Container);

  beforeEach(() => {
    mockService = {
      listContainers: vi.fn(),
      performAction: vi.fn(),
      getLogs: vi.fn(),
    };
    state = new ContainerState(mockService);
  });

  it('should start with empty state', () => {
    expect(state.containers()).toEqual([]);
    expect(state.error()).toBeNull();
    expect(state.selectedContainerId()).toBeNull();
  });

  it('should load containers for a system', async () => {
    const containers = [makeContainer(), makeContainer({ id: 'c-2', name: 'web' })];
    mockService.listContainers.mockResolvedValue(containers);

    await state.loadContainers('sys-1');
    expect(state.containers()).toHaveLength(2);
    expect(state.error()).toBeNull();
  });

  it('should handle load error', async () => {
    mockService.listContainers.mockRejectedValue(new Error('Connection failed'));

    await state.loadContainers('sys-1');
    expect(state.error()).toBe('Connection failed');
  });

  it('should replace containers for same system on reload', async () => {
    mockService.listContainers.mockResolvedValue([makeContainer()]);
    await state.loadContainers('sys-1');
    expect(state.containers()).toHaveLength(1);

    mockService.listContainers.mockResolvedValue([makeContainer({ id: 'c-new' })]);
    await state.loadContainers('sys-1');
    expect(state.containers()).toHaveLength(1);
    expect(state.containers()[0].id).toBe('c-new');
  });

  it('should keep containers from other systems', async () => {
    mockService.listContainers.mockResolvedValue([makeContainer({ systemId: 'sys-1' })]);
    await state.loadContainers('sys-1');

    mockService.listContainers.mockResolvedValue([makeContainer({ id: 'c-2', systemId: 'sys-2' })]);
    await state.loadContainers('sys-2');

    expect(state.containers()).toHaveLength(2);
  });

  it('should select and deselect container', () => {
    state.selectContainer('c-1');
    expect(state.selectedContainerId()).toBe('c-1');

    state.selectContainer(null);
    expect(state.selectedContainerId()).toBeNull();
  });

  it('should compute selected container', async () => {
    mockService.listContainers.mockResolvedValue([makeContainer()]);
    await state.loadContainers('sys-1');

    state.selectContainer('c-1');
    expect(state.selectedContainer()?.id).toBe('c-1');

    state.selectContainer('nonexistent');
    expect(state.selectedContainer()).toBeNull();
  });

  it('should filter by status', async () => {
    const containers = [
      makeContainer({ id: 'c-1', status: 'running' }),
      makeContainer({ id: 'c-2', status: 'exited' }),
    ];
    mockService.listContainers.mockResolvedValue(containers);
    await state.loadContainers('sys-1');

    state.setStatusFilter('running');
    expect(state.filteredContainers()).toHaveLength(1);
    expect(state.filteredContainers()[0].id).toBe('c-1');
  });

  it('should filter by runtime', async () => {
    const containers = [
      makeContainer({ id: 'c-1', runtime: 'docker' }),
      makeContainer({ id: 'c-2', runtime: 'podman' }),
    ];
    mockService.listContainers.mockResolvedValue(containers);
    await state.loadContainers('sys-1');

    state.setRuntimeFilter('podman');
    expect(state.filteredContainers()).toHaveLength(1);
    expect(state.filteredContainers()[0].id).toBe('c-2');
  });

  it('should filter by search query', async () => {
    const containers = [
      makeContainer({ id: 'c-1', name: 'nginx-web', image: 'nginx:latest' }),
      makeContainer({ id: 'c-2', name: 'redis-cache', image: 'redis:7' }),
    ];
    mockService.listContainers.mockResolvedValue(containers);
    await state.loadContainers('sys-1');

    state.setSearchQuery('redis');
    expect(state.filteredContainers()).toHaveLength(1);
    expect(state.filteredContainers()[0].name).toBe('redis-cache');
  });

  it('should filter by system', async () => {
    mockService.listContainers.mockResolvedValue([makeContainer({ systemId: 'sys-1' })]);
    await state.loadContainers('sys-1');
    mockService.listContainers.mockResolvedValue([makeContainer({ id: 'c-2', systemId: 'sys-2' })]);
    await state.loadContainers('sys-2');

    state.setSystemFilter('sys-1');
    expect(state.filteredContainers()).toHaveLength(1);
  });

  it('should sort by name', async () => {
    const containers = [
      makeContainer({ id: 'c-1', name: 'zebra' }),
      makeContainer({ id: 'c-2', name: 'alpha' }),
    ];
    mockService.listContainers.mockResolvedValue(containers);
    await state.loadContainers('sys-1');

    state.setSortOption('name');
    expect(state.filteredContainers()[0].name).toBe('alpha');
  });

  it('should sort by status', async () => {
    const containers = [
      makeContainer({ id: 'c-1', status: 'running' }),
      makeContainer({ id: 'c-2', status: 'exited' }),
    ];
    mockService.listContainers.mockResolvedValue(containers);
    await state.loadContainers('sys-1');

    state.setSortOption('status');
    expect(state.filteredContainers()[0].status).toBe('exited');
  });

  it('should compute stats', async () => {
    const containers = [
      makeContainer({ id: 'c-1', status: 'running' }),
      makeContainer({ id: 'c-2', status: 'running' }),
      makeContainer({ id: 'c-3', status: 'exited' }),
      makeContainer({ id: 'c-4', status: 'paused' }),
    ];
    mockService.listContainers.mockResolvedValue(containers);
    await state.loadContainers('sys-1');

    const stats = state.stats();
    expect(stats.total).toBe(4);
    expect(stats.running).toBe(2);
    expect(stats.stopped).toBe(1);
    expect(stats.paused).toBe(1);
  });

  it('should compute containers by system', async () => {
    mockService.listContainers.mockResolvedValue([
      makeContainer({ id: 'c-1', systemId: 'sys-1' }),
    ]);
    await state.loadContainers('sys-1');
    mockService.listContainers.mockResolvedValue([
      makeContainer({ id: 'c-2', systemId: 'sys-2' }),
    ]);
    await state.loadContainers('sys-2');

    const grouped = state.containersBySystem();
    expect(Object.keys(grouped)).toHaveLength(2);
    expect(grouped['sys-1']).toHaveLength(1);
    expect(grouped['sys-2']).toHaveLength(1);
  });

  it('should clear filters', async () => {
    state.setStatusFilter('running');
    state.setRuntimeFilter('docker');
    state.setSearchQuery('test');
    state.setSystemFilter('sys-1');
    state.setSortOption('status');

    state.clearFilters();

    expect(state.statusFilter()).toBeNull();
    expect(state.runtimeFilter()).toBeNull();
    expect(state.searchQuery()).toBe('');
    expect(state.systemFilter()).toBeNull();
    expect(state.sortOption()).toBe('name');
  });

  it('should clear containers for a system', async () => {
    mockService.listContainers.mockResolvedValue([makeContainer({ systemId: 'sys-1' })]);
    await state.loadContainers('sys-1');
    expect(state.containers()).toHaveLength(1);

    state.clearContainersForSystem('sys-1');
    expect(state.containers()).toHaveLength(0);
  });

  it('should check loading state', () => {
    expect(state.isLoading('c-1')).toBe(false);
  });

  it('should clear error', () => {
    state.clearError();
    expect(state.error()).toBeNull();
  });

  it('should perform action - remove', async () => {
    const container = makeContainer();
    mockService.listContainers.mockResolvedValue([container]);
    await state.loadContainers('sys-1');

    mockService.performAction.mockResolvedValue(undefined);
    const result = await state.performAction(container, 'remove');

    expect(result).toBe(true);
    expect(state.containers()).toHaveLength(0);
  });

  it('should perform action - start (reloads)', async () => {
    const container = makeContainer({ status: 'exited' });
    mockService.listContainers.mockResolvedValue([container]);
    await state.loadContainers('sys-1');

    mockService.performAction.mockResolvedValue(undefined);
    mockService.listContainers.mockResolvedValue([makeContainer({ status: 'running' })]);
    const result = await state.performAction(container, 'start');

    expect(result).toBe(true);
  });

  it('should handle action error', async () => {
    const container = makeContainer();
    mockService.performAction.mockRejectedValue(new Error('Permission denied'));

    const result = await state.performAction(container, 'start');
    expect(result).toBe(false);
    expect(state.error()).toBe('Permission denied');
  });

  it('should get logs', async () => {
    const container = makeContainer();
    mockService.getLogs.mockResolvedValue('log line 1\nlog line 2');

    const logs = await state.getLogs(container);
    expect(logs).toBe('log line 1\nlog line 2');
  });

  it('should handle get logs error', async () => {
    const container = makeContainer();
    mockService.getLogs.mockRejectedValue(new Error('Not found'));

    const logs = await state.getLogs(container);
    expect(logs).toBeNull();
    expect(state.error()).toBe('Not found');
  });
});
