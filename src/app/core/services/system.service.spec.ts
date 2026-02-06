import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SystemService } from './system.service';
import { TauriService } from './tauri.service';

describe('SystemService', () => {
  let service: SystemService;
  let tauriMock: { invoke: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    tauriMock = { invoke: vi.fn() };
    service = new SystemService(tauriMock as unknown as TauriService);
  });

  describe('listSystems', () => {
    it('should call tauri invoke', async () => {
      tauriMock.invoke.mockResolvedValue([]);
      await service.listSystems();
      expect(tauriMock.invoke).toHaveBeenCalledWith('list_systems');
    });
  });

  describe('addSystem', () => {
    it('should pass payload correctly', async () => {
      const payload = { name: 'test', hostname: 'localhost' };
      tauriMock.invoke.mockResolvedValue({ id: 'new-id', ...payload });
      const result = await service.addSystem(payload as any);
      expect(tauriMock.invoke).toHaveBeenCalledWith('add_system', { payload });
      expect(result.id).toBe('new-id');
    });
  });

  describe('updateSystem', () => {
    it('should pass payload correctly', async () => {
      const payload = { id: 'sys-1', name: 'updated' };
      tauriMock.invoke.mockResolvedValue(payload);
      await service.updateSystem(payload as any);
      expect(tauriMock.invoke).toHaveBeenCalledWith('update_system', { payload });
    });
  });

  describe('removeSystem', () => {
    it('should pass systemId', async () => {
      tauriMock.invoke.mockResolvedValue(true);
      const result = await service.removeSystem('sys-1');
      expect(tauriMock.invoke).toHaveBeenCalledWith('remove_system', { systemId: 'sys-1' });
      expect(result).toBe(true);
    });
  });

  describe('connectSystem', () => {
    it('should pass systemId and optional credentials', async () => {
      tauriMock.invoke.mockResolvedValue('connected');
      await service.connectSystem('sys-1', 'password123');
      expect(tauriMock.invoke).toHaveBeenCalledWith('connect_system', {
        systemId: 'sys-1',
        password: 'password123',
        passphrase: undefined,
        privateKey: undefined,
      });
    });

    it('should work without credentials', async () => {
      tauriMock.invoke.mockResolvedValue('connected');
      await service.connectSystem('sys-1');
      expect(tauriMock.invoke).toHaveBeenCalledWith('connect_system', {
        systemId: 'sys-1',
        password: undefined,
        passphrase: undefined,
        privateKey: undefined,
      });
    });
  });

  describe('disconnectSystem', () => {
    it('should pass systemId', async () => {
      tauriMock.invoke.mockResolvedValue('disconnected');
      await service.disconnectSystem('sys-1');
      expect(tauriMock.invoke).toHaveBeenCalledWith('disconnect_system', { systemId: 'sys-1' });
    });
  });

  describe('getConnectionState', () => {
    it('should return connection state', async () => {
      tauriMock.invoke.mockResolvedValue('connected');
      const result = await service.getConnectionState('sys-1');
      expect(result).toBe('connected');
    });
  });

  describe('detectRuntimes', () => {
    it('should return detected runtimes', async () => {
      tauriMock.invoke.mockResolvedValue(['docker', 'podman']);
      const result = await service.detectRuntimes('sys-1');
      expect(result).toEqual(['docker', 'podman']);
    });
  });

  describe('getSshCredentials', () => {
    it('should transform tuple response to object', async () => {
      tauriMock.invoke.mockResolvedValue(['mypass', null, null]);
      const result = await service.getSshCredentials('sys-1');
      expect(result).toEqual({ password: 'mypass', passphrase: null, privateKey: null });
    });
  });

  describe('hasSshConfig', () => {
    it('should pass null for empty paths', async () => {
      tauriMock.invoke.mockResolvedValue(true);
      await service.hasSshConfig([]);
      expect(tauriMock.invoke).toHaveBeenCalledWith('has_ssh_config', { configPaths: null });
    });

    it('should pass paths when provided', async () => {
      tauriMock.invoke.mockResolvedValue(true);
      await service.hasSshConfig(['/path/to/config']);
      expect(tauriMock.invoke).toHaveBeenCalledWith('has_ssh_config', { configPaths: ['/path/to/config'] });
    });
  });

  describe('getAppSettings', () => {
    it('should call correct command', async () => {
      tauriMock.invoke.mockResolvedValue({});
      await service.getAppSettings();
      expect(tauriMock.invoke).toHaveBeenCalledWith('get_app_settings');
    });
  });

  describe('updateAppSettings', () => {
    it('should pass settings', async () => {
      const settings = { sshConfigPaths: ['/path'] };
      tauriMock.invoke.mockResolvedValue(undefined);
      await service.updateAppSettings(settings as any);
      expect(tauriMock.invoke).toHaveBeenCalledWith('update_app_settings', { settings });
    });
  });
});
