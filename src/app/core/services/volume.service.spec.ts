import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VolumeService } from './volume.service';
import { TauriService } from './tauri.service';

describe('VolumeService', () => {
  let service: VolumeService;
  let tauriMock: { invoke: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    tauriMock = { invoke: vi.fn() };
    service = new VolumeService(tauriMock as unknown as TauriService);
  });

  describe('listVolumes', () => {
    it('should call with systemId', async () => {
      tauriMock.invoke.mockResolvedValue([]);
      await service.listVolumes('sys-1');
      expect(tauriMock.invoke).toHaveBeenCalledWith('list_volumes', { systemId: 'sys-1' });
    });
  });

  describe('createVolume', () => {
    it('should call with name and runtime', async () => {
      tauriMock.invoke.mockResolvedValue(undefined);
      await service.createVolume('sys-1', 'my-vol', 'docker');
      expect(tauriMock.invoke).toHaveBeenCalledWith('create_volume', {
        systemId: 'sys-1',
        name: 'my-vol',
        runtime: 'docker',
        driver: undefined,
      });
    });

    it('should pass optional driver', async () => {
      tauriMock.invoke.mockResolvedValue(undefined);
      await service.createVolume('sys-1', 'my-vol', 'docker', 'local');
      expect(tauriMock.invoke).toHaveBeenCalledWith('create_volume', {
        systemId: 'sys-1',
        name: 'my-vol',
        runtime: 'docker',
        driver: 'local',
      });
    });
  });

  describe('removeVolume', () => {
    it('should call with correct parameters', async () => {
      tauriMock.invoke.mockResolvedValue(undefined);
      await service.removeVolume('sys-1', 'my-vol', 'docker');
      expect(tauriMock.invoke).toHaveBeenCalledWith('remove_volume', {
        systemId: 'sys-1',
        name: 'my-vol',
        runtime: 'docker',
      });
    });
  });
});
