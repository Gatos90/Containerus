import {
  Component,
  inject,
  signal,
  computed,
  Input,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  Monitor,
  Plus,
  X,
  Plug,
  Unplug,
  Trash2,
  Loader2,
  AlertCircle,
  Key,
  Pencil,
} from 'lucide-angular';
import { BackendService } from '../../../core/services/backend.service';
import { BackendSystem } from '../../../core/models/backend.model';
import { AppState } from '../../../state/app.state';

@Component({
  selector: 'app-project-servers',
  standalone: true,
  imports: [FormsModule, LucideAngularModule],
  templateUrl: './project-servers.component.html',
})
export class ProjectServersComponent implements OnChanges {
  private readonly backend = inject(BackendService);
  private readonly appState = inject(AppState);

  @Input() connectionId!: string;
  @Input() projectId!: string;
  @Input() environmentId!: string;

  // Icons
  readonly Monitor = Monitor;
  readonly Plus = Plus;
  readonly X = X;
  readonly Plug = Plug;
  readonly Unplug = Unplug;
  readonly Trash2 = Trash2;
  readonly Loader2 = Loader2;
  readonly AlertCircle = AlertCircle;
  readonly Key = Key;
  readonly Pencil = Pencil;

  // ---- Systems state ----
  systems = signal<BackendSystem[]>([]);
  systemErrors = signal<Map<string, string>>(new Map());
  showAddSystem = signal(false);
  savingSystem = signal(false);

  // Add system form
  newSystem = {
    name: '',
    hostname: '',
    port: 22,
    username: 'root',
    primaryRuntime: 'docker' as 'docker' | 'podman',
    authMethod: 'password' as 'password' | 'publicKey',
    password: '',
    privateKey: '',
    passphrase: '',
  };

  // Edit system state
  editingSystemId = signal<string | null>(null);
  savingEdit = signal(false);
  editSystem = {
    name: '',
    hostname: '',
    port: 22,
    username: 'root',
    primaryRuntime: 'docker' as 'docker' | 'podman',
    authMethod: 'password' as 'password' | 'publicKey',
    password: '',
    privateKey: '',
    passphrase: '',
  };

  // Inline confirm state
  confirmingDeleteSystemId = signal<string | null>(null);

  // Host key mismatch modal
  showHostKeyModal = signal(false);
  hostKeyInfo = signal<{
    systemId: string;
    hostname: string;
    expected: string;
    received: string;
  } | null>(null);
  trustingHostKey = signal(false);

  // Loading
  loading = signal(false);
  refreshing = signal(false);

  // Search
  searchQuery = signal('');

