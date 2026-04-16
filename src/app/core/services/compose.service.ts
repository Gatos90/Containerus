import { Injectable } from '@angular/core';
import { ContainerRuntime } from '../models/container.model';
import { BackendService } from './backend.service';
import { TauriService } from './tauri.service';

@Injectable({
  providedIn: 'root',
})
export class ComposeApiService {
  constructor(
    private tauri: TauriService,
    private backend: BackendService,
  ) {}

  /** Start all services in the given compose project (-p <name> up -d) */
  async composeUp(
    systemId: string,
    projectName: string,
    runtime: ContainerRuntime,
  ): Promise<string> {
    // Backend HTTP compose support is not yet implemented; always use Tauri path.
    // When a backend connection is available, we still fall through to Tauri for now.
    return this.tauri.invoke<string>('compose_up', { systemId, projectName, runtime });
  }

  /** Stop and remove containers for the given compose project */
  async composeDown(
    systemId: string,
    projectName: string,
    runtime: ContainerRuntime,
  ): Promise<string> {
    return this.tauri.invoke<string>('compose_down', { systemId, projectName, runtime });
  }

  /** Restart all services (or a specific service) in the compose project */
  async composeRestart(
    systemId: string,
    projectName: string,
    runtime: ContainerRuntime,
    serviceName?: string,
  ): Promise<string> {
    return this.tauri.invoke<string>('compose_restart', {
      systemId,
      projectName,
      runtime,
      serviceName: serviceName ?? null,
    });
  }

  /** Fetch logs for all services (or a specific service) in the compose project */
  async composeLogs(
    systemId: string,
    projectName: string,
    runtime: ContainerRuntime,
    serviceName?: string,
    tail: number = 100,
  ): Promise<string> {
    return this.tauri.invoke<string>('compose_logs', {
      systemId,
      projectName,
      runtime,
      serviceName: serviceName ?? null,
      tail,
    });
  }
}
