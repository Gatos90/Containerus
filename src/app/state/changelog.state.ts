import { Injectable } from '@angular/core';
import { signal } from '@angular/core';
import { getVersion } from '@tauri-apps/api/app';
import { AppSettings } from '../core/models/system.model';
import { TauriService } from '../core/services/tauri.service';

export interface ChangelogEntry {
  version: string;
  content: string;
}

@Injectable({ providedIn: 'root' })
export class ChangelogState {
  readonly showModal = signal(false);
  readonly entries = signal<ChangelogEntry[]>([]);

  constructor(private tauri: TauriService) {}

  async checkForChangelog(): Promise<void> {
    try {
      const [currentVersion, settings, changelogRaw] = await Promise.all([
        getVersion(),
        this.tauri.invoke<AppSettings>('get_app_settings'),
        this.tauri.invoke<string>('get_changelog'),
      ]);

      const lastSeen = settings.lastSeenVersion;

      if (lastSeen === currentVersion) {
        return;
      }

      const allEntries = this.parseChangelog(changelogRaw);
      const newEntries = this.getEntriesSince(allEntries, lastSeen);

      if (newEntries.length > 0) {
        this.entries.set(newEntries);
        this.showModal.set(true);
      } else {
        // Version changed but no matching changelog entries — still mark as seen
        await this.markAsSeen(currentVersion, settings);
      }
    } catch (err) {
      console.warn('Failed to check changelog:', err);
    }
  }

  /** Manually open the What's New dialog (e.g. from Settings). Shows the full changelog. */
  async showChangelog(): Promise<void> {
    try {
      const changelogRaw = await this.tauri.invoke<string>('get_changelog');
      const allEntries = this.parseChangelog(changelogRaw);
      if (allEntries.length > 0) {
        this.entries.set(allEntries);
        this.showModal.set(true);
      }
    } catch (err) {
      console.warn('Failed to load changelog:', err);
    }
  }

  async dismiss(): Promise<void> {
    this.showModal.set(false);
    try {
      const [currentVersion, settings] = await Promise.all([
        getVersion(),
        this.tauri.invoke<AppSettings>('get_app_settings'),
      ]);
      await this.markAsSeen(currentVersion, settings);
    } catch (err) {
      console.warn('Failed to save last seen version:', err);
    }
  }

  private async markAsSeen(version: string, settings: AppSettings): Promise<void> {
    await this.tauri.invoke<void>('update_app_settings', {
      settings: { ...settings, lastSeenVersion: version },
    });
  }

  private parseChangelog(raw: string): ChangelogEntry[] {
    const entries: ChangelogEntry[] = [];
    const versionRegex = /^## \[([^\]]+)\]/;
    const lines = raw.split('\n');

    let currentVersion: string | null = null;
    let currentLines: string[] = [];

    for (const line of lines) {
      const match = line.match(versionRegex);
      if (match) {
        if (currentVersion) {
          entries.push({
            version: currentVersion,
            content: currentLines.join('\n').trim(),
          });
        }
        currentVersion = match[1];
        currentLines = [];
      } else if (currentVersion) {
        currentLines.push(line);
      }
    }

    if (currentVersion) {
      entries.push({
        version: currentVersion,
        content: currentLines.join('\n').trim(),
      });
    }

    return entries;
  }

  private getEntriesSince(
    allEntries: ChangelogEntry[],
    lastSeenVersion: string | null | undefined
  ): ChangelogEntry[] {
    if (!lastSeenVersion) {
      // First launch: show only the current version's entry
      return allEntries.length > 0 ? [allEntries[0]] : [];
    }

    const result: ChangelogEntry[] = [];
    for (const entry of allEntries) {
      if (entry.version === lastSeenVersion) {
        break;
      }
      result.push(entry);
    }
    return result;
  }
}
