import { Injectable } from '@angular/core';
import { ContainerRuntime } from '../models/container.model';
import { Volume } from '../models/volume.model';
import { TauriService } from './tauri.service';

@Injectable({
  providedIn: 'root',
})
export class VolumeService {
  constructor(private tauri: TauriService) {}

  listVolumes(systemId: string): Promise<Volume[]> {
    return this.tauri.invoke<Volume[]>('list_volumes', { systemId });
  }

  createVolume(
    systemId: string,
    name: string,
    runtime: ContainerRuntime,
    driver?: string
  ): Promise<void> {
    return this.tauri.invoke<void>('create_volume', {
      systemId,
      name,
      runtime,
      driver,
    });
  }

  removeVolume(
    systemId: string,
    name: string,
    runtime: ContainerRuntime
  ): Promise<void> {
    return this.tauri.invoke<void>('remove_volume', {
      systemId,
      name,
      runtime,
    });
  }
}
