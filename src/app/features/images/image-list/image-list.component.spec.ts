import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { ImageListComponent } from './image-list.component';
import { ImageState } from '../../../state/image.state';
import { SystemState } from '../../../state/system.state';
import { ContainerState } from '../../../state/container.state';
import type { ContainerImage } from '../../../core/models/image.model';

const makeImage = (overrides: Partial<ContainerImage> = {}): ContainerImage =>
  ({
    id: 'img-1',
    name: 'nginx',
    tag: 'latest',
    size: 52428800,
    created: '2024-01-01T00:00:00Z',
    runtime: 'docker',
    systemId: 'sys-1',
    labels: {},
    ...overrides,
  } as ContainerImage);

function makeComponent(): ImageListComponent {
  const mockImageState: any = {
    filteredImages: vi.fn(() => []),
    loadImages: vi.fn().mockResolvedValue(undefined),
    pullImage: vi.fn().mockResolvedValue(undefined),
    removeImage: vi.fn().mockResolvedValue(undefined),
  };

  const mockSystemState: any = {
    connectedSystems: vi.fn(() => []),
  };

  const mockContainerState: any = {
    loadContainers: vi.fn().mockResolvedValue(undefined),
  };

  const injector = Injector.create({
    providers: [
      { provide: ImageState, useValue: mockImageState },
      { provide: SystemState, useValue: mockSystemState },
      { provide: ContainerState, useValue: mockContainerState },
    ],
  });

  return runInInjectionContext(injector, () => new ImageListComponent());
}

