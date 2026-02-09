import { Injectable } from '@angular/core';
import { ContainerRuntime } from '../models/container.model';
import { Network } from '../models/network.model';
import { BackendService } from './backend.service';
import { TauriService } from './tauri.service';

@Injectable({
  providedIn: 'root',
})
export class NetworkService {
  constructor(
    private tauri: TauriService,
    private backend: BackendService,
  ) {}

  async listNetworks(systemId: string): Promise<Network[]> {
    const connId = this.backend.getBackendForSystem(systemId);
    if (connId) {
      return this.backend.listNetworksFor(connId, systemId);
    }
    return this.tauri.invoke<Network[]>('list_networks', { systemId });
  }

  async createNetwork(
    systemId: string,
    name: string,
    runtime: ContainerRuntime,
    driver?: string,
    subnet?: string
  ): Promise<void> {
    const connId = this.backend.getBackendForSystem(systemId);
    if (connId) {
      return this.backend.createNetworkFor(connId, systemId, name, runtime, driver, subnet);
    }
    return this.tauri.invoke<void>('create_network', {
      systemId,
      name,
      runtime,
      driver,
      subnet,
    });
  }

  async removeNetwork(
    systemId: string,
    name: string,
    runtime: ContainerRuntime
  ): Promise<void> {
    const connId = this.backend.getBackendForSystem(systemId);
    if (connId) {
      return this.backend.removeNetworkFor(connId, systemId, name, runtime);
    }
    return this.tauri.invoke<void>('remove_network', {
      systemId,
      name,
      runtime,
    });
  }

  async connectContainerToNetwork(
    systemId: string,
    containerId: string,
    networkName: string,
    runtime: ContainerRuntime
  ): Promise<void> {
    const connId = this.backend.getBackendForSystem(systemId);
    if (connId) {
      return this.backend.connectContainerToNetworkFor(connId, systemId, containerId, networkName, runtime);
    }
    return this.tauri.invoke<void>('connect_container_to_network', {
      systemId,
      containerId,
      networkName,
      runtime,
    });
  }

  async disconnectContainerFromNetwork(
    systemId: string,
    containerId: string,
    networkName: string,
    runtime: ContainerRuntime
  ): Promise<void> {
    const connId = this.backend.getBackendForSystem(systemId);
    if (connId) {
      return this.backend.disconnectContainerFromNetworkFor(connId, systemId, containerId, networkName, runtime);
    }
    return this.tauri.invoke<void>('disconnect_container_from_network', {
      systemId,
      containerId,
      networkName,
      runtime,
    });
  }
}
