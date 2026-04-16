import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UpdateState } from './update.state';

// Mock Tauri plugin modules so we can simulate update responses
vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn().mockResolvedValue(null),
}));
vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn().mockResolvedValue(undefined),
}));

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
    it('should not throw when no update is available', async () => {
      await expect(state.checkForUpdate()).resolves.toBeUndefined();
      expect(state.updateAvailable()).toBe(false);
    });

    it('should silently ignore errors from update check', async () => {
      const { check } = await import('@tauri-apps/plugin-updater');
      (check as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network error'));
      await expect(state.checkForUpdate()).resolves.toBeUndefined();
      expect(state.updateAvailable()).toBe(false);
    });

    it('should set updateAvailable and version when update is found', async () => {
      const { check } = await import('@tauri-apps/plugin-updater');
      (check as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ version: '2.0.0' });
      await state.checkForUpdate();
      expect(state.updateAvailable()).toBe(true);
      expect(state.updateVersion()).toBe('2.0.0');
    });

    it('should not change state on repeated calls when no update', async () => {
      await state.checkForUpdate();
      await state.checkForUpdate();
      expect(state.updateAvailable()).toBe(false);
    });
  });

  describe('downloadAndInstall', () => {
    it('should not throw when called with no update', async () => {
      await expect(state.downloadAndInstall()).resolves.toBeUndefined();
    });

    it('should end with downloading=false if no update available', async () => {
      await state.downloadAndInstall();
      expect(state.downloading()).toBe(false);
    });

    it('should call downloadAndInstall and relaunch when update is available', async () => {
      const mockDownloadAndInstall = vi.fn().mockResolvedValue(undefined);
      const { check } = await import('@tauri-apps/plugin-updater');
      (check as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        version: '2.0.0',
        downloadAndInstall: mockDownloadAndInstall,
      });
      const { relaunch } = await import('@tauri-apps/plugin-process');

      await state.downloadAndInstall();

      expect(mockDownloadAndInstall).toHaveBeenCalled();
      expect(relaunch).toHaveBeenCalled();
    });

    it('should set downloading=true during download and reset on error', async () => {
      const { check } = await import('@tauri-apps/plugin-updater');
      (check as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        version: '2.0.0',
        downloadAndInstall: vi.fn().mockRejectedValue(new Error('download failed')),
      });

      await state.downloadAndInstall();
      expect(state.downloading()).toBe(false);
    });
  });
});
