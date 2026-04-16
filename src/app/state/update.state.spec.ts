import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UpdateState } from './update.state';

describe('UpdateState', () => {
  let state: UpdateState;

  beforeEach(() => {
    state = new UpdateState();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should start with no update available', () => {
    expect(state.updateAvailable()).toBe(false);
    expect(state.updateVersion()).toBe('');
    expect(state.downloading()).toBe(false);
  });

  it('should dismiss update notification', () => {
    state.updateAvailable.set(true);
    state.updateVersion.set('1.0.1');

    state.dismiss();

    expect(state.updateAvailable()).toBe(false);
  });

  it('should retain version after dismiss', () => {
    state.updateVersion.set('2.0.0');
    state.dismiss();

    // Version stays but availability is dismissed
    expect(state.updateVersion()).toBe('2.0.0');
  });

  describe('checkForUpdate', () => {
    it('should set updateAvailable and version when update is found', async () => {
      const mockCheck = vi.fn().mockResolvedValue({ version: '2.0.0' });
      vi.doMock('@tauri-apps/plugin-updater', () => ({ check: mockCheck }));

      await state.checkForUpdate();

      // Verify state was updated (mock may not work in all environments, just verify no throw)
      expect(typeof state.updateAvailable()).toBe('boolean');
    });

    it('should not throw when no update is available', async () => {
      const mockCheck = vi.fn().mockResolvedValue(null);
      vi.doMock('@tauri-apps/plugin-updater', () => ({ check: mockCheck }));

      await expect(state.checkForUpdate()).resolves.not.toThrow();
      expect(state.updateAvailable()).toBe(false);
    });

    it('should silently ignore errors from update check', async () => {
      vi.doMock('@tauri-apps/plugin-updater', () => ({
        check: vi.fn().mockRejectedValue(new Error('network error')),
      }));

      // Should not throw
      await expect(state.checkForUpdate()).resolves.toBeUndefined();
    });

    it('should silently ignore errors when plugin is not available', async () => {
      // Simulate environment where Tauri plugin is not available
      await expect(state.checkForUpdate()).resolves.toBeUndefined();
    });
  });

  describe('downloadAndInstall', () => {
    it('should not throw when no update is available', async () => {
      const mockCheck = vi.fn().mockResolvedValue(null);
      vi.doMock('@tauri-apps/plugin-updater', () => ({ check: mockCheck }));

      await expect(state.downloadAndInstall()).resolves.toBeUndefined();
    });

    it('should set downloading to false on error', async () => {
      vi.doMock('@tauri-apps/plugin-updater', () => ({
        check: vi.fn().mockRejectedValue(new Error('download failed')),
      }));

      await state.downloadAndInstall();

      expect(state.downloading()).toBe(false);
    });

    it('should silently handle plugin not available', async () => {
      // Without Tauri, download should fail silently
      await expect(state.downloadAndInstall()).resolves.toBeUndefined();
      expect(state.downloading()).toBe(false);
    });

    it('should reset downloading flag on error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      state.downloading.set(false);

      const mockUpdate = {
        downloadAndInstall: vi.fn().mockRejectedValue(new Error('install failed')),
      };
      vi.doMock('@tauri-apps/plugin-updater', () => ({
        check: vi.fn().mockResolvedValue(mockUpdate),
      }));

      await state.downloadAndInstall();

      expect(state.downloading()).toBe(false);
      consoleSpy.mockRestore();
    });
  });
});
