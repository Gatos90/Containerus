import { describe, it, expect, vi } from 'vitest';
import { Injector, runInInjectionContext, ɵChangeDetectionScheduler, ɵEffectScheduler } from '@angular/core';
import { SystemVolumeSectionComponent } from './system-volume-section.component';
import { VolumeState } from '../../../../state/volume.state';
import { ContainerSystem } from '../../../../core/models/system.model';
import { Volume } from '../../../../core/models/volume.model';

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

function makeVolume(overrides: Partial<Volume> = {}): Volume {
  return {
    name: 'vol-1',
    driver: 'local',
    mountpoint: '/var/lib/docker/volumes/vol-1/_data',
    labels: {},
    options: {},
    runtime: 'docker',
    systemId: 'sys-1',
    ...overrides,
  };
}

function makeComponent(mockOverrides: Partial<{
  getContainersUsingVolume: (name: string) => any[];
  isVolumeMounted: (vol: Volume) => boolean;
  isLoading: (name: string) => boolean;
}> = {}) {
  const mockVolumeState: any = {
    getContainersUsingVolume: vi.fn(mockOverrides.getContainersUsingVolume ?? (() => [])),
    isVolumeMounted: vi.fn(mockOverrides.isVolumeMounted ?? (() => false)),
    isLoading: vi.fn(mockOverrides.isLoading ?? (() => false)),
  };
  const injector = Injector.create({
    providers: [
      { provide: VolumeState, useValue: mockVolumeState },
      { provide: ɵChangeDetectionScheduler, useValue: { notify: vi.fn(), runningTick: false } },
      { provide: ɵEffectScheduler, useValue: { add: vi.fn(), remove: vi.fn(), schedule: vi.fn(), flush: vi.fn() } },
    ],
  });
  return {
    component: runInInjectionContext(injector, () => new SystemVolumeSectionComponent()),
    mockVolumeState,
  };
}

describe('SystemVolumeSectionComponent', () => {
  describe('volumeCount', () => {
    it('returns 0 when no volumes', () => {
      const { component } = makeComponent();
      (component.volumes as any) = () => [];
      expect(component.volumeCount()).toBe(0);
    });

    it('returns the number of volumes', () => {
      const { component } = makeComponent();
      (component.volumes as any) = () => [makeVolume(), makeVolume({ name: 'vol-2' })];
      expect(component.volumeCount()).toBe(2);
    });
  });

  describe('containerCount', () => {
    it('returns 0 when no containers use any volume', () => {
      const { component } = makeComponent({ getContainersUsingVolume: () => [] });
      (component.volumes as any) = () => [makeVolume()];
      expect(component.containerCount()).toBe(0);
    });

    it('sums containers across multiple volumes', () => {
      const { component } = makeComponent({
        getContainersUsingVolume: (name) => name === 'vol-1' ? [{}] : [{}],
      });
      (component.volumes as any) = () => [makeVolume({ name: 'vol-1' }), makeVolume({ name: 'vol-2' })];
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

    it('toggles to true when called once', () => {
      const { component } = makeComponent();
      component.toggleExpanded();
      expect(component.expanded()).toBe(true);
    });

    it('toggles back to false when called twice', () => {
      const { component } = makeComponent();
      component.toggleExpanded();
      component.toggleExpanded();
      expect(component.expanded()).toBe(false);
    });
  });

  describe('getContainersForVolume()', () => {
    it('delegates to volumeState.getContainersUsingVolume', () => {
      const mockFn = vi.fn().mockReturnValue([]);
      const { component } = makeComponent({ getContainersUsingVolume: mockFn });
      const vol = makeVolume({ name: 'test-vol' });
      component.getContainersForVolume(vol);
      expect(mockFn).toHaveBeenCalledWith('test-vol');
    });
  });

  describe('isVolumeOrphaned()', () => {
    it('returns true when volume is not mounted', () => {
      const { component } = makeComponent({ isVolumeMounted: () => false });
      const vol = makeVolume();
      expect(component.isVolumeOrphaned(vol)).toBe(true);
    });

    it('returns false when volume is mounted', () => {
      const { component } = makeComponent({ isVolumeMounted: () => true });
      const vol = makeVolume();
      expect(component.isVolumeOrphaned(vol)).toBe(false);
    });
  });

  describe('isVolumeDeleting()', () => {
    it('returns false when not loading', () => {
      const { component } = makeComponent({ isLoading: () => false });
      const vol = makeVolume({ name: 'vol-1' });
      expect(component.isVolumeDeleting(vol)).toBe(false);
    });

    it('returns true when loading', () => {
      const { component } = makeComponent({ isLoading: () => true });
      const vol = makeVolume({ name: 'vol-1' });
      expect(component.isVolumeDeleting(vol)).toBe(true);
    });
  });

  describe('onVolumeDeleted()', () => {
    it('emits the volume via volumeDeleted output', () => {
      const { component } = makeComponent();
      const emitted: Volume[] = [];
      component.volumeDeleted.subscribe((v) => emitted.push(v));
      const vol = makeVolume();
      component.onVolumeDeleted(vol);
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toBe(vol);
    });
  });
});
