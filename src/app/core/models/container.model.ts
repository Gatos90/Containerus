export type ContainerStatus =
  | 'running'
  | 'exited'
  | 'paused'
  | 'restarting'
  | 'removing'
  | 'dead'
  | 'created';

export type ContainerRuntime = 'docker' | 'podman' | 'apple';

export type ContainerAction =
  | 'start'
  | 'stop'
  | 'restart'
  | 'pause'
  | 'unpause'
  | 'remove';

export interface PortMapping {
  hostIp: string;
  hostPort: number;
  containerPort: number;
  protocol: string;
}

export interface VolumeMount {
  source: string;
  destination: string;
  mode: string;
  readWrite: boolean;
  volumeName?: string | null;
  mountType: string;
}

export interface NetworkInfo {
  ipAddress: string;
  gateway: string;
  macAddress: string;
}

export interface NetworkSettings {
  networks: Record<string, NetworkInfo>;
  portBindings: PortMapping[];
}

export interface ResourceLimits {
  memory?: number | null;
  cpuShares?: number | null;
  cpuQuota?: number | null;
  cpuPeriod?: number | null;
}

export interface RestartPolicy {
  name: string;
  maximumRetryCount: number;
}

export interface HealthCheck {
  test: string[];
  interval: number;
  timeout: number;
  retries: number;
  startPeriod: number;
}

export interface ContainerState {
  pid: number;
  exitCode: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  healthStatus: string | null;
}

export interface ContainerConfig {
  cmd: string[] | null;
  entrypoint: string[] | null;
  workingDir: string | null;
  user: string | null;
  hostname: string | null;
  domainname: string | null;
  tty: boolean;
  stopSignal: string | null;
}

export interface DeviceMapping {
  hostPath: string;
  containerPath: string;
  permissions: string;
}

export interface LogConfig {
  logType: string;
  config: Record<string, string>;
}

export interface Ulimit {
  name: string;
  soft: number;
  hard: number;
}

export interface HostConfigExtras {
  networkMode: string | null;
  privileged: boolean;
  capAdd: string[];
  capDrop: string[];
  devices: DeviceMapping[];
  shmSize: number | null;
  logConfig: LogConfig | null;
  securityOpt: string[];
  ulimits: Ulimit[];
}

export interface Container {
  // Basic info
  id: string;
  name: string;
  image: string;
  status: ContainerStatus;
  runtime: ContainerRuntime;
  systemId: string;
  createdAt: string;
  ports: PortMapping[];

  // Full details (always available)
  environmentVariables: Record<string, string>;
  volumes: VolumeMount[];
  networkSettings: NetworkSettings;
  resourceLimits: ResourceLimits;
  labels: Record<string, string>;
  restartPolicy: RestartPolicy;
  healthCheck: HealthCheck | null;
  state: ContainerState;
  config: ContainerConfig;
  hostConfig: HostConfigExtras;
}

/** @deprecated Use Container directly - all details are now included */
export type ContainerDetails = Pick<
  Container,
  | 'environmentVariables'
  | 'volumes'
  | 'networkSettings'
  | 'resourceLimits'
  | 'labels'
  | 'restartPolicy'
  | 'healthCheck'
  | 'state'
  | 'config'
  | 'hostConfig'
>;

export const getDisplayName = (container: Container): string =>
  container.name?.length ? container.name : container.id.slice(0, 12);

export const getStatusColor = (status: ContainerStatus): string => {
  switch (status) {
    case 'running':
      return 'text-green-500';
    case 'paused':
      return 'text-yellow-500';
    case 'restarting':
      return 'text-orange-500';
    case 'exited':
    case 'dead':
      return 'text-red-500';
    case 'created':
      return 'text-blue-500';
    case 'removing':
    default:
      return 'text-gray-500';
  }
};

export const getRuntimeColor = (runtime: ContainerRuntime): string => {
  switch (runtime) {
    case 'docker':
      return 'text-blue-500';
    case 'podman':
      return 'text-orange-500';
    case 'apple':
      return 'text-purple-500';
    default:
      return 'text-gray-500';
  }
};

export const getAvailableActions = (container: Container): ContainerAction[] => {
  switch (container.status) {
    case 'running':
      return ['stop', 'restart', 'pause'];
    case 'paused':
      return ['unpause', 'stop'];
    case 'exited':
    case 'created':
    case 'dead':
      return ['start', 'remove'];
    case 'restarting':
      return ['stop'];
    case 'removing':
    default:
      return [];
  }
};

export const isRunning = (container: Container): boolean =>
  container.status === 'running';

export const getStatusText = (status: ContainerStatus): string => {
  switch (status) {
    case 'running':
      return 'Running';
    case 'exited':
      return 'Exited';
    case 'created':
      return 'Created';
    case 'paused':
      return 'Paused';
    case 'restarting':
      return 'Restarting';
    case 'removing':
      return 'Removing';
    case 'dead':
      return 'Dead';
    default:
      return status;
  }
};

export const formatPort = (port: PortMapping): string =>
  `${port.hostPort}:${port.containerPort}/${port.protocol.toUpperCase()}`;

export const getRelativeTime = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffYears > 0) return `${diffYears} year${diffYears > 1 ? 's' : ''} ago`;
  if (diffMonths > 0) return `${diffMonths} month${diffMonths > 1 ? 's' : ''} ago`;
  if (diffWeeks > 0) return `${diffWeeks} week${diffWeeks > 1 ? 's' : ''} ago`;
  if (diffDays > 0) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  if (diffHours > 0) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffMinutes > 0) return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`;
  return 'Just now';
};
