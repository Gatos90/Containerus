import { ContainerRuntime } from './container.model';

export interface Volume {
  name: string;
  driver: string;
  mountpoint: string;
  createdAt?: string | null;
  labels: Record<string, string>;
  options: Record<string, string>;
  runtime: ContainerRuntime;
  systemId: string;
}
