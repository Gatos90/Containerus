import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { VolumeListComponent } from './volume-list.component';
import { VolumeState } from '../../../state/volume.state';
import { SystemState } from '../../../state/system.state';
import { ContainerState } from '../../../state/container.state';
import type { Volume } from '../../../core/models/volume.model';

const makeVolume = (overrides: Partial<Volume> = {}): Volume =>
  ({
    name: 'my-volume',
    driver: 'local',
    mountpoint: '/var/lib/docker/volumes/my-volume/_data',
    created: '2024-01-01T00:00:00Z',
    runtime: 'docker',
    systemId: 'sys-1',
    labels: {},
    options: {},
    ...overrides,
  } as Volume);

function makeComponent(): VolumeListComponent {
  const mockVolumeState: any = {
    filteredVolumes: vi.fn(() => []),
    loadVolumes: vi.fn().mockResolvedValue(undefined),
    createVolume: vi.fn().mockResolvedValue(undefined),
    removeVolume: vi.fn().mockResolvedValue(undefined),
  };

  const mockSystemState: any = {
    connectedSystems: vi.fn(() => []),
  };

  const mockContainerState: any = {
    loadContainers: vi.fn().mockResolvedValue(undefined),
  };

  const injector = Injector.create({
    providers: [
      { provide: VolumeState, useValue: mockVolumeState },
      { provide: SystemState, useValue: mockSystemState },
      { provide: ContainerState, useValue: mockContainerState },
    ],
  });

  return runInInjectionContext(injector, () => new VolumeListComponent());
}

