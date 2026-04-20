import { Injectable, ProviderToken, inject, signal, computed } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { ToastState } from '../../state/toast.state';
import { PermissionBannerState } from '../../state/permission-banner.state';
import {
  AuthTokens,
  BackendConnection,
  BackendSystem,
  CompanyAdmin,
  CompanyInfo,
  ConnectionStatus,
  EffectivePermissions,
  Environment,
  InviteMemberRequest,
  PendingInvite,
  K8sCluster,
  K8sDeployment,
  K8sNamespace,
  K8sPod,
  K8sService,
  K8sTopology,
  LoginRequest,
  PermissionDef,
  Project,
  ProjectMember,
  ProjectOverview,
  RegisterRequest,
  ResourceAcl,
  Role,
  RoleWithPermissions,
  SavedBackendConnection,
  UserProfile,
  UserSession,
  MfaEnrollResponse,
  MfaVerifyEnrollmentResponse,
  PasswordChangeRequest,
  PasswordResetConfirmRequest,
  AuditLogEntry,
  K8sApiResource,
  mapPod,
  mapDeployment,
  mapService,
  mapNamespace,
} from '../models/backend.model';
import { Container } from '../models/container.model';
import { ContainerImage } from '../models/image.model';
import { Volume } from '../models/volume.model';
import { Network } from '../models/network.model';
import { DirectoryListing, FileContent } from '../models/file-browser.model';
import { ExtendedSystemInfo, LiveSystemMetrics } from '../models/system.model';

const STORAGE_KEY = 'containerus_backend_connections';

/**
 * Run `inject(token)` if we're inside an Angular injection context; return null
 * otherwise. Lets this service be `new`'d by legacy specs without crashing,
 * while still wiring up toast/banner collaborators when used from the app.
 */
