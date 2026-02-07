import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  Server,
  Plus,
  RefreshCw,
  Link,
  Unlink,
  Terminal,
  Trash2,
  Pencil,
  X,
  FolderOpen,
  Crown,
  ShieldCheck,
  Cpu,
  MemoryStick,
  HardDrive,
  User,
  Clock,
  Box,
  Layers,
  Search,
  Circle,
  Activity,
} from 'lucide-angular';
import { ContainerRuntime } from '../../../core/models/container.model';
import { ContainerSystem, ExtendedSystemInfo, JumpHost, JumpHostCredentials, LiveSystemMetrics, NewSystemRequest, OsType, SshAuthMethod, SshHostEntry, UpdateSystemRequest } from '../../../core/models/system.model';

export interface LoadLevelInfo {
  level: 'unknown' | 'low' | 'medium' | 'high' | 'critical';
  label: string;
  dots: number;
  color: string;
  bgColor: string;
  tooltip: string;
  score: number;
}
import { KeychainService } from '../../../core/services/keychain.service';
import { SystemService } from '../../../core/services/system.service';
import { TerminalService } from '../../../core/services/terminal.service';
import { SystemState } from '../../../state/system.state';
import { AppState } from '../../../state/app.state';
import { TerminalState, DEFAULT_TERMINAL_OPTIONS } from '../../../state/terminal.state';
import { ToastState } from '../../../state/toast.state';

@Component({
  selector: 'app-system-list',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  templateUrl: './system-list.component.html',
})
export class SystemListComponent implements OnInit {
  readonly systemState = inject(SystemState);
  readonly appState = inject(AppState);
  private readonly systemService = inject(SystemService);
  private readonly keychainService = inject(KeychainService);
  private readonly terminalState = inject(TerminalState);
  private readonly terminalService = inject(TerminalService);
  private readonly toast = inject(ToastState);

  readonly Server = Server;
  readonly Plus = Plus;
  readonly RefreshCw = RefreshCw;
  readonly Link = Link;
  readonly Unlink = Unlink;
  readonly Terminal = Terminal;
  readonly Trash2 = Trash2;
  readonly Pencil = Pencil;
  readonly X = X;
  readonly FolderOpen = FolderOpen;
  readonly Crown = Crown;
  readonly ShieldCheck = ShieldCheck;
  readonly Cpu = Cpu;
  readonly MemoryStick = MemoryStick;
  readonly HardDrive = HardDrive;
  readonly User = User;
  readonly Clock = Clock;
  readonly Box = Box;
  readonly Layers = Layers;
  readonly Search = Search;
  readonly Circle = Circle;
  readonly Activity = Activity;

  refreshing = false;
  showAddDialog = false;
  showEditDialog = false;
  editingSystemId: string | null = null;
  isMobile = signal(false);
  addingSystem = signal(false);

  // SSH Config host selection
  sshHosts = signal<SshHostEntry[]>([]);
  loadingSshHosts = signal(false);
  selectedSshHost = '';
  selectedHostProxyCommand: string | null = null;
  selectedHostProxyJump: string | null = null;
  private sshConfigPaths: string[] = [];

  addForm = {
    name: '',
    hostname: '',
    connectionType: 'remote' as 'local' | 'remote',
    primaryRuntime: 'docker' as ContainerRuntime,
    autoConnect: true,
    sshUsername: 'root',
    sshPort: 22,
    sshAuthMethod: 'password' as SshAuthMethod,
    sshKeyPath: '',
    sshKeyContent: '',
    sshKeyImportMethod: 'paste' as 'paste' | 'file',
    sshKeyPassphrase: '',
    sshPassword: '',
  };

  editForm = {
    name: '',
    hostname: '',
    connectionType: 'local' as 'local' | 'remote',
    primaryRuntime: 'docker' as ContainerRuntime,
    autoConnect: true,
    sshUsername: 'root',
    sshPort: 22,
    sshAuthMethod: 'password' as SshAuthMethod,
    sshKeyPath: '',
    sshKeyContent: '',
    sshKeyImportMethod: 'paste' as 'paste' | 'file',
    sshKeyPassphrase: '',
    sshPassword: '',
    availableRuntimes: [] as ContainerRuntime[],
  };

