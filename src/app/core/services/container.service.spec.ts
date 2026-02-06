import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContainerService } from './container.service';
import { TauriService } from './tauri.service';

describe('ContainerService', () => {
  let service: ContainerService;
  let tauriMock: { invoke: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    tauriMock = { invoke: vi.fn() };
    service = new ContainerService(tauriMock as unknown as TauriService);
  });

  describe('listContainers', () => {
    it('should call tauri invoke with correct command and args', async () => {
      tauriMock.invoke.mockResolvedValue([]);
      await service.listContainers('sys-1');
      expect(tauriMock.invoke).toHaveBeenCalledWith('list_containers', { systemId: 'sys-1' });
    });

    it('should return containers from backend', async () => {
      const containers = [{ id: 'c1', name: 'web' }];
      tauriMock.invoke.mockResolvedValue(containers);
      const result = await service.listContainers('sys-1');
      expect(result).toEqual(containers);
    });

    it('should propagate errors', async () => {
      tauriMock.invoke.mockRejectedValue(new Error('Not connected'));
      await expect(service.listContainers('sys-1')).rejects.toThrow('Not connected');
    });
  });

  describe('performAction', () => {
    it('should call with correct arguments', async () => {
      tauriMock.invoke.mockResolvedValue(undefined);
      await service.performAction('sys-1', 'c1', 'stop', 'docker');
      expect(tauriMock.invoke).toHaveBeenCalledWith('perform_container_action', {
        systemId: 'sys-1',
        containerId: 'c1',
        action: 'stop',
        runtime: 'docker',
      });
    });
  });

  describe('getLogs', () => {
    it('should call with default parameters', async () => {
      tauriMock.invoke.mockResolvedValue('log output');
      const result = await service.getLogs('sys-1', 'c1', 'docker');
      expect(tauriMock.invoke).toHaveBeenCalledWith('get_container_logs', {
        systemId: 'sys-1',
        containerId: 'c1',
        runtime: 'docker',
        tail: 100,
        timestamps: true,
      });
      expect(result).toBe('log output');
    });

    it('should accept custom tail and timestamps', async () => {
      tauriMock.invoke.mockResolvedValue('');
      await service.getLogs('sys-1', 'c1', 'docker', 50, false);
      expect(tauriMock.invoke).toHaveBeenCalledWith('get_container_logs', {
        systemId: 'sys-1',
        containerId: 'c1',
        runtime: 'docker',
        tail: 50,
        timestamps: false,
      });
    });
  });

  describe('inspectContainer', () => {
    it('should call with correct arguments', async () => {
      const details = { environmentVariables: {} };
      tauriMock.invoke.mockResolvedValue(details);
      const result = await service.inspectContainer('sys-1', 'c1', 'docker');
      expect(tauriMock.invoke).toHaveBeenCalledWith('inspect_container', {
        systemId: 'sys-1',
        containerId: 'c1',
        runtime: 'docker',
      });
      expect(result).toEqual(details);
    });
  });
});