describe('VolumeListComponent', () => {
  let component: VolumeListComponent;

  beforeEach(() => {
    component = makeComponent();
  });

  describe('initial state', () => {
    it('should initialize refreshing to false', () => {
      expect(component.refreshing).toBe(false);
    });

    it('should initialize showCreateDialog to false', () => {
      expect(component.showCreateDialog).toBe(false);
    });

    it('should initialize showMobileFilters signal to false', () => {
      expect(component.showMobileFilters()).toBe(false);
    });

    it('should initialize createForm with default values', () => {
      expect(component.createForm.name).toBe('');
      expect(component.createForm.systemId).toBe('');
      expect(component.createForm.runtime).toBe('docker');
      expect(component.createForm.driver).toBe('');
    });
  });

  describe('refresh', () => {
    it('should call loadVolumes and loadContainers for each connected system', async () => {
      component.systemState.connectedSystems = vi.fn(() => [
        { id: 'sys-1' } as any,
        { id: 'sys-2' } as any,
      ]);
      await component.refresh();
      expect(component.volumeState.loadVolumes).toHaveBeenCalledWith('sys-1');
      expect(component.volumeState.loadVolumes).toHaveBeenCalledWith('sys-2');
      expect(component.containerState.loadContainers).toHaveBeenCalledWith('sys-1');
      expect(component.containerState.loadContainers).toHaveBeenCalledWith('sys-2');
    });

    it('should set refreshing to false after successful refresh', async () => {
      await component.refresh();
      expect(component.refreshing).toBe(false);
    });

    it('should set refreshing to false even when a call throws', async () => {
      component.systemState.connectedSystems = vi.fn(() => [{ id: 'sys-1' } as any]);
      component.volumeState.loadVolumes = vi.fn().mockRejectedValue(new Error('fail'));
      await expect(component.refresh()).rejects.toThrow();
      expect(component.refreshing).toBe(false);
    });

    it('should not call loadVolumes when no systems connected', async () => {
      await component.refresh();
      expect(component.volumeState.loadVolumes).not.toHaveBeenCalled();
    });
  });

  describe('ngOnInit', () => {
    it('should call refresh on init', async () => {
      const refreshSpy = vi.spyOn(component, 'refresh').mockResolvedValue(undefined);
      await component.ngOnInit();
      expect(refreshSpy).toHaveBeenCalled();
    });

    it('should set createForm.systemId to first connected system', async () => {
      component.systemState.connectedSystems = vi.fn(() => [
        { id: 'sys-77' } as any,
        { id: 'sys-88' } as any,
      ]);
      vi.spyOn(component, 'refresh').mockResolvedValue(undefined);
      await component.ngOnInit();
      expect(component.createForm.systemId).toBe('sys-77');
    });

    it('should not set createForm.systemId when no systems connected', async () => {
      vi.spyOn(component, 'refresh').mockResolvedValue(undefined);
      await component.ngOnInit();
      expect(component.createForm.systemId).toBe('');
    });
  });

  describe('createVolume', () => {
    it('should do nothing when createForm name is empty', async () => {
      component.createForm.name = '';
      component.createForm.systemId = 'sys-1';
      await component.createVolume();
      expect(component.volumeState.createVolume).not.toHaveBeenCalled();
    });

    it('should do nothing when createForm systemId is empty', async () => {
      component.createForm.name = 'my-vol';
      component.createForm.systemId = '';
      await component.createVolume();
      expect(component.volumeState.createVolume).not.toHaveBeenCalled();
    });

    it('should call volumeState.createVolume with correct arguments', async () => {
      component.createForm.name = 'my-vol';
      component.createForm.systemId = 'sys-1';
      component.createForm.runtime = 'docker';
      component.createForm.driver = 'local';
      await component.createVolume();
      expect(component.volumeState.createVolume).toHaveBeenCalledWith(
        'sys-1',
        'my-vol',
        'docker',
        'local'
      );
    });

    it('should pass undefined for driver when driver is empty string', async () => {
      component.createForm.name = 'my-vol';
      component.createForm.systemId = 'sys-1';
      component.createForm.driver = '';
      await component.createVolume();
      expect(component.volumeState.createVolume).toHaveBeenCalledWith(
        'sys-1',
        'my-vol',
        'docker',
        undefined
      );
    });

    it('should close create dialog after successful creation', async () => {
      component.showCreateDialog = true;
      component.createForm.name = 'my-vol';
      component.createForm.systemId = 'sys-1';
      await component.createVolume();
      expect(component.showCreateDialog).toBe(false);
    });

    it('should reset form name and driver after creation', async () => {
      component.createForm.name = 'my-vol';
      component.createForm.driver = 'nfs';
      component.createForm.systemId = 'sys-1';
      await component.createVolume();
      expect(component.createForm.name).toBe('');
      expect(component.createForm.driver).toBe('');
    });

    it('should preserve systemId in createForm after creation', async () => {
      component.createForm.name = 'my-vol';
      component.createForm.systemId = 'sys-1';
      await component.createVolume();
      expect(component.createForm.systemId).toBe('sys-1');
    });

    it('should reset runtime to docker after creation', async () => {
      component.createForm.name = 'my-vol';
      component.createForm.systemId = 'sys-1';
      component.createForm.runtime = 'docker';
      await component.createVolume();
      expect(component.createForm.runtime).toBe('docker');
    });
  });

  describe('onVolumeDeleted', () => {
    it('should call removeVolume when user confirms', async () => {
      vi.stubGlobal('confirm', vi.fn(() => true));
      const volume = makeVolume({ name: 'my-volume' });
      await component.onVolumeDeleted(volume);
      expect(component.volumeState.removeVolume).toHaveBeenCalledWith(volume);
      vi.unstubAllGlobals();
    });

    it('should not call removeVolume when user cancels', async () => {
      vi.stubGlobal('confirm', vi.fn(() => false));
      const volume = makeVolume();
      await component.onVolumeDeleted(volume);
      expect(component.volumeState.removeVolume).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it('should include volume name in confirmation dialog', async () => {
      const mockConfirm = vi.fn(() => false);
      vi.stubGlobal('confirm', mockConfirm);
      const volume = makeVolume({ name: 'critical-data' });
      await component.onVolumeDeleted(volume);
      expect(mockConfirm).toHaveBeenCalledWith(expect.stringContaining('critical-data'));
      vi.unstubAllGlobals();
    });
  });

  describe('filteredVolumesBySystem computed', () => {
    it('should return empty object when no volumes', () => {
      component.volumeState.filteredVolumes = vi.fn(() => []);
      expect(component.filteredVolumesBySystem()).toEqual({});
    });

    it('should group volumes by systemId', () => {
      component.volumeState.filteredVolumes = vi.fn(() => [
        makeVolume({ name: 'vol-a', systemId: 'sys-1' }),
        makeVolume({ name: 'vol-b', systemId: 'sys-2' }),
        makeVolume({ name: 'vol-c', systemId: 'sys-1' }),
      ]);
      const grouped = component.filteredVolumesBySystem();
      expect(Object.keys(grouped)).toHaveLength(2);
      expect(grouped['sys-1']).toHaveLength(2);
      expect(grouped['sys-2']).toHaveLength(1);
    });

    it('should put all volumes under the same key when all share one systemId', () => {
      component.volumeState.filteredVolumes = vi.fn(() => [
        makeVolume({ name: 'vol-a', systemId: 'sys-1' }),
        makeVolume({ name: 'vol-b', systemId: 'sys-1' }),
      ]);
      const grouped = component.filteredVolumesBySystem();
      expect(Object.keys(grouped)).toHaveLength(1);
      expect(grouped['sys-1']).toHaveLength(2);
    });

    it('should return separate entries for each system', () => {
      component.volumeState.filteredVolumes = vi.fn(() => [
        makeVolume({ name: 'vol-a', systemId: 'sys-1' }),
        makeVolume({ name: 'vol-b', systemId: 'sys-2' }),
        makeVolume({ name: 'vol-c', systemId: 'sys-3' }),
      ]);
      const grouped = component.filteredVolumesBySystem();
      expect(Object.keys(grouped)).toHaveLength(3);
    });
  });
});
