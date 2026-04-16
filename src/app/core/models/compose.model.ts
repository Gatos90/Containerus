import { Container, ContainerRuntime, ContainerStatus } from './container.model';

export interface ComposeProjectService {
  name: string;
  containers: Container[];
  /** Status derived from the most-running container for this service */
  status: ContainerStatus | 'stopped';
}

export type ComposeProjectStatus = 'running' | 'partially_running' | 'stopped';

export interface ComposeProject {
  /** Stable derived ID: "{systemId}::{runtime}::{projectName}" */
  id: string;
  name: string;
  systemId: string;
  runtime: ContainerRuntime;
  /** From com.docker.compose.project.working_dir label */
  workingDir: string;
  /** From com.docker.compose.project.config_files label */
  configFiles: string;
  services: ComposeProjectService[];
  status: ComposeProjectStatus;
  serviceCount: number;
  runningCount: number;
}

export const getComposeStatusColor = (status: ComposeProjectStatus): string => {
  switch (status) {
    case 'running':
      return 'text-green-500';
    case 'partially_running':
      return 'text-amber-500';
    case 'stopped':
      return 'text-zinc-500';
  }
};

export const getComposeStatusBg = (status: ComposeProjectStatus): string => {
  switch (status) {
    case 'running':
      return 'bg-green-500/10 text-green-400 border-green-500/20';
    case 'partially_running':
      return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    case 'stopped':
      return 'bg-zinc-700/50 text-zinc-400 border-zinc-600/30';
  }
};

export const getComposeStatusLabel = (status: ComposeProjectStatus): string => {
  switch (status) {
    case 'running':
      return 'Running';
    case 'partially_running':
      return 'Partial';
    case 'stopped':
      return 'Stopped';
  }
};