  // Per-jump-host credential forms
  jumpHostForms: {
    hostname: string;
    port: number;
    username: string;
    authMethod: SshAuthMethod;
    password: string;
    passphrase: string;
    keyContent: string;
    identityFile: string | null;
  }[] = [];

  // Per-jump-host credential forms for edit dialog
  editJumpHostForms: {
    hostname: string;
    port: number;
    username: string;
    authMethod: SshAuthMethod;
    password: string;
    passphrase: string;
    keyContent: string;
    identityFile: string | null;
  }[] = [];

  importingKey = signal(false);

  async ngOnInit(): Promise<void> {
    // Detect platform for mobile-specific UX
    const mobile = await this.keychainService.checkPlatform();
    this.isMobile.set(mobile);
    await this.refresh();

    // Load SSH hosts on desktop
    if (!mobile) {
      await this.loadSshHosts();
    }
  }

  /**
   * Load SSH hosts from ~/.ssh/config
   */
  async loadSshHosts(): Promise<void> {
    this.loadingSshHosts.set(true);
    try {
      // Load custom SSH config paths from app settings
      const appSettings = await this.systemService.getAppSettings();
      this.sshConfigPaths = appSettings.sshConfigPaths ?? [];

      const hosts = await this.systemService.listSshConfigHosts(this.sshConfigPaths);
      this.sshHosts.set(hosts);
    } catch (err) {
      console.warn('Could not load SSH config:', err);
      // Non-fatal - just means no SSH config available
    } finally {
      this.loadingSshHosts.set(false);
    }
  }

  /**
   * Handle SSH host selection from dropdown
   */
  async onSshHostSelected(hostName: string): Promise<void> {
    this.selectedSshHost = hostName;
    this.selectedHostProxyCommand = null;
    this.selectedHostProxyJump = null;

    if (!hostName) {
      // Reset to manual mode - don't clear fields
      return;
    }

    try {
      const config = await this.systemService.getSshHostConfig(hostName, this.sshConfigPaths);

      // Auto-fill form fields
      if (config.hostname) {
        this.addForm.hostname = config.hostname;
      } else {
        this.addForm.hostname = hostName;
      }

      if (config.user) {
        this.addForm.sshUsername = config.user;
      }

      if (config.port) {
        this.addForm.sshPort = config.port;
      }

      if (config.identityFile) {
        this.addForm.sshAuthMethod = 'publicKey';
        this.addForm.sshKeyPath = config.identityFile;
        this.addForm.sshKeyImportMethod = 'file';
      }

      // Capture proxy settings
      this.selectedHostProxyCommand = config.proxyCommand ?? null;
      this.selectedHostProxyJump = config.proxyJump ?? null;

      // Populate jump host credential forms
      if (this.selectedHostProxyJump) {
        const parsed = this.parseJumpHosts(this.selectedHostProxyJump);
        this.jumpHostForms = this.buildJumpHostForms(parsed);
      } else {
        this.jumpHostForms = [];
      }

      // Auto-fill system name if empty
      if (!this.addForm.name) {
        this.addForm.name = hostName;
      }
    } catch (err) {
      console.error('Failed to get SSH host config:', err);
      this.systemState.setError('Failed to load SSH host configuration');
    }
  }

  async refresh(): Promise<void> {
    this.refreshing = true;
    try {
      await this.systemState.loadSystems();

      // Fetch extended info for connected systems that don't have it yet
      const connectedSystems = this.systemState.connectedSystems();
      for (const system of connectedSystems) {
        if (!this.systemState.getExtendedInfo(system.id)) {
          // Don't await - let it load in background
          this.systemState.fetchExtendedInfo(system.id);
        }
      }
    } finally {
      this.refreshing = false;
    }
  }

  getConnectionState(systemId: string): string {
    return this.systemState.getConnectionState(systemId);
  }

