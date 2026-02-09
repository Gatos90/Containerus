import { Injectable } from '@angular/core';
import { ContainerRuntime } from '../models/container.model';
import { Volume } from '../models/volume.model';
import { BackendService } from './backend.service';
import { TauriService } from './tauri.service';

@Injectable({
  providedIn: 'root',
})
export class VolumeService {
  constructor(
    private tauri: TauriService,
    private backend: BackendService,
  ) {}

  async listVolumes(systemId: string): Promise<Volume[]> {
    const connId = this.backend.getBackendForSystem(systemId);
    if (connId) {
      return this.backend.listVolumesFor(connId, systemId);
    }
    return this.tauri.invoke<Volume[]>('list_volumes', { systemId });
  }

  async createVolume(
    systemId: string,
    name: string,
    runtime: ContainerRuntime,
    driver?: string
  ): Promise<void> {
    const connId = this.backend.getBackendForSystem(systemId);
    if (connId) {
      return this.backend.createVolumeFor(connId, systemId, name, runtime, driver);
    }
    return this.tauri.invoke<void>('create_volume', {
      systemId,
      name,
      runtime,
      driver,
    });
  }

  async removeVolume(
    systemId: string,
    name: string,
    runtime: ContainerRuntime
  ): Promise<void> {
    const connId = this.backend.getBackendForSystem(systemId);
    if (connId) {
      return this.backend.removeVolumeFor(connId, systemId, name, runtime);
    }
    return this.tauri.invoke<void>('remove_volume', {
      systemId,
      name,
      runtime,
    });
  }
}
