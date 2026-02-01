import { Injectable } from '@angular/core';
import {
  Container,
  ContainerAction,
  ContainerDetails,
  ContainerRuntime,
} from '../models/container.model';
import { TauriService } from './tauri.service';

@Injectable({
  providedIn: 'root',
})
export class ContainerService {
  constructor(private tauri: TauriService) {}

  listContainers(systemId: string): Promise<Container[]> {
    return this.tauri.invoke<Container[]>('list_containers', { systemId });
  }

  performAction(
    systemId: string,
    containerId: string,
    action: ContainerAction,
    runtime: ContainerRuntime
  ): Promise<void> {
    return this.tauri.invoke<void>('perform_container_action', {
      systemId,
      containerId,
      action,
      runtime,
    });
  }

  getLogs(
    systemId: string,
    containerId: string,
    runtime: ContainerRuntime,
    tail: number = 100,
    timestamps: boolean = true
  ): Promise<string> {
    return this.tauri.invoke<string>('get_container_logs', {
      systemId,
      containerId,
      runtime,
      tail,
      timestamps,
    });
  }

  inspectContainer(
    systemId: string,
    containerId: string,
    runtime: ContainerRuntime
  ): Promise<ContainerDetails> {
    return this.tauri.invoke<ContainerDetails>('inspect_container', {
      systemId,
      containerId,
      runtime,
    });
  }
}