function tryInject<T>(token: ProviderToken<T>): T | null {
  try {
    return inject(token, { optional: true }) ?? null;
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class BackendService {
  private _connections = signal<BackendConnection[]>([]);

  /** Map systemId → connectionId for routing actions to the correct backend */
  _systemOwnership = new Map<string, string>();

  /** Serializes concurrent token refresh attempts per connection */
  private _refreshPromises = new Map<string, Promise<void>>();

  /** Resolves when all auto-reconnect attempts are complete */
  private _readyPromise: Promise<void> = Promise.resolve();

  /** Connection IDs where the user explicitly logged out (skip auto-reconnect) */
  _userLoggedOut = new Set<string>();

  /** Periodic reconnect timer handle */
  private _reconnectInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * CON-126 §4.7: coalesces 403-triggered permission refreshes per connection
   * so a burst of denied requests only causes one `/auth/me` round-trip.
   */
  private readonly _permissionRefreshPromises = new Map<string, Promise<void>>();

  /**
   * Toast + banner are resolved defensively so the service can still be
   * constructed via `new BackendService()` in unit tests that don't bootstrap
   * Angular DI. When absent, 403 handling still flushes the cache and
   * refetches — it just skips the user-facing notification.
   */
  private readonly toast = tryInject(ToastState);
  private readonly permissionBanner = tryInject(PermissionBannerState);

  readonly connections = this._connections.asReadonly();
  readonly isBackendMode = computed(() => this._connections().some(c => c.status === 'connected'));
  readonly hasConnections = computed(() => this._connections().length > 0);
  readonly connectedBackends = computed(() => this._connections().filter(c => c.status === 'connected'));

  // Legacy compatibility — returns first connected backend's data
  readonly serverUrl = computed(() => this.connectedBackends()[0]?.serverUrl ?? '');
  readonly user = computed(() => this.connectedBackends()[0]?.user ?? null);
  readonly projects = computed(() => this.connectedBackends()[0]?.projects ?? []);
  readonly isAuthenticated = computed(() => this.connectedBackends().length > 0);

  constructor() {
    this._readyPromise = this.loadPersistedConnections();
    this.startReconnectLoop();
  }

  /** Wait for all auto-reconnect attempts to complete. */
  waitForReady(): Promise<void> {
    return this._readyPromise;
  }

  private startReconnectLoop(): void {
    this._reconnectInterval = setInterval(() => this.monitorConnections(), 30_000);
  }

  private async monitorConnections(): Promise<void> {
    // Phase 1: Health-check connected backends — detect server going down
    const connected = this._connections().filter(c => c.status === 'connected');

    for (const conn of connected) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        try {
          const resp = await fetch(`${conn.serverUrl}/api/health`, { signal: controller.signal });
          clearTimeout(timeoutId);
          if (!resp.ok) throw new Error('unhealthy');
        } catch {
          clearTimeout(timeoutId);
          throw new Error('unreachable');
        }
      } catch {
        console.warn(`Backend ${conn.label} is unreachable, marking disconnected`);
        this.updateConnection(conn.id, { status: 'disconnected', errorReason: 'server_unreachable' });
      }
    }

    // Phase 2: Reconnect disconnected backends
    const disconnected = this._connections()
      .filter(c => c.status === 'disconnected' && !this._userLoggedOut.has(c.id) && c.tokens?.refreshToken);

    for (const conn of disconnected) {
      if (this._refreshPromises.has(conn.id)) continue;

      this.updateConnection(conn.id, { status: 'connecting', errorReason: null });
      try {
        await this.refreshTokenFor(conn.id);
        const user = await this.requestFor<UserProfile>(conn.id, 'GET', '/api/auth/me');
        this.updateConnection(conn.id, { user, status: 'connected', errorReason: null });
        await this.loadProjectsFor(conn.id);
        console.info(`Auto-reconnected to backend: ${conn.label}`);
      } catch {
        // Keep whatever errorReason refreshTokenFor set (refresh_token_expired) or fall back.
        const c = this.getConnection(conn.id);
        this.updateConnection(conn.id, {
          status: 'disconnected',
          errorReason: c?.errorReason ?? 'server_unreachable',
        });
      }
    }
  }

  // ==========================================================================
  // Connection Management
  // ==========================================================================

  /** Add a new backend and test connectivity. Returns the connection ID. */
  async addBackend(serverUrl: string, label?: string): Promise<string> {
    const url = serverUrl.replace(/\/+$/, '');

    // Test connectivity
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const resp = await fetch(`${url}/api/health`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!resp.ok) throw new Error(`Cannot reach server at ${url} (HTTP ${resp.status})`);
    } catch (e) {
      clearTimeout(timeoutId);
      if (e instanceof Error && e.name === 'AbortError') {
        throw new Error(`Connection to ${url} timed out`);
      }
      if (e instanceof Error && e.message.startsWith('Cannot reach')) throw e;
      throw new Error(`Cannot reach server at ${url}`);
    }

    const id = crypto.randomUUID();
    const conn: BackendConnection = {
      id,
      serverUrl: url,
      label: label || (() => { try { return new URL(url).hostname; } catch { return url.replace(/^https?:\/\//, '').split('/')[0]; } })(),
      tokens: null,
      user: null,
      projects: [],
      projectPermissions: {},
      status: 'disconnected',
      errorReason: null,
    };

    this._connections.update(list => [...list, conn]);
    this.persistConnections();
    return id;
  }

  /** Remove a backend connection entirely. */
  removeBackend(connectionId: string): void {
    this._userLoggedOut.delete(connectionId);
    // Clean up system ownership
    for (const [sysId, connId] of this._systemOwnership) {
      if (connId === connectionId) this._systemOwnership.delete(sysId);
    }
    this._connections.update(list => list.filter(c => c.id !== connectionId));
    invoke('delete_backend_connection', { id: connectionId }).catch(err =>
      console.warn('Failed to delete backend connection from storage:', err)
    );
  }

  /** Get a specific connection by ID. */
  getConnection(connectionId: string): BackendConnection | undefined {
    return this._connections().find(c => c.id === connectionId);
  }

  /** Get the most recently added connection (for connect→login flow). */
  getLatestConnection(): BackendConnection | undefined {
    const list = this._connections();
    return list[list.length - 1];
  }

  // ==========================================================================
  // Auth (per-connection)
  // ==========================================================================

  async loginToBackend(connectionId: string, req: LoginRequest): Promise<void> {
    this._userLoggedOut.delete(connectionId);
    this.updateConnection(connectionId, { status: 'connecting', errorReason: null });
    try {
      const data = await this.requestFor<AuthTokens & { user: UserProfile }>(
        connectionId, 'POST', '/api/auth/login', req
      );
      this.updateConnection(connectionId, {
        tokens: { accessToken: data.accessToken, refreshToken: data.refreshToken },
        user: data.user,
        status: 'connected',
        errorReason: null,
      });
      this.persistConnections();
      await this.loadProjectsFor(connectionId);
    } catch (e) {
      this.updateConnection(connectionId, { status: 'error', errorReason: 'rejected_by_server' });
      throw e;
    }
  }

  async registerOnBackend(connectionId: string, req: RegisterRequest): Promise<void> {
    this._userLoggedOut.delete(connectionId);
    this.updateConnection(connectionId, { status: 'connecting', errorReason: null });
    try {
      const data = await this.requestFor<AuthTokens & { user: UserProfile }>(
        connectionId, 'POST', '/api/auth/register', req
      );
      this.updateConnection(connectionId, {
        tokens: { accessToken: data.accessToken, refreshToken: data.refreshToken },
        user: data.user,
        status: 'connected',
        errorReason: null,
      });
      this.persistConnections();
      await this.loadProjectsFor(connectionId);
    } catch (e) {
      this.updateConnection(connectionId, { status: 'error', errorReason: 'rejected_by_server' });
      throw e;
    }
  }

  logoutFrom(connectionId: string): void {
    this._userLoggedOut.add(connectionId);
    for (const [sysId, connId] of this._systemOwnership) {
      if (connId === connectionId) this._systemOwnership.delete(sysId);
    }
    this.updateConnection(connectionId, {
      tokens: null,
      user: null,
      projects: [],
      projectPermissions: {},
      status: 'disconnected',
      errorReason: null,
    });
    this.persistConnections();
  }

  /** Disconnect all backends and return to local-only mode. */
  switchToLocal(): void {
    this._systemOwnership.clear();
    this._connections.set([]);
    invoke('delete_all_backend_connections').catch(err =>
      console.warn('Failed to clear backend connections from storage:', err)
    );
  }

  // ==========================================================================
  // Projects (per-connection)
  // ==========================================================================

  async loadProjectsFor(connectionId: string): Promise<Project[]> {
    const projects = await this.requestFor<Project[]>(connectionId, 'GET', '/api/projects');
    this.updateConnection(connectionId, { projects });
    this.persistConnections();
    // Load permissions for all projects in parallel
    const permMap: Record<string, EffectivePermissions> = {};
    await Promise.all(projects.map(async (p) => {
      try {
        permMap[p.id] = await this.requestFor<EffectivePermissions>(
          connectionId, 'GET', `/api/projects/${p.id}/my-permissions`
        );
      } catch {
        // Ignore — user may not have access to some projects
      }
    }));
    this.updateConnection(connectionId, { projectPermissions: permMap });
    return projects;
  }

  async createProjectFor(connectionId: string, data: { name: string; slug: string; description?: string }): Promise<Project> {
    const project = await this.requestFor<Project>(connectionId, 'POST', '/api/projects', data);
    await this.loadProjectsFor(connectionId);
    return project;
  }

  async deleteProjectFor(connectionId: string, projectId: string): Promise<void> {
    await this.requestFor(connectionId, 'DELETE', `/api/projects/${projectId}`);
    await this.loadProjectsFor(connectionId);
  }

  async getProjectMembersFor(connectionId: string, projectId: string): Promise<ProjectMember[]> {
    return this.requestFor<ProjectMember[]>(connectionId, 'GET', `/api/projects/${projectId}/members`);
  }

  async inviteMemberFor(connectionId: string, projectId: string, req: InviteMemberRequest): Promise<void> {
    await this.requestFor(connectionId, 'POST', `/api/projects/${projectId}/members/invite`, req);
  }

  async updateMemberRoleFor(connectionId: string, projectId: string, userId: string, roleId: string): Promise<void> {
    await this.requestFor(connectionId, 'PUT', `/api/projects/${projectId}/members/${userId}/role`, { roleId });
    this.notifyLocalPermissionEdit(connectionId);
  }

  async removeMemberFor(connectionId: string, projectId: string, userId: string): Promise<void> {
    await this.requestFor(connectionId, 'DELETE', `/api/projects/${projectId}/members/${userId}`);
    this.notifyLocalPermissionEdit(connectionId);
  }

  /**
   * CON-115 §3.3 — pending invites. The backend endpoint is tracked as a
   * follow-up (BackendEngineer subtask from CON-125); callers must catch and
   * degrade gracefully when it 404s.
   */
  async listInvitesFor(connectionId: string, projectId: string): Promise<PendingInvite[]> {
    return this.requestFor<PendingInvite[]>(connectionId, 'GET', `/api/projects/${projectId}/invites`);
  }

  async resendInviteFor(connectionId: string, projectId: string, inviteId: string): Promise<void> {
    await this.requestFor(connectionId, 'POST', `/api/projects/${projectId}/invites/${inviteId}/resend`);
  }

  async revokeInviteFor(connectionId: string, projectId: string, inviteId: string): Promise<void> {
    await this.requestFor(connectionId, 'DELETE', `/api/projects/${projectId}/invites/${inviteId}`);
  }

  async loadPermissionsFor(connectionId: string, projectId: string): Promise<EffectivePermissions> {
    const perms = await this.requestFor<EffectivePermissions>(
      connectionId, 'GET', `/api/projects/${projectId}/my-permissions`
    );
    const conn = this.getConnection(connectionId);
    const permMap = { ...conn?.projectPermissions, [projectId]: perms };
    this.updateConnection(connectionId, { projectPermissions: permMap });
    return perms;
  }

  hasPermission(connectionId: string, perm: string, projectId?: string): boolean {
    const conn = this.getConnection(connectionId);
    if (!conn) return false;
    // If no specific project, check if any project grants the permission
    if (!projectId) {
      return Object.values(conn.projectPermissions).some(
        p => p.isCompanyAdmin || p.permissions.includes(perm)
      );
    }
    const perms = conn.projectPermissions[projectId];
    if (!perms) return false;
    if (perms.isCompanyAdmin) return true;
    return perms.permissions.includes(perm);
  }

  // ==========================================================================
  // Environments (per-connection)
  // ==========================================================================

  async listEnvironmentsFor(connectionId: string, projectId: string): Promise<Environment[]> {
    return this.requestFor<Environment[]>(connectionId, 'GET', `/api/projects/${projectId}/environments`);
  }

  async createEnvironmentFor(connectionId: string, projectId: string, data: { name: string; slug: string; description?: string }): Promise<Environment> {
    return this.requestFor<Environment>(connectionId, 'POST', `/api/projects/${projectId}/environments`, data);
  }

  async updateEnvironmentFor(connectionId: string, projectId: string, envId: string, data: { name?: string; slug?: string; description?: string }): Promise<Environment> {
    return this.requestFor<Environment>(connectionId, 'PUT', `/api/projects/${projectId}/environments/${envId}`, data);
  }

  async deleteEnvironmentFor(connectionId: string, projectId: string, envId: string): Promise<void> {
    await this.requestFor(connectionId, 'DELETE', `/api/projects/${projectId}/environments/${envId}`);
  }

  // ==========================================================================
  // Roles & Permissions (per-connection)
  // ==========================================================================

  async listRolesFor(connectionId: string): Promise<Role[]> {
    return this.requestFor<Role[]>(connectionId, 'GET', '/api/roles');
  }

  async getRoleFor(connectionId: string, roleId: string): Promise<RoleWithPermissions> {
    return this.requestFor<RoleWithPermissions>(connectionId, 'GET', `/api/roles/${roleId}`);
  }

  async createRoleFor(connectionId: string, data: { name: string; slug: string; description?: string; permissions: string[] }): Promise<Role> {
    return this.requestFor<Role>(connectionId, 'POST', '/api/roles', data);
  }

  async updateRoleFor(connectionId: string, roleId: string, data: { name?: string; slug?: string; description?: string; permissions?: string[] }): Promise<Role> {
    const role = await this.requestFor<Role>(connectionId, 'PUT', `/api/roles/${roleId}`, data);
    // Only a permission-set change can affect what the current user can do;
    // renaming or re-describing a role cannot, so skip the banner for those.
    if (data.permissions) {
      this.notifyLocalPermissionEdit(connectionId);
    }
    return role;
  }

  async deleteRoleFor(connectionId: string, roleId: string): Promise<void> {
    await this.requestFor(connectionId, 'DELETE', `/api/roles/${roleId}`);
    this.notifyLocalPermissionEdit(connectionId);
  }

  async listPermissionDefsFor(connectionId: string): Promise<PermissionDef[]> {
    return this.requestFor<PermissionDef[]>(connectionId, 'GET', '/api/permissions');
  }

  // ==========================================================================
  // Company (per-connection)
  // ==========================================================================

  async getCompanyInfoFor(connectionId: string): Promise<CompanyInfo> {
    return this.requestFor<CompanyInfo>(connectionId, 'GET', '/api/company');
  }

  async updateCompanyFor(connectionId: string, data: { name: string; slug: string }): Promise<CompanyInfo> {
    return this.requestFor<CompanyInfo>(connectionId, 'PUT', '/api/company', data);
  }

  async listCompanyAdminsFor(connectionId: string): Promise<CompanyAdmin[]> {
    return this.requestFor<CompanyAdmin[]>(connectionId, 'GET', '/api/company/admins');
  }

  async addCompanyAdminFor(connectionId: string, userId: string): Promise<void> {
    await this.requestFor(connectionId, 'POST', '/api/company/admins', { userId });
  }

  async removeCompanyAdminFor(connectionId: string, userId: string): Promise<void> {
    await this.requestFor(connectionId, 'DELETE', `/api/company/admins/${userId}`);
  }

  // ==========================================================================
  // Resource ACLs (per-connection)
  // ==========================================================================

  async listAclsFor(connectionId: string, projectId: string): Promise<ResourceAcl[]> {
    return this.requestFor<ResourceAcl[]>(connectionId, 'GET', `/api/projects/${projectId}/acls`);
  }

  async createAclFor(
    connectionId: string,
    projectId: string,
    data: {
      userId: string;
      resourceType: string;
      resourceId: string;
      /**
       * Required when `resourceType === 'container'`, rejected otherwise.
       * Enforced server-side by the CON-117 DB CHECK constraint and the
       * api/acls.rs handler — the client mirrors that shape so a malformed
       * payload fails fast before hitting the network.
       */
      systemId?: string;
      roleId?: string;
      extraPermissions: string[];
      deniedPermissions: string[];
    },
  ): Promise<ResourceAcl> {
    const acl = await this.requestFor<ResourceAcl>(connectionId, 'POST', `/api/projects/${projectId}/acls`, data);
    this.notifyLocalPermissionEdit(connectionId);
    return acl;
  }

  async updateAclFor(connectionId: string, projectId: string, aclId: string, data: { roleId?: string; extraPermissions?: string[]; deniedPermissions?: string[] }): Promise<ResourceAcl> {
    const acl = await this.requestFor<ResourceAcl>(connectionId, 'PUT', `/api/projects/${projectId}/acls/${aclId}`, data);
    this.notifyLocalPermissionEdit(connectionId);
    return acl;
  }

  async deleteAclFor(connectionId: string, projectId: string, aclId: string): Promise<void> {
    await this.requestFor(connectionId, 'DELETE', `/api/projects/${projectId}/acls/${aclId}`);
    this.notifyLocalPermissionEdit(connectionId);
  }

  // ==========================================================================
  // Sessions + MFA (CON-132)
  // --------------------------------------------------------------------------
  // Sessions are projected off refresh_tokens; MFA uses TOTP with one-shot
  // backup codes. Both surfaces are under the caller's own user — no project
  // or system scoping is required.
  // ==========================================================================

  async listMySessionsFor(connectionId: string): Promise<UserSession[]> {
    return this.requestFor<UserSession[]>(connectionId, 'GET', '/api/users/me/sessions');
  }

  async revokeMySessionFor(connectionId: string, sessionId: string): Promise<void> {
    await this.requestFor(connectionId, 'DELETE', `/api/users/me/sessions/${sessionId}`);
  }

  async revokeAllOtherSessionsFor(connectionId: string): Promise<{ revoked: number }> {
    return this.requestFor<{ revoked: number }>(
      connectionId,
      'DELETE',
      '/api/users/me/sessions/all',
    );
  }

  async enrollMfaFor(connectionId: string): Promise<MfaEnrollResponse> {
    return this.requestFor<MfaEnrollResponse>(connectionId, 'POST', '/api/auth/mfa/enroll');
  }

  async verifyMfaEnrollmentFor(
    connectionId: string,
    code: string,
  ): Promise<MfaVerifyEnrollmentResponse> {
    const result = await this.requestFor<MfaVerifyEnrollmentResponse>(
      connectionId,
      'POST',
      '/api/auth/mfa/verify',
      { code },
    );
    // Re-fetch /auth/me so the cached `mfaEnabled` flag flips without a reload.
    try {
      const user = await this.requestFor<UserProfile>(connectionId, 'GET', '/api/auth/me');
      this.updateConnection(connectionId, { user });
    } catch {
      // Non-fatal — the screen re-derives state from the verify response.
    }
    return result;
  }

  async disableMfaFor(connectionId: string, code: string): Promise<void> {
    await this.requestFor(connectionId, 'POST', '/api/auth/mfa/disable', { code });
    try {
      const user = await this.requestFor<UserProfile>(connectionId, 'GET', '/api/auth/me');
      this.updateConnection(connectionId, { user });
    } catch {
      // Non-fatal.
    }
  }

  // ==========================================================================
  // Password change + reset (CON-133)
  // --------------------------------------------------------------------------
  // All three endpoints live under `/api/auth/password/*`. Change is
  // authenticated; request/confirm are anonymous — `requestFor` simply omits
  // the `Authorization` header when the connection has no access token, so
  // the login-screen callsites reuse the same pipeline without a second
  // transport. Server-side rate limiting + enumeration-proof responses live
  // in `crates/containerus-server/src/api/password.rs`.
  // ==========================================================================

  async changePasswordFor(
    connectionId: string,
    req: PasswordChangeRequest,
  ): Promise<void> {
    await this.requestFor(connectionId, 'POST', '/api/auth/password/change', req);
    // The server revoked every refresh token for this user (including ours),
    // so clear the local session to force a fresh login instead of letting
    // the next request trip a 401 → failed-refresh cascade.
    this.updateConnection(connectionId, {
      tokens: null,
      user: null,
      projects: [],
      projectPermissions: {},
      status: 'disconnected',
      errorReason: null,
    });
    this._userLoggedOut.add(connectionId);
    this.persistConnections();
  }

  async requestPasswordResetFor(connectionId: string, email: string): Promise<void> {
    // Response is always 200 with a generic body — we ignore it. Errors here
    // mean transport failure, which the caller surfaces as a network reason.
    await this.requestFor(connectionId, 'POST', '/api/auth/password/reset/request', {
      email,
    });
  }

  async confirmPasswordResetFor(
    connectionId: string,
    req: PasswordResetConfirmRequest,
  ): Promise<void> {
    await this.requestFor(connectionId, 'POST', '/api/auth/password/reset/confirm', req);
  }

  // ==========================================================================
  // Systems (per-connection)
  // ==========================================================================

  async listSystemsInEnvironmentFor(connectionId: string, projectId: string, environmentId: string): Promise<BackendSystem[]> {
    const systems = await this.requestFor<BackendSystem[]>(
      connectionId, 'GET', `/api/projects/${projectId}/environments/${environmentId}/systems`
    );
    for (const s of systems) {
      this._systemOwnership.set(s.id, connectionId);
    }
    return systems;
  }

  /** List all systems across all projects and environments for a connection */
  async listAllSystemsFor(connectionId: string): Promise<BackendSystem[]> {
    const conn = this.getConnection(connectionId);
    if (!conn) return [];
    const allSystems: BackendSystem[] = [];
    for (const project of conn.projects) {
      try {
        const envs = await this.listEnvironmentsFor(connectionId, project.id);
        for (const env of envs) {
          try {
            const systems = await this.listSystemsInEnvironmentFor(connectionId, project.id, env.id);
            allSystems.push(...systems);
          } catch { /* skip environments we can't access */ }
        }
      } catch { /* skip projects we can't access */ }
    }
    return allSystems;
  }

  async createSystemInEnvironmentFor(connectionId: string, projectId: string, environmentId: string, data: Record<string, unknown>): Promise<BackendSystem> {
    const system = await this.requestFor<BackendSystem>(
      connectionId, 'POST', `/api/projects/${projectId}/environments/${environmentId}/systems`, data
    );
    this._systemOwnership.set(system.id, connectionId);
    return system;
  }

  async getSystemFor(connectionId: string, id: string): Promise<BackendSystem> {
    return this.requestFor<BackendSystem>(connectionId, 'GET', `/api/systems/${id}`);
  }

  async deleteSystemFor(connectionId: string, id: string): Promise<void> {
    await this.requestFor(connectionId, 'DELETE', `/api/systems/${id}`);
    this._systemOwnership.delete(id);
  }

  async connectSystemFor(connectionId: string, id: string): Promise<void> {
    await this.requestFor(connectionId, 'POST', `/api/systems/${id}/connect`);
  }

  async disconnectSystemFor(connectionId: string, id: string): Promise<void> {
    await this.requestFor(connectionId, 'POST', `/api/systems/${id}/disconnect`);
  }

  async updateSystemFor(connectionId: string, systemId: string, data: Record<string, unknown>): Promise<BackendSystem> {
    return this.requestFor<BackendSystem>(connectionId, 'PUT', `/api/systems/${systemId}`, data);
  }

  async trustHostKeyFor(connectionId: string, id: string): Promise<void> {
    await this.requestFor(connectionId, 'POST', `/api/systems/${id}/trust-host-key`);
  }

  async testSystemFor(connectionId: string, id: string): Promise<{ status: string; message?: string }> {
    return this.requestFor(connectionId, 'POST', `/api/systems/${id}/test`);
  }

  async getSystemInfoFor(connectionId: string, systemId: string): Promise<ExtendedSystemInfo> {
    return this.requestFor<ExtendedSystemInfo>(connectionId, 'GET', `/api/systems/${systemId}/info`);
  }

  async getSystemMetricsFor(connectionId: string, systemId: string): Promise<LiveSystemMetrics> {
    return this.requestFor<LiveSystemMetrics>(connectionId, 'GET', `/api/systems/${systemId}/metrics`);
  }

  // ==========================================================================
  // Containers (per-connection)
  // ==========================================================================

  async listContainersFor(connectionId: string, systemId: string): Promise<Container[]> {
    return this.requestFor<Container[]>(connectionId, 'GET', `/api/systems/${systemId}/containers`);
  }

  async containerActionFor(connectionId: string, systemId: string, containerId: string, action: string, runtime?: string): Promise<void> {
    await this.requestFor(connectionId, 'POST', `/api/systems/${systemId}/containers/${containerId}/action`, { action, runtime });
  }

  async inspectContainerFor(connectionId: string, systemId: string, containerId: string, runtime?: string): Promise<import('../models/container.model').ContainerDetails> {
    const params = runtime ? `?runtime=${encodeURIComponent(runtime)}` : '';
    return this.requestFor(connectionId, 'GET', `/api/systems/${systemId}/containers/${containerId}/inspect${params}`);
  }

  async getContainerLogsFor(connectionId: string, systemId: string, containerId: string, tail?: number, timestamps?: boolean, runtime?: string): Promise<{ logs: string }> {
    const query = new URLSearchParams();
    if (tail != null) query.set('tail', String(tail));
    if (timestamps != null) query.set('timestamps', String(timestamps));
    if (runtime) query.set('runtime', runtime);
    const qs = query.toString();
    return this.requestFor(connectionId, 'GET', `/api/systems/${systemId}/containers/${containerId}/logs${qs ? `?${qs}` : ''}`);
  }

  async listImagesFor(connectionId: string, systemId: string): Promise<ContainerImage[]> {
    return this.requestFor<ContainerImage[]>(connectionId, 'GET', `/api/systems/${systemId}/images`);
  }

  async listVolumesFor(connectionId: string, systemId: string): Promise<Volume[]> {
    return this.requestFor<Volume[]>(connectionId, 'GET', `/api/systems/${systemId}/volumes`);
  }

  async listNetworksFor(connectionId: string, systemId: string): Promise<Network[]> {
    return this.requestFor<Network[]>(connectionId, 'GET', `/api/systems/${systemId}/networks`);
  }

  async pullImageFor(connectionId: string, systemId: string, image: string, runtime: string): Promise<void> {
    await this.requestFor(connectionId, 'POST', `/api/systems/${systemId}/images/pull`, { image, runtime });
  }

  async removeImageFor(connectionId: string, systemId: string, imageId: string, runtime: string, force = false): Promise<void> {
    await this.requestFor(connectionId, 'DELETE', `/api/systems/${systemId}/images/${encodeURIComponent(imageId)}?runtime=${runtime}&force=${force}`);
  }

  async createVolumeFor(connectionId: string, systemId: string, name: string, runtime: string, driver?: string): Promise<void> {
    await this.requestFor(connectionId, 'POST', `/api/systems/${systemId}/volumes`, { name, runtime, driver });
  }

  async removeVolumeFor(connectionId: string, systemId: string, name: string, runtime: string, force = false): Promise<void> {
    await this.requestFor(connectionId, 'DELETE', `/api/systems/${systemId}/volumes/${encodeURIComponent(name)}?runtime=${runtime}&force=${force}`);
  }

  async createNetworkFor(connectionId: string, systemId: string, name: string, runtime: string, driver?: string, subnet?: string): Promise<void> {
    await this.requestFor(connectionId, 'POST', `/api/systems/${systemId}/networks`, { name, runtime, driver, subnet });
  }

  async removeNetworkFor(connectionId: string, systemId: string, name: string, runtime: string): Promise<void> {
    await this.requestFor(connectionId, 'DELETE', `/api/systems/${systemId}/networks/${encodeURIComponent(name)}?runtime=${runtime}`);
  }

  async connectContainerToNetworkFor(connectionId: string, systemId: string, networkName: string, containerId: string, runtime: string): Promise<void> {
    await this.requestFor(connectionId, 'POST', `/api/systems/${systemId}/networks/${encodeURIComponent(networkName)}/connect`, { containerId, runtime });
  }

  async disconnectContainerFromNetworkFor(connectionId: string, systemId: string, networkName: string, containerId: string, runtime: string): Promise<void> {
    await this.requestFor(connectionId, 'POST', `/api/systems/${systemId}/networks/${encodeURIComponent(networkName)}/disconnect`, { containerId, runtime });
  }

  // ==========================================================================
  // Port Forward Tunnel (per-connection)
  // ==========================================================================

  /** Get WebSocket URL and token for a port forward tunnel on a backend system. */
  getTunnelWsUrl(connectionId: string, systemId: string): { url: string; token: string } | null {
    const conn = this.getConnection(connectionId);
    if (!conn?.tokens?.accessToken) return null;

    try {
      const parsed = new URL(conn.serverUrl);
      const wsProtocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${wsProtocol}//${parsed.host}/api/ws/tunnel/${systemId}`;
      return { url, token: conn.tokens.accessToken };
    } catch {
      const serverUrl = conn.serverUrl;
      const wsProtocol = serverUrl.startsWith('https') ? 'wss' : 'ws';
      const host = serverUrl.replace(/^https?:\/\//, '');
      const url = `${wsProtocol}://${host}/api/ws/tunnel/${systemId}`;
      return { url, token: conn.tokens.accessToken };
    }
  }

  // ==========================================================================
  // File Browser (per-connection)
  // ==========================================================================

  async listDirectoryFor(connectionId: string, systemId: string, path: string, containerId?: string, runtime?: string): Promise<DirectoryListing> {
    const params = new URLSearchParams({ path });
    if (containerId) params.set('containerId', containerId);
    if (runtime) params.set('runtime', runtime);
    return this.requestFor<DirectoryListing>(connectionId, 'GET', `/api/systems/${systemId}/files/list?${params}`);
  }

  async readFileFor(connectionId: string, systemId: string, path: string, containerId?: string, runtime?: string): Promise<FileContent> {
    const params = new URLSearchParams({ path });
    if (containerId) params.set('containerId', containerId);
    if (runtime) params.set('runtime', runtime);
    return this.requestFor<FileContent>(connectionId, 'GET', `/api/systems/${systemId}/files/read?${params}`);
  }

  async writeFileFor(connectionId: string, systemId: string, path: string, content: string, containerId?: string, runtime?: string): Promise<void> {
    await this.requestFor(connectionId, 'POST', `/api/systems/${systemId}/files/write`, { path, content, containerId, runtime });
  }

  async createDirectoryFor(connectionId: string, systemId: string, path: string, containerId?: string, runtime?: string): Promise<void> {
    await this.requestFor(connectionId, 'POST', `/api/systems/${systemId}/files/mkdir`, { path, containerId, runtime });
  }

  async deletePathFor(connectionId: string, systemId: string, path: string, isDirectory: boolean, containerId?: string, runtime?: string): Promise<void> {
    await this.requestFor(connectionId, 'DELETE', `/api/systems/${systemId}/files/delete`, { path, isDirectory, containerId, runtime });
  }

  async renamePathFor(connectionId: string, systemId: string, oldPath: string, newPath: string, containerId?: string, runtime?: string): Promise<void> {
    await this.requestFor(connectionId, 'POST', `/api/systems/${systemId}/files/rename`, { oldPath, newPath, containerId, runtime });
  }

  async downloadFileFor(connectionId: string, systemId: string, path: string, containerId?: string, runtime?: string): Promise<{ path: string; content: string }> {
    const params = new URLSearchParams({ path });
    if (containerId) params.set('containerId', containerId);
    if (runtime) params.set('runtime', runtime);
    return this.requestFor(connectionId, 'GET', `/api/systems/${systemId}/files/download?${params}`);
  }

  async uploadFileFor(connectionId: string, systemId: string, remotePath: string, content: string, containerId?: string, runtime?: string): Promise<void> {
    await this.requestFor(connectionId, 'POST', `/api/systems/${systemId}/files/upload`, { remotePath, content, containerId, runtime });
  }

  // ==========================================================================
  // K8s Pod File Operations
  // ==========================================================================

  private podFilePath(clusterId: string, ns: string, pod: string, op: string): string {
    return `/api/clusters/${clusterId}/namespaces/${ns}/pods/${pod}/files/${op}`;
  }

  async listPodDirectoryFor(connectionId: string, clusterId: string, ns: string, pod: string, path: string, container?: string): Promise<DirectoryListing> {
    const params = new URLSearchParams({ path });
    if (container) params.set('container', container);
    return this.requestFor<DirectoryListing>(connectionId, 'GET', `${this.podFilePath(clusterId, ns, pod, 'list')}?${params}`);
  }

  async readPodFileFor(connectionId: string, clusterId: string, ns: string, pod: string, path: string, container?: string): Promise<FileContent> {
    const params = new URLSearchParams({ path });
    if (container) params.set('container', container);
    return this.requestFor<FileContent>(connectionId, 'GET', `${this.podFilePath(clusterId, ns, pod, 'read')}?${params}`);
  }

  async writePodFileFor(connectionId: string, clusterId: string, ns: string, pod: string, path: string, content: string, container?: string): Promise<void> {
    await this.requestFor(connectionId, 'POST', this.podFilePath(clusterId, ns, pod, 'write'), { path, content, container });
  }

  async createPodDirectoryFor(connectionId: string, clusterId: string, ns: string, pod: string, path: string, container?: string): Promise<void> {
    await this.requestFor(connectionId, 'POST', this.podFilePath(clusterId, ns, pod, 'mkdir'), { path, container });
  }

  async deletePodPathFor(connectionId: string, clusterId: string, ns: string, pod: string, path: string, isDirectory: boolean, container?: string): Promise<void> {
    await this.requestFor(connectionId, 'DELETE', this.podFilePath(clusterId, ns, pod, 'delete'), { path, isDirectory, container });
  }

  async renamePodPathFor(connectionId: string, clusterId: string, ns: string, pod: string, oldPath: string, newPath: string, container?: string): Promise<void> {
    await this.requestFor(connectionId, 'POST', this.podFilePath(clusterId, ns, pod, 'rename'), { oldPath, newPath, container });
  }

  async downloadPodFileFor(connectionId: string, clusterId: string, ns: string, pod: string, path: string, container?: string): Promise<{ path: string; content: string }> {
    const params = new URLSearchParams({ path });
    if (container) params.set('container', container);
    return this.requestFor(connectionId, 'GET', `${this.podFilePath(clusterId, ns, pod, 'download')}?${params}`);
  }

  async uploadPodFileFor(connectionId: string, clusterId: string, ns: string, pod: string, remotePath: string, content: string, container?: string): Promise<void> {
    await this.requestFor(connectionId, 'POST', this.podFilePath(clusterId, ns, pod, 'upload'), { remotePath, content, container });
  }

  // ==========================================================================
  // Terminal WebSocket (per-connection)
  // ==========================================================================

  /** Get WebSocket URL and token for a terminal session on a backend system. */
  getTerminalWsUrl(connectionId: string, systemId: string): { url: string; token: string } | null {
    const conn = this.getConnection(connectionId);
    if (!conn?.tokens?.accessToken) return null;

    const serverUrl = conn.serverUrl;
    const wsProtocol = serverUrl.startsWith('https') ? 'wss' : 'ws';
    const host = serverUrl.replace(/^https?:\/\//, '');
    const url = `${wsProtocol}://${host}/api/ws/terminal/${systemId}`;
    return { url, token: conn.tokens.accessToken };
  }

  // ==========================================================================
  // Kubernetes (per-connection)
  // ==========================================================================

  async listClustersInEnvironmentFor(connectionId: string, projectId: string, environmentId: string): Promise<K8sCluster[]> {
    return this.requestFor<K8sCluster[]>(
      connectionId, 'GET', `/api/projects/${projectId}/environments/${environmentId}/clusters`
    );
  }

  /** List all clusters across all projects and environments for a connection */
  async listAllClustersFor(connectionId: string): Promise<K8sCluster[]> {
    const conn = this.getConnection(connectionId);
    if (!conn) return [];
    const allClusters: K8sCluster[] = [];
    for (const project of conn.projects) {
      try {
        const envs = await this.listEnvironmentsFor(connectionId, project.id);
        for (const env of envs) {
          try {
            const clusters = await this.listClustersInEnvironmentFor(connectionId, project.id, env.id);
            allClusters.push(...clusters);
          } catch { /* skip environments we can't access */ }
        }
      } catch { /* skip projects we can't access */ }
    }
    return allClusters;
  }

  async createClusterInEnvironmentFor(connectionId: string, projectId: string, environmentId: string, data: { name: string; kubeconfig: string; contextName?: string }): Promise<K8sCluster> {
    return this.requestFor<K8sCluster>(
      connectionId, 'POST', `/api/projects/${projectId}/environments/${environmentId}/clusters`, data
    );
  }

  async deleteClusterFor(connectionId: string, id: string): Promise<void> {
    await this.requestFor(connectionId, 'DELETE', `/api/clusters/${id}`);
  }

  async testClusterFor(connectionId: string, id: string): Promise<{ status: string; version?: string }> {
    return this.requestFor(connectionId, 'POST', `/api/clusters/${id}/test`);
  }

  async updateClusterFor(connectionId: string, clusterId: string, data: { name?: string; kubeconfig?: string; contextName?: string }): Promise<K8sCluster> {
    return this.requestFor<K8sCluster>(connectionId, 'PUT', `/api/clusters/${clusterId}`, data);
  }

  // ---------- Generic K8s resource methods ----------

  /** List any K8s resource kind. Returns raw k8s-openapi JSON arrays. */
  async listK8sResourcesFor(connectionId: string, clusterId: string, kind: string, namespace?: string): Promise<any[]> {
    const params = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
    return this.requestFor<any[]>(connectionId, 'GET', `/api/clusters/${clusterId}/resources/${kind}${params}`);
  }

  /** Get a single K8s resource by name. Returns raw k8s-openapi JSON. */
  async getK8sResourceFor(connectionId: string, clusterId: string, kind: string, name: string, namespace?: string): Promise<any> {
    const params = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
    return this.requestFor<any>(connectionId, 'GET', `/api/clusters/${clusterId}/resources/${kind}/${name}${params}`);
  }

  /** Delete a K8s resource by name. */
  async deleteK8sResourceFor(connectionId: string, clusterId: string, kind: string, name: string, namespace?: string): Promise<void> {
    const params = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
    await this.requestFor(connectionId, 'DELETE', `/api/clusters/${clusterId}/resources/${kind}/${name}${params}`);
  }

  // ---------- Typed K8s resource methods (mapped from generic) ----------

  async listNamespacesFor(connectionId: string, clusterId: string): Promise<K8sNamespace[]> {
    const raw = await this.listK8sResourcesFor(connectionId, clusterId, 'namespaces');
    return raw.map(mapNamespace);
  }

  async listPodsFor(connectionId: string, clusterId: string, namespace: string): Promise<K8sPod[]> {
    const raw = await this.listK8sResourcesFor(connectionId, clusterId, 'pods', namespace);
    return raw.map(mapPod);
  }

  async listDeploymentsFor(connectionId: string, clusterId: string, namespace: string): Promise<K8sDeployment[]> {
    const raw = await this.listK8sResourcesFor(connectionId, clusterId, 'deployments', namespace);
    return raw.map(mapDeployment);
  }

  async listServicesFor(connectionId: string, clusterId: string, namespace: string): Promise<K8sService[]> {
    const raw = await this.listK8sResourcesFor(connectionId, clusterId, 'services', namespace);
    return raw.map(mapService);
  }

  async scaleDeploymentFor(connectionId: string, clusterId: string, namespace: string, name: string, replicas: number): Promise<void> {
    await this.requestFor(connectionId, 'POST', `/api/clusters/${clusterId}/namespaces/${namespace}/deployments/${name}/scale`, { replicas });
  }

  async restartDeploymentFor(connectionId: string, clusterId: string, namespace: string, name: string): Promise<void> {
    await this.requestFor(connectionId, 'POST', `/api/clusters/${clusterId}/namespaces/${namespace}/deployments/${name}/restart`);
  }

  // ---------- StatefulSet operations ----------

  async scaleStatefulSetFor(connectionId: string, clusterId: string, namespace: string, name: string, replicas: number): Promise<void> {
    await this.requestFor(connectionId, 'POST', `/api/clusters/${clusterId}/namespaces/${namespace}/statefulsets/${name}/scale`, { replicas });
  }

  async restartStatefulSetFor(connectionId: string, clusterId: string, namespace: string, name: string): Promise<void> {
    await this.requestFor(connectionId, 'POST', `/api/clusters/${clusterId}/namespaces/${namespace}/statefulsets/${name}/restart`);
  }

  // ---------- DaemonSet operations ----------

  async restartDaemonSetFor(connectionId: string, clusterId: string, namespace: string, name: string): Promise<void> {
    await this.requestFor(connectionId, 'POST', `/api/clusters/${clusterId}/namespaces/${namespace}/daemonsets/${name}/restart`);
  }

  // ---------- Pod logs ----------

  async getPodLogsFor(
    connectionId: string, clusterId: string, namespace: string, pod: string,
    opts?: { container?: string; tailLines?: number; sinceSeconds?: number; previous?: boolean; timestamps?: boolean }
  ): Promise<{ logs: string; container?: string }> {
    const params = new URLSearchParams();
    if (opts?.container) params.set('container', opts.container);
    if (opts?.tailLines != null) params.set('tailLines', String(opts.tailLines));
    if (opts?.sinceSeconds != null) params.set('sinceSeconds', String(opts.sinceSeconds));
    if (opts?.previous) params.set('previous', 'true');
    if (opts?.timestamps) params.set('timestamps', 'true');
    const qs = params.toString();
    return this.requestFor(connectionId, 'GET',
      `/api/clusters/${clusterId}/namespaces/${namespace}/pods/${pod}/logs${qs ? `?${qs}` : ''}`
    );
  }

  /** Returns the full SSE URL and auth token for streaming pod logs via fetch+ReadableStream */
  getLogStreamInfo(
    connectionId: string, clusterId: string, namespace: string, pod: string,
    opts?: { container?: string; tailLines?: number; previous?: boolean; timestamps?: boolean }
  ): { url: string; token: string } | null {
    const conn = this.getConnection(connectionId);
    if (!conn?.tokens?.accessToken) return null;
    const params = new URLSearchParams();
    if (opts?.container) params.set('container', opts.container);
    if (opts?.tailLines != null) params.set('tailLines', String(opts.tailLines));
    if (opts?.previous) params.set('previous', 'true');
    if (opts?.timestamps) params.set('timestamps', 'true');
    const qs = params.toString();
    return {
      url: `${conn.serverUrl}/api/clusters/${clusterId}/namespaces/${namespace}/pods/${pod}/logs/stream${qs ? `?${qs}` : ''}`,
      token: conn.tokens.accessToken,
    };
  }

  // ---------- Resource events ----------

  async getResourceEventsFor(connectionId: string, clusterId: string, namespace: string, kind: string, name: string): Promise<any[]> {
    const fieldSelector = `involvedObject.name=${name},involvedObject.kind=${kind}`;
    const params = `?namespace=${encodeURIComponent(namespace)}&fieldSelector=${encodeURIComponent(fieldSelector)}`;
    return this.requestFor<any[]>(connectionId, 'GET', `/api/clusters/${clusterId}/resources/events${params}`);
  }

  // ---------- Topology ----------

  async getNamespaceTopologyFor(connectionId: string, clusterId: string, namespace: string): Promise<import('../models/backend.model').K8sTopology> {
    return this.requestFor(connectionId, 'GET', `/api/clusters/${clusterId}/namespaces/${namespace}/topology`);
  }

  // ---------- Node management ----------

  async cordonNodeFor(connectionId: string, clusterId: string, node: string): Promise<void> {
    await this.requestFor(connectionId, 'POST', `/api/clusters/${clusterId}/nodes/${node}/cordon`);
  }

  async uncordonNodeFor(connectionId: string, clusterId: string, node: string): Promise<void> {
    await this.requestFor(connectionId, 'POST', `/api/clusters/${clusterId}/nodes/${node}/uncordon`);
  }

  async drainNodeFor(connectionId: string, clusterId: string, node: string, force?: boolean): Promise<{ status: string; evicted: number; errors?: string[] }> {
    return this.requestFor(connectionId, 'POST', `/api/clusters/${clusterId}/nodes/${node}/drain`, force ? { force: true } : undefined);
  }

  // ---------- YAML apply ----------

  async applyYamlFor(connectionId: string, clusterId: string, yaml: string, namespace?: string): Promise<any> {
    return this.requestFor(connectionId, 'POST', `/api/clusters/${clusterId}/apply`, { namespace, yaml });
  }

  // ---------- CRD Discovery ----------

  async discoverApiResourcesFor(connectionId: string, clusterId: string): Promise<K8sApiResource[]> {
    return this.requestFor(connectionId, 'GET', `/api/clusters/${clusterId}/discovery`);
  }

  async listCustomResourcesFor(connectionId: string, clusterId: string, group: string, version: string, plural: string, namespace?: string): Promise<any[]> {
    const params = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
    return this.requestFor(connectionId, 'GET', `/api/clusters/${clusterId}/custom/${group}/${version}/${plural}${params}`);
  }

  async getCustomResourceFor(connectionId: string, clusterId: string, group: string, version: string, plural: string, name: string, namespace?: string): Promise<any> {
    const params = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
    return this.requestFor(connectionId, 'GET', `/api/clusters/${clusterId}/custom/${group}/${version}/${plural}/${name}${params}`);
  }

  async deleteCustomResourceFor(connectionId: string, clusterId: string, group: string, version: string, plural: string, name: string, namespace?: string): Promise<void> {
    const params = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
    await this.requestFor(connectionId, 'DELETE', `/api/clusters/${clusterId}/custom/${group}/${version}/${plural}/${name}${params}`);
  }

  async applyCustomResourceFor(connectionId: string, clusterId: string, group: string, version: string, plural: string, yaml: string, namespace?: string): Promise<any> {
    return this.requestFor(connectionId, 'POST', `/api/clusters/${clusterId}/custom/${group}/${version}/${plural}/apply`, { namespace, yaml });
  }

  // ---------- K8s exec WebSocket ----------

  getK8sExecWsUrl(connectionId: string, clusterId: string): { url: string; token: string } | null {
    const conn = this.getConnection(connectionId);
    if (!conn?.tokens?.accessToken) return null;
    const serverUrl = conn.serverUrl;
    const wsProtocol = serverUrl.startsWith('https') ? 'wss' : 'ws';
    const host = serverUrl.replace(/^https?:\/\//, '');
    return {
      url: `${wsProtocol}://${host}/api/ws/k8s-exec/${clusterId}`,
      token: conn.tokens.accessToken,
    };
  }

  // ---------- K8s watch WebSocket ----------

  getK8sWatchWsUrl(connectionId: string, clusterId: string): { url: string; token: string } | null {
    const conn = this.getConnection(connectionId);
    if (!conn?.tokens?.accessToken) return null;
    const serverUrl = conn.serverUrl;
    const wsProtocol = serverUrl.startsWith('https') ? 'wss' : 'ws';
    const host = serverUrl.replace(/^https?:\/\//, '');
    return {
      url: `${wsProtocol}://${host}/api/ws/k8s-watch/${clusterId}`,
      token: conn.tokens.accessToken,
    };
  }

  // ==========================================================================
  // Audit (per-connection)
  // ==========================================================================

  async getAuditLogsFor(connectionId: string, projectId: string, params?: {
    limit?: number;
    offset?: number;
    action?: string;
    resourceType?: string;
    userId?: string;
    from?: string;
    to?: string;
  }): Promise<AuditLogEntry[]> {
    const query = new URLSearchParams();
    if (params?.limit != null) query.set('limit', String(params.limit));
    if (params?.offset != null) query.set('offset', String(params.offset));
    if (params?.action) query.set('action', params.action);
    if (params?.resourceType) query.set('resourceType', params.resourceType);
    if (params?.userId) query.set('userId', params.userId);
    if (params?.from) query.set('from', params.from);
    if (params?.to) query.set('to', params.to);
    const qs = query.toString();
    return this.requestFor<AuditLogEntry[]>(connectionId, 'GET', `/api/projects/${projectId}/audit${qs ? `?${qs}` : ''}`);
  }

  // ==========================================================================
  // System Ownership Tracking
  // ==========================================================================

  registerSystem(systemId: string, connectionId: string): void {
    this._systemOwnership.set(systemId, connectionId);
  }

  getBackendForSystem(systemId: string): string | undefined {
    return this._systemOwnership.get(systemId);
  }

  isBackendSystem(systemId: string): boolean {
    return this._systemOwnership.has(systemId);
  }

  // ==========================================================================
  // Legacy compatibility — delegates to first connected backend
  // These are used by existing components (org-management, k8s-dashboard, audit-log)
  // ==========================================================================

  get mode(): 'local' | 'backend' {
    return this.isBackendMode() ? 'backend' : 'local';
  }

  async connectToBackend(serverUrl: string): Promise<void> {
    await this.addBackend(serverUrl);
  }

  async login(req: LoginRequest): Promise<void> {
    const conn = this.getLatestConnection();
    if (!conn) throw new Error('No backend connection');
    await this.loginToBackend(conn.id, req);
  }

  async register(req: RegisterRequest): Promise<void> {
    const conn = this.getLatestConnection();
    if (!conn) throw new Error('No backend connection');
    await this.registerOnBackend(conn.id, req);
  }

  logout(): void {
    const conn = this.connectedBackends()[0];
    if (conn) this.logoutFrom(conn.id);
  }

  // ==========================================================================
  // HTTP helpers
  // ==========================================================================

  async requestFor<T>(connectionId: string, method: string, path: string, body?: unknown): Promise<T> {
    const conn = this.getConnection(connectionId);
    if (!conn) throw new Error(`Backend connection ${connectionId} not found`);

    const url = `${conn.serverUrl}${path}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (conn.tokens?.accessToken) {
      headers['Authorization'] = `Bearer ${conn.tokens.accessToken}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    let resp: Response;
    try {
      resp = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timeoutId);
      // Server unreachable — mark disconnected so reconnect loop picks it up
      if (conn.status === 'connected') {
        this.updateConnection(connectionId, {
          status: 'disconnected',
          errorReason: 'server_unreachable',
        });
      }
      if (e instanceof Error && e.name === 'AbortError') {
        throw new Error(`Request to ${path} timed out`);
      }
      throw e;
    } finally {
      clearTimeout(timeoutId);
    }

    // Handle token expiry — try refresh (serialized to prevent concurrent refreshes)
    if (resp.status === 401 && conn.tokens?.refreshToken) {
      // Step 1: Refresh the token — disconnect only if refresh itself fails
      try {
        let refreshPromise = this._refreshPromises.get(connectionId);
        if (!refreshPromise) {
          refreshPromise = this.refreshTokenFor(connectionId).finally(() => {
            this._refreshPromises.delete(connectionId);
          });
          this._refreshPromises.set(connectionId, refreshPromise);
        }
        await refreshPromise;
      } catch (refreshError) {
        console.warn('Token refresh failed:', refreshError);
        // Keep refresh token so the reconnect loop can retry later. If refreshTokenFor
        // already identified this as an expired refresh token it will have set the
        // reason on the connection — preserve it; otherwise default to unreachable.
        const currentConn = this.getConnection(connectionId);
        const refreshToken = currentConn?.tokens?.refreshToken ?? null;
        this.updateConnection(connectionId, {
          tokens: refreshToken ? { accessToken: '', refreshToken } : null,
          user: null,
          projectPermissions: {},
          status: 'disconnected',
          errorReason: currentConn?.errorReason ?? 'server_unreachable',
        });
        this.persistConnections();
        throw new Error('Session expired. Reconnecting automatically...');
      }

      // Step 2: Retry with the new token — failures here are normal errors, NOT session expiry
      const refreshed = this.getConnection(connectionId);
      if (refreshed?.tokens?.accessToken) {
        headers['Authorization'] = `Bearer ${refreshed.tokens.accessToken}`;
      }
      const retryController = new AbortController();
      const retryTimeoutId = setTimeout(() => retryController.abort(), 30000);
      let retry: Response;
      try {
        retry = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: retryController.signal,
        });
      } catch (e) {
        clearTimeout(retryTimeoutId);
        if (e instanceof Error && e.name === 'AbortError') {
          throw new Error(`Request to ${path} timed out`);
        }
        throw e;
      } finally {
        clearTimeout(retryTimeoutId);
      }
      if (!retry.ok) {
        const err = await retry.json().catch(() => ({ error: retry.statusText }));
        throw new Error(err.error || retry.statusText);
      }
      const retryText = await retry.text();
      if (!retryText) return undefined as unknown as T;
      return JSON.parse(retryText) as T;
    }

    // CON-126 §4.7 stop-gap: on 403 the server told us the user's permissions
    // no longer include this action. Flush the cached permissions and refetch
    // so subsequent navigation reflects reality; the original request still
    // fails (we don't retry it — the user may have lost access deliberately).
    if (resp.status === 403) {
      this.schedulePermissionRefreshFor(connectionId, /* fromDenial */ true);
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      throw new Error(err.error || resp.statusText);
    }

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      throw new Error(err.error || resp.statusText);
    }

    const text = await resp.text();
    if (!text) return undefined as unknown as T;
    return JSON.parse(text) as T;
  }

  /**
   * CON-126 §4.7: refetch `/auth/me` + project permissions after a permission
   * event (403 response, manual refresh, or — once CON-122 lands — a server
   * push). Coalesces concurrent calls per-connection so a burst of 403s still
   * only causes one round-trip.
   */
  refreshPermissionsFor(connectionId: string): Promise<void> {
    return this.schedulePermissionRefreshFor(connectionId, false);
  }

  private schedulePermissionRefreshFor(
    connectionId: string,
    fromDenial: boolean,
  ): Promise<void> {
    const existing = this._permissionRefreshPromises.get(connectionId);
    if (existing) return existing;

    const conn = this.getConnection(connectionId);
    if (!conn || conn.status !== 'connected') return Promise.resolve();

    if (fromDenial && this.toast) {
      this.toast.info('Your permissions changed — refreshing.');
    }

    // Flush cached permissions synchronously so callers making back-to-back
    // checks don't see stale positives while the refetch is in flight.
    this.updateConnection(connectionId, { projectPermissions: {} });

    const task = (async () => {
      try {
        const user = await this.requestFor<UserProfile>(connectionId, 'GET', '/api/auth/me');
        this.updateConnection(connectionId, { user });
        await this.loadProjectsFor(connectionId);
      } catch (err) {
        console.warn('Permission refresh failed:', err);
      }
    })().finally(() => {
      this._permissionRefreshPromises.delete(connectionId);
    });

    this._permissionRefreshPromises.set(connectionId, task);
    return task;
  }

  /**
   * CON-126 §4.7: the caller just performed a role/ACL mutation from this
   * client, so the *current* user's permissions may have changed. Show the
   * in-page banner so they can opt into a refresh. We intentionally don't
   * auto-refresh — role edits are infrequent, and a surprise signal flip in
   * the middle of a review flow is jarring.
   */
  notifyLocalPermissionEdit(connectionId: string): void {
    this.permissionBanner?.show(connectionId);
  }

  async refreshTokenFor(connectionId: string): Promise<void> {
    const conn = this.getConnection(connectionId);
    if (!conn?.tokens?.refreshToken) throw new Error('No refresh token');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const resp = await fetch(`${conn.serverUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: conn.tokens.refreshToken }),
        signal: controller.signal,
      });

      if (resp.status === 401) {
        // Refresh token itself is expired/revoked — clear everything
        this.updateConnection(connectionId, {
          tokens: null,
          user: null,
          projectPermissions: {},
          status: 'disconnected',
          errorReason: 'refresh_token_expired',
        });
        this.persistConnections();
        throw new Error('Refresh token expired');
      }
      if (!resp.ok) throw new Error('Token refresh failed');
      const data: AuthTokens = await resp.json();
      this.updateConnection(connectionId, { tokens: data });
      this.persistConnections();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ==========================================================================
  // Internal helpers (also used by BackendAuthService)
  // ==========================================================================

  updateConnection(connectionId: string, updates: Partial<BackendConnection>): void {
    this._connections.update(list =>
      list.map(c => c.id === connectionId ? { ...c, ...updates } : c)
    );
  }

  // ==========================================================================
  // Persistence (Tauri SQLite + keyring vault)
  // ==========================================================================

  persistConnections(): void {
    for (const c of this._connections()) {
      invoke('save_backend_connection', {
        id: c.id,
        serverUrl: c.serverUrl,
        label: c.label,
        accessToken: c.tokens?.accessToken ?? null,
        refreshToken: c.tokens?.refreshToken ?? null,
      }).catch(err => console.warn('Failed to persist backend connection:', err));
    }
  }

  private async loadPersistedConnections(): Promise<void> {
    try {
      const saved = await invoke<{
        id: string;
        serverUrl: string;
        label: string;
        accessToken: string | null;
        refreshToken: string | null;
      }[]>('list_backend_connections');

      if (saved.length === 0) {
        // No Tauri-persisted connections — try migrating from sessionStorage/localStorage
        this.migrateFromWebStorage();
        return;
      }

      const connections: BackendConnection[] = saved.map(s => {
        const hasTokens = !!(s.accessToken && s.refreshToken);
        return {
          id: s.id,
          serverUrl: s.serverUrl,
          label: s.label,
          tokens: hasTokens ? { accessToken: s.accessToken!, refreshToken: s.refreshToken! } : null,
          user: null,
          projects: [],
          projectPermissions: {},
          status: hasTokens ? 'connecting' as const : 'disconnected' as const,
          errorReason: null,
        };
      });
      this._connections.set(connections);

      // Auto-reconnect connections that have tokens
      const reconnectPromises: Promise<void>[] = [];
      for (const conn of connections) {
        if (conn.tokens) {
          reconnectPromises.push(this.autoReconnect(conn.id));
        }
      }
      await Promise.all(reconnectPromises);
    } catch {
      // Tauri invoke failed — fall back to web storage migration
      this.migrateFromWebStorage();
    }
  }

  /** Migrate from sessionStorage/localStorage (pre-persistence upgrade) into Tauri storage. */
  private migrateFromWebStorage(): void {
    try {
      const sessionStr = sessionStorage.getItem(STORAGE_KEY);
      const localStr = localStorage.getItem(STORAGE_KEY);
      const str = sessionStr || localStr;
      if (!str) {
        // Also try the very old single-connection format
        this.migrateOldConfig();
        return;
      }
      const saved: SavedBackendConnection[] = JSON.parse(str);
      const connections: BackendConnection[] = saved.map(s => ({
        ...s,
        tokens: s.tokens ?? null,
        user: null,
        projects: [],
        projectPermissions: {},
        status: s.tokens ? 'connecting' as const : 'disconnected' as const,
        errorReason: null,
      }));
      this._connections.set(connections);

      // Persist to Tauri storage and clean up web storage
      this.persistConnections();
      sessionStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_KEY);

      // Auto-reconnect each connection that has tokens
      const reconnectPromises: Promise<void>[] = [];
      for (const conn of connections) {
        if (conn.tokens) {
          reconnectPromises.push(this.autoReconnect(conn.id));
        }
      }
      this._readyPromise = Promise.all(reconnectPromises).then(() => {});
    } catch {
      // Ignore corrupt web storage
    }
  }

  /** Migrate from the very old single-connection localStorage keys */
  private migrateOldConfig(): void {
    try {
      const configStr = localStorage.getItem('containerus_backend_config');
      if (!configStr) return;
      const config = JSON.parse(configStr);
      if (config.mode !== 'backend' || !config.serverUrl) return;

      const tokensStr = localStorage.getItem('containerus_auth_tokens');
      const tokens = tokensStr ? JSON.parse(tokensStr) : null;
      const conn: BackendConnection = {
        id: crypto.randomUUID(),
        serverUrl: config.serverUrl,
        label: (() => { try { return new URL(config.serverUrl).hostname; } catch { return config.serverUrl; } })(),
        tokens,
        user: null,
        projects: [],
        projectPermissions: {},
        status: tokens ? 'connecting' : 'disconnected',
        errorReason: null,
      };

      this._connections.set([conn]);
      this.persistConnections();

      // Clean up old keys
      localStorage.removeItem('containerus_backend_config');
      localStorage.removeItem('containerus_auth_tokens');
      localStorage.removeItem('containerus_active_org');

      if (tokens) {
        this._readyPromise = this.autoReconnect(conn.id);
      }
    } catch {
      // Ignore migration errors
    }
  }

  private async autoReconnect(connectionId: string): Promise<void> {
    try {
      await this.refreshTokenFor(connectionId);
      // Load user profile
      const user = await this.requestFor<UserProfile>(connectionId, 'GET', '/api/auth/me');
      this.updateConnection(connectionId, { user, status: 'connected', errorReason: null });
      await this.loadProjectsFor(connectionId);
    } catch (err) {
      console.warn('Auto-reconnect failed:', err);
      // Keep refresh token so the periodic reconnect loop can retry.
      // Preserve any errorReason set by refreshTokenFor (e.g. refresh_token_expired).
      const conn = this.getConnection(connectionId);
      const refreshToken = conn?.tokens?.refreshToken ?? null;
      this.updateConnection(connectionId, {
        tokens: refreshToken ? { accessToken: '', refreshToken } : null,
        user: null,
        projectPermissions: {},
        status: 'disconnected',
        errorReason: conn?.errorReason ?? 'server_unreachable',
      });
      this.persistConnections();
    }
  }
}
