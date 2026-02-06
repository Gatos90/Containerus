import { Component, inject, input, signal, effect, OnInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  LucideAngularModule,
  ArrowLeft, ArrowRight, ArrowUp, RefreshCw,
  Search, FolderPlus, Upload, Eye, EyeOff,
  Folder, File, FileText, FileCode, FileImage, FileArchive,
  Link, Settings, Trash2, Pencil, Download, MoreVertical,
  ChevronRight, X, FolderOpen, PanelBottomOpen,
} from 'lucide-angular';
import { FileBrowserState } from '../../../state/file-browser.state';
import { SystemState } from '../../../state/system.state';
import { ContainerState } from '../../../state/container.state';
import { FileEntry, formatFileSize, isTextFile } from '../../../core/models/file-browser.model';
import { ContainerRuntime, getDisplayName } from '../../../core/models/container.model';
import { TerminalState } from '../../../state/terminal.state';
import { FileEditorModalComponent } from '../components/file-editor-modal/file-editor-modal.component';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-file-browser-view',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, FileEditorModalComponent],
  templateUrl: './file-browser-view.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileBrowserViewComponent implements OnInit, OnDestroy {
  readonly state = inject(FileBrowserState);
  readonly systemState = inject(SystemState);
  readonly containerState = inject(ContainerState);
  readonly terminalState = inject(TerminalState);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private paramsSub?: Subscription;

  // Icons
  readonly ArrowLeft = ArrowLeft;
  readonly ArrowRight = ArrowRight;
  readonly ArrowUp = ArrowUp;
  readonly RefreshCw = RefreshCw;
  readonly Search = Search;
  readonly FolderPlus = FolderPlus;
  readonly Upload = Upload;
  readonly Eye = Eye;
  readonly EyeOff = EyeOff;
  readonly Folder = Folder;
  readonly File = File;
  readonly FileText = FileText;
  readonly FileCode = FileCode;
  readonly FileImage = FileImage;
  readonly FileArchive = FileArchive;
  readonly Link = Link;
  readonly Settings = Settings;
  readonly Trash2 = Trash2;
  readonly Pencil = Pencil;
  readonly Download = Download;
  readonly MoreVertical = MoreVertical;
  readonly ChevronRight = ChevronRight;
  readonly X = X;
  readonly FolderOpen = FolderOpen;
  readonly PanelBottomOpen = PanelBottomOpen;

  // Embedded mode inputs (when rendered inside workspace dock)
  readonly embeddedSystemId = input<string>();
  readonly embeddedContainerId = input<string>();
  readonly embeddedRuntime = input<ContainerRuntime>();
  readonly embeddedPath = input<string>();

  // Local UI state
  showCreateDirDialog = signal(false);
  newDirName = signal('');
  renameEntry = signal<FileEntry | null>(null);
  renameValue = signal('');
  confirmDeleteEntry = signal<FileEntry | null>(null);
  contextMenuEntry = signal<FileEntry | null>(null);
  contextMenuPos = signal({ x: 0, y: 0 });
  refreshing = signal(false);
  embedded = false;

  // System selection (when no systemId in route)
  systemId: string | null = null;
  containerId: string | null = null;

  // Path sync effect to keep docked entry in sync
  private pathSyncEffect = effect(() => {
    const path = this.state.currentPath();
    if (this.systemId) {
      const match = this.terminalState.dockedFileBrowsers().find(
        fb => fb.systemId === this.systemId && fb.containerId === (this.containerId ?? undefined)
      );
      if (match) {
        this.terminalState.updateFileBrowserPath(match.id, path);
      }
    }
  });

  // Re-initialize when switching between different docked file browsers
  // Only fires when system/container changes — NOT on path-only changes (avoids infinite loop)
  private embeddedEffect = effect(() => {
    const sysId = this.embeddedSystemId();
    const cId = this.embeddedContainerId();
    const rt = this.embeddedRuntime();
    const path = this.embeddedPath();
    if (sysId && this.embedded) {
      if (sysId !== this.systemId || (cId ?? null) !== this.containerId) {
        this.systemId = sysId;
        this.containerId = cId ?? null;
        this.state.setContext(sysId, cId ?? null, rt ?? null);
        this.state.navigateTo(path ?? '/');
      }
    }
  });

  async ngOnInit(): Promise<void> {
    // Check if we're in embedded mode (inputs provided)
    const sysId = this.embeddedSystemId();
    if (sysId) {
      this.embedded = true;
      this.systemId = sysId;
      this.containerId = this.embeddedContainerId() ?? null;
      this.state.setContext(sysId, this.containerId, this.embeddedRuntime() ?? null);
      await this.state.navigateTo(this.embeddedPath() ?? '/');
      return;
    }

    // Route-based mode
    const params = this.route.snapshot.params;
    this.systemId = params['systemId'] ?? null;
    this.containerId = params['containerId'] ?? null;

    if (this.systemId) {
      await this.initBrowser();
    }

    // Subscribe to route param changes for switching between docked file browsers
    this.paramsSub = this.route.params.subscribe(async (p) => {
      const newSystemId = p['systemId'] ?? null;
      const newContainerId = p['containerId'] ?? null;
      if (newSystemId !== this.systemId || newContainerId !== this.containerId) {
        this.systemId = newSystemId;
        this.containerId = newContainerId;
        if (this.systemId) {
          await this.initBrowser();
        }
      }
    });
  }

  ngOnDestroy(): void {
    this.paramsSub?.unsubscribe();
  }

  private async initBrowser(): Promise<void> {
    if (!this.systemId) return;

    let runtime: ContainerRuntime | null = null;
    if (this.containerId) {
      const queryRuntime = this.route.snapshot.queryParams['runtime'] as ContainerRuntime | undefined;
      if (queryRuntime) {
        runtime = queryRuntime;
      } else {
        const container = this.containerState.containers()
          .find(c => c.id === this.containerId);
        runtime = container?.runtime ?? null;
      }
    }

    this.state.setContext(this.systemId, this.containerId, runtime);
    const initialPath = this.route.snapshot.queryParams['path'] ?? '/';
    await this.state.navigateTo(initialPath);
  }

  // Context helpers
  getSystemName(): string {
    if (!this.systemId) return 'Unknown';
    const system = this.systemState.systems().find(s => s.id === this.systemId);
    return system?.name ?? this.systemId;
  }

  getContainerName(): string | null {
    if (!this.containerId) return null;
    const container = this.containerState.containers().find(c => c.id === this.containerId);
    return container ? getDisplayName(container) : this.containerId.slice(0, 12);
  }

  popOutToDock(): void {
    if (!this.systemId) return;

    this.terminalState.addFileBrowser({
      id: this.terminalState.generateFileBrowserId(),
      systemId: this.systemId,
      containerId: this.containerId ?? undefined,
      runtime: this.state.runtime() ?? undefined,
      systemName: this.getSystemName(),
      containerName: this.getContainerName() ?? undefined,
      currentPath: this.state.currentPath(),
    });

    this.router.navigate(['/containers']);
  }

  // System selection for when no systemId in route
  async selectSystem(systemId: string): Promise<void> {
    this.router.navigate(['/files', systemId]);
  }

  // Navigation
  async navigateToEntry(entry: FileEntry): Promise<void> {
    if (entry.fileType === 'directory') {
      await this.state.navigateTo(entry.path);
    } else if (isTextFile(entry.name)) {
      await this.state.openFile(entry);
    }
  }

  async refresh(): Promise<void> {
    this.refreshing.set(true);
    await this.state.refresh();
    this.refreshing.set(false);
  }

  // File actions
  async createDirectory(): Promise<void> {
    const name = this.newDirName().trim();
    if (!name) return;
    await this.state.createDirectory(name);
    this.newDirName.set('');
    this.showCreateDirDialog.set(false);
  }

  startRename(entry: FileEntry): void {
    this.renameEntry.set(entry);
    this.renameValue.set(entry.name);
    this.closeContextMenu();
  }

  async confirmRename(): Promise<void> {
    const entry = this.renameEntry();
    const newName = this.renameValue().trim();
    if (!entry || !newName || newName === entry.name) {
      this.renameEntry.set(null);
      return;
    }
    await this.state.renamePath(entry, newName);
    this.renameEntry.set(null);
  }

  cancelRename(): void {
    this.renameEntry.set(null);
  }

  startDelete(entry: FileEntry): void {
    this.confirmDeleteEntry.set(entry);
    this.closeContextMenu();
  }

  async confirmDelete(): Promise<void> {
    const entry = this.confirmDeleteEntry();
    if (!entry) return;
    await this.state.deletePath(entry);
    this.confirmDeleteEntry.set(null);
  }

  cancelDelete(): void {
    this.confirmDeleteEntry.set(null);
  }

  async downloadEntry(entry: FileEntry): Promise<void> {
    this.closeContextMenu();
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const localPath = await save({
        defaultPath: entry.name,
        title: 'Save file as...',
      });
      if (localPath) {
        await this.state.downloadFile(entry, localPath);
      }
    } catch (err: any) {
      console.error('Download failed:', err);
    }
  }

  async uploadFile(): Promise<void> {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const filePath = await open({
        multiple: false,
        title: 'Select file to upload',
      });
      if (filePath) {
        const fileName = filePath.split('/').pop() ?? filePath.split('\\').pop() ?? 'uploaded';
        await this.state.uploadFile(filePath, fileName);
      }
    } catch (err: any) {
      console.error('Upload failed:', err);
    }
  }

  // Context menu
  onContextMenu(event: MouseEvent, entry: FileEntry): void {
    event.preventDefault();

    const menuWidth = 180;
    const menuHeight = 200;
    let x = event.clientX;
    let y = event.clientY;

    if (x + menuWidth > window.innerWidth) {
      x = window.innerWidth - menuWidth - 8;
    }
    if (y + menuHeight > window.innerHeight) {
      y = window.innerHeight - menuHeight - 8;
    }
    if (x < 0) x = 8;
    if (y < 0) y = 8;

    this.contextMenuEntry.set(entry);
    this.contextMenuPos.set({ x, y });
  }

  closeContextMenu(): void {
    this.contextMenuEntry.set(null);
  }

  // Helpers
  getIcon(entry: FileEntry) {
    if (entry.fileType === 'directory') return this.Folder;
    if (entry.fileType === 'symlink') return this.Link;

    const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
    const codeExts = new Set(['ts', 'js', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'rb', 'sh', 'bash']);
    const imageExts = new Set(['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'ico']);
    const archiveExts = new Set(['zip', 'tar', 'gz', 'bz2', 'xz', 'rar', '7z']);
    const configExts = new Set(['json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'cfg', 'conf']);

    if (codeExts.has(ext)) return this.FileCode;
    if (imageExts.has(ext)) return this.FileImage;
    if (archiveExts.has(ext)) return this.FileArchive;
    if (configExts.has(ext)) return this.Settings;
    if (isTextFile(entry.name)) return this.FileText;
    return this.File;
  }

  getIconColor(entry: FileEntry): string {
    if (entry.fileType === 'directory') return 'text-blue-400';
    if (entry.fileType === 'symlink') return 'text-purple-400';
    return 'text-zinc-400';
  }

  formatSize(bytes: number): string {
    return formatFileSize(bytes);
  }

  isText(name: string): boolean {
    return isTextFile(name);
  }

  getSortIcon(column: string): string {
    if (this.state.sortOption() !== column) return '';
    return this.state.sortDirection() === 'asc' ? ' ↑' : ' ↓';
  }
}
