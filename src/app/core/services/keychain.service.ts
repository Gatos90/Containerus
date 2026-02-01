import { Injectable, signal } from '@angular/core';
import { platform } from '@tauri-apps/plugin-os';
import { getItem, saveItem, removeItem } from 'tauri-plugin-keychain';
import { TauriService } from './tauri.service';

/**
 * KeychainService - Cross-platform secure credential storage
 *
 * On Android/iOS: Uses tauri-plugin-keychain (AccountManager/Keychain)
 * On Desktop: Uses Rust keyring crate via Tauri commands
 *
 * Note: The tauri-plugin-keychain Android implementation via AccountManager
 * is unstable and may hang indefinitely. We use timeouts to prevent this.
 */
@Injectable({
  providedIn: 'root',
})
export class KeychainService {
  private _isMobile = signal<boolean | null>(null);
  private _platformChecked = false;

  /** Timeout for keychain operations in milliseconds */
  private readonly KEYCHAIN_TIMEOUT_MS = 5000;

  readonly isMobile = this._isMobile.asReadonly();

  constructor(private tauri: TauriService) {}

  /**
   * Wrap a promise with a timeout to prevent indefinite hangs
   */
  private async withTimeout<T>(promise: Promise<T>, ms: number, operation: string): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`${operation} timed out after ${ms}ms`));
      }, ms);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
      clearTimeout(timeoutId);
    });
  }

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
   * Store SSH password for a username
   */
  async storeSshPassword(username: string, password: string): Promise<void> {
    const mobile = await this.checkPlatform();
    const key = `ssh-password:${username}`;

    console.log(`[KeychainService] storeSshPassword called, mobile=${mobile}, key=${key}`);

    if (mobile) {
      try {
        console.log('[KeychainService] Calling saveItem...');
        await this.withTimeout(saveItem(key, password), this.KEYCHAIN_TIMEOUT_MS, 'saveItem');
        console.log('[KeychainService] saveItem succeeded');
      } catch (err) {
        console.error('[KeychainService] saveItem failed:', err);
        throw err; // Re-throw so the caller can handle it
      }
    } else {
      // Desktop: use Rust keyring via Tauri command
      await this.tauri.invoke<void>('store_ssh_password', { username, password });
    }
  }

  /**
   * Get SSH password for a username
   */
  async getSshPassword(username: string): Promise<string | null> {
    const mobile = await this.checkPlatform();
    const key = `ssh-password:${username}`;

    console.log(`[KeychainService] getSshPassword called, mobile=${mobile}, key=${key}`);

    if (mobile) {
      try {
        console.log('[KeychainService] Calling getItem...');
        const result = await this.withTimeout(getItem(key), this.KEYCHAIN_TIMEOUT_MS, 'getItem');
        console.log('[KeychainService] getItem succeeded, hasValue:', !!result);
        return result;
      } catch (err) {
        console.error('[KeychainService] getItem failed:', err);
        return null; // Return null on failure so caller can prompt for password
      }
    } else {
      // Desktop: keyring is accessed directly in Rust during SSH connection
      // Return null - Rust will retrieve it from keyring
      return null;
    }
  }

  /**
   * Remove SSH password for a username
   */
  async removeSshPassword(username: string): Promise<void> {
    const mobile = await this.checkPlatform();
    const key = `ssh-password:${username}`;

    if (mobile) {
      await removeItem(key);
    }
    // Desktop: no easy way to remove from keyring via command, skip for now
  }

  /**
   * Store SSH key passphrase
   */
  async storeSshKeyPassphrase(keyPath: string, passphrase: string): Promise<void> {
    const mobile = await this.checkPlatform();
    const key = `ssh-keypass:${keyPath}`;

    console.log(`[KeychainService] storeSshKeyPassphrase called, mobile=${mobile}, key=${key}`);

    if (mobile) {
      try {
        console.log('[KeychainService] Calling saveItem for passphrase...');
        await this.withTimeout(saveItem(key, passphrase), this.KEYCHAIN_TIMEOUT_MS, 'saveItem');
        console.log('[KeychainService] saveItem for passphrase succeeded');
      } catch (err) {
        console.error('[KeychainService] saveItem for passphrase failed:', err);
        throw err;
      }
    } else {
      // Desktop: use Rust keyring via Tauri command
      await this.tauri.invoke<void>('store_ssh_key_passphrase', { keyPath, passphrase });
    }
  }

  /**
   * Get SSH key passphrase
   */
  async getSshKeyPassphrase(keyPath: string): Promise<string | null> {
    const mobile = await this.checkPlatform();
    const key = `ssh-keypass:${keyPath}`;

    console.log(`[KeychainService] getSshKeyPassphrase called, mobile=${mobile}, key=${key}`);

    if (mobile) {
      try {
        console.log('[KeychainService] Calling getItem for passphrase...');
        const result = await this.withTimeout(getItem(key), this.KEYCHAIN_TIMEOUT_MS, 'getItem');
        console.log('[KeychainService] getItem for passphrase succeeded, hasValue:', !!result);
        return result;
      } catch (err) {
        console.error('[KeychainService] getItem for passphrase failed:', err);
        return null;
      }
    } else {
      // Desktop: keyring is accessed directly in Rust
      return null;
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