  async connect(systemId: string): Promise<void> {
    const system = this.systemState.systems().find(s => s.id === systemId);

    // Backend resolves credentials from keyring (desktop) or DB (mobile) automatically
    const success = await this.systemState.connectSystem(systemId);

    if (success) {
      await this.appState.loadAllDataForSystem(systemId);
      await this.systemState.detectRuntimes(systemId);
    } else if (this.isMobile() && system?.connectionType === 'remote') {
      // Connection failed on mobile - might need credentials
      // Prompt user and try again
      if (system?.sshConfig?.authMethod === 'password') {
        const pwd = prompt('Enter SSH password for ' + system.sshConfig.username + '@' + system.hostname);
        if (pwd) {
          // Store for future use and retry
          await this.systemService.storeSshCredentials(systemId, pwd, undefined);
          const retrySuccess = await this.systemState.connectSystem(systemId, pwd);
          if (retrySuccess) {
            await this.appState.loadAllDataForSystem(systemId);
            await this.systemState.detectRuntimes(systemId);
          }
        }
      } else if (system?.sshConfig?.authMethod === 'publicKey') {
        const pp = prompt('Enter passphrase for SSH key (leave empty if unencrypted):');
        if (pp !== null) {
          // Store for future use and retry
          await this.systemService.storeSshCredentials(systemId, undefined, pp || undefined);
          const retrySuccess = await this.systemState.connectSystem(systemId, undefined, pp || undefined);
          if (retrySuccess) {
            await this.appState.loadAllDataForSystem(systemId);
            await this.systemState.detectRuntimes(systemId);
          }
        }
      }
    }
  }

  async disconnect(systemId: string): Promise<void> {
    await this.systemState.disconnectSystem(systemId);
    this.appState.clearDataForSystem(systemId);
  }

  async addSystem(): Promise<void> {
    if (!this.addForm.name || !this.addForm.hostname) return;

    // Clear any previous errors and set loading state
    this.systemState.clearError();
    this.addingSystem.set(true);

    console.log('[SystemList] addSystem started', {
      name: this.addForm.name,
      hostname: this.addForm.hostname,
      connectionType: this.addForm.connectionType,
      isMobile: this.isMobile(),
    });

    try {
      const mobile = this.isMobile();

      // Determine if we're using key content (paste or import) vs file path
      const usingKeyContent = this.addForm.sshAuthMethod === 'publicKey' &&
        (this.addForm.sshKeyImportMethod === 'paste' || this.isMobile()) &&
        this.addForm.sshKeyContent;

      const request: NewSystemRequest = {
        name: this.addForm.name,
        hostname: this.addForm.hostname,
        connectionType: this.addForm.connectionType,
        primaryRuntime: this.addForm.primaryRuntime,
        availableRuntimes: [this.addForm.primaryRuntime],
        autoConnect: this.addForm.autoConnect,
        sshConfig:
          this.addForm.connectionType === 'remote'
            ? {
                username: this.addForm.sshUsername,
                port: this.addForm.sshPort,
                authMethod: this.addForm.sshAuthMethod,
                privateKeyPath:
                  this.addForm.sshAuthMethod === 'publicKey' && !usingKeyContent
                    ? this.addForm.sshKeyPath
                    : null,
                privateKeyContent:
                  usingKeyContent
                    ? this.addForm.sshKeyContent
                    : null,
                connectionTimeout: 30,
                proxyCommand: this.selectedHostProxyCommand ?? null,
                proxyJump: this.jumpHostForms.length > 0
                  ? this.buildJumpHostsFromForms(this.jumpHostForms)
                  : this.selectedHostProxyJump
                    ? this.parseJumpHosts(this.selectedHostProxyJump)
                    : null,
                sshConfigHost: this.selectedSshHost || null,
              }
            : null,
      };

      // For mobile, ALWAYS pass credentials directly since keychain is unreliable
      // For desktop with autoConnect, also pass for immediate connection
      const passwordForConnect =
        this.addForm.connectionType === 'remote' &&
        this.addForm.sshAuthMethod === 'password'
          ? this.addForm.sshPassword
          : undefined;

      // For public key auth, pass passphrase directly (mobile can't use keyring)
      const passphraseForConnect =
        this.addForm.connectionType === 'remote' &&
        this.addForm.sshAuthMethod === 'publicKey'
          ? this.addForm.sshKeyPassphrase || undefined
          : undefined;

      // For public key auth with content, pass the key content for connection
      const privateKeyForConnect =
        usingKeyContent
          ? this.addForm.sshKeyContent
          : undefined;

      // Collect jump host credentials before connecting
      const jumpHostCreds = this.collectJumpHostCredentials(this.jumpHostForms);

      console.log('[SystemList] Calling systemState.addSystem...');
      const system = await this.systemState.addSystem(request, passwordForConnect, passphraseForConnect, privateKeyForConnect, jumpHostCreds);
      console.log('[SystemList] systemState.addSystem returned:', system);

      if (system) {
        // Store credentials for future autoConnect (after connection so they persist)
        if (this.addForm.connectionType === 'remote') {
          const credPassword = this.addForm.sshAuthMethod === 'password' ? this.addForm.sshPassword : undefined;
          const credPassphrase = this.addForm.sshAuthMethod === 'publicKey' ? this.addForm.sshKeyPassphrase : undefined;
          const credPrivateKey = usingKeyContent ? this.addForm.sshKeyContent : undefined;
          if (credPassword || credPassphrase || credPrivateKey || jumpHostCreds) {
            try {
              console.log('[SystemList] Storing SSH credentials in database...');
              await this.systemService.storeSshCredentials(system.id, credPassword || undefined, credPassphrase || undefined, credPrivateKey || undefined, jumpHostCreds);
              console.log('[SystemList] SSH credentials stored successfully');
            } catch (err) {
              // Non-fatal - just log the error, connection already succeeded
              console.warn('[SystemList] Failed to store SSH credentials:', err);
            }
          }
        }

        if (this.addForm.autoConnect) {
          console.log('[SystemList] Auto-connecting and loading data...');
          await this.appState.loadAllDataForSystem(system.id);
          await this.systemState.detectRuntimes(system.id);
        }
        this.showAddDialog = false;
        this.resetForm();
      } else {
        // System was not added - error should already be set by systemState
        console.error('[SystemList] System was not added (returned null)');
      }
    } catch (err) {
      console.error('[SystemList] Unexpected error in addSystem:', err);
      const message = err instanceof Error ? err.message :
        typeof err === 'string' ? err : 'An unexpected error occurred while adding the system';
      this.systemState.setError(message);
    } finally {
      this.addingSystem.set(false);
    }
  }

