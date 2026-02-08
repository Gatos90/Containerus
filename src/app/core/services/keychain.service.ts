import { Injectable, signal } from '@angular/core';
import { platform } from '@tauri-apps/plugin-os';

/**
 * KeychainService - Platform detection for credential handling
 *
 * Detects whether the app is running on mobile (Android/iOS) or desktop.
 * On mobile, passwords need to be provided on connect.
 * On desktop, Rust handles keyring access directly.
 */
@Injectable({
  providedIn: 'root',
})
export class KeychainService {
  private _isMobile = signal<boolean | null>(null);
  private _platformChecked = false;

  readonly isMobile = this._isMobile.asReadonly();

  /**
   * Check if running on a mobile platform (Android/iOS)
   */
  async checkPlatform(): Promise<boolean> {
    if (this._platformChecked) {
      return this._isMobile() ?? false;
    }

    try {
      const p = await platform();
      const mobile = p === 'android' || p === 'ios';
      this._isMobile.set(mobile);
      this._platformChecked = true;
      return mobile;
    } catch (err) {
      console.warn('Failed to detect platform, assuming desktop:', err);
      this._isMobile.set(false);
      this._platformChecked = true;
      return false;
    }
  }

  /**
   * Check if we need to provide password on connect
   * On mobile, we always need to retrieve and pass the password
   * On desktop, Rust handles keyring access directly
   */
  async needsPasswordOnConnect(): Promise<boolean> {
    return await this.checkPlatform();
  }
}
