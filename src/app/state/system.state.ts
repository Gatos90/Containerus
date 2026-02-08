import { computed, Injectable, signal } from '@angular/core';
import { ContainerRuntime } from '../core/models/container.model';
import {
  ConnectionState,
  ContainerSystem,
  ExtendedSystemInfo,
  JumpHostCredentials,
  LiveSystemMetrics,
  NewSystemRequest,
  UpdateSystemRequest,
} from '../core/models/system.model';
import { SystemMonitoringService } from '../core/services/system-monitoring.service';
import { SystemService } from '../core/services/system.service';

@Injectable({ providedIn: 'root' })
export class SystemState {
  private _systems = signal<ContainerSystem[]>([]);
  private _connectionStates = signal<Record<string, ConnectionState>>({});
  private _extendedInfo = signal<Record<string, ExtendedSystemInfo>>({});
  private _loading = signal<boolean>(false);
  private _error = signal<string | null>(null);
  private _selectedSystemId = signal<string | null>(null);
  private _searchQuery = signal<string>('');
  private _statusFilter = signal<ConnectionState | null>(null);
  private _hostKeyMismatch = signal<{
    systemId: string;
    hostname: string;
    port: number;
    expected: string;
    actual: string;
  } | null>(null);

  // Credentials held outside reactive state so they're not visible in Angular DevTools.
  // Cleared immediately after use in trustNewHostKey().
  private _pendingCredentials: {
    password?: string;
    passphrase?: string;
    privateKey?: string;
    jumpHostCredentials?: Record<string, JumpHostCredentials>;
  } | null = null;

  readonly systems = this._systems.asReadonly();
  readonly connectionStates = this._connectionStates.asReadonly();
  readonly extendedInfo = this._extendedInfo.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly selectedSystemId = this._selectedSystemId.asReadonly();
  readonly searchQuery = this._searchQuery.asReadonly();
  readonly statusFilter = this._statusFilter.asReadonly();
  readonly hostKeyMismatch = this._hostKeyMismatch.asReadonly();

  readonly selectedSystem = computed(() => {
    const id = this._selectedSystemId();
    return id ? this._systems().find((s) => s.id === id) ?? null : null;
  });

  readonly connectedSystems = computed(() =>
    this._systems().filter(
      (s) => this._connectionStates()[s.id] === 'connected'
    )
  );

  readonly disconnectedSystems = computed(() =>
    this._systems().filter(
      (s) => {
        const state = this._connectionStates()[s.id];
        return state === 'disconnected' || state === 'error';
      }
    )
  );

  /** Filtered systems based on search query and status filter */
  readonly filteredSystems = computed(() => {
    let systems = this._systems();
    const query = this._searchQuery().toLowerCase().trim();
    const statusFilter = this._statusFilter();

    // Filter by search query
    if (query) {
      systems = systems.filter((s) => {
        const info = this._extendedInfo()[s.id];
        return (
          s.name.toLowerCase().includes(query) ||
          s.hostname.toLowerCase().includes(query) ||
          s.primaryRuntime.toLowerCase().includes(query) ||
          info?.username?.toLowerCase().includes(query) ||
          info?.distro?.toLowerCase().includes(query) ||
          info?.hostname?.toLowerCase().includes(query)
        );
      });
    }

    // Filter by connection status
    if (statusFilter) {
      systems = systems.filter(
        (s) => this._connectionStates()[s.id] === statusFilter
      );
    }

    return systems;
  });

  readonly stats = computed(() => {
    const systems = this._systems();
    const states = this._connectionStates();
    return {
      total: systems.length,
      connected: systems.filter((s) => states[s.id] === 'connected').length,
      disconnected: systems.filter((s) => states[s.id] === 'disconnected')
        .length,
      error: systems.filter((s) => states[s.id] === 'error').length,
    };
  });

  constructor(
    private systemService: SystemService,
    private monitoringService: SystemMonitoringService
  ) {
    // Start listening to monitoring events
    this.monitoringService.startListening();
  }

  async loadSystems(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);

