import { Injectable, signal, computed } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
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
  K8sCluster,
  K8sDeployment,
  K8sNamespace,
  K8sPod,
  K8sService,
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
  AuditLogEntry,
} from '../models/backend.model';
import { Container } from '../models/container.model';
import { ContainerImage } from '../models/image.model';
import { Volume } from '../models/volume.model';
import { Network } from '../models/network.model';
import { DirectoryListing, FileContent } from '../models/file-browser.model';
import { ExtendedSystemInfo, LiveSystemMetrics } from '../models/system.model';

const STORAGE_KEY = 'containerus_backend_connections';

@Injectable({ providedIn: 'root' })
export class BackendService {
  private _connections = signal<BackendConnection[]>([]);

  /** Map systemId → connectionId for routing actions to the correct backend */
  private _systemOwnership = new Map<string, string>();

  /** Serializes concurrent token refresh attempts per connection */
  private _refreshPromises = new Map<string, Promise<void>>();

  /** Resolves when all auto-reconnect attempts are complete */
  private _readyPromise: Promise<void> = Promise.resolve();

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
  }

  /** Wait for all auto-reconnect attempts to complete. */
  waitForReady(): Promise<void> {
    return this._readyPromise;
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
      label: label || new URL(url).hostname,
      tokens: null,
      user: null,
      projects: [],
      projectPermissions: {},
      status: 'disconnected',
    };

    this._connections.update(list => [...list, conn]);
    this.persistConnections();
    return id;
  }

  /** Remove a backend connection entirely. */
  removeBackend(connectionId: string): void {
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
    this.updateConnection(connectionId, { status: 'connecting' });
    try {
      const data = await this.requestFor<AuthTokens & { user: UserProfile }>(
        connectionId, 'POST', '/api/auth/login', req
      );
      this.updateConnection(connectionId, {
        tokens: { accessToken: data.accessToken, refreshToken: data.refreshToken },
        user: data.user,
        status: 'connected',
      });
      this.persistConnections();
      await this.loadProjectsFor(connectionId);
    } catch (e) {
      this.updateConnection(connectionId, { status: 'error' });
      throw e;
    }
  }

  async registerOnBackend(connectionId: string, req: RegisterRequest): Promise<void> {
    this.updateConnection(connectionId, { status: 'connecting' });
    try {
      const data = await this.requestFor<AuthTokens & { user: UserProfile }>(
        connectionId, 'POST', '/api/auth/register', req
      );
      this.updateConnection(connectionId, {
        tokens: { accessToken: data.accessToken, refreshToken: data.refreshToken },
        user: data.user,
        status: 'connected',
      });
      this.persistConnections();
      await this.loadProjectsFor(connectionId);
    } catch (e) {
      this.updateConnection(connectionId, { status: 'error' });
      throw e;
    }
  }

  logoutFrom(connectionId: string): void {
    for (const [sysId, connId] of this._systemOwnership) {
      if (connId === connectionId) this._systemOwnership.delete(sysId);
    }
    this.updateConnection(connectionId, {
      tokens: null,
      user: null,
      projects: [],
      projectPermissions: {},
      status: 'disconnected',
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
  }

  async removeMemberFor(connectionId: string, projectId: string, userId: string): Promise<void> {
    await this.requestFor(connectionId, 'DELETE', `/api/projects/${projectId}/members/${userId}`);
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
    return this.requestFor<Role>(connectionId, 'PUT', `/api/roles/${roleId}`, data);
  }

  async deleteRoleFor(connectionId: string, roleId: string): Promise<void> {
    await this.requestFor(connectionId, 'DELETE', `/api/roles/${roleId}`);
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

  async createAclFor(connectionId: string, projectId: string, data: { userId: string; resourceType: string; resourceId: string; roleId?: string; extraPermissions: string[]; deniedPermissions: string[] }): Promise<ResourceAcl> {
    return this.requestFor<ResourceAcl>(connectionId, 'POST', `/api/projects/${projectId}/acls`, data);
  }

  async updateAclFor(connectionId: string, projectId: string, aclId: string, data: { roleId?: string; extraPermissions?: string[]; deniedPermissions?: string[] }): Promise<ResourceAcl> {
    return this.requestFor<ResourceAcl>(connectionId, 'PUT', `/api/projects/${projectId}/acls/${aclId}`, data);
  }

  async deleteAclFor(connectionId: string, projectId: string, aclId: string): Promise<void> {
    await this.requestFor(connectionId, 'DELETE', `/api/projects/${projectId}/acls/${aclId}`);
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

    const serverUrl = conn.serverUrl;
    const wsProtocol = serverUrl.startsWith('https') ? 'wss' : 'ws';
    const host = serverUrl.replace(/^https?:\/\//, '');
    const url = `${wsProtocol}://${host}/api/ws/tunnel/${systemId}`;
    return { url, token: conn.tokens.accessToken };
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

  async listNamespacesFor(connectionId: string, clusterId: string): Promise<K8sNamespace[]> {
    return this.requestFor<K8sNamespace[]>(connectionId, 'GET', `/api/clusters/${clusterId}/namespaces`);
  }

  async listPodsFor(connectionId: string, clusterId: string, namespace: string): Promise<K8sPod[]> {
    return this.requestFor<K8sPod[]>(connectionId, 'GET', `/api/clusters/${clusterId}/namespaces/${namespace}/pods`);
  }

  async listDeploymentsFor(connectionId: string, clusterId: string, namespace: string): Promise<K8sDeployment[]> {
    return this.requestFor<K8sDeployment[]>(connectionId, 'GET', `/api/clusters/${clusterId}/namespaces/${namespace}/deployments`);
  }

  async scaleDeploymentFor(connectionId: string, clusterId: string, namespace: string, name: string, replicas: number): Promise<void> {
    await this.requestFor(connectionId, 'POST', `/api/clusters/${clusterId}/namespaces/${namespace}/deployments/${name}/scale`, { replicas });
  }

  async listServicesFor(connectionId: string, clusterId: string, namespace: string): Promise<K8sService[]> {
    return this.requestFor<K8sService[]>(connectionId, 'GET', `/api/clusters/${clusterId}/namespaces/${namespace}/services`);
  }

  // ==========================================================================
  // Audit (per-connection)
  // ==========================================================================

  async getAuditLogsFor(connectionId: string, projectId: string, params?: { limit?: number; offset?: number; action?: string }): Promise<AuditLogEntry[]> {
    const query = new URLSearchParams();
    if (params?.limit != null) query.set('limit', String(params.limit));
    if (params?.offset != null) query.set('offset', String(params.offset));
    if (params?.action) query.set('action', params.action);
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

  async loadProjects(): Promise<Project[]> {
    const conn = this.connectedBackends()[0];
    if (!conn) return [];
    return this.loadProjectsFor(conn.id);
  }

  async createProject(data: { name: string; slug: string; description?: string }): Promise<Project> {
    const conn = this.connectedBackends()[0];
    if (!conn) throw new Error('No backend connection');
    return this.createProjectFor(conn.id, data);
  }

  async getProjectMembers(projectId: string): Promise<ProjectMember[]> {
    const conn = this.connectedBackends()[0];
    if (!conn) return [];
    return this.getProjectMembersFor(conn.id, projectId);
  }

  async inviteMember(projectId: string, req: InviteMemberRequest): Promise<void> {
    const conn = this.connectedBackends()[0];
    if (!conn) throw new Error('No backend connection');
    await this.inviteMemberFor(conn.id, projectId, req);
  }

  async listSystems(): Promise<BackendSystem[]> {
    const conn = this.connectedBackends()[0];
    if (!conn) return [];
    return this.listAllSystemsFor(conn.id);
  }

  async deleteCluster(id: string): Promise<void> {
    const conn = this.connectedBackends()[0];
    if (!conn) throw new Error('No backend connection');
    await this.deleteClusterFor(conn.id, id);
  }

  async testCluster(id: string): Promise<{ status: string; version?: string }> {
    const conn = this.connectedBackends()[0];
    if (!conn) throw new Error('No backend connection');
    return this.testClusterFor(conn.id, id);
  }

  async listNamespaces(clusterId: string): Promise<K8sNamespace[]> {
    const conn = this.connectedBackends()[0];
    if (!conn) return [];
    return this.listNamespacesFor(conn.id, clusterId);
  }

  async listPods(clusterId: string, namespace: string): Promise<K8sPod[]> {
    const conn = this.connectedBackends()[0];
    if (!conn) return [];
    return this.listPodsFor(conn.id, clusterId, namespace);
  }

  async listDeployments(clusterId: string, namespace: string): Promise<K8sDeployment[]> {
    const conn = this.connectedBackends()[0];
    if (!conn) return [];
    return this.listDeploymentsFor(conn.id, clusterId, namespace);
  }

  async scaleDeployment(clusterId: string, namespace: string, name: string, replicas: number): Promise<void> {
    const conn = this.connectedBackends()[0];
    if (!conn) throw new Error('No backend connection');
    await this.scaleDeploymentFor(conn.id, clusterId, namespace, name, replicas);
  }

  async listServices(clusterId: string, namespace: string): Promise<K8sService[]> {
    const conn = this.connectedBackends()[0];
    if (!conn) return [];
    return this.listServicesFor(conn.id, clusterId, namespace);
  }

  async getAuditLogs(projectId: string, params?: { limit?: number; offset?: number; action?: string }): Promise<AuditLogEntry[]> {
    const conn = this.connectedBackends()[0];
    if (!conn) return [];
    return this.getAuditLogsFor(conn.id, projectId, params);
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
        this.updateConnection(connectionId, { tokens: null, user: null, projectPermissions: {}, status: 'disconnected' });
        this.persistConnections();
        throw new Error('Session expired. Please login again.');
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

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      throw new Error(err.error || resp.statusText);
    }

    const text = await resp.text();
    if (!text) return undefined as unknown as T;
    return JSON.parse(text) as T;
  }

  private async refreshTokenFor(connectionId: string): Promise<void> {
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

      if (!resp.ok) throw new Error('Token refresh failed');
      const data: AuthTokens = await resp.json();
      this.updateConnection(connectionId, { tokens: data });
      this.persistConnections();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ==========================================================================
  // Internal helpers
  // ==========================================================================

  private updateConnection(connectionId: string, updates: Partial<BackendConnection>): void {
    this._connections.update(list =>
      list.map(c => c.id === connectionId ? { ...c, ...updates } : c)
    );
  }

  // ==========================================================================
  // Persistence (Tauri SQLite + keyring vault)
  // ==========================================================================

  private persistConnections(): void {
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
        label: new URL(config.serverUrl).hostname,
        tokens,
        user: null,
        projects: [],
        projectPermissions: {},
        status: tokens ? 'connecting' : 'disconnected',
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
      this.updateConnection(connectionId, { user, status: 'connected' });
      await this.loadProjectsFor(connectionId);
    } catch (err) {
      console.warn('Auto-reconnect failed:', err);
      this.updateConnection(connectionId, { tokens: null, user: null, projectPermissions: {}, status: 'disconnected' });
      this.persistConnections();
    }
  }
}
