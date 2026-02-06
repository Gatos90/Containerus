import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeychainService } from './keychain.service';

// Mock platform modules
vi.mock('@tauri-apps/plugin-os', () => ({
  platform: vi.fn(),
}));

vi.mock('tauri-plugin-keychain', () => ({
  getItem: vi.fn(),
  saveItem: vi.fn(),
  removeItem: vi.fn(),
}));

import { platform } from '@tauri-apps/plugin-os';
import { getItem, saveItem, removeItem } from 'tauri-plugin-keychain';

const mockPlatform = vi.mocked(platform);
const mockGetItem = vi.mocked(getItem);
const mockSaveItem = vi.mocked(saveItem);
const mockRemoveItem = vi.mocked(removeItem);

describe('KeychainService', () => {
  let service: KeychainService;
  let mockTauri: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTauri = { invoke: vi.fn() };
    service = new KeychainService(mockTauri);
  });

  describe('checkPlatform', () => {
    it('should detect desktop platform', async () => {
      mockPlatform.mockResolvedValue('macos' as any);

      const result = await service.checkPlatform();
      expect(result).toBe(false);
      expect(service.isMobile()).toBe(false);
    });

    it('should detect android as mobile', async () => {
      mockPlatform.mockResolvedValue('android' as any);

      const result = await service.checkPlatform();
      expect(result).toBe(true);
      expect(service.isMobile()).toBe(true);
    });

    it('should detect iOS as mobile', async () => {
      mockPlatform.mockResolvedValue('ios' as any);

      const result = await service.checkPlatform();
      expect(result).toBe(true);
    });

    it('should cache platform check result', async () => {
      mockPlatform.mockResolvedValue('macos' as any);

      await service.checkPlatform();
      await service.checkPlatform();

      // Should only call platform() once
      expect(mockPlatform).toHaveBeenCalledTimes(1);
    });

    it('should default to desktop on error', async () => {
      mockPlatform.mockRejectedValue(new Error('not available'));

      const result = await service.checkPlatform();
      expect(result).toBe(false);
    });
  });

  describe('desktop mode', () => {
    beforeEach(async () => {
      mockPlatform.mockResolvedValue('macos' as any);
    });

    it('should store SSH password via Tauri command', async () => {
      mockTauri.invoke.mockResolvedValue(undefined);

      await service.storeSshPassword('user1', 'pass123');
      expect(mockTauri.invoke).toHaveBeenCalledWith('store_ssh_password', {
        username: 'user1',
        password: 'pass123',
      });
    });

    it('should return null for getSshPassword on desktop', async () => {
      const result = await service.getSshPassword('user1');
      expect(result).toBeNull();
    });

    it('should store SSH key passphrase via Tauri command', async () => {
      mockTauri.invoke.mockResolvedValue(undefined);

      await service.storeSshKeyPassphrase('/home/.ssh/id_rsa', 'phrase123');
      expect(mockTauri.invoke).toHaveBeenCalledWith('store_ssh_key_passphrase', {
        keyPath: '/home/.ssh/id_rsa',
        passphrase: 'phrase123',
      });
    });

    it('should return null for getSshKeyPassphrase on desktop', async () => {
      const result = await service.getSshKeyPassphrase('/home/.ssh/id_rsa');
      expect(result).toBeNull();
    });

    it('should not need password on connect for desktop', async () => {
      const result = await service.needsPasswordOnConnect();
      expect(result).toBe(false);
    });
  });

  describe('mobile mode', () => {
    beforeEach(async () => {
      mockPlatform.mockResolvedValue('android' as any);
    });

    it('should store SSH password via keychain plugin', async () => {
      mockSaveItem.mockResolvedValue(undefined as any);

      await service.storeSshPassword('user1', 'pass123');
      expect(mockSaveItem).toHaveBeenCalledWith('ssh-password:user1', 'pass123');
    });

    it('should get SSH password via keychain plugin', async () => {
      mockGetItem.mockResolvedValue('pass123' as any);

      const result = await service.getSshPassword('user1');
      expect(result).toBe('pass123');
    });

    it('should return null on getSshPassword failure', async () => {
      mockGetItem.mockRejectedValue(new Error('timeout'));

      const result = await service.getSshPassword('user1');
      expect(result).toBeNull();
    });

    it('should remove SSH password via keychain plugin', async () => {
      mockRemoveItem.mockResolvedValue(undefined as any);

      await service.removeSshPassword('user1');
      expect(mockRemoveItem).toHaveBeenCalledWith('ssh-password:user1');
    });

    it('should need password on connect for mobile', async () => {
      const result = await service.needsPasswordOnConnect();
      expect(result).toBe(true);
    });
  });
});
