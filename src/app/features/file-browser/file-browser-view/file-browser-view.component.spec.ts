import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext, ɵChangeDetectionScheduler as ChangeDetectionScheduler, ɵEffectScheduler as EffectScheduler } from '@angular/core';
import { setupTestBed } from '@analogjs/vitest-angular/setup-testbed';
setupTestBed();
import { FileBrowserViewComponent } from './file-browser-view.component';
import { FileBrowserState } from '../../../state/file-browser.state';
import { SystemState } from '../../../state/system.state';
import { ContainerState } from '../../../state/container.state';
import { TerminalState } from '../../../state/terminal.state';
import { ActivatedRoute, Router } from '@angular/router';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFileEntry(overrides: Partial<any> = {}): any {
  return {
    name: 'file.txt',
    path: '/home/file.txt',
    fileType: 'file',
    size: 1024,
    permissions: '-rw-r--r--',
    owner: 'root',
    group: 'root',
    modified: '2025-01-01',
    isHidden: false,
    ...overrides,
  };
}

function makeContainer(overrides: Partial<any> = {}): any {
  return {
    id: 'ctr-1',
    name: 'web',
    image: 'nginx',
    status: 'running',
    runtime: 'docker',
    systemId: 'sys-1',
    createdAt: '2025-01-01',
    ports: [],
    environmentVariables: {},
    volumes: [],
    networkSettings: { networks: {}, portBindings: [] },
    resourceLimits: {},
    labels: {},
    restartPolicy: { name: 'always', maximumRetryCount: 0 },
    healthCheck: null,
    state: { pid: 1, exitCode: 0, error: null, startedAt: null, finishedAt: null, healthStatus: null },
    config: { cmd: null, entrypoint: null, workingDir: null, user: null, hostname: null, domainname: null, tty: false, stopSignal: null },
    hostConfig: { networkMode: null, privileged: false, capAdd: [], capDrop: [], devices: [], shmSize: null, logConfig: null, securityOpt: [], ulimits: [] },
    ...overrides,
  };
}

// No-op Angular schedulers — satisfies effect() requirements in pure unit tests
const noopCDScheduler = { schedule: vi.fn(), notify: vi.fn(), runningTick: false, hasOwnerTick: vi.fn(() => false) };
const noopEffectScheduler = { add: vi.fn(), remove: vi.fn(), flush: vi.fn(), scheduleEffect: vi.fn(), schedule: vi.fn() };

// ─── Factory ──────────────────────────────────────────────────────────────────