  /**
   * Parse a ProxyJump string into JumpHost entries.
   * Resolves host aliases against loaded SSH config hosts.
   */
  private parseJumpHosts(proxyJumpStr: string): JumpHost[] {
    const hosts = this.sshHosts();
    const jumpHosts = proxyJumpStr.split(',').map(entry => {
      const trimmed = entry.trim();

      // Check if it's a known host alias
      const knownHost = hosts.find(h => h.host === trimmed);
      if (knownHost) {
        return {
          hostname: knownHost.hostname ?? trimmed,
          port: knownHost.port ?? 22,
          username: knownHost.user ?? 'root',
          identityFile: knownHost.identityFile ?? null,
        };
      }

      // Parse explicit user@host:port format
      let username = 'root';
      let hostname = trimmed;
      let port = 22;

      // Extract user@
      const atIdx = hostname.indexOf('@');
      if (atIdx !== -1) {
        username = hostname.substring(0, atIdx);
        hostname = hostname.substring(atIdx + 1);
      }

      // Extract :port
      const colonIdx = hostname.lastIndexOf(':');
      if (colonIdx !== -1) {
        const portStr = hostname.substring(colonIdx + 1);
        const parsed = parseInt(portStr, 10);
        if (!isNaN(parsed)) {
          port = parsed;
          hostname = hostname.substring(0, colonIdx);
        }
      }

      return { hostname, port, username, identityFile: null };
    });

    return jumpHosts;
  }

