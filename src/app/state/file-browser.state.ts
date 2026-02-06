import { computed, Injectable, signal } from '@angular/core';
import { ContainerRuntime } from '../core/models/container.model';
import {
  Breadcrumb,
  DirectoryListing,
  FileContent,
  FileEntry,
  FileSortOption,
  SortDirection,
} from '../core/models/file-browser.model';
import { FileBrowserService } from '../core/services/file-browser.service';

@Injectable({ providedIn: 'root' })
export class FileBrowserState {
  // Core state
  private _listing = signal<DirectoryListing | null>(null);
  private _currentPath = signal('/');
  private _loading = signal(false);
  private _error = signal<string | null>(null);
  private _selectedEntry = signal<FileEntry | null>(null);

  // Editor state
  private _editorContent = signal<FileContent | null>(null);
  private _editorDirty = signal(false);
  private _editorLoading = signal(false);

  // Navigation history
  private _history = signal<string[]>([]);
  private _historyIndex = signal(-1);

  // View options
  private _showHiddenFiles = signal(false);
  private _sortOption = signal<FileSortOption>('name');
  private _sortDirection = signal<SortDirection>('asc');
  private _searchQuery = signal('');

  // Context
  private _systemId = signal<string | null>(null);
  private _containerId = signal<string | null>(null);
  private _runtime = signal<ContainerRuntime | null>(null);

  // Public readonly
  readonly listing = this._listing.asReadonly();
  readonly currentPath = this._currentPath.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly selectedEntry = this._selectedEntry.asReadonly();
  readonly editorContent = this._editorContent.asReadonly();
  readonly editorDirty = this._editorDirty.asReadonly();
  readonly editorLoading = this._editorLoading.asReadonly();
  readonly showHiddenFiles = this._showHiddenFiles.asReadonly();
  readonly sortOption = this._sortOption.asReadonly();
  readonly sortDirection = this._sortDirection.asReadonly();
  readonly searchQuery = this._searchQuery.asReadonly();
  readonly systemId = this._systemId.asReadonly();
  readonly containerId = this._containerId.asReadonly();
  readonly runtime = this._runtime.asReadonly();

  // Computed: breadcrumbs
  readonly breadcrumbs = computed<Breadcrumb[]>(() => {
    const path = this._currentPath();
    const parts = path.split('/').filter(Boolean);
    const crumbs: Breadcrumb[] = [{ name: '/', path: '/' }];
    let accumulated = '';
    for (const part of parts) {
      accumulated += '/' + part;
      crumbs.push({ name: part, path: accumulated });
    }
    return crumbs;
  });

  // Computed: filtered + sorted entries
  readonly visibleEntries = computed(() => {
    const listing = this._listing();
    if (!listing) return [];

    let entries = [...listing.entries];

    if (!this._showHiddenFiles()) {
      entries = entries.filter(e => !e.isHidden);
    }

    const query = this._searchQuery().toLowerCase();
    if (query) {
      entries = entries.filter(e => e.name.toLowerCase().includes(query));
    }

    const dir = this._sortDirection() === 'asc' ? 1 : -1;
    entries.sort((a, b) => {
      // Directories always first
      if (a.fileType === 'directory' && b.fileType !== 'directory') return -1;
      if (a.fileType !== 'directory' && b.fileType === 'directory') return 1;

      switch (this._sortOption()) {
        case 'name':
          return dir * a.name.localeCompare(b.name);
        case 'size':
          return dir * (a.size - b.size);
        case 'modified':
          return dir * a.modified.localeCompare(b.modified);
        case 'type': {
          const extA = a.name.includes('.') ? a.name.split('.').pop()! : '';
          const extB = b.name.includes('.') ? b.name.split('.').pop()! : '';
          return dir * extA.localeCompare(extB);
        }
        default:
          return 0;
      }
    });

    return entries;
  });

  readonly canGoBack = computed(() => this._historyIndex() > 0);
  readonly canGoForward = computed(() => this._historyIndex() < this._history().length - 1);
  readonly parentPath = computed(() => this._listing()?.parentPath ?? null);

  constructor(private service: FileBrowserService) {}

