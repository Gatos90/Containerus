import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class UpdateState {
  readonly updateAvailable = signal(false);
  readonly updateVersion = signal('');
  readonly downloading = signal(false);

  async checkForUpdate(): Promise<void> {
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (update) {
        this.updateAvailable.set(true);
        this.updateVersion.set(update.version);
      }
    } catch {
      // Silently ignore — update check is non-critical
    }
  }

  async downloadAndInstall(): Promise<void> {
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (!update) return;

      this.downloading.set(true);
      await update.downloadAndInstall();

      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (err: any) {
      this.downloading.set(false);
      console.error('Update failed:', err);
    }
  }

  dismiss(): void {
    this.updateAvailable.set(false);
  }
}