  /**
   * Build jump host forms from parsed JumpHost entries.
   * Call after parseJumpHosts to populate the credential UI.
   */
  private buildJumpHostForms(jumpHosts: JumpHost[]): typeof this.jumpHostForms {
    return jumpHosts.map(jh => ({
      hostname: jh.hostname,
      port: jh.port,
      username: jh.username,
      authMethod: 'publicKey' as SshAuthMethod,
      password: '',
      passphrase: '',
      keyContent: '',
      identityFile: jh.identityFile ?? null,
    }));
  }

  /**
   * Collect jump host credentials from forms into a Record keyed by "hostname:port"
   */
  private collectJumpHostCredentials(forms: typeof this.jumpHostForms): Record<string, JumpHostCredentials> | undefined {
    const creds: Record<string, JumpHostCredentials> = {};
    let hasAny = false;
    for (const form of forms) {
      const needsBrackets = form.hostname.includes(':') && !form.hostname.startsWith('[');
      const key = needsBrackets ? `[${form.hostname}]:${form.port}` : `${form.hostname}:${form.port}`;
      const entry: JumpHostCredentials = {};
      if (form.authMethod === 'password' && form.password) {
        entry.password = form.password;
        hasAny = true;
      }
      if (form.passphrase) {
        entry.passphrase = form.passphrase;
        hasAny = true;
      }
      if (form.keyContent) {
        entry.privateKey = form.keyContent;
        hasAny = true;
      }
      if (entry.password || entry.passphrase || entry.privateKey) {
        creds[key] = entry;
      }
    }
    return hasAny ? creds : undefined;
  }

  /**
   * Build JumpHost array with auth methods from forms
   */
  private buildJumpHostsFromForms(forms: typeof this.jumpHostForms): JumpHost[] {
    return forms.map(f => ({
      hostname: f.hostname,
      port: f.port,
      username: f.username,
      identityFile: f.identityFile,
      authMethod: f.authMethod,
      privateKeyContent: f.keyContent || null,
    }));
  }

  private resetForm(): void {
    this.selectedSshHost = '';
    this.selectedHostProxyCommand = null;
    this.selectedHostProxyJump = null;
    this.jumpHostForms = [];
    this.addForm = {
      name: '',
      hostname: '',
      connectionType: 'remote',
      primaryRuntime: 'docker',
      autoConnect: true,
      sshUsername: 'root',
      sshPort: 22,
      sshAuthMethod: 'password',
      sshKeyPath: '',
      sshKeyContent: '',
      sshKeyImportMethod: 'paste',
      sshKeyPassphrase: '',
      sshPassword: '',
    };
  }

  openEditDialog(system: ContainerSystem): void {
    this.editingSystemId = system.id;
    this.editForm = {
      name: system.name,
      hostname: system.hostname,
      connectionType: system.connectionType,
      primaryRuntime: system.primaryRuntime,
      autoConnect: system.autoConnect,
      sshUsername: system.sshConfig?.username ?? 'root',
      sshPort: system.sshConfig?.port ?? 22,
      sshAuthMethod: system.sshConfig?.authMethod ?? 'password',
      sshKeyPath: system.sshConfig?.privateKeyPath ?? '',
      sshKeyContent: system.sshConfig?.privateKeyContent ?? '',
      sshKeyImportMethod: system.sshConfig?.privateKeyContent ? 'paste' : (system.sshConfig?.privateKeyPath ? 'file' : 'paste'),
      sshKeyPassphrase: '',
      sshPassword: '',
      availableRuntimes: system.availableRuntimes,
    };

    // Populate edit jump host forms from existing proxy_jump config
    if (system.sshConfig?.proxyJump && system.sshConfig.proxyJump.length > 0) {
      this.editJumpHostForms = system.sshConfig.proxyJump.map(jh => ({
        hostname: jh.hostname,
        port: jh.port,
        username: jh.username,
        authMethod: jh.authMethod ?? 'publicKey' as SshAuthMethod,
        password: '',
        passphrase: '',
        keyContent: jh.privateKeyContent ?? '',
        identityFile: jh.identityFile ?? null,
      }));
    } else {
      this.editJumpHostForms = [];
    }

    this.showEditDialog = true;
  }