  /** Extract a readable error message from Tauri serialized errors or standard Errors */
  private extractError(err: unknown, fallback: string): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    if (typeof err === 'object' && err !== null) {
      // Tauri serialized enum: { "VariantName": "message" } or { "VariantName": { command, stderr, ... } }
      const keys = Object.keys(err);
      if (keys.length === 1) {
        const value = (err as Record<string, unknown>)[keys[0]];
        if (typeof value === 'string') return value;
        if (typeof value === 'object' && value !== null) {
          const obj = value as Record<string, unknown>;
          if (typeof obj['stderr'] === 'string' && obj['stderr']) return obj['stderr'];
          if (typeof obj['message'] === 'string' && obj['message']) return obj['message'];
        }
      }
    }
    return fallback;
  }

  /** Set the target system (and optionally container) */
  setContext(systemId: string, containerId?: string | null, runtime?: ContainerRuntime | null): void {
    this._systemId.set(systemId);
    this._containerId.set(containerId ?? null);
    this._runtime.set(runtime ?? null);
    this._history.set([]);
    this._historyIndex.set(-1);
    this._listing.set(null);
    this._editorContent.set(null);
    this._error.set(null);
    this._selectedEntry.set(null);
    this._currentPath.set('/');
    this._searchQuery.set('');
  }

  /** Navigate to a directory path */
  async navigateTo(path: string): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    this._selectedEntry.set(null);

    try {
      const listing = await this.service.listDirectory(
        this._systemId()!,
        path,
        this._containerId(),
        this._runtime(),
      );
      this._listing.set(listing);
      this._currentPath.set(path);

      // Update history
      const history = this._history();
      const idx = this._historyIndex();
      const newHistory = [...history.slice(0, idx + 1), path];
      this._history.set(newHistory);
      this._historyIndex.set(newHistory.length - 1);
    } catch (err: any) {
      this._error.set(this.extractError(err, 'Operation failed'));
    } finally {
      this._loading.set(false);
    }
  }

  /** Navigate to parent directory */
  async goUp(): Promise<void> {
    const parent = this.parentPath();
    if (parent) await this.navigateTo(parent);
  }

  /** Navigate back in history */
  async goBack(): Promise<void> {
    if (!this.canGoBack()) return;
    const newIdx = this._historyIndex() - 1;
    this._historyIndex.set(newIdx);
    await this.loadDirectory(this._history()[newIdx]);
  }

  /** Navigate forward in history */
  async goForward(): Promise<void> {
    if (!this.canGoForward()) return;
    const newIdx = this._historyIndex() + 1;
    this._historyIndex.set(newIdx);
    await this.loadDirectory(this._history()[newIdx]);
  }

  /** Open a file for viewing/editing */
  async openFile(entry: FileEntry): Promise<void> {
    this._editorLoading.set(true);
    this._error.set(null);

    try {
      const content = await this.service.readFile(
        this._systemId()!,
        entry.path,
        this._containerId(),
        this._runtime(),
      );
      this._editorContent.set(content);
      this._editorDirty.set(false);
    } catch (err: any) {
      this._error.set(this.extractError(err, 'Operation failed'));
    } finally {
      this._editorLoading.set(false);
    }
  }

  /** Save the currently edited file */
  async saveFile(content: string): Promise<boolean> {
    const file = this._editorContent();
    if (!file) return false;

    this._editorLoading.set(true);
    try {
      await this.service.writeFile(
        this._systemId()!,
        file.path,
        content,
        this._containerId(),
        this._runtime(),
      );
      this._editorContent.update(f => f ? { ...f, content } : null);
      this._editorDirty.set(false);
      return true;
    } catch (err: any) {
      this._error.set(this.extractError(err, 'Operation failed'));
      return false;
    } finally {
      this._editorLoading.set(false);
    }
  }

  closeEditor(): void {
    this._editorContent.set(null);
    this._editorDirty.set(false);
  }

  /** Create a new directory in the current path */
  async createDirectory(name: string): Promise<boolean> {
    const currentPath = this._currentPath();
    const newPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;

    try {
      await this.service.createDirectory(
        this._systemId()!, newPath, this._containerId(), this._runtime(),
      );
      await this.refresh();
      return true;
    } catch (err: any) {
      this._error.set(this.extractError(err, 'Operation failed'));
      return false;
    }
  }

  /** Delete a file or directory */
  async deletePath(entry: FileEntry): Promise<boolean> {
    try {
      await this.service.deletePath(
        this._systemId()!, entry.path, entry.fileType === 'directory',
        this._containerId(), this._runtime(),
      );
      await this.refresh();
      return true;
    } catch (err: any) {
      this._error.set(this.extractError(err, 'Operation failed'));
      return false;
    }
  }

  /** Rename a file or directory */
  async renamePath(entry: FileEntry, newName: string): Promise<boolean> {
    const parent = entry.path.substring(0, entry.path.lastIndexOf('/'));
    const newPath = parent ? `${parent}/${newName}` : `/${newName}`;

    try {
      await this.service.renamePath(
        this._systemId()!, entry.path, newPath,
        this._containerId(), this._runtime(),
      );
      await this.refresh();
      return true;
    } catch (err: any) {
      this._error.set(this.extractError(err, 'Operation failed'));
      return false;
    }
  }

  /** Download a file to a local path */
  async downloadFile(entry: FileEntry, localPath: string): Promise<boolean> {
    try {
      await this.service.downloadFile(
        this._systemId()!, entry.path, localPath,
        this._containerId(), this._runtime(),
      );
      return true;
    } catch (err: any) {
      this._error.set(this.extractError(err, 'Operation failed'));
      return false;
    }
  }

  /** Upload a local file to the current directory */
  async uploadFile(localPath: string, fileName: string): Promise<boolean> {
    const currentPath = this._currentPath();
    const remotePath = currentPath === '/' ? `/${fileName}` : `${currentPath}/${fileName}`;

    try {
      await this.service.uploadFile(
        this._systemId()!, localPath, remotePath,
        this._containerId(), this._runtime(),
      );
      await this.refresh();
      return true;
    } catch (err: any) {
      this._error.set(this.extractError(err, 'Operation failed'));
      return false;
    }
  }

  /** Refresh the current directory listing */
  async refresh(): Promise<void> {
    await this.loadDirectory(this._currentPath());
  }

  // View option setters
  toggleHiddenFiles(): void {
    this._showHiddenFiles.update(v => !v);
  }

  setSortOption(option: FileSortOption): void {
    if (this._sortOption() === option) {
      this._sortDirection.update(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      this._sortOption.set(option);
      this._sortDirection.set('asc');
    }
  }

  setSearchQuery(query: string): void {
    this._searchQuery.set(query);
  }

  selectEntry(entry: FileEntry | null): void {
    this._selectedEntry.set(entry);
  }

  setEditorDirty(dirty: boolean): void {
    this._editorDirty.set(dirty);
  }

  clearError(): void {
    this._error.set(null);
  }

  /** Load a directory without adding to history */
  private async loadDirectory(path: string): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      const listing = await this.service.listDirectory(
        this._systemId()!, path, this._containerId(), this._runtime(),
      );
      this._listing.set(listing);
      this._currentPath.set(path);
    } catch (err: any) {
      this._error.set(this.extractError(err, 'Operation failed'));
    } finally {
      this._loading.set(false);
    }
  }
}
