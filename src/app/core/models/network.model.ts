import { ContainerRuntime } from './container.model';

export interface Network {
  id: string;
  name: string;
  driver: string;
  scope: string;
  createdAt?: string | null;
  internal: boolean;
  attachable: boolean;
  labels: Record<string, string>;
  runtime: ContainerRuntime;
  systemId: string;
}
