import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { VolumeState } from './volume.state';
import { ContainerState } from './container.state';
import { VolumeService } from '../core/services/volume.service';
import type { Volume } from '../core/models/volume.model';

describe('VolumeState', () => {
  let state: VolumeState;
  let mockVolumeService: any;
  let mockContainerState: any;

  const makeVolume = (overrides: Partial<Volume> = {}): Volume => ({
    name: 'my-volume',
    driver: 'local',
    mountpoint: '/var/lib/docker/volumes/my-volume/_data',
    createdAt: '2024-01-01T00:00:00Z',
    labels: {},
    options: {},
    runtime: 'docker',
    systemId: 'sys-1',
    ...overrides,
  } as Volume);

  beforeEach(() => {
    mockVolumeService = {
      listVolumes: vi.fn(),
      createVolume: vi.fn(),
      removeVolume: vi.fn(),
    };
    mockContainerState = {
      containers: signal([]),
    };

    const injector = Injector.create({
      providers: [
        { provide: ContainerState, useValue: mockContainerState },
      ],
    });

    state = runInInjectionContext(injector, () => new VolumeState(mockVolumeService));
  });

  it('should start with empty state', () => {
    expect(state.volumes()).toEqual([]);
    expect(state.error()).toBeNull();
  });

  it('should load volumes', async () => {
    mockVolumeService.listVolumes.mockResolvedValue([makeVolume(), makeVolume({ name: 'vol-2' })]);

    await state.loadVolumes('sys-1');

    expect(state.volumes()).toHaveLength(2);
    expect(state.error()).toBeNull();
  });

  it('should handle load error', async () => {
    mockVolumeService.listVolumes.mockRejectedValue(new Error('Timeout'));

    await state.loadVolumes('sys-1');

    expect(state.error()).toBe('Timeout');
  });

  it('should replace volumes for same system', async () => {
    mockVolumeService.listVolumes.mockResolvedValue([makeVolume()]);
    await state.loadVolumes('sys-1');

    mockVolumeService.listVolumes.mockResolvedValue([makeVolume({ name: 'new-vol' })]);
    await state.loadVolumes('sys-1');

    expect(state.volumes()).toHaveLength(1);
    expect(state.volumes()[0].name).toBe('new-vol');
  });

  it('should keep volumes from other systems', async () => {
    mockVolumeService.listVolumes.mockResolvedValue([makeVolume({ systemId: 'sys-1' })]);
    await state.loadVolumes('sys-1');

    mockVolumeService.listVolumes.mockResolvedValue([makeVolume({ name: 'v2', systemId: 'sys-2' })]);
    await state.loadVolumes('sys-2');

    expect(state.volumes()).toHaveLength(2);
  });

  it('should create a volume', async () => {
    mockVolumeService.createVolume.mockResolvedValue(undefined);
    mockVolumeService.listVolumes.mockResolvedValue([makeVolume()]);

    const result = await state.createVolume('sys-1', 'my-volume', 'docker');

    expect(result).toBe(true);
    expect(mockVolumeService.createVolume).toHaveBeenCalledWith('sys-1', 'my-volume', 'docker', undefined);
  });

  it('should handle create error', async () => {
    mockVolumeService.createVolume.mockRejectedValue(new Error('Name taken'));

    const result = await state.createVolume('sys-1', 'my-volume', 'docker');

    expect(result).toBe(false);
    expect(state.error()).toBe('Name taken');
  });

  it('should remove a volume', async () => {
    mockVolumeService.listVolumes.mockResolvedValue([makeVolume()]);
    await state.loadVolumes('sys-1');

    mockVolumeService.removeVolume.mockResolvedValue(undefined);

    const result = await state.removeVolume(makeVolume());

    expect(result).toBe(true);
    expect(state.volumes()).toHaveLength(0);
  });

  it('should handle remove error', async () => {
    mockVolumeService.removeVolume.mockRejectedValue(new Error('In use'));

    const result = await state.removeVolume(makeVolume());

    expect(result).toBe(false);
    expect(state.error()).toBe('In use');
  });

  it('should filter by mount status - mounted', async () => {
    mockContainerState.containers.set([
      { volumes: [{ volumeName: 'my-volume' }] },
    ]);
    mockVolumeService.listVolumes.mockResolvedValue([
      makeVolume({ name: 'my-volume' }),
      makeVolume({ name: 'orphan-vol' }),
    ]);
    await state.loadVolumes('sys-1');

    state.setMountFilter('mounted');
    expect(state.filteredVolumes()).toHaveLength(1);
    expect(state.filteredVolumes()[0].name).toBe('my-volume');
  });

  it('should filter by mount status - orphaned', async () => {
    mockContainerState.containers.set([
      { volumes: [{ volumeName: 'my-volume' }] },
    ]);
    mockVolumeService.listVolumes.mockResolvedValue([
      makeVolume({ name: 'my-volume' }),
      makeVolume({ name: 'orphan-vol' }),
    ]);
    await state.loadVolumes('sys-1');

    state.setMountFilter('orphaned');
    expect(state.filteredVolumes()).toHaveLength(1);
    expect(state.filteredVolumes()[0].name).toBe('orphan-vol');
  });

  it('should filter by runtime', async () => {
    mockVolumeService.listVolumes.mockResolvedValue([
      makeVolume({ name: 'v1', runtime: 'docker' }),
      makeVolume({ name: 'v2', runtime: 'podman' }),
    ]);
    await state.loadVolumes('sys-1');

    state.setRuntimeFilter('podman');
    expect(state.filteredVolumes()).toHaveLength(1);
    expect(state.filteredVolumes()[0].name).toBe('v2');
  });

  it('should filter by search query', async () => {
    mockVolumeService.listVolumes.mockResolvedValue([
      makeVolume({ name: 'database-vol' }),
      makeVolume({ name: 'cache-vol' }),
    ]);
    await state.loadVolumes('sys-1');

    state.setSearchQuery('database');
    expect(state.filteredVolumes()).toHaveLength(1);
    expect(state.filteredVolumes()[0].name).toBe('database-vol');
  });

  it('should filter by system', async () => {
    mockVolumeService.listVolumes.mockResolvedValue([makeVolume({ systemId: 'sys-1' })]);
    await state.loadVolumes('sys-1');
    mockVolumeService.listVolumes.mockResolvedValue([makeVolume({ name: 'v2', systemId: 'sys-2' })]);
    await state.loadVolumes('sys-2');

    state.setSystemFilter('sys-1');
    expect(state.filteredVolumes()).toHaveLength(1);
  });

  it('should sort by name', async () => {
    mockVolumeService.listVolumes.mockResolvedValue([
      makeVolume({ name: 'zebra-vol' }),
      makeVolume({ name: 'alpha-vol' }),
    ]);
    await state.loadVolumes('sys-1');

    state.setSortOption('name');
    expect(state.filteredVolumes()[0].name).toBe('alpha-vol');
  });

  it('should sort by driver', async () => {
    mockVolumeService.listVolumes.mockResolvedValue([
      makeVolume({ name: 'v1', driver: 'nfs' }),
      makeVolume({ name: 'v2', driver: 'local' }),
    ]);
    await state.loadVolumes('sys-1');

    state.setSortOption('driver');
    expect(state.filteredVolumes()[0].driver).toBe('local');
  });

  it('should sort mounted volumes first', async () => {
    mockContainerState.containers.set([
      { volumes: [{ volumeName: 'mounted-vol' }] },
    ]);
    mockVolumeService.listVolumes.mockResolvedValue([
      makeVolume({ name: 'orphan-vol' }),
      makeVolume({ name: 'mounted-vol' }),
    ]);
    await state.loadVolumes('sys-1');

    expect(state.filteredVolumes()[0].name).toBe('mounted-vol');
  });

  it('should compute stats', async () => {
    mockContainerState.containers.set([
      { volumes: [{ volumeName: 'vol-1' }] },
    ]);
    mockVolumeService.listVolumes.mockResolvedValue([
      makeVolume({ name: 'vol-1' }),
      makeVolume({ name: 'vol-2' }),
      makeVolume({ name: 'vol-3' }),
    ]);
    await state.loadVolumes('sys-1');

    const stats = state.stats();
    expect(stats.total).toBe(3);
    expect(stats.mounted).toBe(1);
    expect(stats.orphaned).toBe(2);
  });

  it('should compute volumes by system', async () => {
    mockVolumeService.listVolumes.mockResolvedValue([makeVolume({ systemId: 'sys-1' })]);
    await state.loadVolumes('sys-1');
    mockVolumeService.listVolumes.mockResolvedValue([makeVolume({ name: 'v2', systemId: 'sys-2' })]);
    await state.loadVolumes('sys-2');

    const grouped = state.volumesBySystem();
    expect(Object.keys(grouped)).toHaveLength(2);
  });

  it('should clear filters', () => {
    state.setRuntimeFilter('docker');
    state.setSystemFilter('sys-1');
    state.setSearchQuery('test');
    state.setSortOption('driver');
    state.setMountFilter('mounted');

    state.clearFilters();

    expect(state.runtimeFilter()).toBeNull();
    expect(state.systemFilter()).toBeNull();
    expect(state.searchQuery()).toBe('');
    expect(state.sortOption()).toBe('name');
    expect(state.mountFilter()).toBe('all');
  });

  it('should check if volume is mounted', () => {
    mockContainerState.containers.set([
      { volumes: [{ volumeName: 'my-volume' }] },
    ]);

    expect(state.isVolumeMounted(makeVolume({ name: 'my-volume' }))).toBe(true);
    expect(state.isVolumeMounted(makeVolume({ name: 'other' }))).toBe(false);
  });

  it('should get containers using a volume', () => {
    mockContainerState.containers.set([
      { id: 'c1', volumes: [{ volumeName: 'my-volume', source: '/data' }] },
      { id: 'c2', volumes: [{ volumeName: 'other', source: 'other' }] },
    ]);

    const result = state.getContainersUsingVolume('my-volume');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('c1');
  });

  it('should clear volumes for system', async () => {
    mockVolumeService.listVolumes.mockResolvedValue([makeVolume({ systemId: 'sys-1' })]);
    await state.loadVolumes('sys-1');

    state.clearVolumesForSystem('sys-1');
    expect(state.volumes()).toHaveLength(0);
  });

  it('should check loading state', () => {
    expect(state.isLoading('sys-1')).toBe(false);
  });

  it('should clear error', () => {
    state.clearError();
    expect(state.error()).toBeNull();
  });
});
