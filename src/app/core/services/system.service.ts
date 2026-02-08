import { Injectable } from '@angular/core';
import { open } from '@tauri-apps/plugin-dialog';
import { ContainerRuntime } from '../models/container.model';
import {
  AppSettings,
  ConnectionState,
  ContainerSystem,
  ExtendedSystemInfo,
  JumpHostCredentials,
  NewSystemRequest,
  SshHostEntry,
  UpdateSystemRequest,
} from '../models/system.model';
import { TauriService } from './tauri.service';

@Injectable({
  providedIn: 'root',
})
export class SystemService {
  constructor(private tauri: TauriService) {}

  listSystems(): Promise<ContainerSystem[]> {
    return this.tauri.invoke<ContainerSystem[]>('list_systems');
  }

  addSystem(payload: NewSystemRequest): Promise<ContainerSystem> {
    return this.tauri.invoke<ContainerSystem>('add_system', { payload });
  }

  updateSystem(payload: UpdateSystemRequest): Promise<ContainerSystem> {
    return this.tauri.invoke<ContainerSystem>('update_system', { payload });
  }

  removeSystem(systemId: string): Promise<boolean> {
    return this.tauri.invoke<boolean>('remove_system', { systemId });
  }

  connectSystem(systemId: string, password?: string, passphrase?: string, privateKey?: string, jumpHostCredentials?: Record<string, JumpHostCredentials>): Promise<ConnectionState> {
    return this.tauri.invoke<ConnectionState>('connect_system', { systemId, password, passphrase, privateKey, jumpHostCredentials });
  }

  disconnectSystem(systemId: string): Promise<ConnectionState> {
    return this.tauri.invoke<ConnectionState>('disconnect_system', {
      systemId,
    });
  }

  getConnectionState(systemId: string): Promise<ConnectionState> {
    return this.tauri.invoke<ConnectionState>('get_connection_state', {
      systemId,
    });
  }

  detectRuntimes(systemId: string): Promise<ContainerRuntime[]> {
    return this.tauri.invoke<ContainerRuntime[]>('detect_runtimes', {
      systemId,
    });
  }

  /**
   * Store SSH credentials in the database (works on all platforms including Android)
   * This persists credentials so autoConnect works across app restarts
   */
  storeSshCredentials(systemId: string, password?: string, passphrase?: string, privateKey?: string, jumpHostCredentials?: Record<string, JumpHostCredentials>): Promise<void> {
    return this.tauri.invoke<void>('store_ssh_credentials', { systemId, password, passphrase, privateKey, jumpHostCredentials });
  }

  /**
   * Get stored SSH credentials for a system
   */
  getSshCredentials(systemId: string): Promise<{ password: string | null; passphrase: string | null; privateKey: string | null }> {
    return this.tauri.invoke<[string | null, string | null, string | null]>('get_ssh_credentials', { systemId })
      .then(([password, passphrase, privateKey]) => ({ password, passphrase, privateKey }));
  }

  /**
   * Import SSH private key from a file and return its PEM content
   * Used for mobile file picker where we can't rely on file paths
   */
  async importSshKeyFromFile(filePath: string): Promise<string> {
    return this.tauri.invoke<string>('import_ssh_key_from_file', { filePath });
  }

  /**
   * Browse for SSH key file and import its content
   * Returns the PEM content of the key, or null if cancelled
   */
  async browseAndImportSshKey(): Promise<string | null> {
    const selected = await open({
      title: 'Select SSH Private Key',
      multiple: false,
      directory: false,
      defaultPath: '~/.ssh/',
    });
    if (!selected) return null;
    return this.importSshKeyFromFile(selected);
  }

  async browseSshKey(): Promise<string | null> {
    const selected = await open({
      title: 'Select SSH Private Key',
      multiple: false,
      directory: false,
      defaultPath: '~/.ssh/',
    });
    return selected;
  }

  getExtendedSystemInfo(systemId: string): Promise<ExtendedSystemInfo> {
    return this.tauri.invoke<ExtendedSystemInfo>('get_extended_system_info', {
      systemId,
    });
  }

  /**
   * Remove a host key from ~/.ssh/known_hosts (for trust-new-key flow)
   */
  removeKnownHost(hostname: string, port: number): Promise<number> {
    return this.tauri.invoke<number>('remove_known_host', { hostname, port });
  }

  // ========================================================================
  // SSH Config Methods (for importing hosts from ~/.ssh/config)
  // ========================================================================

  /**
   * Check if any SSH config file exists
   */
  hasSshConfig(configPaths?: string[]): Promise<boolean> {
    return this.tauri.invoke<boolean>('has_ssh_config', {
      configPaths: configPaths?.length ? configPaths : null,
    });
  }

  /**
   * List all SSH hosts from config files (excludes wildcard patterns)
   */
  listSshConfigHosts(configPaths?: string[]): Promise<SshHostEntry[]> {
    return this.tauri.invoke<SshHostEntry[]>('list_ssh_config_hosts', {
      configPaths: configPaths?.length ? configPaths : null,
    });
  }

  /**
   * Get resolved SSH configuration for a specific host from config files
   */
  getSshHostConfig(host: string, configPaths?: string[]): Promise<SshHostEntry> {
    return this.tauri.invoke<SshHostEntry>('get_ssh_host_config', {
      host,
      configPaths: configPaths?.length ? configPaths : null,
    });
  }

  // ========================================================================
  // App Settings Methods
  // ========================================================================

  getAppSettings(): Promise<AppSettings> {
    return this.tauri.invoke<AppSettings>('get_app_settings');
  }

  updateAppSettings(settings: AppSettings): Promise<void> {
    return this.tauri.invoke<void>('update_app_settings', { settings });
  }
}
