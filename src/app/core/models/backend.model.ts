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
  labels?: Record<string, string>;
  creationTimestamp?: string | null;
  containerNames?: string[];
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
// K8s resource mapping helpers
// ============================================================================

/** Extract common fields from a raw k8s-openapi JSON object */
function k8sAge(creationTimestamp?: string): string {
  if (!creationTimestamp) return 'unknown';
  const dur = Date.now() - new Date(creationTimestamp).getTime();
  if (dur < 0) return '0m';
  const days = Math.floor(dur / 86400000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(dur / 3600000);
  if (hours > 0) return `${hours}h`;
  return `${Math.floor(dur / 60000)}m`;
}

/** Map a raw k8s-openapi Pod JSON to K8sPod */
export function mapPod(raw: any): K8sPod {
  const containers = raw.spec?.containers?.length ?? 0;
  const readyCount = raw.status?.containerStatuses?.filter((c: any) => c.ready).length ?? 0;
  const restarts = raw.status?.containerStatuses?.reduce((sum: number, c: any) => sum + (c.restartCount ?? 0), 0) ?? 0;
  return {
    name: raw.metadata?.name ?? '',
    namespace: raw.metadata?.namespace ?? '',
    status: raw.status?.phase ?? 'Unknown',
    ready: `${readyCount}/${containers}`,
    restarts,
    age: k8sAge(raw.metadata?.creationTimestamp),
    node: raw.spec?.nodeName ?? null,
    ip: raw.status?.podIP ?? null,
    labels: raw.metadata?.labels ?? {},
    creationTimestamp: raw.metadata?.creationTimestamp ?? null,
    containerNames: (raw.spec?.containers ?? []).map((c: any) => c.name),
  };
}

/** Map a raw k8s-openapi Deployment JSON to K8sDeployment */
export function mapDeployment(raw: any): K8sDeployment {
  const status = raw.status ?? {};
  const replicas = status.replicas ?? 0;
  const ready = status.readyReplicas ?? 0;
  return {
    name: raw.metadata?.name ?? '',
    namespace: raw.metadata?.namespace ?? '',
    ready: `${ready}/${replicas}`,
    upToDate: status.updatedReplicas ?? 0,
    available: status.availableReplicas ?? 0,
    age: k8sAge(raw.metadata?.creationTimestamp),
  };
}

/** Map a raw k8s-openapi Service JSON to K8sService */
export function mapService(raw: any): K8sService {
  const spec = raw.spec ?? {};
  const ports = (spec.ports ?? []).map((p: any) => {
    const port = p.port;
    const proto = p.protocol ?? 'TCP';
    return p.nodePort ? `${port}:${p.nodePort}/${proto}` : `${port}/${proto}`;
  });
  const externalIp =
    raw.status?.loadBalancer?.ingress?.[0]?.ip ??
    raw.status?.loadBalancer?.ingress?.[0]?.hostname ??
    spec.externalIPs?.[0] ??
    null;
  return {
    name: raw.metadata?.name ?? '',
    namespace: raw.metadata?.namespace ?? '',
    serviceType: spec.type ?? 'ClusterIP',
    clusterIp: spec.clusterIP ?? null,
    externalIp,
    ports,
    age: k8sAge(raw.metadata?.creationTimestamp),
  };
}

/** Map a raw k8s-openapi Namespace JSON to K8sNamespace */
export function mapNamespace(raw: any): K8sNamespace {
  return {
    name: raw.metadata?.name ?? 'unknown',
    status: raw.status?.phase ?? 'Unknown',
    age: k8sAge(raw.metadata?.creationTimestamp),
  };
}

// ============================================================================
// K8s resource detail models
// ============================================================================

export interface K8sContainerInfo {
  name: string;
  image: string;
  ports: string[];
  ready: boolean;
  restartCount: number;
  state: string;
  resources?: { requests?: Record<string, string>; limits?: Record<string, string> };
}

export interface K8sCondition {
  type: string;
  status: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
}

export interface K8sEvent {
  type: string;
  reason: string;
  message: string;
  count: number;
  firstTimestamp?: string;
  lastTimestamp?: string;
  source?: string;
  age: string;
}

export interface K8sTopologyNode {
  kind: string;
  name: string;
  namespace: string;
  status: string;
}

export interface K8sTopologyEdge {
  from: { kind: string; name: string };
  to: { kind: string; name: string };
  relation: string;
}

export interface K8sTopology {
  nodes: K8sTopologyNode[];
  edges: K8sTopologyEdge[];
}

/** Extract container info from a raw pod JSON */
export function extractContainers(raw: any): K8sContainerInfo[] {
  const specContainers = raw.spec?.containers ?? [];
  const statuses = raw.status?.containerStatuses ?? [];
  return specContainers.map((c: any) => {
    const cs = statuses.find((s: any) => s.name === c.name);
    const ports = (c.ports ?? []).map((p: any) => {
      const proto = p.protocol ?? 'TCP';
      return p.name ? `${p.name}:${p.containerPort}/${proto}` : `${p.containerPort}/${proto}`;
    });
    let state = 'unknown';
    if (cs?.state) {
      if (cs.state.running) state = 'running';
      else if (cs.state.waiting) state = cs.state.waiting.reason ?? 'waiting';
      else if (cs.state.terminated) state = cs.state.terminated.reason ?? 'terminated';
    }
    return {
      name: c.name,
      image: c.image ?? '',
      ports,
      ready: cs?.ready ?? false,
      restartCount: cs?.restartCount ?? 0,
      state,
      resources: c.resources ? {
        requests: c.resources.requests,
        limits: c.resources.limits,
      } : undefined,
    };
  });
}

/** Extract conditions from a raw K8s resource JSON */
export function extractConditions(raw: any): K8sCondition[] {
  return (raw.status?.conditions ?? []).map((c: any) => ({
    type: c.type ?? '',
    status: c.status ?? '',
    reason: c.reason,
    message: c.message,
    lastTransitionTime: c.lastTransitionTime,
  }));
}

/** Map a raw K8s event to K8sEvent */
export function mapEvent(raw: any): K8sEvent {
  return {
    type: raw.type ?? 'Normal',
    reason: raw.reason ?? '',
    message: raw.message ?? '',
    count: raw.count ?? 1,
    firstTimestamp: raw.firstTimestamp ?? raw.metadata?.creationTimestamp,
    lastTimestamp: raw.lastTimestamp ?? raw.firstTimestamp ?? raw.metadata?.creationTimestamp,
    source: raw.source?.component ?? '',
    age: k8sAge(raw.lastTimestamp ?? raw.metadata?.creationTimestamp),
  };
}

// ============================================================================
// CRD Discovery models
// ============================================================================

export interface K8sApiResource {
  group: string;
  version: string;
  kind: string;
  plural: string;
  scope: 'Namespaced' | 'Cluster';
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
