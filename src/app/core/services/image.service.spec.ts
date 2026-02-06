import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImageService } from './image.service';
import { TauriService } from './tauri.service';

describe('ImageService', () => {
  let service: ImageService;
  let tauriMock: { invoke: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    tauriMock = { invoke: vi.fn() };
    service = new ImageService(tauriMock as unknown as TauriService);
  });

  describe('listImages', () => {
    it('should call with systemId', async () => {
      tauriMock.invoke.mockResolvedValue([]);
      await service.listImages('sys-1');
      expect(tauriMock.invoke).toHaveBeenCalledWith('list_images', { systemId: 'sys-1' });
    });
  });

  describe('pullImage', () => {
    it('should call with all required parameters', async () => {
      tauriMock.invoke.mockResolvedValue(undefined);
      await service.pullImage('sys-1', 'nginx', 'latest', 'docker');
      expect(tauriMock.invoke).toHaveBeenCalledWith('pull_image', {
        systemId: 'sys-1',
        name: 'nginx',
        tag: 'latest',
        runtime: 'docker',
      });
    });
  });

  describe('removeImage', () => {
    it('should call with correct parameters', async () => {
      tauriMock.invoke.mockResolvedValue(undefined);
      await service.removeImage('sys-1', 'sha256:abc', 'docker');
      expect(tauriMock.invoke).toHaveBeenCalledWith('remove_image', {
        systemId: 'sys-1',
        imageId: 'sha256:abc',
        runtime: 'docker',
      });
    });
  });
});
