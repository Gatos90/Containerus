import { Injectable } from '@angular/core';
import { ContainerRuntime } from '../models/container.model';
import { DirectoryListing, FileContent } from '../models/file-browser.model';
import { TauriService } from './tauri.service';

@Injectable({ providedIn: 'root' })
export class FileBrowserService {
  constructor(private tauri: TauriService) {}

  listDirectory(
    systemId: string,
    path: string,
    containerId?: string | null,
    runtime?: ContainerRuntime | null,
  ): Promise<DirectoryListing> {
    return this.tauri.invoke<DirectoryListing>('list_directory', {
      systemId, path, containerId, runtime,
    });
  }

  readFile(
    systemId: string,
    path: string,
    containerId?: string | null,
    runtime?: ContainerRuntime | null,
  ): Promise<FileContent> {
    return this.tauri.invoke<FileContent>('read_file', {
      systemId, path, containerId, runtime,
    });
  }

  writeFile(
    systemId: string,
    path: string,
    content: string,
    containerId?: string | null,
    runtime?: ContainerRuntime | null,
  ): Promise<void> {
    return this.tauri.invoke<void>('write_file', {
      systemId, path, content, containerId, runtime,
    });
  }

  createDirectory(
    systemId: string,
    path: string,
    containerId?: string | null,
    runtime?: ContainerRuntime | null,
  ): Promise<void> {
    return this.tauri.invoke<void>('create_directory', {
      systemId, path, containerId, runtime,
    });
  }

  deletePath(
    systemId: string,
    path: string,
    isDirectory: boolean,
    containerId?: string | null,
    runtime?: ContainerRuntime | null,
  ): Promise<void> {
    return this.tauri.invoke<void>('delete_path', {
      systemId, path, isDirectory, containerId, runtime,
    });
  }

  renamePath(
    systemId: string,
    oldPath: string,
    newPath: string,
    containerId?: string | null,
    runtime?: ContainerRuntime | null,
  ): Promise<void> {
    return this.tauri.invoke<void>('rename_path', {
      systemId, oldPath, newPath, containerId, runtime,
    });
  }

  downloadFile(
    systemId: string,
    remotePath: string,
    localPath: string,
    containerId?: string | null,
    runtime?: ContainerRuntime | null,
  ): Promise<void> {
    return this.tauri.invoke<void>('download_file', {
      systemId, remotePath, localPath, containerId, runtime,
    });
  }

  uploadFile(
    systemId: string,
    localPath: string,
    remotePath: string,
    containerId?: string | null,
    runtime?: ContainerRuntime | null,
  ): Promise<void> {
    return this.tauri.invoke<void>('upload_file', {
      systemId, localPath, remotePath, containerId, runtime,
    });
  }
}