describe('ImageListComponent', () => {
  let component: ImageListComponent;

  beforeEach(() => {
    component = makeComponent();
  });

  describe('initial state', () => {
    it('should initialize refreshing to false', () => {
      expect(component.refreshing).toBe(false);
    });

    it('should initialize showPullDialog to false', () => {
      expect(component.showPullDialog).toBe(false);
    });

    it('should initialize showMobileFilters signal to false', () => {
      expect(component.showMobileFilters()).toBe(false);
    });

    it('should initialize pullForm with default values', () => {
      expect(component.pullForm.name).toBe('');
      expect(component.pullForm.tag).toBe('latest');
      expect(component.pullForm.systemId).toBe('');
      expect(component.pullForm.runtime).toBe('docker');
    });
  });

  describe('refresh', () => {
    it('should call loadImages and loadContainers for each connected system', async () => {
      component.systemState.connectedSystems = vi.fn(() => [
        { id: 'sys-1' } as any,
        { id: 'sys-2' } as any,
      ]);
      await component.refresh();
      expect(component.imageState.loadImages).toHaveBeenCalledWith('sys-1');
      expect(component.imageState.loadImages).toHaveBeenCalledWith('sys-2');
      expect(component.containerState.loadContainers).toHaveBeenCalledWith('sys-1');
      expect(component.containerState.loadContainers).toHaveBeenCalledWith('sys-2');
    });

    it('should set refreshing to false after successful refresh', async () => {
      await component.refresh();
      expect(component.refreshing).toBe(false);
    });

    it('should set refreshing to false even when a call throws', async () => {
      component.imageState.loadImages = vi.fn().mockRejectedValue(new Error('network error'));
      component.systemState.connectedSystems = vi.fn(() => [{ id: 'sys-1' } as any]);
      await expect(component.refresh()).rejects.toThrow();
      expect(component.refreshing).toBe(false);
    });

    it('should not call loadImages when no systems are connected', async () => {
      await component.refresh();
      expect(component.imageState.loadImages).not.toHaveBeenCalled();
    });
  });

  describe('ngOnInit', () => {
    it('should call refresh on init', async () => {
      const refreshSpy = vi.spyOn(component, 'refresh').mockResolvedValue(undefined);
      await component.ngOnInit();
      expect(refreshSpy).toHaveBeenCalled();
    });

    it('should set pullForm.systemId to first connected system', async () => {
      component.systemState.connectedSystems = vi.fn(() => [
        { id: 'sys-42' } as any,
        { id: 'sys-99' } as any,
      ]);
      vi.spyOn(component, 'refresh').mockResolvedValue(undefined);
      await component.ngOnInit();
      expect(component.pullForm.systemId).toBe('sys-42');
    });

    it('should not set pullForm.systemId when no systems connected', async () => {
      vi.spyOn(component, 'refresh').mockResolvedValue(undefined);
      await component.ngOnInit();
      expect(component.pullForm.systemId).toBe('');
    });
  });

  describe('pullImage', () => {
    it('should do nothing when pullForm name is empty', async () => {
      component.pullForm.name = '';
      component.pullForm.systemId = 'sys-1';
      await component.pullImage();
      expect(component.imageState.pullImage).not.toHaveBeenCalled();
    });

    it('should do nothing when pullForm systemId is empty', async () => {
      component.pullForm.name = 'nginx';
      component.pullForm.systemId = '';
      await component.pullImage();
      expect(component.imageState.pullImage).not.toHaveBeenCalled();
    });

    it('should call imageState.pullImage with correct arguments', async () => {
      component.pullForm.name = 'nginx';
      component.pullForm.tag = 'alpine';
      component.pullForm.systemId = 'sys-1';
      component.pullForm.runtime = 'docker';
      await component.pullImage();
      expect(component.imageState.pullImage).toHaveBeenCalledWith('sys-1', 'nginx', 'alpine', 'docker');
    });

    it('should close pull dialog after successful pull', async () => {
      component.showPullDialog = true;
      component.pullForm.name = 'redis';
      component.pullForm.systemId = 'sys-1';
      await component.pullImage();
      expect(component.showPullDialog).toBe(false);
    });

    it('should reset pullForm name and tag after pull', async () => {
      component.pullForm.name = 'redis';
      component.pullForm.tag = '7-alpine';
      component.pullForm.systemId = 'sys-1';
      await component.pullImage();
      expect(component.pullForm.name).toBe('');
      expect(component.pullForm.tag).toBe('latest');
    });

    it('should preserve systemId in pullForm after pull', async () => {
      component.pullForm.name = 'redis';
      component.pullForm.systemId = 'sys-1';
      await component.pullImage();
      expect(component.pullForm.systemId).toBe('sys-1');
    });
  });

  describe('onImageDeleted', () => {
    it('should call removeImage when user confirms', async () => {
      vi.stubGlobal('confirm', vi.fn(() => true));
      const image = makeImage();
      await component.onImageDeleted(image);
      expect(component.imageState.removeImage).toHaveBeenCalledWith(image);
      vi.unstubAllGlobals();
    });

    it('should not call removeImage when user cancels', async () => {
      vi.stubGlobal('confirm', vi.fn(() => false));
      const image = makeImage();
      await component.onImageDeleted(image);
      expect(component.imageState.removeImage).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it('should include image name in confirmation dialog', async () => {
      const mockConfirm = vi.fn(() => false);
      vi.stubGlobal('confirm', mockConfirm);
      const image = makeImage({ name: 'postgres', tag: '15' });
      await component.onImageDeleted(image);
      expect(mockConfirm).toHaveBeenCalledWith(expect.stringContaining('postgres'));
      vi.unstubAllGlobals();
    });
  });

  describe('formatSize', () => {
    it('should format bytes in KB when less than 1 MB', () => {
      expect(component.formatSize(512 * 1024)).toBe('512.00 KB');
    });

    it('should format bytes in MB when 1 MB or more but less than 1 GB', () => {
      expect(component.formatSize(10 * 1024 * 1024)).toBe('10.00 MB');
    });

    it('should format bytes in GB when 1 GB or more', () => {
      expect(component.formatSize(2 * 1024 * 1024 * 1024)).toBe('2.00 GB');
    });

    it('should round to 2 decimal places', () => {
      const result = component.formatSize(1536 * 1024);
      expect(result).toBe('1.50 MB');
    });
  });

  describe('filteredImagesBySystem computed', () => {
    it('should return empty object when no images', () => {
      component.imageState.filteredImages = vi.fn(() => []);
      expect(component.filteredImagesBySystem()).toEqual({});
    });

    it('should group images by systemId', () => {
      component.imageState.filteredImages = vi.fn(() => [
        makeImage({ id: 'img-1', systemId: 'sys-1' }),
        makeImage({ id: 'img-2', systemId: 'sys-2' }),
        makeImage({ id: 'img-3', systemId: 'sys-1' }),
      ]);
      const grouped = component.filteredImagesBySystem();
      expect(Object.keys(grouped)).toHaveLength(2);
      expect(grouped['sys-1']).toHaveLength(2);
      expect(grouped['sys-2']).toHaveLength(1);
    });

    it('should put all images under the same key when all share one systemId', () => {
      component.imageState.filteredImages = vi.fn(() => [
        makeImage({ id: 'img-1', systemId: 'sys-1' }),
        makeImage({ id: 'img-2', systemId: 'sys-1' }),
      ]);
      const grouped = component.filteredImagesBySystem();
      expect(Object.keys(grouped)).toHaveLength(1);
      expect(grouped['sys-1']).toHaveLength(2);
    });
  });
});
