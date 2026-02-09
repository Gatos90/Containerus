import { Injectable } from '@angular/core';
import {
  Container,
  ContainerAction,
  ContainerDetails,
  ContainerRuntime,
} from '../models/container.model';
import { BackendService } from './backend.service';
import { TauriService } from './tauri.service';

@Injectable({
  providedIn: 'root',
})
export class ContainerService {
  constructor(
    private tauri: TauriService,
    private backend: BackendService,
  ) {}

  async listContainers(systemId: string): Promise<Container[]> {
    const connId = this.backend.getBackendForSystem(systemId);
    if (connId) {
      return this.backend.listContainersFor(connId, systemId);
    }
    return this.tauri.invoke<Container[]>('list_containers', { systemId });
  }

  async performAction(
    systemId: string,
    containerId: string,
    action: ContainerAction,
    runtime: ContainerRuntime
  ): Promise<void> {
    const connId = this.backend.getBackendForSystem(systemId);
    if (connId) {
      return this.backend.containerActionFor(connId, systemId, containerId, action, runtime);
    }
    return this.tauri.invoke<void>('perform_container_action', {
      systemId,
      containerId,
      action,
      runtime,
    });
  }

  async getLogs(
    systemId: string,
    containerId: string,
    runtime: ContainerRuntime,
    tail: number = 100,
    timestamps: boolean = true
  ): Promise<string> {
    const connId = this.backend.getBackendForSystem(systemId);
    if (connId) {
      const result = await this.backend.getContainerLogsFor(connId, systemId, containerId, tail, timestamps, runtime);
      return result.logs;
    }
    return this.tauri.invoke<string>('get_container_logs', {
      systemId,
      containerId,
      runtime,
      tail,
      timestamps,
    });
  }

  async inspectContainer(
    systemId: string,
    containerId: string,
    runtime: ContainerRuntime
  ): Promise<ContainerDetails> {
    const connId = this.backend.getBackendForSystem(systemId);
    if (connId) {
      return this.backend.inspectContainerFor(connId, systemId, containerId, runtime);
    }
    return this.tauri.invoke<ContainerDetails>('inspect_container', {
      systemId,
      containerId,
      runtime,
    });
  }
}
