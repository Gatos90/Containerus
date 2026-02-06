import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { AppState } from './app.state';

describe('AppState', () => {
  let appState: AppState;
  let mockSystemState: any;
  let mockContainerState: any;
  let mockImageState: any;
  let mockVolumeState: any;
  let mockNetworkState: any;

  beforeEach(() => {
    mockSystemState = {
      systems: signal([]),
      error: signal(null),
      loading: signal(false),
      stats: signal({ total: 0, connected: 0, disconnected: 0 }),
      connectedSystems: signal([]),
      loadSystems: vi.fn().mockResolvedValue(undefined),
      connectSystem: vi.fn().mockResolvedValue(true),
      detectRuntimes: vi.fn().mockResolvedValue(undefined),
      clearError: vi.fn(),
    };

    mockContainerState = {
      error: signal(null),
      loading: signal({}),
      stats: signal({ total: 0, running: 0, stopped: 0, paused: 0 }),
      loadContainersForSystems: vi.fn().mockResolvedValue(undefined),
      loadContainers: vi.fn().mockResolvedValue(undefined),
      clearContainersForSystem: vi.fn(),
      setSystemFilter: vi.fn(),
      clearFilters: vi.fn(),
      clearError: vi.fn(),
    };

    mockImageState = {
      error: signal(null),
      loading: signal({}),
      stats: signal({ total: 0, totalSize: 0, dangling: 0 }),
      loadImages: vi.fn().mockResolvedValue(undefined),
      clearImagesForSystem: vi.fn(),
      setSystemFilter: vi.fn(),
      clearFilters: vi.fn(),
      clearError: vi.fn(),
    };

    mockVolumeState = {
      error: signal(null),
      loading: signal({}),
      stats: signal({ total: 0, mounted: 0, orphaned: 0 }),
      loadVolumes: vi.fn().mockResolvedValue(undefined),
      clearVolumesForSystem: vi.fn(),
      setSystemFilter: vi.fn(),
      clearFilters: vi.fn(),
      clearError: vi.fn(),
    };

    mockNetworkState = {
      error: signal(null),
      loading: signal({}),
      stats: signal({ total: 0, bridge: 0, host: 0 }),
      loadNetworks: vi.fn().mockResolvedValue(undefined),
      clearNetworksForSystem: vi.fn(),
      setSystemFilter: vi.fn(),
      clearFilters: vi.fn(),
      clearError: vi.fn(),
    };

    appState = new AppState(
      mockSystemState,
      mockContainerState,
      mockImageState,
      mockVolumeState,
      mockNetworkState
    );
  });

  it('should create', () => {
    expect(appState).toBeTruthy();
  });

  it('should report not initialized when no systems', () => {
    expect(appState.isInitialized()).toBe(false);
  });

  it('should report initialized when systems exist', () => {
    mockSystemState.systems.set([{ id: 'sys-1', name: 'Test' }]);
    expect(appState.isInitialized()).toBe(true);
  });

  it('should report no global error when all states ok', () => {
    expect(appState.globalError()).toBeNull();
  });

  it('should report global error from system state', () => {
    mockSystemState.error.set('System error');
    expect(appState.globalError()).toBe('System error');
  });

  it('should report global error from container state', () => {
    mockContainerState.error.set('Container error');
    expect(appState.globalError()).toBe('Container error');
  });

  it('should report global error from image state', () => {
    mockImageState.error.set('Image error');
    expect(appState.globalError()).toBe('Image error');
  });

  it('should report global error from volume state', () => {
    mockVolumeState.error.set('Volume error');
    expect(appState.globalError()).toBe('Volume error');
  });

  it('should report global error from network state', () => {
    mockNetworkState.error.set('Network error');
    expect(appState.globalError()).toBe('Network error');
  });

  it('should report not loading when nothing is loading', () => {
    expect(appState.isLoading()).toBe(false);
  });

  it('should report loading when system is loading', () => {
    mockSystemState.loading.set(true);
    expect(appState.isLoading()).toBe(true);
  });

  it('should report loading when containers are loading', () => {
    mockContainerState.loading.set({ 'sys-1': true });
    expect(appState.isLoading()).toBe(true);
  });

  it('should aggregate global stats', () => {
    const stats = appState.globalStats();
    expect(stats).toHaveProperty('systems');
    expect(stats).toHaveProperty('containers');
    expect(stats).toHaveProperty('images');
    expect(stats).toHaveProperty('volumes');
    expect(stats).toHaveProperty('networks');
  });

  it('should load systems on initialize', async () => {
    await appState.initialize();
    expect(mockSystemState.loadSystems).toHaveBeenCalled();
  });

  it('should auto-connect systems with autoConnect flag', async () => {
    mockSystemState.systems.set([
      { id: 'sys-1', autoConnect: true },
      { id: 'sys-2', autoConnect: false },
    ]);
    mockSystemState.connectedSystems.set([]);

    await appState.initialize();

    expect(mockSystemState.connectSystem).toHaveBeenCalledWith('sys-1');
    expect(mockSystemState.connectSystem).not.toHaveBeenCalledWith('sys-2');
  });

  it('should load data for system after auto-connect', async () => {
    mockSystemState.systems.set([{ id: 'sys-1', autoConnect: true }]);
    mockSystemState.connectedSystems.set([]);

    await appState.initialize();

    expect(mockContainerState.loadContainers).toHaveBeenCalledWith('sys-1');
    expect(mockImageState.loadImages).toHaveBeenCalledWith('sys-1');
    expect(mockVolumeState.loadVolumes).toHaveBeenCalledWith('sys-1');
    expect(mockNetworkState.loadNetworks).toHaveBeenCalledWith('sys-1');
  });

  it('should load data for all systems', async () => {
    await appState.loadAllDataForSystems(['sys-1', 'sys-2']);

    expect(mockContainerState.loadContainersForSystems).toHaveBeenCalledWith(['sys-1', 'sys-2']);
    expect(mockImageState.loadImages).toHaveBeenCalledWith('sys-1');
    expect(mockImageState.loadImages).toHaveBeenCalledWith('sys-2');
  });

  it('should load data for a single system', async () => {
    await appState.loadAllDataForSystem('sys-1');

    expect(mockContainerState.loadContainers).toHaveBeenCalledWith('sys-1');
    expect(mockImageState.loadImages).toHaveBeenCalledWith('sys-1');
    expect(mockVolumeState.loadVolumes).toHaveBeenCalledWith('sys-1');
    expect(mockNetworkState.loadNetworks).toHaveBeenCalledWith('sys-1');
  });

  it('should clear data for a system', () => {
    appState.clearDataForSystem('sys-1');

    expect(mockContainerState.clearContainersForSystem).toHaveBeenCalledWith('sys-1');
    expect(mockImageState.clearImagesForSystem).toHaveBeenCalledWith('sys-1');
    expect(mockVolumeState.clearVolumesForSystem).toHaveBeenCalledWith('sys-1');
    expect(mockNetworkState.clearNetworksForSystem).toHaveBeenCalledWith('sys-1');
  });

  it('should clear all errors', () => {
    appState.clearAllErrors();

    expect(mockSystemState.clearError).toHaveBeenCalled();
    expect(mockContainerState.clearError).toHaveBeenCalled();
    expect(mockImageState.clearError).toHaveBeenCalled();
    expect(mockVolumeState.clearError).toHaveBeenCalled();
    expect(mockNetworkState.clearError).toHaveBeenCalled();
  });

  it('should set system filter on all states', () => {
    appState.setSystemFilter('sys-1');

    expect(mockContainerState.setSystemFilter).toHaveBeenCalledWith('sys-1');
    expect(mockImageState.setSystemFilter).toHaveBeenCalledWith('sys-1');
    expect(mockVolumeState.setSystemFilter).toHaveBeenCalledWith('sys-1');
    expect(mockNetworkState.setSystemFilter).toHaveBeenCalledWith('sys-1');
  });

  it('should clear system filter with null', () => {
    appState.setSystemFilter(null);

    expect(mockContainerState.setSystemFilter).toHaveBeenCalledWith(null);
    expect(mockImageState.setSystemFilter).toHaveBeenCalledWith(null);
  });

  it('should clear all filters', () => {
    appState.clearAllFilters();

    expect(mockContainerState.clearFilters).toHaveBeenCalled();
    expect(mockImageState.clearFilters).toHaveBeenCalled();
    expect(mockVolumeState.clearFilters).toHaveBeenCalled();
    expect(mockNetworkState.clearFilters).toHaveBeenCalled();
  });
});
