import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChangelogState } from './changelog.state';
import { TauriService } from '../core/services/tauri.service';

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn(),
}));

import { getVersion } from '@tauri-apps/api/app';

function makeState(tauriOverrides: Partial<{ invoke: ReturnType<typeof vi.fn> }> = {}) {
  const mockTauri: any = {
    invoke: vi.fn(),
    ...tauriOverrides,
  };
  return { state: new ChangelogState(mockTauri as TauriService), tauri: mockTauri };
}

const SAMPLE_CHANGELOG = `
## [1.2.0]
### Added
- Feature A
- Feature B

## [1.1.0]
### Fixed
- Bug fix C

## [1.0.0]
### Initial
- First release
`.trim();

describe('ChangelogState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create with default signal values', () => {
    const { state } = makeState();
    expect(state.showModal()).toBe(false);
    expect(state.entries()).toEqual([]);
  });

  // ── checkForChangelog ──────────────────────────────────────────────────────

  describe('checkForChangelog', () => {
    it('should not show modal when version matches lastSeenVersion', async () => {
      const { state, tauri } = makeState();
      (getVersion as ReturnType<typeof vi.fn>).mockResolvedValue('1.2.0');
      tauri.invoke
        .mockResolvedValueOnce({ lastSeenVersion: '1.2.0' }) // get_app_settings
        .mockResolvedValueOnce(SAMPLE_CHANGELOG);             // get_changelog

      await state.checkForChangelog();

      expect(state.showModal()).toBe(false);
      expect(state.entries()).toEqual([]);
    });

    it('should show modal with new entries when version is newer than lastSeen', async () => {
      const { state, tauri } = makeState();
      (getVersion as ReturnType<typeof vi.fn>).mockResolvedValue('1.2.0');
      tauri.invoke
        .mockResolvedValueOnce({ lastSeenVersion: '1.1.0' })
        .mockResolvedValueOnce(SAMPLE_CHANGELOG);

      await state.checkForChangelog();

      expect(state.showModal()).toBe(true);
      expect(state.entries().length).toBe(1);
      expect(state.entries()[0].version).toBe('1.2.0');
    });

    it('should show only first entry on first launch (no lastSeenVersion)', async () => {
      const { state, tauri } = makeState();
      (getVersion as ReturnType<typeof vi.fn>).mockResolvedValue('1.2.0');
      tauri.invoke
        .mockResolvedValueOnce({ lastSeenVersion: null })
        .mockResolvedValueOnce(SAMPLE_CHANGELOG);

      await state.checkForChangelog();

      expect(state.showModal()).toBe(true);
      expect(state.entries().length).toBe(1);
      expect(state.entries()[0].version).toBe('1.2.0');
    });

    it('should show only first entry when lastSeenVersion is undefined', async () => {
      const { state, tauri } = makeState();
      (getVersion as ReturnType<typeof vi.fn>).mockResolvedValue('1.2.0');
      tauri.invoke
        .mockResolvedValueOnce({})  // no lastSeenVersion property
        .mockResolvedValueOnce(SAMPLE_CHANGELOG);

      await state.checkForChangelog();

      expect(state.showModal()).toBe(true);
      expect(state.entries().length).toBe(1);
    });

    it('should mark as seen (call update_app_settings) when version changed but no matching entries', async () => {
      const { state, tauri } = makeState();
      (getVersion as ReturnType<typeof vi.fn>).mockResolvedValue('2.0.0');
      tauri.invoke
        .mockResolvedValueOnce({ lastSeenVersion: '1.2.0' })
        .mockResolvedValueOnce(SAMPLE_CHANGELOG)
        .mockResolvedValueOnce(undefined); // update_app_settings

      await state.checkForChangelog();

      expect(state.showModal()).toBe(false);
      expect(tauri.invoke).toHaveBeenCalledWith('update_app_settings', expect.objectContaining({
        settings: expect.objectContaining({ lastSeenVersion: '2.0.0' }),
      }));
    });

    it('should not throw on error, just warn', async () => {
      const { state, tauri } = makeState();
      (getVersion as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network error'));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(state.checkForChangelog()).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to check changelog'),
        expect.any(Error)
      );
      warnSpy.mockRestore();
    });

    it('should show multiple new entries when several versions are new', async () => {
      const { state, tauri } = makeState();
      (getVersion as ReturnType<typeof vi.fn>).mockResolvedValue('1.2.0');
      tauri.invoke
        .mockResolvedValueOnce({ lastSeenVersion: '1.0.0' })
        .mockResolvedValueOnce(SAMPLE_CHANGELOG);

      await state.checkForChangelog();

      expect(state.showModal()).toBe(true);
      expect(state.entries().length).toBe(2);
      expect(state.entries().map((e) => e.version)).toEqual(['1.2.0', '1.1.0']);
    });

    it('should not show modal when changelog is empty', async () => {
      const { state, tauri } = makeState();
      (getVersion as ReturnType<typeof vi.fn>).mockResolvedValue('1.2.0');
      tauri.invoke
        .mockResolvedValueOnce({ lastSeenVersion: null })
        .mockResolvedValueOnce('');

      await state.checkForChangelog();

      expect(state.showModal()).toBe(false);
    });
  });

  // ── showChangelog ──────────────────────────────────────────────────────────

  describe('showChangelog', () => {
    it('should set all entries and show modal', async () => {
      const { state, tauri } = makeState();
      tauri.invoke.mockResolvedValue(SAMPLE_CHANGELOG);

      await state.showChangelog();

      expect(state.showModal()).toBe(true);
      expect(state.entries().length).toBe(3);
    });

    it('should not show modal when no entries exist', async () => {
      const { state, tauri } = makeState();
      tauri.invoke.mockResolvedValue('');

      await state.showChangelog();

      expect(state.showModal()).toBe(false);
    });

    it('should not throw on error, just warn', async () => {
      const { state, tauri } = makeState();
      tauri.invoke.mockRejectedValue(new Error('backend down'));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(state.showChangelog()).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load changelog'),
        expect.any(Error)
      );
      warnSpy.mockRestore();
    });

    it('should call get_changelog tauri command', async () => {
      const { state, tauri } = makeState();
      tauri.invoke.mockResolvedValue(SAMPLE_CHANGELOG);

      await state.showChangelog();

      expect(tauri.invoke).toHaveBeenCalledWith('get_changelog');
    });
  });

  // ── dismiss ────────────────────────────────────────────────────────────────

  describe('dismiss', () => {
    it('should hide the modal immediately', async () => {
      const { state, tauri } = makeState();
      (getVersion as ReturnType<typeof vi.fn>).mockResolvedValue('1.2.0');
      tauri.invoke.mockResolvedValue({ lastSeenVersion: '1.1.0' });

      // Pre-set modal to visible
      state.showModal.set(true);

      await state.dismiss();

      expect(state.showModal()).toBe(false);
    });

    it('should call update_app_settings with current version', async () => {
      const { state, tauri } = makeState();
      (getVersion as ReturnType<typeof vi.fn>).mockResolvedValue('1.2.0');
      const settings = { lastSeenVersion: '1.1.0', theme: 'dark' };
      tauri.invoke
        .mockResolvedValueOnce(settings)    // get_app_settings
        .mockResolvedValueOnce(undefined);  // update_app_settings

      await state.dismiss();

      expect(tauri.invoke).toHaveBeenCalledWith('update_app_settings', {
        settings: { ...settings, lastSeenVersion: '1.2.0' },
      });
    });

    it('should not throw on error during dismiss, just warn', async () => {
      const { state, tauri } = makeState();
      (getVersion as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('version error'));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(state.dismiss()).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to save last seen version'),
        expect.any(Error)
      );
      warnSpy.mockRestore();
    });

    it('should hide modal even when markAsSeen throws', async () => {
      const { state, tauri } = makeState();
      (getVersion as ReturnType<typeof vi.fn>).mockResolvedValue('1.2.0');
      tauri.invoke.mockRejectedValue(new Error('DB error'));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      state.showModal.set(true);

      await state.dismiss();

      expect(state.showModal()).toBe(false);
      warnSpy.mockRestore();
    });
  });

  // ── parseChangelog (tested via public surface) ─────────────────────────────

  describe('changelog parsing', () => {
    it('should parse multiple versions from raw changelog', async () => {
      const { state, tauri } = makeState();
      tauri.invoke.mockResolvedValue(SAMPLE_CHANGELOG);

      await state.showChangelog();

      const entries = state.entries();
      expect(entries.length).toBe(3);
      expect(entries[0].version).toBe('1.2.0');
      expect(entries[1].version).toBe('1.1.0');
      expect(entries[2].version).toBe('1.0.0');
    });

    it('should capture content for each entry', async () => {
      const { state, tauri } = makeState();
      tauri.invoke.mockResolvedValue(SAMPLE_CHANGELOG);

      await state.showChangelog();

      const entry = state.entries()[0];
      expect(entry.content).toContain('Feature A');
      expect(entry.content).toContain('Feature B');
    });

    it('should handle changelog with only one version', async () => {
      const { state, tauri } = makeState();
      tauri.invoke.mockResolvedValue('## [1.0.0]\n- Only release');

      await state.showChangelog();

      expect(state.entries().length).toBe(1);
      expect(state.entries()[0].version).toBe('1.0.0');
    });

    it('should handle entries between specific versions', async () => {
      const { state, tauri } = makeState();
      (getVersion as ReturnType<typeof vi.fn>).mockResolvedValue('1.2.0');
      tauri.invoke
        .mockResolvedValueOnce({ lastSeenVersion: '1.1.0' })
        .mockResolvedValueOnce(SAMPLE_CHANGELOG);

      await state.checkForChangelog();

      // Only 1.2.0 is new since lastSeen is 1.1.0
      expect(state.entries().length).toBe(1);
      expect(state.entries()[0].version).toBe('1.2.0');
    });
  });
});
