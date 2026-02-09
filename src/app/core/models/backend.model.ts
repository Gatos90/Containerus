import { ContainerRuntime } from './container.model';
import { ContainerSystem, SshAuthMethod } from './system.model';

// ============================================================================
// Backend connection models
// ============================================================================

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

export interface BackendConnection {
  id: string;
  serverUrl: string;
  label: string;
  tokens: AuthTokens | null;
  user: UserProfile | null;
  projects: Project[];
  /** Per-project permissions, keyed by project ID */
  projectPermissions: Record<string, EffectivePermissions>;
  status: ConnectionStatus;
}

export interface SavedBackendConnection {
  id: string;
  serverUrl: string;
  label: string;
  tokens?: AuthTokens | null;
}

// ============================================================================
// Auth models
// ============================================================================

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  displayName: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
  authProvider: string;
  isCompanyAdmin: boolean;
  createdAt: string;
}

// ============================================================================
// Project models (renamed from Organization)
// ============================================================================

export interface Project {
  id: string;
  companyId?: string | null;
  name: string;
  slug: string;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Environment {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  description?: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectOverview {
  project: Project;
  environments: EnvironmentOverview[];
}

export interface EnvironmentOverview {
  environment: Environment;
  systems: BackendSystem[];
  clusters: K8sCluster[];
}

export interface ProjectMember {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
  roleId: string;
  roleName: string;
  roleSlug: string;
  joinedAt: string;
}

export interface InviteMemberRequest {
  email: string;
  roleId: string;
}

// ============================================================================
// Role & Permission models
// ============================================================================

export interface Role {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RoleWithPermissions extends Role {
  permissions: string[];
}

export interface PermissionDef {
  id: string;
  key: string;
  description?: string | null;
  category: string;
}

export interface EffectivePermissions {
  permissions: string[];
  isCompanyAdmin: boolean;
}

// ============================================================================
// Company models
// ============================================================================

export interface CompanyInfo {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyAdmin {
  userId: string;
  email: string;
  displayName: string;
  grantedAt: string;
}

// ============================================================================
// Resource ACL models
// ============================================================================

export interface ResourceAcl {
  id: string;
  userId: string;
  projectId: string;
  resourceType: string;
  resourceId: string;
  roleId?: string | null;
  extraPermissions: string[];
  deniedPermissions: string[];
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Backend system models (server-managed systems)
// ============================================================================

export interface BackendSystem {
  id: string;
  environmentId: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  primaryRuntime: string;
  availableRuntimes: string[];
  authMethod: string;
  isActive: boolean;
  lastConnectedAt?: string | null;
  createdAt: string;
  connected: boolean;
}

function validateRuntime(runtime: string): ContainerRuntime {
  const valid: string[] = ['docker', 'podman', 'apple'];
  if (valid.includes(runtime)) {
    return runtime as ContainerRuntime;
  }
  console.warn(`Unknown runtime: ${runtime}, defaulting to 'docker'`);
  return 'docker';
}

function validateAuthMethod(method: string): SshAuthMethod {
  const valid: string[] = ['password', 'publicKey'];
  if (valid.includes(method)) {
    return method as SshAuthMethod;
  }
  console.warn(`Unknown auth method: ${method}, defaulting to 'password'`);
  return 'password';
}

/** Map a BackendSystem (from server API) to a ContainerSystem (used by all UI components) */
export function backendSystemToContainerSystem(bs: BackendSystem): ContainerSystem {
  return {
    id: bs.id,
    name: bs.name,
    hostname: bs.hostname,
    connectionType: 'remote',
    primaryRuntime: validateRuntime(bs.primaryRuntime),
    availableRuntimes: bs.availableRuntimes.map(validateRuntime),
    sshConfig: {
      username: bs.username,
      port: bs.port,
      authMethod: validateAuthMethod(bs.authMethod),
      connectionTimeout: 30,
    },
    autoConnect: false,
  };
}

// ============================================================================
// Kubernetes models
// ============================================================================

export interface K8sCluster {
  id: string;
  environmentId: string;
  name: string;
  apiServerUrl: string;
  contextName?: string | null;
  isActive: boolean;
  lastConnectedAt?: string | null;
  createdAt: string;
}

export interface K8sNamespace {
  name: string;
  status: string;
  age: string;
}

export interface K8sPod {
  name: string;
  namespace: string;
  status: string;
  ready: string;
  restarts: number;
  age: string;
  node?: string | null;
  ip?: string | null;
}

export interface K8sDeployment {
  name: string;
  namespace: string;
  ready: string;
  upToDate: number;
  available: number;
  age: string;
}

export interface K8sService {
  name: string;
  namespace: string;
  serviceType: string;
  clusterIp?: string | null;
  externalIp?: string | null;
  ports: string[];
  age: string;
}

// ============================================================================
// Audit models
// ============================================================================

export interface AuditLogEntry {
  id: string;
  projectId?: string | null;
  userId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  details?: Record<string, unknown> | null;
  ipAddress?: string | null;
  environmentId?: string | null;
  createdAt: string;
}
