import { describe, it, expect, vi } from 'vitest';
import { Injector, runInInjectionContext, ɵChangeDetectionScheduler, ɵEffectScheduler } from '@angular/core';
import { SystemImageSectionComponent } from './system-image-section.component';
import { ImageState } from '../../../../state/image.state';
import { ContainerSystem } from '../../../../core/models/system.model';
import { ContainerImage } from '../../../../core/models/image.model';

function makeSystem(overrides: Partial<ContainerSystem> = {}): ContainerSystem {
  return {
    id: 'sys-1',
    name: 'My System',
    hostname: 'localhost',
    connectionType: 'local',
    primaryRuntime: 'docker',
    availableRuntimes: ['docker'],
    autoConnect: false,
    ...overrides,
  };
}

function makeImage(overrides: Partial<ContainerImage> = {}): ContainerImage {
  return {
    id: 'sha256:abc123',
    name: 'nginx',
    tag: 'latest',
    size: 1024 * 1024 * 50,
    runtime: 'docker',
    systemId: 'sys-1',
    ...overrides,
  };
}

function makeComponent(mockOverrides: Partial<{
  getContainersUsingImage: (img: ContainerImage) => any[];
  isImageInUse: (img: ContainerImage) => boolean;
  isDangling: (img: ContainerImage) => boolean;
  isLoading: (id: string) => boolean;
}> = {}) {
  const mockImageState: any = {
    getContainersUsingImage: vi.fn(mockOverrides.getContainersUsingImage ?? (() => [])),
    isImageInUse: vi.fn(mockOverrides.isImageInUse ?? (() => false)),
    isDangling: vi.fn(mockOverrides.isDangling ?? (() => false)),
    isLoading: vi.fn(mockOverrides.isLoading ?? (() => false)),
  };
  const injector = Injector.create({
    providers: [
      { provide: ImageState, useValue: mockImageState },
      { provide: ɵChangeDetectionScheduler, useValue: { notify: vi.fn(), runningTick: false } },
      { provide: ɵEffectScheduler, useValue: { add: vi.fn(), remove: vi.fn(), schedule: vi.fn(), flush: vi.fn() } },
    ],
  });
  return {
    component: runInInjectionContext(injector, () => new SystemImageSectionComponent()),
    mockImageState,
  };
}

describe('SystemImageSectionComponent', () => {
  describe('imageCount', () => {
    it('returns 0 when no images', () => {
      const { component } = makeComponent();
      (component.images as any) = () => [];
      expect(component.imageCount()).toBe(0);
    });

    it('returns correct image count', () => {
      const { component } = makeComponent();
      (component.images as any) = () => [makeImage(), makeImage({ id: 'sha256:def456', name: 'redis' })];
      expect(component.imageCount()).toBe(2);
    });
  });

  describe('totalSize', () => {
    it('returns "0 B" for no images', () => {
      const { component } = makeComponent();
      (component.images as any) = () => [];
      expect(component.totalSize()).toBe('0 B');
    });

    it('returns GB for large total size', () => {
      const { component } = makeComponent();
      (component.images as any) = () => [makeImage({ size: 1024 * 1024 * 1024 * 2 })];
      expect(component.totalSize()).toContain('GB');
    });

    it('returns MB for medium total size', () => {
      const { component } = makeComponent();
      (component.images as any) = () => [makeImage({ size: 1024 * 1024 * 100 })];
      expect(component.totalSize()).toContain('MB');
    });

    it('sums sizes of multiple images', () => {
      const { component } = makeComponent();
      (component.images as any) = () => [
        makeImage({ size: 1024 * 1024 * 50 }),
        makeImage({ id: 'sha256:def', size: 1024 * 1024 * 50 }),
      ];
      expect(component.totalSize()).toContain('MB');
    });
  });

  describe('containerCount', () => {
    it('returns 0 when no containers use any images', () => {
      const { component } = makeComponent({ getContainersUsingImage: () => [] });
      (component.images as any) = () => [makeImage()];
      expect(component.containerCount()).toBe(0);
    });

    it('sums container counts across images', () => {
      let calls = 0;
      const { component } = makeComponent({
        getContainersUsingImage: () => {
          calls++;
          return [{}];
        },
      });
      (component.images as any) = () => [makeImage(), makeImage({ id: 'sha256:def' })];
      expect(component.containerCount()).toBe(2);
    });
  });

  describe('runtimeIcon', () => {
    it.each([
      ['docker', 'Docker'],
      ['podman', 'Podman'],
      ['apple', 'Apple'],
    ] as const)('returns %s for %s runtime', (runtime, expected) => {
      const { component } = makeComponent();
      (component.system as any) = () => makeSystem({ primaryRuntime: runtime });
      expect(component.runtimeIcon()).toBe(expected);
    });

    it('returns Container for unknown runtime', () => {
      const { component } = makeComponent();
      (component.system as any) = () => makeSystem({ primaryRuntime: 'unknown' as any });
      expect(component.runtimeIcon()).toBe('Container');
    });
  });

  describe('toggleExpanded()', () => {
    it('starts collapsed (false)', () => {
      const { component } = makeComponent();
      expect(component.expanded()).toBe(false);
    });

    it('toggles to true on first call', () => {
      const { component } = makeComponent();
      component.toggleExpanded();
      expect(component.expanded()).toBe(true);
    });

    it('toggles back to false on second call', () => {
      const { component } = makeComponent();
      component.toggleExpanded();
      component.toggleExpanded();
      expect(component.expanded()).toBe(false);
    });
  });

  describe('getContainersForImage()', () => {
    it('delegates to imageState.getContainersUsingImage', () => {
      const mockFn = vi.fn().mockReturnValue([]);
      const { component } = makeComponent({ getContainersUsingImage: mockFn });
      const img = makeImage();
      component.getContainersForImage(img);
      expect(mockFn).toHaveBeenCalledWith(img);
    });
  });

  describe('isImageUnused()', () => {
    it('returns true when image is not in use', () => {
      const { component } = makeComponent({ isImageInUse: () => false });
      expect(component.isImageUnused(makeImage())).toBe(true);
    });

    it('returns false when image is in use', () => {
      const { component } = makeComponent({ isImageInUse: () => true });
      expect(component.isImageUnused(makeImage())).toBe(false);
    });
  });

  describe('isImageDangling()', () => {
    it('returns false when image is not dangling', () => {
      const { component } = makeComponent({ isDangling: () => false });
      expect(component.isImageDangling(makeImage())).toBe(false);
    });

    it('returns true when image is dangling', () => {
      const { component } = makeComponent({ isDangling: () => true });
      expect(component.isImageDangling(makeImage())).toBe(true);
    });
  });

  describe('isImageDeleting()', () => {
    it('returns false when not loading', () => {
      const { component } = makeComponent({ isLoading: () => false });
      expect(component.isImageDeleting(makeImage())).toBe(false);
    });

    it('returns true when loading', () => {
      const { component } = makeComponent({ isLoading: () => true });
      expect(component.isImageDeleting(makeImage())).toBe(true);
    });
  });

  describe('onImageDeleted()', () => {
    it('emits the image via imageDeleted output', () => {
      const { component } = makeComponent();
      const emitted: ContainerImage[] = [];
      component.imageDeleted.subscribe((img) => emitted.push(img));
      const img = makeImage();
      component.onImageDeleted(img);
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toBe(img);
    });
  });
});