function makeComponent() {
  const mockFileBrowserState: any = {
    currentPath: vi.fn(() => '/'),
    listing: vi.fn(() => null),
    loading: vi.fn(() => false),
    error: vi.fn(() => null),
    selectedEntry: vi.fn(() => null),
    editorContent: vi.fn(() => null),
    editorDirty: vi.fn(() => false),
    editorLoading: vi.fn(() => false),
    showHiddenFiles: vi.fn(() => false),
    sortOption: vi.fn(() => 'name'),
    sortDirection: vi.fn(() => 'asc'),
    searchQuery: vi.fn(() => ''),
    systemId: vi.fn(() => null),
    containerId: vi.fn(() => null),
    runtime: vi.fn(() => null),
    breadcrumbs: vi.fn(() => []),
    visibleEntries: vi.fn(() => []),
    canGoBack: vi.fn(() => false),
    canGoForward: vi.fn(() => false),
    parentPath: vi.fn(() => null),
    setContext: vi.fn(),
    navigateTo: vi.fn().mockResolvedValue(undefined),
    goUp: vi.fn().mockResolvedValue(undefined),
    podContext: vi.fn(() => null),
    refresh: vi.fn().mockResolvedValue(undefined),
    createDirectory: vi.fn().mockResolvedValue(undefined),
    renamePath: vi.fn().mockResolvedValue(undefined),
    deletePath: vi.fn().mockResolvedValue(undefined),
    downloadFile: vi.fn().mockResolvedValue(undefined),
    uploadFile: vi.fn().mockResolvedValue(undefined),
    selectEntry: vi.fn(),
    openFile: vi.fn().mockResolvedValue(undefined),
  };

  const mockSystemState: any = {
    systems: vi.fn(() => []),
    getExtendedInfo: vi.fn().mockReturnValue(null),
  };

  const mockContainerState: any = {
    containers: vi.fn(() => []),
    containersBySystem: vi.fn(() => ({})),
  };

  const mockTerminalState: any = {
    dockedFileBrowsers: vi.fn(() => []),
    generateFileBrowserId: vi.fn().mockReturnValue('fb-123'),
    addFileBrowser: vi.fn(),
    updateFileBrowserPath: vi.fn(),
  };

  const mockRoute: any = {
    snapshot: { params: {}, queryParams: {} },
    params: { subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }) },
  };

  const mockRouter: any = { navigate: vi.fn() };

  const injector = Injector.create({
    providers: [
      { provide: ChangeDetectionScheduler, useValue: noopCDScheduler },
      { provide: EffectScheduler, useValue: noopEffectScheduler },
      { provide: FileBrowserState, useValue: mockFileBrowserState },
      { provide: SystemState, useValue: mockSystemState },
      { provide: ContainerState, useValue: mockContainerState },
      { provide: TerminalState, useValue: mockTerminalState },
      { provide: ActivatedRoute, useValue: mockRoute },
      { provide: Router, useValue: mockRouter },
    ],
  });

  const component = runInInjectionContext(injector, () => new FileBrowserViewComponent());
  return { component, mockFileBrowserState, mockSystemState, mockContainerState, mockTerminalState, mockRoute, mockRouter };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FileBrowserViewComponent', () => {
  describe('getSystemName', () => {
    it('should return "Unknown" when systemId is null', () => {
      const { component } = makeComponent();
      component.systemId = null;
      expect(component.getSystemName()).toBe('Unknown');
    });

    it('should return system name when found', () => {
      const { component, mockSystemState } = makeComponent();
      component.systemId = 'sys-1';
      mockSystemState.systems.mockReturnValue([{ id: 'sys-1', name: 'Production' }]);
      expect(component.getSystemName()).toBe('Production');
    });

    it('should return systemId as fallback when system not found', () => {
      const { component, mockSystemState } = makeComponent();
      component.systemId = 'sys-unknown';
      mockSystemState.systems.mockReturnValue([]);
      expect(component.getSystemName()).toBe('sys-unknown');
    });
  });

  describe('getContainerName', () => {
    it('should return null when containerId is null', () => {
      const { component } = makeComponent();
      component.containerId = null;
      expect(component.getContainerName()).toBeNull();
    });

    it('should return display name when container found', () => {
      const { component, mockContainerState } = makeComponent();
      component.containerId = 'ctr-1';
      mockContainerState.containers.mockReturnValue([makeContainer({ id: 'ctr-1', name: 'web' })]);
      expect(component.getContainerName()).toBe('web');
    });

    it('should return truncated id fallback when container not found', () => {
      const { component, mockContainerState } = makeComponent();
      component.containerId = 'abc123def456789';
      mockContainerState.containers.mockReturnValue([]);
      expect(component.getContainerName()).toBe('abc123def456');
    });
  });

  describe('getRunningContainers', () => {
    it('should return only running containers for the system', () => {
      const { component, mockContainerState } = makeComponent();
      const running = makeContainer({ id: 'ctr-1', systemId: 'sys-1', status: 'running' });
      const stopped = makeContainer({ id: 'ctr-2', systemId: 'sys-1', status: 'exited' });
      mockContainerState.containersBySystem.mockReturnValue({ 'sys-1': [running, stopped] });
      const result = component.getRunningContainers('sys-1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('ctr-1');
    });

    it('should return empty array when system has no containers', () => {
      const { component, mockContainerState } = makeComponent();
      mockContainerState.containersBySystem.mockReturnValue({});
      expect(component.getRunningContainers('sys-none')).toEqual([]);
    });
  });

  describe('getContainerDisplayName', () => {
    it('should return container name when available', () => {
      const { component } = makeComponent();
      expect(component.getContainerDisplayName(makeContainer({ name: 'nginx' }))).toBe('nginx');
    });

    it('should return truncated id when name is empty', () => {
      const { component } = makeComponent();
      const container = makeContainer({ id: 'abc123def456789', name: '' });
      expect(component.getContainerDisplayName(container)).toBe('abc123def456');
    });
  });

  describe('toggleExpandSystem', () => {
    it('should expand a collapsed system', () => {
      const { component } = makeComponent();
      component.toggleExpandSystem('sys-1');
      expect(component.expandedSystemId()).toBe('sys-1');
    });

    it('should collapse an already expanded system', () => {
      const { component } = makeComponent();
      component.toggleExpandSystem('sys-1');
      component.toggleExpandSystem('sys-1');
      expect(component.expandedSystemId()).toBeNull();
    });

    it('should switch expanded system when different id used', () => {
      const { component } = makeComponent();
      component.toggleExpandSystem('sys-1');
      component.toggleExpandSystem('sys-2');
      expect(component.expandedSystemId()).toBe('sys-2');
    });
  });

  describe('getRuntimeIcon', () => {
    it('should return Docker for docker runtime', () => {
      const { component } = makeComponent();
      expect(component.getRuntimeIcon({ primaryRuntime: 'docker' })).toBe('Docker');
    });

    it('should return Podman for podman runtime', () => {
      const { component } = makeComponent();
      expect(component.getRuntimeIcon({ primaryRuntime: 'podman' })).toBe('Podman');
    });

    it('should return Apple for apple runtime', () => {
      const { component } = makeComponent();
      expect(component.getRuntimeIcon({ primaryRuntime: 'apple' })).toBe('Apple');
    });

    it('should return Container for unknown runtime', () => {
      const { component } = makeComponent();
      expect(component.getRuntimeIcon({ primaryRuntime: 'other' })).toBe('Container');
    });
  });

  describe('onEntryClick', () => {
    it('should navigate to directory on click', async () => {
      const { component, mockFileBrowserState } = makeComponent();
      const dir = makeFileEntry({ fileType: 'directory', path: '/home/user' });
      await component.onEntryClick(dir);
      expect(mockFileBrowserState.navigateTo).toHaveBeenCalledWith('/home/user');
    });

    it('should select file entry on click (not navigate)', async () => {
      const { component, mockFileBrowserState } = makeComponent();
      const file = makeFileEntry({ fileType: 'file' });
      await component.onEntryClick(file);
      expect(mockFileBrowserState.selectEntry).toHaveBeenCalledWith(file);
      expect(mockFileBrowserState.navigateTo).not.toHaveBeenCalled();
    });
  });

  describe('navigateToEntry', () => {
    it('should navigate to directory', async () => {
      const { component, mockFileBrowserState } = makeComponent();
      const dir = makeFileEntry({ fileType: 'directory', path: '/etc' });
      await component.navigateToEntry(dir);
      expect(mockFileBrowserState.navigateTo).toHaveBeenCalledWith('/etc');
    });

    it('should open text file', async () => {
      const { component, mockFileBrowserState } = makeComponent();
      const file = makeFileEntry({ name: 'config.json', fileType: 'file' });
      await component.navigateToEntry(file);
      expect(mockFileBrowserState.openFile).toHaveBeenCalledWith(file);
    });

    it('should do nothing for binary file', async () => {
      const { component, mockFileBrowserState } = makeComponent();
      const file = makeFileEntry({ name: 'image.png', fileType: 'file' });
      await component.navigateToEntry(file);
      expect(mockFileBrowserState.openFile).not.toHaveBeenCalled();
      expect(mockFileBrowserState.navigateTo).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('should set refreshing to true during refresh', async () => {
      const { component, mockFileBrowserState } = makeComponent();
      let capturedRefreshing = false;
      mockFileBrowserState.refresh.mockImplementation(async () => {
        capturedRefreshing = component.refreshing();
      });
      await component.refresh();
      expect(capturedRefreshing).toBe(true);
    });

    it('should set refreshing back to false after refresh', async () => {
      const { component } = makeComponent();
      await component.refresh();
      expect(component.refreshing()).toBe(false);
    });

    it('should call state.refresh', async () => {
      const { component, mockFileBrowserState } = makeComponent();
      await component.refresh();
      expect(mockFileBrowserState.refresh).toHaveBeenCalledOnce();
    });
  });

  describe('createDirectory', () => {
    it('should call state.createDirectory with trimmed name', async () => {
      const { component, mockFileBrowserState } = makeComponent();
      component.newDirName.set('  my-dir  ');
      await component.createDirectory();
      expect(mockFileBrowserState.createDirectory).toHaveBeenCalledWith('my-dir');
    });

    it('should reset newDirName after creation', async () => {
      const { component } = makeComponent();
      component.newDirName.set('test');
      await component.createDirectory();
      expect(component.newDirName()).toBe('');
    });

    it('should close the dialog after creation', async () => {
      const { component } = makeComponent();
      component.showCreateDirDialog.set(true);
      component.newDirName.set('new-folder');
      await component.createDirectory();
      expect(component.showCreateDirDialog()).toBe(false);
    });

    it('should do nothing when name is empty', async () => {
      const { component, mockFileBrowserState } = makeComponent();
      component.newDirName.set('   ');
      await component.createDirectory();
      expect(mockFileBrowserState.createDirectory).not.toHaveBeenCalled();
    });
  });

  describe('startRename', () => {
    it('should set renameEntry and renameValue', () => {
      const { component } = makeComponent();
      const entry = makeFileEntry({ name: 'old.txt' });
      component.startRename(entry);
      expect(component.renameEntry()).toBe(entry);
      expect(component.renameValue()).toBe('old.txt');
    });

    it('should close context menu on rename start', () => {
      const { component } = makeComponent();
      component.contextMenuEntry.set(makeFileEntry());
      component.startRename(makeFileEntry({ name: 'x.txt' }));
      expect(component.contextMenuEntry()).toBeNull();
    });
  });

  describe('confirmRename', () => {
    it('should call state.renamePath with new name', async () => {
      const { component, mockFileBrowserState } = makeComponent();
      const entry = makeFileEntry({ name: 'old.txt' });
      component.renameEntry.set(entry);
      component.renameValue.set('new.txt');
      await component.confirmRename();
      expect(mockFileBrowserState.renamePath).toHaveBeenCalledWith(entry, 'new.txt');
    });

    it('should clear renameEntry after rename', async () => {
      const { component } = makeComponent();
      component.renameEntry.set(makeFileEntry({ name: 'old.txt' }));
      component.renameValue.set('new.txt');
      await component.confirmRename();
      expect(component.renameEntry()).toBeNull();
    });

    it('should cancel if new name is same as old name', async () => {
      const { component, mockFileBrowserState } = makeComponent();
      const entry = makeFileEntry({ name: 'same.txt' });
      component.renameEntry.set(entry);
      component.renameValue.set('same.txt');
      await component.confirmRename();
      expect(mockFileBrowserState.renamePath).not.toHaveBeenCalled();
      expect(component.renameEntry()).toBeNull();
    });

    it('should cancel if entry is null', async () => {
      const { component, mockFileBrowserState } = makeComponent();
      component.renameEntry.set(null);
      component.renameValue.set('new.txt');
      await component.confirmRename();
      expect(mockFileBrowserState.renamePath).not.toHaveBeenCalled();
    });
  });

  describe('cancelRename', () => {
    it('should clear renameEntry', () => {
      const { component } = makeComponent();
      component.renameEntry.set(makeFileEntry());
      component.cancelRename();
      expect(component.renameEntry()).toBeNull();
    });
  });

  describe('startDelete', () => {
    it('should set confirmDeleteEntry', () => {
      const { component } = makeComponent();
      const entry = makeFileEntry();
      component.startDelete(entry);
      expect(component.confirmDeleteEntry()).toBe(entry);
    });
  });

  describe('confirmDelete', () => {
    it('should call state.deletePath with the entry', async () => {
      const { component, mockFileBrowserState } = makeComponent();
      const entry = makeFileEntry();
      component.confirmDeleteEntry.set(entry);
      await component.confirmDelete();
      expect(mockFileBrowserState.deletePath).toHaveBeenCalledWith(entry);
    });

    it('should clear confirmDeleteEntry after deletion', async () => {
      const { component } = makeComponent();
      component.confirmDeleteEntry.set(makeFileEntry());
      await component.confirmDelete();
      expect(component.confirmDeleteEntry()).toBeNull();
    });

    it('should do nothing when confirmDeleteEntry is null', async () => {
      const { component, mockFileBrowserState } = makeComponent();
      component.confirmDeleteEntry.set(null);
      await component.confirmDelete();
      expect(mockFileBrowserState.deletePath).not.toHaveBeenCalled();
    });
  });

  describe('cancelDelete', () => {
    it('should clear confirmDeleteEntry', () => {
      const { component } = makeComponent();
      component.confirmDeleteEntry.set(makeFileEntry());
      component.cancelDelete();
      expect(component.confirmDeleteEntry()).toBeNull();
    });
  });

  describe('onContextMenu', () => {
    it('should set contextMenuEntry and position', () => {
      const { component } = makeComponent();
      const entry = makeFileEntry();
      const event = { preventDefault: vi.fn(), clientX: 100, clientY: 200 } as any;
      Object.defineProperty(window, 'innerWidth', { value: 1920, writable: true, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: 1080, writable: true, configurable: true });
      component.onContextMenu(event, entry);
      expect(component.contextMenuEntry()).toBe(entry);
      expect(component.contextMenuPos().x).toBe(100);
      expect(component.contextMenuPos().y).toBe(200);
    });

    it('should clamp menu to not overflow right edge', () => {
      const { component } = makeComponent();
      const event = { preventDefault: vi.fn(), clientX: 1910, clientY: 100 } as any;
      Object.defineProperty(window, 'innerWidth', { value: 1920, writable: true, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: 1080, writable: true, configurable: true });
      component.onContextMenu(event, makeFileEntry());
      // 1910 + 180 > 1920, so x should be clamped
      expect(component.contextMenuPos().x).toBeLessThan(1910);
    });

    it('should prevent default', () => {
      const { component } = makeComponent();
      const event = { preventDefault: vi.fn(), clientX: 10, clientY: 10 } as any;
      component.onContextMenu(event, makeFileEntry());
      expect(event.preventDefault).toHaveBeenCalled();
    });
  });

  describe('closeContextMenu', () => {
    it('should clear contextMenuEntry', () => {
      const { component } = makeComponent();
      component.contextMenuEntry.set(makeFileEntry());
      component.closeContextMenu();
      expect(component.contextMenuEntry()).toBeNull();
    });
  });

  describe('getIcon', () => {
    it('should return Folder icon for directories', () => {
      const { component } = makeComponent();
      expect(component.getIcon(makeFileEntry({ fileType: 'directory' }))).toBe(component.Folder);
    });

    it('should return Link icon for symlinks', () => {
      const { component } = makeComponent();
      expect(component.getIcon(makeFileEntry({ fileType: 'symlink' }))).toBe(component.Link);
    });

    it('should return FileCode icon for .ts files', () => {
      const { component } = makeComponent();
      expect(component.getIcon(makeFileEntry({ name: 'app.ts', fileType: 'file' }))).toBe(component.FileCode);
    });

    it('should return FileImage icon for image files', () => {
      const { component } = makeComponent();
      expect(component.getIcon(makeFileEntry({ name: 'logo.png', fileType: 'file' }))).toBe(component.FileImage);
    });

    it('should return FileArchive icon for zip files', () => {
      const { component } = makeComponent();
      expect(component.getIcon(makeFileEntry({ name: 'backup.zip', fileType: 'file' }))).toBe(component.FileArchive);
    });

    it('should return Settings icon for config files', () => {
      const { component } = makeComponent();
      expect(component.getIcon(makeFileEntry({ name: 'config.json', fileType: 'file' }))).toBe(component.Settings);
    });

    it('should return FileText icon for text files', () => {
      const { component } = makeComponent();
      expect(component.getIcon(makeFileEntry({ name: 'readme.md', fileType: 'file' }))).toBe(component.FileText);
    });

    it('should return generic File icon for unknown extensions', () => {
      const { component } = makeComponent();
      expect(component.getIcon(makeFileEntry({ name: 'binary.exe', fileType: 'file' }))).toBe(component.File);
    });
  });

  describe('getIconColor', () => {
    it('should return blue for directories', () => {
      const { component } = makeComponent();
      expect(component.getIconColor(makeFileEntry({ fileType: 'directory' }))).toBe('text-blue-400');
    });

    it('should return purple for symlinks', () => {
      const { component } = makeComponent();
      expect(component.getIconColor(makeFileEntry({ fileType: 'symlink' }))).toBe('text-purple-400');
    });

    it('should return zinc for files', () => {
      const { component } = makeComponent();
      expect(component.getIconColor(makeFileEntry({ fileType: 'file' }))).toBe('text-zinc-400');
    });
  });

  describe('formatSize', () => {
    it('should format 0 bytes', () => {
      const { component } = makeComponent();
      expect(component.formatSize(0)).toBe('0 B');
    });

    it('should format kilobytes', () => {
      const { component } = makeComponent();
      expect(component.formatSize(1024)).toBe('1.0 KB');
    });

    it('should format megabytes', () => {
      const { component } = makeComponent();
      expect(component.formatSize(1024 * 1024)).toBe('1.0 MB');
    });
  });

  describe('isText', () => {
    it('should return true for .md files', () => {
      const { component } = makeComponent();
      expect(component.isText('README.md')).toBe(true);
    });

    it('should return true for Dockerfile', () => {
      const { component } = makeComponent();
      expect(component.isText('Dockerfile')).toBe(true);
    });

    it('should return false for binary files', () => {
      const { component } = makeComponent();
      expect(component.isText('photo.jpg')).toBe(false);
    });
  });

  describe('getSortIcon', () => {
    it('should return empty string when column is not active', () => {
      const { component, mockFileBrowserState } = makeComponent();
      mockFileBrowserState.sortOption.mockReturnValue('name');
      expect(component.getSortIcon('size')).toBe('');
    });

    it('should return ascending arrow for active asc column', () => {
      const { component, mockFileBrowserState } = makeComponent();
      mockFileBrowserState.sortOption.mockReturnValue('name');
      mockFileBrowserState.sortDirection.mockReturnValue('asc');
      expect(component.getSortIcon('name')).toBe(' ↑');
    });

    it('should return descending arrow for active desc column', () => {
      const { component, mockFileBrowserState } = makeComponent();
      mockFileBrowserState.sortOption.mockReturnValue('size');
      mockFileBrowserState.sortDirection.mockReturnValue('desc');
      expect(component.getSortIcon('size')).toBe(' ↓');
    });
  });

  describe('popOutToDock', () => {
    it('should do nothing when systemId is null', () => {
      const { component, mockTerminalState, mockRouter } = makeComponent();
      component.systemId = null;
      component.popOutToDock();
      expect(mockTerminalState.addFileBrowser).not.toHaveBeenCalled();
      expect(mockRouter.navigate).not.toHaveBeenCalled();
    });

    it('should add file browser to dock with current path', () => {
      const { component, mockTerminalState, mockFileBrowserState, mockSystemState } = makeComponent();
      component.systemId = 'sys-1';
      mockSystemState.systems.mockReturnValue([{ id: 'sys-1', name: 'Dev Server' }]);
      mockFileBrowserState.currentPath.mockReturnValue('/home/user');
      mockFileBrowserState.runtime.mockReturnValue(null);
      component.popOutToDock();
      expect(mockTerminalState.addFileBrowser).toHaveBeenCalledWith(
        expect.objectContaining({ systemId: 'sys-1', systemName: 'Dev Server', currentPath: '/home/user' })
      );
    });

    it('should navigate to /containers after popping out', () => {
      const { component, mockSystemState, mockRouter } = makeComponent();
      component.systemId = 'sys-1';
      mockSystemState.systems.mockReturnValue([{ id: 'sys-1', name: 'Server' }]);
      component.popOutToDock();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/containers']);
    });
  });

  describe('selectSystem', () => {
    it('should add file browser to dock for found system', () => {
      const { component, mockSystemState, mockTerminalState } = makeComponent();
      mockSystemState.systems.mockReturnValue([{ id: 'sys-1', name: 'My Server' }]);
      component.selectSystem('sys-1');
      expect(mockTerminalState.addFileBrowser).toHaveBeenCalledWith(
        expect.objectContaining({ systemId: 'sys-1', systemName: 'My Server', currentPath: '/' })
      );
    });

    it('should do nothing when system not found', () => {
      const { component, mockSystemState, mockTerminalState } = makeComponent();
      mockSystemState.systems.mockReturnValue([]);
      component.selectSystem('sys-unknown');
      expect(mockTerminalState.addFileBrowser).not.toHaveBeenCalled();
    });
  });

  describe('selectContainer', () => {
    it('should add container file browser to dock', () => {
      const { component, mockSystemState, mockTerminalState } = makeComponent();
      mockSystemState.systems.mockReturnValue([{ id: 'sys-1', name: 'Dev' }]);
      const container = makeContainer({ id: 'ctr-1', name: 'nginx', runtime: 'docker' });
      component.selectContainer('sys-1', container);
      expect(mockTerminalState.addFileBrowser).toHaveBeenCalledWith(
        expect.objectContaining({
          systemId: 'sys-1',
          containerId: 'ctr-1',
          containerName: 'nginx',
          runtime: 'docker',
          currentPath: '/',
        })
      );
    });

    it('should do nothing when system not found', () => {
      const { component, mockSystemState, mockTerminalState } = makeComponent();
      mockSystemState.systems.mockReturnValue([]);
      component.selectContainer('sys-none', makeContainer());
      expect(mockTerminalState.addFileBrowser).not.toHaveBeenCalled();
    });
  });

  describe('navigateToSystems', () => {
    it('should navigate to /files in route mode', () => {
      const { component, mockRouter } = makeComponent();
      component.embedded = false;
      component.navigateToSystems();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/files']);
    });

    it('should do nothing in embedded mode', () => {
      const { component, mockRouter } = makeComponent();
      component.embedded = true;
      component.navigateToSystems();
      expect(mockRouter.navigate).not.toHaveBeenCalled();
    });
  });

  describe('navigateToSystemRoot', () => {
    it('should route to /files/:systemId with path=/ in route mode', async () => {
      const { component, mockRouter } = makeComponent();
      component.embedded = false;
      component.systemId = 'sys-1';
      component.containerId = 'ctr-1';
      await component.navigateToSystemRoot();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/files', 'sys-1'], { queryParams: { path: '/' } });
    });

    it('should drop container scope and navigate to / in embedded mode', async () => {
      const { component, mockFileBrowserState } = makeComponent();
      component.embedded = true;
      component.systemId = 'sys-1';
      component.containerId = 'ctr-1';
      await component.navigateToSystemRoot();
      expect(component.containerId).toBeNull();
      expect(mockFileBrowserState.setContext).toHaveBeenCalledWith('sys-1', null, null);
      expect(mockFileBrowserState.navigateTo).toHaveBeenCalledWith('/');
    });

    it('should do nothing without a systemId', async () => {
      const { component, mockRouter, mockFileBrowserState } = makeComponent();
      component.systemId = null;
      await component.navigateToSystemRoot();
      expect(mockRouter.navigate).not.toHaveBeenCalled();
      expect(mockFileBrowserState.navigateTo).not.toHaveBeenCalled();
    });
  });

  describe('navigateToContainerRoot', () => {
    it('should route to /files/:systemId/:containerId with path=/', async () => {
      const { component, mockRouter } = makeComponent();
      component.embedded = false;
      component.systemId = 'sys-1';
      component.containerId = 'ctr-1';
      await component.navigateToContainerRoot();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/files', 'sys-1', 'ctr-1'], { queryParams: { path: '/' } });
    });

    it('should navigate state to / in embedded mode', async () => {
      const { component, mockFileBrowserState } = makeComponent();
      component.embedded = true;
      component.systemId = 'sys-1';
      component.containerId = 'ctr-1';
      await component.navigateToContainerRoot();
      expect(mockFileBrowserState.navigateTo).toHaveBeenCalledWith('/');
    });

    it('should do nothing without systemId or containerId', async () => {
      const { component, mockRouter, mockFileBrowserState } = makeComponent();
      component.systemId = 'sys-1';
      component.containerId = null;
      await component.navigateToContainerRoot();
      expect(mockRouter.navigate).not.toHaveBeenCalled();
      expect(mockFileBrowserState.navigateTo).not.toHaveBeenCalled();
    });
  });

  describe('onAltArrowUp', () => {
    function makeEvent(): KeyboardEvent {
      return { preventDefault: vi.fn() } as any;
    }

    it('should call state.goUp when a system is selected', async () => {
      const { component, mockFileBrowserState } = makeComponent();
      component.systemId = 'sys-1';
      const event = makeEvent();
      await component.onAltArrowUp(event);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockFileBrowserState.goUp).toHaveBeenCalledOnce();
    });

    it('should call state.goUp when a pod context is set', async () => {
      const { component, mockFileBrowserState } = makeComponent();
      component.systemId = null;
      mockFileBrowserState.podContext.mockReturnValue({ podName: 'p', namespace: 'n', clusterId: 'c', clusterName: 'c', connectionId: 'c' });
      await component.onAltArrowUp(makeEvent());
      expect(mockFileBrowserState.goUp).toHaveBeenCalledOnce();
    });

    it('should not goUp when no system/pod is selected (picker view)', async () => {
      const { component, mockFileBrowserState } = makeComponent();
      component.systemId = null;
      const event = makeEvent();
      await component.onAltArrowUp(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(mockFileBrowserState.goUp).not.toHaveBeenCalled();
    });

    it('should not goUp while a modal/dialog is open', async () => {
      const { component, mockFileBrowserState } = makeComponent();
      component.systemId = 'sys-1';
      component.showCreateDirDialog.set(true);
      await component.onAltArrowUp(makeEvent());
      expect(mockFileBrowserState.goUp).not.toHaveBeenCalled();

      component.showCreateDirDialog.set(false);
      component.renameEntry.set(makeFileEntry());
      await component.onAltArrowUp(makeEvent());
      expect(mockFileBrowserState.goUp).not.toHaveBeenCalled();

      component.renameEntry.set(null);
      component.confirmDeleteEntry.set(makeFileEntry());
      await component.onAltArrowUp(makeEvent());
      expect(mockFileBrowserState.goUp).not.toHaveBeenCalled();
    });
  });

  describe('ngOnDestroy', () => {
    it('should unsubscribe from params subscription', () => {
      const { component } = makeComponent();
      const unsub = vi.fn();
      component['paramsSub'] = { unsubscribe: unsub } as any;
      component.ngOnDestroy();
      expect(unsub).toHaveBeenCalled();
    });

    it('should not throw when paramsSub is not set', () => {
      const { component } = makeComponent();
      component['paramsSub'] = undefined;
      expect(() => component.ngOnDestroy()).not.toThrow();
    });
  });
});
