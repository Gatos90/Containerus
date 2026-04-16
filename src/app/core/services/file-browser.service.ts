import { Injectable } from '@angular/core';
import { ContainerRuntime } from '../models/container.model';
import { DirectoryListing, FileContent } from '../models/file-browser.model';
import { BackendService } from './backend.service';
import { TauriService } from './tauri.service';
import { PodContext } from '../../state/terminal.state';

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
    podCtx?: PodContext | null,
  ): Promise<DirectoryListing> {
    if (podCtx) {
      return this.backend.listPodDirectoryFor(
        podCtx.connectionId, podCtx.clusterId, podCtx.namespace,
        podCtx.podName, path, podCtx.containerName,
      );
    }
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
    podCtx?: PodContext | null,
  ): Promise<FileContent> {
    if (podCtx) {
      return this.backend.readPodFileFor(
        podCtx.connectionId, podCtx.clusterId, podCtx.namespace,
        podCtx.podName, path, podCtx.containerName,
      );
    }
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
    podCtx?: PodContext | null,
  ): Promise<void> {
    if (podCtx) {
      return this.backend.writePodFileFor(
        podCtx.connectionId, podCtx.clusterId, podCtx.namespace,
        podCtx.podName, path, content, podCtx.containerName,
      );
    }
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
    podCtx?: PodContext | null,
  ): Promise<void> {
    if (podCtx) {
      return this.backend.createPodDirectoryFor(
        podCtx.connectionId, podCtx.clusterId, podCtx.namespace,
        podCtx.podName, path, podCtx.containerName,
      );
    }
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
    podCtx?: PodContext | null,
  ): Promise<void> {
    if (podCtx) {
      return this.backend.deletePodPathFor(
        podCtx.connectionId, podCtx.clusterId, podCtx.namespace,
        podCtx.podName, path, isDirectory, podCtx.containerName,
      );
    }
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
    podCtx?: PodContext | null,
  ): Promise<void> {
    if (podCtx) {
      return this.backend.renamePodPathFor(
        podCtx.connectionId, podCtx.clusterId, podCtx.namespace,
        podCtx.podName, oldPath, newPath, podCtx.containerName,
      );
    }
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
    podCtx?: PodContext | null,
  ): Promise<void> {
    if (podCtx) {
      const result = await this.backend.downloadPodFileFor(
        podCtx.connectionId, podCtx.clusterId, podCtx.namespace,
        podCtx.podName, remotePath, podCtx.containerName,
      );
      this.triggerBrowserDownload(result.content, remotePath);
      return;
    }
    const connId = this.backend.getBackendForSystem(systemId);
    if (connId) {
      const result = await this.backend.downloadFileFor(
        connId, systemId, remotePath,
        containerId ?? undefined,
        runtime ?? undefined,
      );
      this.triggerBrowserDownload(result.content, remotePath);
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
    podCtx?: PodContext | null,
  ): Promise<void> {
    const bytes = new Uint8Array(content);
    const chars: string[] = [];
    for (let i = 0; i < bytes.length; i++) {
      chars.push(String.fromCharCode(bytes[i]));
    }
    const base64 = btoa(chars.join(''));

    if (podCtx) {
      return this.backend.uploadPodFileFor(
        podCtx.connectionId, podCtx.clusterId, podCtx.namespace,
        podCtx.podName, remotePath, base64, podCtx.containerName,
      );
    }
    const connId = this.backend.getBackendForSystem(systemId);
    if (connId) {
      return this.backend.uploadFileFor(
        connId, systemId, remotePath, base64,
        containerId ?? undefined,
        runtime ?? undefined,
      );
    }
    throw new Error('uploadFileFromContent is only for backend systems');
  }

  private triggerBrowserDownload(base64Content: string, remotePath: string): void {
    const byteChars = atob(base64Content);
    const byteArray = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteArray[i] = byteChars.charCodeAt(i);
    }
    const blob = new Blob([byteArray]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = remotePath.split(/[/\\]/).pop() || 'download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
