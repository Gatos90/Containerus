import { Injectable } from '@angular/core';
import { ContainerRuntime } from '../models/container.model';
import { ContainerImage } from '../models/image.model';
import { TauriService } from './tauri.service';

@Injectable({
  providedIn: 'root',
})
export class ImageService {
  constructor(private tauri: TauriService) {}

  listImages(systemId: string): Promise<ContainerImage[]> {
    return this.tauri.invoke<ContainerImage[]>('list_images', { systemId });
  }

  pullImage(
    systemId: string,
    name: string,
    tag: string,
    runtime: ContainerRuntime
  ): Promise<void> {
    return this.tauri.invoke<void>('pull_image', {
      systemId,
      name,
      tag,
      runtime,
    });
  }

  removeImage(
    systemId: string,
    imageId: string,
    runtime: ContainerRuntime
  ): Promise<void> {
    return this.tauri.invoke<void>('remove_image', {
      systemId,
      imageId,
      runtime,
    });
  }
}