  async updateSystem(): Promise<void> {
    if (!this.editingSystemId || !this.editForm.name || !this.editForm.hostname) return;

    // Clear any previous errors
    this.systemState.clearError();

    // Determine if we're using key content (paste or import) vs file path
    const usingKeyContent = this.editForm.sshAuthMethod === 'publicKey' &&
      (this.editForm.sshKeyImportMethod === 'paste' || this.isMobile()) &&
      this.editForm.sshKeyContent;

    // Preserve existing system's proxy settings and update jump hosts from forms
    const existingSystem = this.systemState.systems().find(s => s.id === this.editingSystemId);
    const existingProxy = existingSystem?.sshConfig;

    const request: UpdateSystemRequest = {
      id: this.editingSystemId,
      name: this.editForm.name,
      hostname: this.editForm.hostname,
      connectionType: this.editForm.connectionType,
      primaryRuntime: this.editForm.primaryRuntime,
      availableRuntimes: this.editForm.availableRuntimes,
      autoConnect: this.editForm.autoConnect,
      sshConfig:
        this.editForm.connectionType === 'remote'
          ? {
              username: this.editForm.sshUsername,
              port: this.editForm.sshPort,
              authMethod: this.editForm.sshAuthMethod,
              privateKeyPath:
                this.editForm.sshAuthMethod === 'publicKey' && !usingKeyContent
                  ? this.editForm.sshKeyPath
                  : null,
              privateKeyContent:
                usingKeyContent
                  ? this.editForm.sshKeyContent
                  : null,
              connectionTimeout: existingProxy?.connectionTimeout ?? 30,
              proxyCommand: existingProxy?.proxyCommand ?? null,
              proxyJump: this.editJumpHostForms.length > 0
                ? this.buildJumpHostsFromForms(this.editJumpHostForms)
                : existingProxy?.proxyJump ?? null,
              sshConfigHost: existingProxy?.sshConfigHost ?? null,
            }
          : null,
    };

    const updated = await this.systemState.updateSystem(request);

    // Store new credentials if provided
    if (updated && this.editForm.connectionType === 'remote') {
      const credPassword = this.editForm.sshAuthMethod === 'password' && this.editForm.sshPassword ? this.editForm.sshPassword : undefined;
      const credPassphrase = this.editForm.sshAuthMethod === 'publicKey' && this.editForm.sshKeyPassphrase ? this.editForm.sshKeyPassphrase : undefined;
      const credPrivateKey = usingKeyContent ? this.editForm.sshKeyContent : undefined;
      const jumpHostCreds = this.collectJumpHostCredentials(this.editJumpHostForms);
      if (credPassword || credPassphrase || credPrivateKey || jumpHostCreds) {
        try {
          await this.systemService.storeSshCredentials(updated.id, credPassword, credPassphrase, credPrivateKey, jumpHostCreds);
        } catch (err) {
          console.warn('[SystemList] Failed to store updated SSH credentials:', err);
        }
      }
    }

    this.showEditDialog = false;
    this.editingSystemId = null;
    this.editJumpHostForms = [];
  }

  async deleteSystem(systemId: string): Promise<void> {
    if (!confirm('Are you sure you want to delete this system?')) return;

    // Disconnect first if connected
    if (this.getConnectionState(systemId) === 'connected') {
      await this.disconnect(systemId);
    }

    await this.systemState.removeSystem(systemId);
  }

  async browseForSshKey(formType: 'add' | 'edit'): Promise<void> {
    try {
      const selectedPath = await this.systemService.browseSshKey();
      if (selectedPath) {
        // Warn if user selected the public key instead of private key
        if (selectedPath.endsWith('.pub')) {
          this.systemState.setError('Please select the private key file (without .pub extension)');
          return;
        }
        if (formType === 'add') {
          this.addForm.sshKeyPath = selectedPath;
        } else {
          this.editForm.sshKeyPath = selectedPath;
        }
      }
    } catch (err) {
      console.error('Failed to open file dialog:', err);
    }
  }

