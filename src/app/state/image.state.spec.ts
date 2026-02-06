import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { ImageState } from './image.state';
import { ContainerState } from './container.state';
import { ImageService } from '../core/services/image.service';
import type { ContainerImage } from '../core/models/image.model';

describe('ImageState', () => {
  let state: ImageState;
  let mockImageService: any;
  let mockContainerState: any;

  const makeImage = (overrides: Partial<ContainerImage> = {}): ContainerImage => ({
    id: 'img-1',
    name: 'nginx',
    tag: 'latest',
    size: 100_000_000,
    created: '2024-01-01T00:00:00Z',
    runtime: 'docker',
    systemId: 'sys-1',
    ...overrides,
  } as ContainerImage);

  beforeEach(() => {
    mockImageService = {
      listImages: vi.fn(),
      pullImage: vi.fn(),
      removeImage: vi.fn(),
    };
    mockContainerState = {
      containers: signal([]),
    };

    const injector = Injector.create({
      providers: [
        { provide: ContainerState, useValue: mockContainerState },
      ],
    });

    state = runInInjectionContext(injector, () => new ImageState(mockImageService));
  });

  it('should start with empty state', () => {
    expect(state.images()).toEqual([]);
    expect(state.error()).toBeNull();
  });

  it('should load images for a system', async () => {
    const images = [makeImage(), makeImage({ id: 'img-2', name: 'redis' })];
    mockImageService.listImages.mockResolvedValue(images);

    await state.loadImages('sys-1');

    expect(state.images()).toHaveLength(2);
    expect(state.error()).toBeNull();
  });

  it('should handle load error', async () => {
    mockImageService.listImages.mockRejectedValue(new Error('Connection refused'));

    await state.loadImages('sys-1');

    expect(state.error()).toBe('Connection refused');
  });

  it('should replace images for same system on reload', async () => {
    mockImageService.listImages.mockResolvedValue([makeImage()]);
    await state.loadImages('sys-1');

    mockImageService.listImages.mockResolvedValue([makeImage({ id: 'img-new' })]);
    await state.loadImages('sys-1');

    expect(state.images()).toHaveLength(1);
    expect(state.images()[0].id).toBe('img-new');
  });

  it('should keep images from other systems', async () => {
    mockImageService.listImages.mockResolvedValue([makeImage({ systemId: 'sys-1' })]);
    await state.loadImages('sys-1');

    mockImageService.listImages.mockResolvedValue([makeImage({ id: 'img-2', systemId: 'sys-2' })]);
    await state.loadImages('sys-2');

    expect(state.images()).toHaveLength(2);
  });

  it('should pull an image', async () => {
    mockImageService.pullImage.mockResolvedValue(undefined);
    mockImageService.listImages.mockResolvedValue([makeImage()]);

    const result = await state.pullImage('sys-1', 'nginx', 'latest', 'docker');

    expect(result).toBe(true);
    expect(mockImageService.pullImage).toHaveBeenCalledWith('sys-1', 'nginx', 'latest', 'docker');
  });

  it('should handle pull error', async () => {
    mockImageService.pullImage.mockRejectedValue(new Error('Pull failed'));

    const result = await state.pullImage('sys-1', 'nginx', 'latest', 'docker');

    expect(result).toBe(false);
    expect(state.error()).toBe('Pull failed');
  });

  it('should remove an image', async () => {
    mockImageService.listImages.mockResolvedValue([makeImage()]);
    await state.loadImages('sys-1');

    mockImageService.removeImage.mockResolvedValue(undefined);

    const result = await state.removeImage(makeImage());

    expect(result).toBe(true);
    expect(state.images()).toHaveLength(0);
  });

  it('should handle remove error', async () => {
    mockImageService.removeImage.mockRejectedValue(new Error('In use'));

    const result = await state.removeImage(makeImage());

    expect(result).toBe(false);
    expect(state.error()).toBe('In use');
  });

  it('should filter by runtime', async () => {
    mockImageService.listImages.mockResolvedValue([
      makeImage({ id: 'img-1', runtime: 'docker' }),
      makeImage({ id: 'img-2', runtime: 'podman' }),
    ]);
    await state.loadImages('sys-1');

    state.setRuntimeFilter('podman');
    expect(state.filteredImages()).toHaveLength(1);
    expect(state.filteredImages()[0].id).toBe('img-2');
  });

  it('should filter by search query', async () => {
    mockImageService.listImages.mockResolvedValue([
      makeImage({ id: 'img-1', name: 'nginx', tag: 'latest' }),
      makeImage({ id: 'img-2', name: 'redis', tag: '7' }),
    ]);
    await state.loadImages('sys-1');

    state.setSearchQuery('redis');
    expect(state.filteredImages()).toHaveLength(1);
    expect(state.filteredImages()[0].name).toBe('redis');
  });

  it('should filter by system', async () => {
    mockImageService.listImages.mockResolvedValue([makeImage({ systemId: 'sys-1' })]);
    await state.loadImages('sys-1');
    mockImageService.listImages.mockResolvedValue([makeImage({ id: 'img-2', systemId: 'sys-2' })]);
    await state.loadImages('sys-2');

    state.setSystemFilter('sys-1');
    expect(state.filteredImages()).toHaveLength(1);
  });

  it('should filter by usage - in-use', async () => {
    mockContainerState.containers.set([
      { image: 'nginx:latest' },
    ]);
    mockImageService.listImages.mockResolvedValue([
      makeImage({ id: 'img-1', name: 'nginx', tag: 'latest' }),
      makeImage({ id: 'img-2', name: 'redis', tag: '7' }),
    ]);
    await state.loadImages('sys-1');

    state.setUsageFilter('in-use');
    expect(state.filteredImages()).toHaveLength(1);
    expect(state.filteredImages()[0].name).toBe('nginx');
  });

  it('should filter by usage - unused', async () => {
    mockContainerState.containers.set([
      { image: 'nginx:latest' },
    ]);
    mockImageService.listImages.mockResolvedValue([
      makeImage({ id: 'img-1', name: 'nginx', tag: 'latest' }),
      makeImage({ id: 'img-2', name: 'redis', tag: '7' }),
    ]);
    await state.loadImages('sys-1');

    state.setUsageFilter('unused');
    expect(state.filteredImages()).toHaveLength(1);
    expect(state.filteredImages()[0].name).toBe('redis');
  });

  it('should filter by usage - dangling', async () => {
    mockImageService.listImages.mockResolvedValue([
      makeImage({ id: 'img-1', name: 'nginx', tag: 'latest' }),
      makeImage({ id: 'img-2', name: 'sha256:abc', tag: '<none>' }),
    ]);
    await state.loadImages('sys-1');

    state.setUsageFilter('dangling');
    expect(state.filteredImages()).toHaveLength(1);
    expect(state.filteredImages()[0].tag).toBe('<none>');
  });

  it('should sort by name', async () => {
    mockImageService.listImages.mockResolvedValue([
      makeImage({ id: 'img-1', name: 'zebra', tag: 'latest' }),
      makeImage({ id: 'img-2', name: 'alpha', tag: 'latest' }),
    ]);
    await state.loadImages('sys-1');

    state.setSortOption('name');
    expect(state.filteredImages()[0].name).toBe('alpha');
  });

  it('should sort by size', async () => {
    mockImageService.listImages.mockResolvedValue([
      makeImage({ id: 'img-1', name: 'small', size: 100 }),
      makeImage({ id: 'img-2', name: 'big', size: 999999 }),
    ]);
    await state.loadImages('sys-1');

    state.setSortOption('size');
    expect(state.filteredImages()[0].name).toBe('big');
  });

  it('should sort in-use images first', async () => {
    mockContainerState.containers.set([
      { image: 'redis:7' },
    ]);
    mockImageService.listImages.mockResolvedValue([
      makeImage({ id: 'img-1', name: 'nginx', tag: 'latest' }),
      makeImage({ id: 'img-2', name: 'redis', tag: '7' }),
    ]);
    await state.loadImages('sys-1');

    // redis is in-use, should come first
    expect(state.filteredImages()[0].name).toBe('redis');
  });

  it('should compute stats', async () => {
    mockContainerState.containers.set([
      { image: 'nginx:latest' },
    ]);
    mockImageService.listImages.mockResolvedValue([
      makeImage({ id: 'img-1', name: 'nginx', tag: 'latest', size: 100 }),
      makeImage({ id: 'img-2', name: 'redis', tag: '7', size: 200 }),
      makeImage({ id: 'img-3', name: 'sha256:abc', tag: '<none>', size: 50 }),
    ]);
    await state.loadImages('sys-1');

    const stats = state.stats();
    expect(stats.total).toBe(3);
    expect(stats.totalSize).toBe(350);
    expect(stats.inUse).toBe(1);
    expect(stats.unused).toBe(2);
    expect(stats.dangling).toBe(1);
  });

  it('should compute images by system', async () => {
    mockImageService.listImages.mockResolvedValue([makeImage({ systemId: 'sys-1' })]);
    await state.loadImages('sys-1');
    mockImageService.listImages.mockResolvedValue([makeImage({ id: 'img-2', systemId: 'sys-2' })]);
    await state.loadImages('sys-2');

    const grouped = state.imagesBySystem();
    expect(Object.keys(grouped)).toHaveLength(2);
  });

  it('should clear filters', () => {
    state.setRuntimeFilter('docker');
    state.setSystemFilter('sys-1');
    state.setSearchQuery('test');
    state.setSortOption('size');
    state.setUsageFilter('dangling');

    state.clearFilters();

    expect(state.runtimeFilter()).toBeNull();
    expect(state.systemFilter()).toBeNull();
    expect(state.searchQuery()).toBe('');
    expect(state.sortOption()).toBe('name');
    expect(state.usageFilter()).toBe('all');
  });

  it('should check if image is in use', () => {
    mockContainerState.containers.set([{ image: 'nginx:latest' }]);

    expect(state.isImageInUse(makeImage({ name: 'nginx', tag: 'latest' }))).toBe(true);
    expect(state.isImageInUse(makeImage({ name: 'redis', tag: '7' }))).toBe(false);
  });

  it('should check if image is dangling', () => {
    expect(state.isDangling(makeImage({ tag: '<none>' }))).toBe(true);
    expect(state.isDangling(makeImage({ tag: '' } as any))).toBe(true);
    expect(state.isDangling(makeImage({ tag: 'latest' }))).toBe(false);
  });

  it('should get containers using an image', () => {
    mockContainerState.containers.set([
      { id: 'c1', image: 'nginx:latest' },
      { id: 'c2', image: 'redis:7' },
    ]);

    const result = state.getContainersUsingImage(makeImage({ name: 'nginx', tag: 'latest' }));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('c1');
  });

  it('should clear images for system', async () => {
    mockImageService.listImages.mockResolvedValue([makeImage({ systemId: 'sys-1' })]);
    await state.loadImages('sys-1');

    state.clearImagesForSystem('sys-1');
    expect(state.images()).toHaveLength(0);
  });

  it('should check loading state', () => {
    expect(state.isLoading('img-1')).toBe(false);
  });

  it('should clear error', () => {
    state.clearError();
    expect(state.error()).toBeNull();
  });
});
