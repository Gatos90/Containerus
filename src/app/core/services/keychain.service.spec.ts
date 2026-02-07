import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeychainService } from './keychain.service';

// Mock platform modules
vi.mock('@tauri-apps/plugin-os', () => ({
  platform: vi.fn(),
}));

import { platform } from '@tauri-apps/plugin-os';

const mockPlatform = vi.mocked(platform);

describe('KeychainService', () => {
  let service: KeychainService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new KeychainService();
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

  describe('needsPasswordOnConnect', () => {
    it('should not need password on connect for desktop', async () => {
      mockPlatform.mockResolvedValue('macos' as any);

      const result = await service.needsPasswordOnConnect();
      expect(result).toBe(false);
    });

    it('should need password on connect for mobile', async () => {
      mockPlatform.mockResolvedValue('android' as any);

      const result = await service.needsPasswordOnConnect();
      expect(result).toBe(true);
    });
  });
});
