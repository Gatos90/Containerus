import { Injectable } from '@angular/core';
import { open } from '@tauri-apps/plugin-dialog';
import { ContainerRuntime } from '../models/container.model';
import {
  AppSettings,
  ConnectionState,
  ContainerSystem,
  ExtendedSystemInfo,
  JumpHostCredentials,
  LiveSystemMetrics,
  NewSystemRequest,
  SshHostEntry,
  UpdateSystemRequest,
} from '../models/system.model';
import { backendSystemToContainerSystem } from '../models/backend.model';
import { BackendService } from './backend.service';
import { TauriService } from './tauri.service';

@Injectable({
  providedIn: 'root',
})
export class SystemService {
  /** Cache of backend system connection states (systemId → connected) */
  private _backendSystemStates = new Map<string, boolean>();

  constructor(
    private tauri: TauriService,
    private backend: BackendService,
  ) {}

  async listSystems(): Promise<ContainerSystem[]> {
    // Load local and backend systems in parallel
    const localPromise = this.tauri.invoke<ContainerSystem[]>('list_systems');

    const backendPromises = this.backend.connectedBackends().map(async conn => {
      try {
        const bSystems = await this.backend.listAllSystemsFor(conn.id);
        return bSystems.map(bs => {
          this._backendSystemStates.set(bs.id, bs.connected);
          return backendSystemToContainerSystem(bs);
        });
      } catch (err) {
        console.warn(`Failed to load systems from backend ${conn.label}:`, err);
        return [];
      }
    });

    const [localSystems, ...backendResults] = await Promise.all([localPromise, ...backendPromises]);
    return [...localSystems, ...backendResults.flat()];
  }

  async addSystem(payload: NewSystemRequest, backendConnectionId?: string): Promise<ContainerSystem> {
    if (backendConnectionId) {
      // Find a project/environment to create the system in
      const conn = this.backend.getConnection(backendConnectionId);
      if (!conn) throw new Error('Backend connection not found.');
      if (!conn.projects?.length) throw new Error('No project available. Create a project first.');
      if (conn.projects.length > 1) {
        console.warn(`Multiple projects found for backend ${backendConnectionId}. Using first project: "${conn.projects[0].name}". Consider specifying a project explicitly.`);
      }
      const project = conn.projects[0];
      const envs = await this.backend.listEnvironmentsFor(backendConnectionId, project.id);
      const env = envs.find(e => e.isDefault) ?? envs[0];
      if (!env) throw new Error('No environment available.');
      const bs = await this.backend.createSystemInEnvironmentFor(backendConnectionId, project.id, env.id, {
        name: payload.name,
        hostname: payload.hostname,
        port: payload.sshConfig?.port ?? 22,
        username: payload.sshConfig?.username ?? 'root',
        primaryRuntime: payload.primaryRuntime,
        availableRuntimes: payload.availableRuntimes ?? [payload.primaryRuntime],
        authMethod: payload.sshConfig?.authMethod ?? 'password',
      });
      this._backendSystemStates.set(bs.id, bs.connected);
      return backendSystemToContainerSystem(bs);
    }
    return this.tauri.invoke<ContainerSystem>('add_system', { payload });
  }

  async updateSystem(payload: UpdateSystemRequest): Promise<ContainerSystem> {
    if (this.backend.isBackendSystem(payload.id)) {
      throw new Error('Backend systems cannot be edited from this client');
    }
    return this.tauri.invoke<ContainerSystem>('update_system', { payload });
  }

  async removeSystem(systemId: string): Promise<boolean> {
    const connId = this.backend.getBackendForSystem(systemId);
    if (connId) {
      await this.backend.deleteSystemFor(connId, systemId);
      this._backendSystemStates.delete(systemId);
      return true;
    }
    return this.tauri.invoke<boolean>('remove_system', { systemId });
  }

  async connectSystem(systemId: string, password?: string, passphrase?: string, privateKey?: string, jumpHostCredentials?: Record<string, JumpHostCredentials>): Promise<ConnectionState> {
    const connId = this.backend.getBackendForSystem(systemId);
    if (connId) {
      await this.backend.connectSystemFor(connId, systemId);
      this._backendSystemStates.set(systemId, true);
      return 'connected';
    }
    return this.tauri.invoke<ConnectionState>('connect_system', { systemId, password, passphrase, privateKey, jumpHostCredentials });
  }

  async disconnectSystem(systemId: string): Promise<ConnectionState> {
    const connId = this.backend.getBackendForSystem(systemId);
    if (connId) {
      await this.backend.disconnectSystemFor(connId, systemId);
      this._backendSystemStates.set(systemId, false);
      return 'disconnected';
    }
    return this.tauri.invoke<ConnectionState>('disconnect_system', {
      systemId,
    });
  }

