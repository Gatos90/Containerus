import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SystemState } from './system.state';
import type { ContainerSystem } from '../core/models/system.model';

describe('SystemState', () => {
  let state: SystemState;
  let mockSystemService: any;
  let mockMonitoringService: any;

  const makeSystem = (overrides: Partial<ContainerSystem> = {}): ContainerSystem => ({
    id: 'sys-1',
    name: 'Test Server',
    hostname: 'test.local',
    port: 22,
    username: 'admin',
    primaryRuntime: 'docker',
    availableRuntimes: ['docker'],
    autoConnect: false,
    authMethod: 'password',
    ...overrides,
  } as ContainerSystem);

  beforeEach(() => {
    mockSystemService = {
      listSystems: vi.fn(),
      addSystem: vi.fn(),
      updateSystem: vi.fn(),
      removeSystem: vi.fn(),
      connectSystem: vi.fn(),
      disconnectSystem: vi.fn(),
      getConnectionState: vi.fn(),
      detectRuntimes: vi.fn(),
      getExtendedSystemInfo: vi.fn(),
    };
    mockMonitoringService = {
      startListening: vi.fn(),
      startMonitoring: vi.fn(),
      stopMonitoring: vi.fn(),
      metrics: vi.fn(() => ({})),
      history: vi.fn(() => ({})),
      getMetrics: vi.fn(() => null),
      getHistory: vi.fn(() => []),
      isMonitoring: vi.fn(() => false),
    };
    state = new SystemState(mockSystemService, mockMonitoringService);
  });

  it('should call startListening on construction', () => {
    expect(mockMonitoringService.startListening).toHaveBeenCalled();
  });

  it('should start with empty state', () => {
    expect(state.systems()).toEqual([]);
    expect(state.loading()).toBe(false);
    expect(state.error()).toBeNull();
    expect(state.selectedSystemId()).toBeNull();
  });

  it('should load systems', async () => {
    const systems = [makeSystem(), makeSystem({ id: 'sys-2', name: 'Server 2' })];
    mockSystemService.listSystems.mockResolvedValue(systems);
    mockSystemService.getConnectionState.mockResolvedValue('disconnected');

    await state.loadSystems();

    expect(state.systems()).toHaveLength(2);
    expect(state.loading()).toBe(false);
  });

  it('should load connection states for each system', async () => {
    mockSystemService.listSystems.mockResolvedValue([makeSystem()]);
    mockSystemService.getConnectionState.mockResolvedValue('connected');

    await state.loadSystems();

    expect(state.getConnectionState('sys-1')).toBe('connected');
  });

  it('should handle load error', async () => {
    mockSystemService.listSystems.mockRejectedValue(new Error('Network error'));

    await state.loadSystems();

    expect(state.error()).toBe('Network error');
    expect(state.loading()).toBe(false);
  });

  it('should add a system', async () => {
    const system = makeSystem();
    mockSystemService.addSystem.mockResolvedValue(system);

    const result = await state.addSystem({ name: 'Test', hostname: 'test.local', port: 22, username: 'admin', primaryRuntime: 'docker' as any, authMethod: 'password' as any, autoConnect: false });

    expect(result).toEqual(system);
    expect(state.systems()).toHaveLength(1);
    expect(state.getConnectionState('sys-1')).toBe('disconnected');
  });

  it('should auto-connect after adding if autoConnect is set', async () => {
    const system = makeSystem();
    mockSystemService.addSystem.mockResolvedValue(system);
    mockSystemService.connectSystem.mockResolvedValue('connected');
    mockSystemService.getExtendedSystemInfo.mockResolvedValue({});

    await state.addSystem({ name: 'Test', hostname: 'test.local', port: 22, username: 'admin', primaryRuntime: 'docker' as any, authMethod: 'password' as any, autoConnect: true });

    expect(mockSystemService.connectSystem).toHaveBeenCalledWith('sys-1', undefined, undefined, undefined);
  });

  it('should handle add system error', async () => {
    mockSystemService.addSystem.mockRejectedValue(new Error('Duplicate'));

    const result = await state.addSystem({ name: 'Test', hostname: 'test.local', port: 22, username: 'admin', primaryRuntime: 'docker' as any, authMethod: 'password' as any, autoConnect: false });

    expect(result).toBeNull();
    expect(state.error()).toBe('Duplicate');
  });

  it('should connect a system', async () => {
    mockSystemService.listSystems.mockResolvedValue([makeSystem()]);
    mockSystemService.getConnectionState.mockResolvedValue('disconnected');
    await state.loadSystems();

    mockSystemService.connectSystem.mockResolvedValue('connected');
    mockSystemService.getExtendedSystemInfo.mockResolvedValue({ hostname: 'test' });

    const result = await state.connectSystem('sys-1');

    expect(result).toBe(true);
    expect(state.getConnectionState('sys-1')).toBe('connected');
    expect(mockMonitoringService.startMonitoring).toHaveBeenCalledWith('sys-1');
  });

  it('should handle connect error', async () => {
    mockSystemService.connectSystem.mockRejectedValue(new Error('Refused'));

    const result = await state.connectSystem('sys-1');

    expect(result).toBe(false);
    expect(state.getConnectionState('sys-1')).toBe('error');
    expect(state.error()).toBe('Refused');
  });

  it('should disconnect a system', async () => {
    mockSystemService.listSystems.mockResolvedValue([makeSystem()]);
    mockSystemService.getConnectionState.mockResolvedValue('connected');
    await state.loadSystems();

    mockSystemService.disconnectSystem.mockResolvedValue('disconnected');
    mockMonitoringService.stopMonitoring.mockResolvedValue(undefined);

    await state.disconnectSystem('sys-1');

    expect(state.getConnectionState('sys-1')).toBe('disconnected');
    expect(mockMonitoringService.stopMonitoring).toHaveBeenCalledWith('sys-1');
  });

  it('should update a system', async () => {
    mockSystemService.listSystems.mockResolvedValue([makeSystem()]);
    mockSystemService.getConnectionState.mockResolvedValue('disconnected');
    await state.loadSystems();

    const updated = makeSystem({ name: 'Updated Server' });
    mockSystemService.updateSystem.mockResolvedValue(updated);

    const result = await state.updateSystem({ id: 'sys-1', name: 'Updated Server' } as any);

    expect(result?.name).toBe('Updated Server');
    expect(state.systems()[0].name).toBe('Updated Server');
  });

  it('should remove a system', async () => {
    mockSystemService.listSystems.mockResolvedValue([makeSystem()]);
    mockSystemService.getConnectionState.mockResolvedValue('disconnected');
    await state.loadSystems();

    mockSystemService.removeSystem.mockResolvedValue(true);

    const result = await state.removeSystem('sys-1');

    expect(result).toBe(true);
    expect(state.systems()).toHaveLength(0);
  });

  it('should detect runtimes', async () => {
    mockSystemService.listSystems.mockResolvedValue([makeSystem()]);
    mockSystemService.getConnectionState.mockResolvedValue('connected');
    await state.loadSystems();

    mockSystemService.detectRuntimes.mockResolvedValue(['docker', 'podman']);

    const runtimes = await state.detectRuntimes('sys-1');

    expect(runtimes).toEqual(['docker', 'podman']);
    expect(state.systems()[0].availableRuntimes).toEqual(['docker', 'podman']);
  });

  it('should select and deselect system', () => {
    state.selectSystem('sys-1');
    expect(state.selectedSystemId()).toBe('sys-1');

    state.selectSystem(null);
    expect(state.selectedSystemId()).toBeNull();
  });

  it('should compute selected system', async () => {
    mockSystemService.listSystems.mockResolvedValue([makeSystem()]);
    mockSystemService.getConnectionState.mockResolvedValue('disconnected');
    await state.loadSystems();

    state.selectSystem('sys-1');
    expect(state.selectedSystem()?.id).toBe('sys-1');

    state.selectSystem('nonexistent');
    expect(state.selectedSystem()).toBeNull();
  });

  it('should compute connected and disconnected systems', async () => {
    const systems = [
      makeSystem({ id: 'sys-1' }),
      makeSystem({ id: 'sys-2' }),
      makeSystem({ id: 'sys-3' }),
    ];
    mockSystemService.listSystems.mockResolvedValue(systems);
    mockSystemService.getConnectionState
      .mockResolvedValueOnce('connected')
      .mockResolvedValueOnce('disconnected')
      .mockResolvedValueOnce('error');

    await state.loadSystems();

    expect(state.connectedSystems()).toHaveLength(1);
    expect(state.disconnectedSystems()).toHaveLength(2);
  });

  it('should compute stats', async () => {
    const systems = [
      makeSystem({ id: 'sys-1' }),
      makeSystem({ id: 'sys-2' }),
      makeSystem({ id: 'sys-3' }),
    ];
    mockSystemService.listSystems.mockResolvedValue(systems);
    mockSystemService.getConnectionState
      .mockResolvedValueOnce('connected')
      .mockResolvedValueOnce('disconnected')
      .mockResolvedValueOnce('error');

    await state.loadSystems();

    const stats = state.stats();
    expect(stats.total).toBe(3);
    expect(stats.connected).toBe(1);
    expect(stats.disconnected).toBe(1);
    expect(stats.error).toBe(1);
  });

  it('should filter systems by search query', async () => {
    mockSystemService.listSystems.mockResolvedValue([
      makeSystem({ id: 'sys-1', name: 'Production', hostname: 'prod.server.com' }),
      makeSystem({ id: 'sys-2', name: 'Staging', hostname: 'staging.server.com' }),
    ]);
    mockSystemService.getConnectionState.mockResolvedValue('disconnected');
    await state.loadSystems();

    state.setSearchQuery('prod');
    expect(state.filteredSystems()).toHaveLength(1);
    expect(state.filteredSystems()[0].name).toBe('Production');
  });

  it('should filter systems by status', async () => {
    mockSystemService.listSystems.mockResolvedValue([
      makeSystem({ id: 'sys-1' }),
      makeSystem({ id: 'sys-2' }),
    ]);
    mockSystemService.getConnectionState
      .mockResolvedValueOnce('connected')
      .mockResolvedValueOnce('disconnected');
    await state.loadSystems();

    state.setStatusFilter('connected');
    expect(state.filteredSystems()).toHaveLength(1);
  });

  it('should fetch extended info', async () => {
    const info = { hostname: 'test', username: 'root', distro: 'Ubuntu' };
    mockSystemService.getExtendedSystemInfo.mockResolvedValue(info);

    const result = await state.fetchExtendedInfo('sys-1');

    expect(result).toEqual(info);
    expect(state.getExtendedInfo('sys-1')).toEqual(info);
  });

  it('should return null for extended info on error', async () => {
    mockSystemService.getExtendedSystemInfo.mockRejectedValue(new Error('fail'));

    const result = await state.fetchExtendedInfo('sys-1');

    expect(result).toBeNull();
  });

  it('should clear and set error', () => {
    state.setError('something broke');
    expect(state.error()).toBe('something broke');

    state.clearError();
    expect(state.error()).toBeNull();
  });

  it('should return disconnected for unknown system connection state', () => {
    expect(state.getConnectionState('unknown')).toBe('disconnected');
  });

  it('should delegate monitoring methods', () => {
    state.getLiveMetrics('sys-1');
    expect(mockMonitoringService.getMetrics).toHaveBeenCalledWith('sys-1');

    state.getMetricsHistory('sys-1');
    expect(mockMonitoringService.getHistory).toHaveBeenCalledWith('sys-1');

    state.isMonitoring('sys-1');
    expect(mockMonitoringService.isMonitoring).toHaveBeenCalledWith('sys-1');
  });
});
