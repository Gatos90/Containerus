import { Injectable } from '@angular/core';
import { ContainerRuntime } from '../models/container.model';
import { Network } from '../models/network.model';
import { TauriService } from './tauri.service';

@Injectable({
  providedIn: 'root',
})
export class NetworkService {
  constructor(private tauri: TauriService) {}

  listNetworks(systemId: string): Promise<Network[]> {
    return this.tauri.invoke<Network[]>('list_networks', { systemId });
  }

  createNetwork(
    systemId: string,
    name: string,
    runtime: ContainerRuntime,
    driver?: string,
    subnet?: string
  ): Promise<void> {
    return this.tauri.invoke<void>('create_network', {
      systemId,
      name,
      runtime,
      driver,
      subnet,
    });
  }

  removeNetwork(
    systemId: string,
    name: string,
    runtime: ContainerRuntime
  ): Promise<void> {
    return this.tauri.invoke<void>('remove_network', {
      systemId,
      name,
      runtime,
    });
  }

  connectContainerToNetwork(
    systemId: string,
    containerId: string,
    networkName: string,
    runtime: ContainerRuntime
  ): Promise<void> {
    return this.tauri.invoke<void>('connect_container_to_network', {
      systemId,
      containerId,
      networkName,
      runtime,
    });
  }

  disconnectContainerFromNetwork(
    systemId: string,
    containerId: string,
    networkName: string,
    runtime: ContainerRuntime
  ): Promise<void> {
    return this.tauri.invoke<void>('disconnect_container_from_network', {
      systemId,
      containerId,
      networkName,
      runtime,
    });
  }
}