  async getConnectionState(systemId: string): Promise<ConnectionState> {
    if (this.backend.isBackendSystem(systemId)) {
      const cached = this._backendSystemStates.get(systemId);
      if (cached !== undefined) {
        return cached ? 'connected' : 'disconnected';
      }
      // Cache miss - fetch from backend
      const connId = this.backend.getBackendForSystem(systemId);
      if (connId) {
        try {
          const bs = await this.backend.getSystemFor(connId, systemId);
          if (bs) {
            const isConnected = !!bs.connected;
            this._backendSystemStates.set(systemId, isConnected);
            return isConnected ? 'connected' : 'disconnected';
          }
        } catch { /* fall through */ }
      }
      return 'disconnected';
    }
    return this.tauri.invoke<ConnectionState>('get_connection_state', {
      systemId,
    });
  }

  async detectRuntimes(systemId: string): Promise<ContainerRuntime[]> {
    if (this.backend.isBackendSystem(systemId)) {
      // Backend server auto-detects runtimes on connect.
      // Re-fetch the system to get updated available_runtimes.
      const connId = this.backend.getBackendForSystem(systemId);
      if (connId) {
        try {
          const bs = await this.backend.getSystemFor(connId, systemId);
          if (bs) {
            return bs.availableRuntimes as ContainerRuntime[];
          }
        } catch {
          // Ignore — detection happens asynchronously, may not be ready yet
        }
      }
      return [];
    }
    return this.tauri.invoke<ContainerRuntime[]>('detect_runtimes', {
      systemId,
    });
  }

  // ========================================================================
  // SSH Credential Methods — local only, no-op for backend systems
  // ========================================================================

  async storeSshCredentials(systemId: string, password?: string, passphrase?: string, privateKey?: string, jumpHostCredentials?: Record<string, JumpHostCredentials>): Promise<void> {
    if (this.backend.isBackendSystem(systemId)) return;
    return this.tauri.invoke<void>('store_ssh_credentials', { systemId, password, passphrase, privateKey, jumpHostCredentials });
  }

  async getSshCredentials(systemId: string): Promise<{ password: string | null; passphrase: string | null; privateKey: string | null }> {
    if (this.backend.isBackendSystem(systemId)) {
      return { password: null, passphrase: null, privateKey: null };
    }
    return this.tauri.invoke<[string | null, string | null, string | null]>('get_ssh_credentials', { systemId })
      .then(([password, passphrase, privateKey]) => ({ password, passphrase, privateKey }));
  }

  async importSshKeyFromFile(filePath: string): Promise<string> {
    return this.tauri.invoke<string>('import_ssh_key_from_file', { filePath });
  }

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

  async getExtendedSystemInfo(systemId: string): Promise<ExtendedSystemInfo> {
    const connId = this.backend.getBackendForSystem(systemId);
    if (connId) {
      return this.backend.getSystemInfoFor(connId, systemId);
    }
    return this.tauri.invoke<ExtendedSystemInfo>('get_extended_system_info', {
      systemId,
    });
  }

  async getLiveMetrics(systemId: string): Promise<LiveSystemMetrics> {
    const connId = this.backend.getBackendForSystem(systemId);
    if (connId) {
      return this.backend.getSystemMetricsFor(connId, systemId);
    }
    return this.tauri.invoke<LiveSystemMetrics>('get_live_metrics', {
      systemId,
    });
  }

  removeKnownHost(hostname: string, port: number): Promise<number> {
    return this.tauri.invoke<number>('remove_known_host', { hostname, port });
  }

  // ========================================================================
  // SSH Config Methods — always local
  // ========================================================================

  hasSshConfig(configPaths?: string[]): Promise<boolean> {
    return this.tauri.invoke<boolean>('has_ssh_config', {
      configPaths: configPaths?.length ? configPaths : null,
    });
  }

  listSshConfigHosts(configPaths?: string[]): Promise<SshHostEntry[]> {
    return this.tauri.invoke<SshHostEntry[]>('list_ssh_config_hosts', {
      configPaths: configPaths?.length ? configPaths : null,
    });
  }

  getSshHostConfig(host: string, configPaths?: string[]): Promise<SshHostEntry> {
    return this.tauri.invoke<SshHostEntry>('get_ssh_host_config', {
      host,
      configPaths: configPaths?.length ? configPaths : null,
    });
  }

  // ========================================================================
  // App Settings Methods — always local
  // ========================================================================

  getAppSettings(): Promise<AppSettings> {
    return this.tauri.invoke<AppSettings>('get_app_settings');
  }

  updateAppSettings(settings: AppSettings): Promise<void> {
    return this.tauri.invoke<void>('update_app_settings', { settings });
  }
}
