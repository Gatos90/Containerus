import { Injectable } from '@angular/core';
import { ContainerRuntime } from '../models/container.model';
import { DirectoryListing, FileContent } from '../models/file-browser.model';
import { BackendService } from './backend.service';
import { TauriService } from './tauri.service';

@Injectable({ providedIn: 'root' })
export class FileBrowserService {
  constructor(
    private tauri: TauriService,
    private backend: BackendService,
  ) {}

  async listDirectory(
    systemId: string,
    path: string,
    containerId?: string | null,
    runtime?: ContainerRuntime | null,
  ): Promise<DirectoryListing> {
    const connId = this.backend.getBackendForSystem(systemId);
    if (connId) {
      return this.backend.listDirectoryFor(
        connId, systemId, path,
        containerId ?? undefined,
        runtime ?? undefined,
      );
    }
    return this.tauri.invoke<DirectoryListing>('list_directory', {
      systemId, path, containerId, runtime,
    });
  }

  async readFile(
    systemId: string,
    path: string,
    containerId?: string | null,
    runtime?: ContainerRuntime | null,
  ): Promise<FileContent> {
    const connId = this.backend.getBackendForSystem(systemId);
    if (connId) {
      return this.backend.readFileFor(
        connId, systemId, path,
        containerId ?? undefined,
        runtime ?? undefined,
      );
    }
    return this.tauri.invoke<FileContent>('read_file', {
      systemId, path, containerId, runtime,
    });
  }

  async writeFile(
    systemId: string,
    path: string,
    content: string,
    containerId?: string | null,
    runtime?: ContainerRuntime | null,
  ): Promise<void> {
    const connId = this.backend.getBackendForSystem(systemId);
    if (connId) {
      return this.backend.writeFileFor(
        connId, systemId, path, content,
        containerId ?? undefined,
        runtime ?? undefined,
      );
    }
    return this.tauri.invoke<void>('write_file', {
      systemId, path, content, containerId, runtime,
    });
  }

  async createDirectory(
    systemId: string,
    path: string,
    containerId?: string | null,
    runtime?: ContainerRuntime | null,
  ): Promise<void> {
    const connId = this.backend.getBackendForSystem(systemId);
    if (connId) {
      return this.backend.createDirectoryFor(
        connId, systemId, path,
        containerId ?? undefined,
        runtime ?? undefined,
      );
    }
    return this.tauri.invoke<void>('create_directory', {
      systemId, path, containerId, runtime,
    });
  }

  async deletePath(
    systemId: string,
    path: string,
    isDirectory: boolean,
    containerId?: string | null,
    runtime?: ContainerRuntime | null,
  ): Promise<void> {
    const connId = this.backend.getBackendForSystem(systemId);
    if (connId) {
      return this.backend.deletePathFor(
        connId, systemId, path, isDirectory,
        containerId ?? undefined,
        runtime ?? undefined,
      );
    }
    return this.tauri.invoke<void>('delete_path', {
      systemId, path, isDirectory, containerId, runtime,
    });
  }

  async renamePath(
    systemId: string,
    oldPath: string,
    newPath: string,
    containerId?: string | null,
    runtime?: ContainerRuntime | null,
  ): Promise<void> {
    const connId = this.backend.getBackendForSystem(systemId);
    if (connId) {
      return this.backend.renamePathFor(
        connId, systemId, oldPath, newPath,
        containerId ?? undefined,
        runtime ?? undefined,
      );
    }
    return this.tauri.invoke<void>('rename_path', {
      systemId, oldPath, newPath, containerId, runtime,
    });
  }

  async downloadFile(
    systemId: string,
    remotePath: string,
    localPath: string,
    containerId?: string | null,
    runtime?: ContainerRuntime | null,
  ): Promise<void> {
    const connId = this.backend.getBackendForSystem(systemId);
    if (connId) {
      // Backend mode: download returns base64, save via browser
      const result = await this.backend.downloadFileFor(
        connId, systemId, remotePath,
        containerId ?? undefined,
        runtime ?? undefined,
      );
      // Decode base64 and trigger browser download
      let blob: Blob;
      try {
        const resp = await fetch(`data:application/octet-stream;base64,${result.content}`);
        blob = await resp.blob();
      } catch (err) {
        throw new Error(`Failed to decode file content: ${err instanceof Error ? err.message : String(err)}`);
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = remotePath.split(/[/\\]/).pop() || 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Delay revocation to ensure download starts
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    return this.tauri.invoke<void>('download_file', {
      systemId, remotePath, localPath, containerId, runtime,
    });
  }

  async uploadFile(
    systemId: string,
    localPath: string,
    remotePath: string,
    containerId?: string | null,
    runtime?: ContainerRuntime | null,
  ): Promise<void> {
    const connId = this.backend.getBackendForSystem(systemId);
    if (connId) {
      // Backend mode: read local file via File API isn't possible here
      // (localPath is a native path). For backend systems, the caller
      // should use uploadFileFromContent() instead.
      throw new Error('Use uploadFileFromContent() for backend systems');
    }
    return this.tauri.invoke<void>('upload_file', {
      systemId, localPath, remotePath, containerId, runtime,
    });
  }

  /** Upload file content directly (for backend systems where local path isn't accessible). */
  async uploadFileFromContent(
    systemId: string,
    remotePath: string,
    content: ArrayBuffer,
    containerId?: string | null,
    runtime?: ContainerRuntime | null,
  ): Promise<void> {
    const connId = this.backend.getBackendForSystem(systemId);
    if (connId) {
      const bytes = new Uint8Array(content);
      const chars: string[] = [];
      for (let i = 0; i < bytes.length; i++) {
        chars.push(String.fromCharCode(bytes[i]));
      }
      const base64 = btoa(chars.join(''));
      return this.backend.uploadFileFor(
        connId, systemId, remotePath, base64,
        containerId ?? undefined,
        runtime ?? undefined,
      );
    }
    throw new Error('uploadFileFromContent is only for backend systems');
  }
}