    try {
      const systems = await this.systemService.listSystems();
      this._systems.set(systems);

      const states: Record<string, ConnectionState> = {};
      await Promise.all(
        systems.map(async (system) => {
          states[system.id] = await this.systemService.getConnectionState(
            system.id
          );
        })
      );
      this._connectionStates.set(states);
    } catch (err) {
      this._error.set(this.extractError(err) || 'Failed to load systems');
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Add a new system
   * @param request The new system request
   * @param password Optional password for SSH authentication on autoConnect (required on mobile)
   * @param passphrase Optional passphrase for SSH key authentication on autoConnect (required on mobile)
   * @param privateKey Optional PEM-encoded private key content for SSH authentication
   */
  async addSystem(request: NewSystemRequest, password?: string, passphrase?: string, privateKey?: string, jumpHostCredentials?: Record<string, JumpHostCredentials>): Promise<ContainerSystem | null> {
    this._loading.set(true);
    this._error.set(null);

    try {
      const system = await this.systemService.addSystem(request);
      this._systems.update((systems) => [...systems, system]);
      this._connectionStates.update((states) => ({
        ...states,
        [system.id]: 'disconnected',
      }));

      if (request.autoConnect) {
        await this.connectSystem(system.id, password, passphrase, privateKey, jumpHostCredentials);
      }

      return system;
    } catch (err) {
      this._error.set(this.extractError(err) || 'Failed to add system');
      return null;
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Connect to a system
   * @param systemId The system ID to connect to
   * @param password Optional password for SSH authentication (required on mobile)
   * @param passphrase Optional passphrase for SSH key authentication (required on mobile)
   * @param privateKey Optional PEM-encoded private key content for SSH authentication
   */
  async connectSystem(systemId: string, password?: string, passphrase?: string, privateKey?: string, jumpHostCredentials?: Record<string, JumpHostCredentials>): Promise<boolean> {
    this._connectionStates.update((states) => ({
      ...states,
      [systemId]: 'connecting',
    }));

    try {
      const state = await this.systemService.connectSystem(systemId, password, passphrase, privateKey, jumpHostCredentials);
      this._connectionStates.update((states) => ({
        ...states,
        [systemId]: state,
      }));

      // Fetch extended system info on successful connection
      if (state === 'connected') {
        this.fetchExtendedInfo(systemId);
        // Start live monitoring
        this.monitoringService.startMonitoring(systemId);
      }

      return state === 'connected';
    } catch (err) {
      this._connectionStates.update((states) => ({
        ...states,
        [systemId]: 'error',
      }));

      const hostKeyErr = this.extractHostKeyError(err);
      if (hostKeyErr) {
        const system = this._systems().find(s => s.id === systemId);
        const port = system?.sshConfig?.port ?? 22;
        const hostname = hostKeyErr.hostname || system?.hostname || '';
        const reason = hostKeyErr.reason;
        const expectedMatch = reason.match(/Expected:\s*(\S+)/);
        const actualMatch = reason.match(/Received:\s*(\S+)/);
        this._pendingCredentials = { password, passphrase, privateKey, jumpHostCredentials };
        this._hostKeyMismatch.set({
          systemId,
          hostname,
          port,
          expected: expectedMatch?.[1] ?? 'unknown',
          actual: actualMatch?.[1] ?? 'unknown',
        });
      } else {
        const errStr = this.extractError(err);
        this._error.set(errStr || 'Connection failed');
      }
      return false;
    }
  }

  /**
   * Fetch extended system information for a connected system.
   * This is called automatically on connection but can be called manually to refresh.
   */
  async fetchExtendedInfo(systemId: string): Promise<ExtendedSystemInfo | null> {
    try {
      const info = await this.systemService.getExtendedSystemInfo(systemId);
      this._extendedInfo.update((infoMap) => ({
        ...infoMap,
        [systemId]: info,
      }));
      return info;
    } catch (err) {
      // Don't set global error for extended info fetch failure
      console.warn(`Failed to fetch extended info for ${systemId}:`, err);
      return null;
    }
  }

  /**
   * Get extended info for a specific system (if available)
   */
  getExtendedInfo(systemId: string): ExtendedSystemInfo | null {
    return this._extendedInfo()[systemId] ?? null;
  }

  /**
   * Get all live metrics (signal)
   */
  get liveMetrics() {
    return this.monitoringService.metrics;
  }

  /**
   * Get all metrics history (signal)
   */
  get metricsHistory() {
    return this.monitoringService.history;
  }

  /**
   * Get live metrics for a specific system (if available)
   */
  getLiveMetrics(systemId: string): LiveSystemMetrics | null {
    return this.monitoringService.getMetrics(systemId);
  }

  /**
   * Get metrics history for a specific system
   */
  getMetricsHistory(systemId: string): LiveSystemMetrics[] {
    return this.monitoringService.getHistory(systemId);
  }

  /**
   * Check if a system is being monitored
   */
  isMonitoring(systemId: string): boolean {
    return this.monitoringService.isMonitoring(systemId);
  }

  async disconnectSystem(systemId: string): Promise<void> {
    try {
      // Stop monitoring first
      await this.monitoringService.stopMonitoring(systemId);

      const state = await this.systemService.disconnectSystem(systemId);
      this._connectionStates.update((states) => ({
        ...states,
        [systemId]: state,
      }));
      // Clear extended info on disconnect
      this._extendedInfo.update((infoMap) => {
        const newMap = { ...infoMap };
        delete newMap[systemId];
        return newMap;
      });
    } catch (err) {
      this._error.set(this.extractError(err) || 'Disconnect failed');
    }
  }

  async detectRuntimes(systemId: string): Promise<ContainerRuntime[]> {
    try {
      const runtimes = await this.systemService.detectRuntimes(systemId);
      this._systems.update((systems) =>
        systems.map((s) =>
          s.id === systemId ? { ...s, availableRuntimes: runtimes } : s
        )
      );
      return runtimes;
    } catch (err) {
      this._error.set(this.extractError(err) || 'Failed to detect runtimes');
      return [];
    }
  }

  async updateSystem(request: UpdateSystemRequest): Promise<ContainerSystem | null> {
    this._loading.set(true);
    this._error.set(null);

    try {
      const system = await this.systemService.updateSystem(request);
      this._systems.update((systems) =>
        systems.map((s) => (s.id === system.id ? system : s))
      );
      return system;
    } catch (err) {
      this._error.set(this.extractError(err) || 'Failed to update system');
      return null;
    } finally {
      this._loading.set(false);
    }
  }

  async removeSystem(systemId: string): Promise<boolean> {
    this._loading.set(true);
    this._error.set(null);

    try {
      const removed = await this.systemService.removeSystem(systemId);
      if (removed) {
        this._systems.update((systems) => systems.filter((s) => s.id !== systemId));
        this._connectionStates.update((states) => {
          const newStates = { ...states };
          delete newStates[systemId];
          return newStates;
        });
      }
      return removed;
    } catch (err) {
      this._error.set(this.extractError(err) || 'Failed to remove system');
      return false;
    } finally {
      this._loading.set(false);
    }
  }

  selectSystem(systemId: string | null): void {
    // Clear stale credentials from a previous host key mismatch flow
    if (this._hostKeyMismatch() && this._hostKeyMismatch()?.systemId !== systemId) {
      this._pendingCredentials = null;
      this._hostKeyMismatch.set(null);
    }
    this._selectedSystemId.set(systemId);
  }

  getConnectionState(systemId: string): ConnectionState {
    return this._connectionStates()[systemId] ?? 'disconnected';
  }

  clearError(): void {
    this._error.set(null);
  }

  setError(message: string): void {
    this._error.set(message);
  }

  setSearchQuery(query: string): void {
    this._searchQuery.set(query);
  }

  setStatusFilter(status: ConnectionState | null): void {
    this._statusFilter.set(status);
  }

  /**
   * Extract a human-readable error message from Tauri command errors.
   * Tauri serializes Rust enums as objects like { "VariantName": data }.
   */
  private extractError(err: unknown): string {
    if (typeof err === 'string') return err;
    if (err instanceof Error) return err.message;
    if (err && typeof err === 'object') {
      // Tauri serializes Rust enums as { VariantName: data }
      const entries = Object.entries(err as Record<string, unknown>);
      if (entries.length === 1) {
        const [, value] = entries[0];
        if (typeof value === 'string') return value;
        if (Array.isArray(value)) return value.filter(v => typeof v === 'string').join(': ');
        if (value && typeof value === 'object') {
          const inner = value as Record<string, unknown>;
          // Struct variants: try common fields
          if (typeof inner['reason'] === 'string') return inner['reason'] as string;
          if (typeof inner['message'] === 'string') return inner['message'] as string;
          if (typeof inner['stderr'] === 'string') return `${inner['command'] ?? 'Command'}: ${inner['stderr']}`;
          return JSON.stringify(value);
        }
      }
      return JSON.stringify(err);
    }
    return String(err);
  }

  /**
   * Check if a Tauri error is a HostKeyVerificationFailed variant.
   * Returns the parsed hostname/reason if so, null otherwise.
   */
  private extractHostKeyError(err: unknown): { hostname: string; reason: string } | null {
    if (err && typeof err === 'object' && !Array.isArray(err)) {
      const obj = err as Record<string, unknown>;
      const hk = obj['HostKeyVerificationFailed'] as Record<string, string> | undefined;
      if (hk && typeof hk === 'object' && typeof hk['reason'] === 'string') {
        return { hostname: hk['hostname'] ?? '', reason: hk['reason'] };
      }
    }
    // Fallback: check if string contains the phrase
    const str = typeof err === 'string' ? err : (err instanceof Error ? err.message : '');
    if (str.toLowerCase().includes('host key verification failed')) {
      return { hostname: '', reason: str };
    }
    return null;
  }

  async trustNewHostKey(): Promise<void> {
    const mismatch = this._hostKeyMismatch();
    if (!mismatch) return;
    if (!mismatch.hostname) {
      this._error.set('Cannot trust host key: hostname is unknown');
      this._hostKeyMismatch.set(null);
      this._pendingCredentials = null;
      return;
    }
    const creds = this._pendingCredentials;
    // Clear immediately — if retry hits another host key mismatch (e.g. jump host),
    // user must provide credentials again (intentional single-trust-per-action).
    this._pendingCredentials = null;
    try {
      await this.systemService.removeKnownHost(mismatch.hostname, mismatch.port);
      this._hostKeyMismatch.set(null);
      await this.connectSystem(
        mismatch.systemId,
        creds?.password,
        creds?.passphrase,
        creds?.privateKey,
        creds?.jumpHostCredentials,
      );
    } catch (err) {
      this._error.set(this.extractError(err) || 'Failed to remove known host');
      this._hostKeyMismatch.set(null);
    }
  }

  dismissHostKeyMismatch(): void {
    this._pendingCredentials = null;
    this._hostKeyMismatch.set(null);
  }
}