  /**
   * Import SSH key from file and store its content
   * Used for mobile file picker where we need the actual key content
   */
  async importKeyFromFile(formType: 'add' | 'edit'): Promise<void> {
    this.importingKey.set(true);
    try {
      const keyContent = await this.systemService.browseAndImportSshKey();
      if (keyContent) {
        if (formType === 'add') {
          this.addForm.sshKeyContent = keyContent;
        } else {
          this.editForm.sshKeyContent = keyContent;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to import SSH key';
      this.systemState.setError(message);
      console.error('Failed to import SSH key:', err);
    } finally {
      this.importingKey.set(false);
    }
  }

  /**
   * Get extended info for a system
   */
  getExtendedInfo(systemId: string): ExtendedSystemInfo | null {
    return this.systemState.getExtendedInfo(systemId);
  }

  /**
   * Get live metrics for a system
   */
  getLiveMetrics(systemId: string): LiveSystemMetrics | null {
    return this.systemState.getLiveMetrics(systemId);
  }

  /**
   * Get composite system stress score from live metrics.
   * Formula: CPU (60%) + Memory (30%) + Swap (10%)
   */
  getLoadLevel(metrics: LiveSystemMetrics | null): LoadLevelInfo {
    if (!metrics) {
      return {
        level: 'unknown',
        label: 'Unknown',
        dots: 0,
        color: 'text-zinc-500',
        bgColor: 'bg-zinc-500',
        tooltip: 'No metrics available',
        score: 0,
      };
    }

    // Weighted composite score
    const cpuWeight = 0.6;
    const memWeight = 0.3;
    const swapWeight = 0.1;
    const swapUsage = metrics.swapUsagePercent ?? 0;

    const score =
      metrics.cpuUsagePercent * cpuWeight +
      metrics.memoryUsagePercent * memWeight +
      swapUsage * swapWeight;

    const roundedScore = Math.round(score);

    if (score < 30) {
      return {
        level: 'low',
        label: 'Low',
        dots: 1,
        color: 'text-green-500',
        bgColor: 'bg-green-500',
        tooltip: `Low: System is mostly idle (${roundedScore}% composite load)`,
        score: roundedScore,
      };
    }
    if (score < 60) {
      return {
        level: 'medium',
        label: 'Medium',
        dots: 3,
        color: 'text-amber-500',
        bgColor: 'bg-amber-500',
        tooltip: `Medium: Normal utilization (${roundedScore}% composite load)`,
        score: roundedScore,
      };
    }
    if (score < 85) {
      return {
        level: 'high',
        label: 'High',
        dots: 4,
        color: 'text-red-500',
        bgColor: 'bg-red-500',
        tooltip: `High: System under pressure (${roundedScore}% composite load)`,
        score: roundedScore,
      };
    }
    return {
      level: 'critical',
      label: 'Critical',
      dots: 5,
      color: 'text-red-600',
      bgColor: 'bg-red-600',
      tooltip: `Critical: System overloaded! (${roundedScore}% composite load)`,
      score: roundedScore,
    };
  }

  /** Array for load dots rendering */
  readonly loadDots = [1, 2, 3, 4, 5];

  /**
   * Get OS icon (emoji) for a system
   */
  getOsIcon(osType: OsType | undefined): string {
    switch (osType) {
      case 'linux':
        return '🐧';
      case 'macos':
        return '🍎';
      case 'windows':
        return '🪟';
      default:
        return '💻';
    }
  }

  /**
   * Get OS display name
   */
  getOsName(osType: OsType | undefined): string {
    switch (osType) {
      case 'linux':
        return 'Linux';
      case 'macos':
        return 'macOS';
      case 'windows':
        return 'Windows';
      default:
        return 'Unknown';
    }
  }

  async dockTerminal(systemId: string): Promise<void> {
    const system = this.systemState.systems().find(s => s.id === systemId);
    if (!system) return;
    try {
      const session = await this.terminalService.startSession(systemId);
      this.terminalState.addTerminal({
        id: this.terminalState.generateTerminalId(),
        session,
        systemId,
        systemName: system.name,
        serializedState: '',
        terminalOptions: DEFAULT_TERMINAL_OPTIONS,
      });
    } catch (err: any) {
      this.toast.error(`Failed to open terminal: ${err?.message ?? err}`);
    }
  }
}
