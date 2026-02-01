import { ContainerRuntime } from './container.model';

export type ConnectionType = 'local' | 'remote';
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';
export type SshAuthMethod = 'password' | 'publicKey';

export interface SshConfig {
  username: string;
  port: number;
  authMethod: SshAuthMethod;
  privateKeyPath?: string | null;
  /** PEM-encoded private key content (for mobile/imported keys) */
  privateKeyContent?: string | null;
  connectionTimeout: number;
}

export interface ContainerSystem {
  id: string;
  name: string;
  hostname: string;
  connectionType: ConnectionType;
  primaryRuntime: ContainerRuntime;
  availableRuntimes: ContainerRuntime[];
  sshConfig?: SshConfig | null;
  autoConnect: boolean;
}

export interface NewSystemRequest {
  name: string;
  hostname: string;
  connectionType: ConnectionType;
  primaryRuntime: ContainerRuntime;
  availableRuntimes: ContainerRuntime[];
  sshConfig?: SshConfig | null;
  autoConnect: boolean;
}

export interface UpdateSystemRequest {
  id: string;
  name: string;
  hostname: string;
  connectionType: ConnectionType;
  primaryRuntime: ContainerRuntime;
  availableRuntimes: ContainerRuntime[];
  sshConfig?: SshConfig | null;
  autoConnect: boolean;
}

export interface SystemHealth {
  isHealthy: boolean;
  containerCount: number;
  runningCount: number;
  stoppedCount: number;
  lastChecked: string;
  responseTimeMs: number;
}

export interface SystemInfo {
  os: string;
  architecture: string;
  runtimeVersion: string;
  kernelVersion?: string | null;
}

export type OsType = 'linux' | 'macos' | 'windows' | 'unknown';

/** Live system metrics for real-time monitoring */
export interface LiveSystemMetrics {
  /** System ID this metrics belong to */
  systemId: string;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Current CPU usage percentage (0-100) */
  cpuUsagePercent: number;
  /** Current memory usage percentage (0-100) */
  memoryUsagePercent: number;
  /** Memory currently used (e.g., "8.5G") */
  memoryUsed?: string | null;
  /** Total memory (e.g., "16G") */
  memoryTotal?: string | null;
  /** Load average: 1m, 5m, 15m (Unix only) */
  loadAverage?: [number, number, number] | null;
  /** Swap usage percentage (0-100) */
  swapUsagePercent?: number | null;
}

export interface ExtendedSystemInfo {
  /** SSH username or local user */
  username: string;
  /** Is the user root/admin? */
  isRoot: boolean;
  /** Can the user sudo/elevate without password? */
  canSudo: boolean;
  /** Operating system type */
  osType: OsType;
  /** Linux distribution or OS version (e.g., "Ubuntu 22.04", "macOS 15.0", "Windows 11") */
  distro?: string | null;
  /** System hostname */
  hostname?: string | null;
  /** Number of CPU cores */
  cpuCount?: number | null;
  /** Total memory (formatted string, e.g., "16GB") */
  totalMemory?: string | null;
  /** Disk usage percentage */
  diskUsagePercent?: number | null;
  /** System uptime (formatted string, e.g., "5 days, 3 hours") */
  uptime?: string | null;
  /** Number of running containers */
  runningContainers?: number | null;
  /** Total number of containers */
  totalContainers?: number | null;
  /** Total number of images */
  totalImages?: number | null;
  /** Container runtime version (e.g., "Docker 24.0.5") */
  runtimeVersion?: string | null;
}