  // Computed
  systemCount = computed(() => this.systems().length);
  filteredSystems = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    const all = this.systems();
    if (!query) return all;
    return all.filter(s =>
      s.name.toLowerCase().includes(query) ||
      s.hostname.toLowerCase().includes(query) ||
      s.username.toLowerCase().includes(query)
    );
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['connectionId'] || changes['projectId'] || changes['environmentId']) {
      this.resetState();
      this.loadResources();
    }
  }

  // ========================================================================
  // Data loading
  // ========================================================================

  async loadResources(): Promise<void> {
    if (!this.connectionId || !this.projectId || !this.environmentId) return;
    this.loading.set(true);
    try {
      const systems = await this.backend.listSystemsInEnvironmentFor(
        this.connectionId, this.projectId, this.environmentId,
      );
      this.systems.set(systems);
    } catch (e) {
      console.error('Failed to load resources:', e);
    } finally {
      this.loading.set(false);
    }
  }

  async refresh(): Promise<void> {
    this.refreshing.set(true);
    try {
      await this.loadResources();
    } finally {
      this.refreshing.set(false);
    }
  }

  // ========================================================================
  // Systems
  // ========================================================================

  toggleAddSystem(): void {
    this.showAddSystem.update(v => !v);
    if (this.showAddSystem()) {
      this.resetSystemForm();
    }
  }

  resetSystemForm(): void {
    this.newSystem = {
      name: '',
      hostname: '',
      port: 22,
      username: 'root',
      primaryRuntime: 'docker',
      authMethod: 'password',
      password: '',
      privateKey: '',
      passphrase: '',
    };
  }

  async saveSystem(): Promise<void> {
    if (!this.newSystem.name.trim() || !this.newSystem.hostname.trim()) return;
    this.savingSystem.set(true);
    try {
      const data: Record<string, unknown> = {
        name: this.newSystem.name.trim(),
        hostname: this.newSystem.hostname.trim(),
        port: this.newSystem.port,
        username: this.newSystem.username.trim(),
        authMethod: this.newSystem.authMethod,
        primaryRuntime: this.newSystem.primaryRuntime,
        availableRuntimes: [this.newSystem.primaryRuntime],
      };

      if (this.newSystem.authMethod === 'password') {
        data['password'] = this.newSystem.password;
      } else {
        data['privateKey'] = this.newSystem.privateKey;
        if (this.newSystem.passphrase) {
          data['passphrase'] = this.newSystem.passphrase;
        }
      }

      const system = await this.backend.createSystemInEnvironmentFor(
        this.connectionId,
        this.projectId,
        this.environmentId,
        data,
      );

      // Auto-connect
      try {
        await this.backend.connectSystemFor(this.connectionId, system.id);
      } catch (e: any) {
        const msg = e?.message ?? '';
        if (this.isHostKeyError(msg)) {
          this.openHostKeyModal(system.id, msg);
        } else {
          this.setSystemError(system.id, msg);
        }
      }

      // Refresh global state
      await this.appState.system.loadSystems();
      try {
        await this.appState.loadAllDataForSystem(system.id);
      } catch (e) {
        console.debug(`System ${system.id} may not be connected, skipping data load:`, e);
      }
      await this.loadResources();

      this.showAddSystem.set(false);
      this.resetSystemForm();
    } catch (e: any) {
      this.setSystemError('new', e?.message ?? 'Failed to create system');
      console.error('Failed to save system:', e);
    } finally {
      this.savingSystem.set(false);
    }
  }

  async connectSystem(systemId: string): Promise<void> {
    this.clearSystemError(systemId);
    try {
      await this.backend.connectSystemFor(this.connectionId, systemId);
      await this.appState.system.loadSystems();
      await this.appState.loadAllDataForSystem(systemId);
      await this.loadResources();
    } catch (e: any) {
      const msg = e?.message ?? '';
      if (this.isHostKeyError(msg)) {
        this.openHostKeyModal(systemId, msg);
      } else {
        this.setSystemError(systemId, msg);
      }
    }
  }

  async disconnectSystem(systemId: string): Promise<void> {
    this.clearSystemError(systemId);
    try {
      await this.backend.disconnectSystemFor(this.connectionId, systemId);
      this.appState.clearDataForSystem(systemId);
      await this.appState.system.loadSystems();
      await this.loadResources();
    } catch (e: any) {
      this.setSystemError(systemId, e?.message ?? 'Failed to disconnect');
    }
  }

  promptDeleteSystem(systemId: string): void {
    this.confirmingDeleteSystemId.set(systemId);
  }

  async deleteSystem(systemId: string): Promise<void> {
    this.confirmingDeleteSystemId.set(null);
    try {
      await this.backend.deleteSystemFor(this.connectionId, systemId);
      this.appState.clearDataForSystem(systemId);
      await this.appState.system.loadSystems();
      await this.loadResources();
    } catch (e: any) {
      this.setSystemError(systemId, e?.message ?? 'Failed to delete');
    }
  }

  getSystemError(systemId: string): string | undefined {
    return this.systemErrors().get(systemId);
  }

  // ========================================================================
  // Edit system
  // ========================================================================

  startEditSystem(system: BackendSystem): void {
    this.editingSystemId.set(system.id);
    this.editSystem = {
      name: system.name,
      hostname: system.hostname,
      port: system.port,
      username: system.username,
      primaryRuntime: system.primaryRuntime as 'docker' | 'podman',
      authMethod: system.authMethod as 'password' | 'publicKey',
      password: '',
      privateKey: '',
      passphrase: '',
    };
    this.clearSystemError(system.id);
  }

  cancelEditSystem(): void {
    this.editingSystemId.set(null);
  }

  async saveEditSystem(): Promise<void> {
    const systemId = this.editingSystemId();
    if (!systemId || !this.editSystem.name.trim() || !this.editSystem.hostname.trim()) return;

    this.savingEdit.set(true);
    this.clearSystemError(systemId);

    try {
      const data: Record<string, unknown> = {
        name: this.editSystem.name.trim(),
        hostname: this.editSystem.hostname.trim(),
        port: this.editSystem.port,
        username: this.editSystem.username.trim(),
        authMethod: this.editSystem.authMethod,
        primaryRuntime: this.editSystem.primaryRuntime,
        availableRuntimes: [this.editSystem.primaryRuntime],
      };

      // Only send credential fields if they were filled in
      if (this.editSystem.authMethod === 'password' && this.editSystem.password) {
        data['password'] = this.editSystem.password;
      } else if (this.editSystem.authMethod === 'publicKey' && this.editSystem.privateKey) {
        data['privateKey'] = this.editSystem.privateKey;
        if (this.editSystem.passphrase) {
          data['passphrase'] = this.editSystem.passphrase;
        }
      }

      await this.backend.updateSystemFor(this.connectionId, systemId, data);
      this.editingSystemId.set(null);
      await this.appState.system.loadSystems();
      await this.loadResources();
    } catch (e: any) {
      this.setSystemError(systemId, e?.message ?? 'Failed to update system');
    } finally {
      this.savingEdit.set(false);
    }
  }

  // ========================================================================
  // Host Key Mismatch
  // ========================================================================

  private isHostKeyError(msg: string): boolean {
    const lower = msg.toLowerCase();
    return lower.includes('host key verification failed') || lower.includes('host key has changed');
  }

  private openHostKeyModal(systemId: string, errorMsg: string): void {
    const hostnameMatch = errorMsg.match(/host[:\s]+([^\s,]+)/i);
    const expectedMatch = errorMsg.match(/expected[:\s]+([^\s,]+)/i);
    const receivedMatch = errorMsg.match(/received[:\s]+([^\s,]+)/i) ?? errorMsg.match(/got[:\s]+([^\s,]+)/i);

    this.hostKeyInfo.set({
      systemId,
      hostname: hostnameMatch?.[1] ?? 'unknown',
      expected: expectedMatch?.[1] ?? 'unknown',
      received: receivedMatch?.[1] ?? 'unknown',
    });
    this.showHostKeyModal.set(true);
  }

  async trustHostKey(): Promise<void> {
    const info = this.hostKeyInfo();
    if (!info) return;
    this.trustingHostKey.set(true);
    try {
      await this.backend.trustHostKeyFor(this.connectionId, info.systemId);
      this.showHostKeyModal.set(false);
      this.hostKeyInfo.set(null);
      await this.connectSystem(info.systemId);
    } catch (e: any) {
      this.setSystemError(info.systemId, e?.message ?? 'Failed to trust host key');
      this.showHostKeyModal.set(false);
      this.hostKeyInfo.set(null);
    } finally {
      this.trustingHostKey.set(false);
    }
  }

  dismissHostKeyModal(): void {
    this.showHostKeyModal.set(false);
    this.hostKeyInfo.set(null);
  }

  // ========================================================================
  // Helpers
  // ========================================================================

  private resetState(): void {
    this.systems.set([]);
    this.systemErrors.set(new Map());
    this.showAddSystem.set(false);
  }

  private setSystemError(systemId: string, msg: string): void {
    this.systemErrors.update(m => {
      const n = new Map(m);
      n.set(systemId, msg);
      return n;
    });
  }

  private clearSystemError(systemId: string): void {
    this.systemErrors.update(m => {
      const n = new Map(m);
      n.delete(systemId);
      return n;
    });
  }
}
