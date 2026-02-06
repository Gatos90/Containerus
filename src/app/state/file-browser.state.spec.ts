import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileBrowserState } from './file-browser.state';
import type { FileEntry } from '../core/models/file-browser.model';

describe('FileBrowserState', () => {
  let state: FileBrowserState;
  let mockService: any;

  const makeEntry = (overrides: Partial<FileEntry> = {}): FileEntry => ({
    name: 'test.txt',
    path: '/home/test.txt',
    fileType: 'file',
    size: 1024,
    permissions: '-rw-r--r--',
    owner: 'user',
    group: 'staff',
    modified: '2024-01-01T00:00:00Z',
    symlinkTarget: null,
    isHidden: false,
    ...overrides,
  } as any);

  beforeEach(() => {
    mockService = {
      listDirectory: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      createDirectory: vi.fn(),
      deletePath: vi.fn(),
      renamePath: vi.fn(),
      downloadFile: vi.fn(),
      uploadFile: vi.fn(),
    };
    state = new FileBrowserState(mockService);
  });

  it('should start with default state', () => {
    expect(state.currentPath()).toBe('/');
    expect(state.loading()).toBe(false);
    expect(state.error()).toBeNull();
    expect(state.listing()).toBeNull();
    expect(state.selectedEntry()).toBeNull();
    expect(state.editorContent()).toBeNull();
    expect(state.showHiddenFiles()).toBe(false);
  });

  it('should set context', () => {
    state.setContext('sys-1', 'c-1', 'docker' as any);

    expect(state.systemId()).toBe('sys-1');
    expect(state.containerId()).toBe('c-1');
    expect(state.runtime()).toBe('docker');
    expect(state.currentPath()).toBe('/');
  });

  it('should navigate to directory', async () => {
    state.setContext('sys-1');

    const listing = {
      path: '/home',
      entries: [makeEntry()],
      parentPath: '/',
    };
    mockService.listDirectory.mockResolvedValue(listing);

    await state.navigateTo('/home');
    expect(state.currentPath()).toBe('/home');
    expect(state.listing()).toEqual(listing);
    expect(state.loading()).toBe(false);
  });

  it('should handle navigation error', async () => {
    state.setContext('sys-1');
    mockService.listDirectory.mockRejectedValue(new Error('Permission denied'));

    await state.navigateTo('/root');
    expect(state.error()).toBe('Permission denied');
  });

  it('should compute breadcrumbs', () => {
    state.setContext('sys-1');

    expect(state.breadcrumbs()).toEqual([{ name: '/', path: '/' }]);
  });

  it('should compute breadcrumbs for nested path', async () => {
    state.setContext('sys-1');
    mockService.listDirectory.mockResolvedValue({
      path: '/home/user/docs',
      entries: [],
      parentPath: '/home/user',
    });
    await state.navigateTo('/home/user/docs');

    const crumbs = state.breadcrumbs();
    expect(crumbs).toHaveLength(4);
    expect(crumbs[0]).toEqual({ name: '/', path: '/' });
    expect(crumbs[1]).toEqual({ name: 'home', path: '/home' });
    expect(crumbs[2]).toEqual({ name: 'user', path: '/home/user' });
    expect(crumbs[3]).toEqual({ name: 'docs', path: '/home/user/docs' });
  });

  it('should filter hidden files', async () => {
    state.setContext('sys-1');
    mockService.listDirectory.mockResolvedValue({
      path: '/home',
      entries: [
        makeEntry({ name: 'visible.txt', isHidden: false }),
        makeEntry({ name: '.hidden', isHidden: true }),
      ],
      parentPath: '/',
    });
    await state.navigateTo('/home');

    // Hidden files not shown by default
    expect(state.visibleEntries()).toHaveLength(1);
    expect(state.visibleEntries()[0].name).toBe('visible.txt');

    // Show hidden files
    state.toggleHiddenFiles();
    expect(state.visibleEntries()).toHaveLength(2);
  });

  it('should filter by search query', async () => {
    state.setContext('sys-1');
    mockService.listDirectory.mockResolvedValue({
      path: '/',
      entries: [
        makeEntry({ name: 'readme.md' }),
        makeEntry({ name: 'package.json' }),
      ],
      parentPath: null,
    });
    await state.navigateTo('/');

    state.setSearchQuery('readme');
    expect(state.visibleEntries()).toHaveLength(1);
    expect(state.visibleEntries()[0].name).toBe('readme.md');
  });

  it('should sort directories first', async () => {
    state.setContext('sys-1');
    mockService.listDirectory.mockResolvedValue({
      path: '/',
      entries: [
        makeEntry({ name: 'file.txt', fileType: 'file' as any }),
        makeEntry({ name: 'dir', fileType: 'directory' as any }),
      ],
      parentPath: null,
    });
    await state.navigateTo('/');

    expect(state.visibleEntries()[0].name).toBe('dir');
    expect(state.visibleEntries()[1].name).toBe('file.txt');
  });

  it('should sort by name ascending by default', async () => {
    state.setContext('sys-1');
    mockService.listDirectory.mockResolvedValue({
      path: '/',
      entries: [
        makeEntry({ name: 'zebra.txt' }),
        makeEntry({ name: 'alpha.txt' }),
      ],
      parentPath: null,
    });
    await state.navigateTo('/');

    expect(state.visibleEntries()[0].name).toBe('alpha.txt');
  });

  it('should toggle sort direction on same option', () => {
    expect(state.sortDirection()).toBe('asc');

    state.setSortOption('name');
    expect(state.sortDirection()).toBe('desc');

    state.setSortOption('name');
    expect(state.sortDirection()).toBe('asc');
  });

  it('should reset direction when changing sort option', () => {
    state.setSortOption('name'); // asc -> desc
    state.setSortOption('size'); // new option -> asc
    expect(state.sortDirection()).toBe('asc');
    expect(state.sortOption()).toBe('size');
  });

  it('should open a file', async () => {
    state.setContext('sys-1');
    const fileContent = { path: '/test.txt', content: 'Hello', size: 5, isBinary: false };
    mockService.readFile.mockResolvedValue(fileContent);

    const entry = makeEntry({ path: '/test.txt' });
    await state.openFile(entry);

    expect(state.editorContent()).toEqual(fileContent);
    expect(state.editorDirty()).toBe(false);
  });

  it('should save a file', async () => {
    state.setContext('sys-1');
    mockService.readFile.mockResolvedValue({ path: '/test.txt', content: 'Old', size: 3, isBinary: false });
    await state.openFile(makeEntry({ path: '/test.txt' }));

    mockService.writeFile.mockResolvedValue(undefined);
    const result = await state.saveFile('New content');

    expect(result).toBe(true);
    expect(state.editorDirty()).toBe(false);
    expect(state.editorContent()?.content).toBe('New content');
  });

  it('should return false when saving without open file', async () => {
    const result = await state.saveFile('content');
    expect(result).toBe(false);
  });

  it('should close editor', async () => {
    state.setContext('sys-1');
    mockService.readFile.mockResolvedValue({ path: '/test.txt', content: 'x', size: 1, isBinary: false });
    await state.openFile(makeEntry());

    state.closeEditor();
    expect(state.editorContent()).toBeNull();
    expect(state.editorDirty()).toBe(false);
  });

  it('should create a directory', async () => {
    state.setContext('sys-1');
    mockService.listDirectory.mockResolvedValue({ path: '/home', entries: [], parentPath: '/' });
    await state.navigateTo('/home');

    mockService.createDirectory.mockResolvedValue(undefined);
    const result = await state.createDirectory('newdir');
    expect(result).toBe(true);
    expect(mockService.createDirectory).toHaveBeenCalledWith('sys-1', '/home/newdir', null, null);
  });

  it('should create directory at root', async () => {
    state.setContext('sys-1');
    mockService.listDirectory.mockResolvedValue({ path: '/', entries: [], parentPath: null });
    await state.navigateTo('/');

    mockService.createDirectory.mockResolvedValue(undefined);
    await state.createDirectory('newdir');
    expect(mockService.createDirectory).toHaveBeenCalledWith('sys-1', '/newdir', null, null);
  });

  it('should delete a path', async () => {
    state.setContext('sys-1');
    mockService.listDirectory.mockResolvedValue({ path: '/', entries: [], parentPath: null });
    await state.navigateTo('/');

    mockService.deletePath.mockResolvedValue(undefined);
    const entry = makeEntry({ path: '/old.txt', fileType: 'file' as any });
    const result = await state.deletePath(entry);
    expect(result).toBe(true);
  });

  it('should rename a path', async () => {
    state.setContext('sys-1');
    mockService.listDirectory.mockResolvedValue({ path: '/', entries: [], parentPath: null });
    await state.navigateTo('/');

    mockService.renamePath.mockResolvedValue(undefined);
    const entry = makeEntry({ path: '/home/old.txt' });
    const result = await state.renamePath(entry, 'new.txt');
    expect(result).toBe(true);
    expect(mockService.renamePath).toHaveBeenCalledWith('sys-1', '/home/old.txt', '/home/new.txt', null, null);
  });

  it('should navigate back and forward in history', async () => {
    state.setContext('sys-1');
    mockService.listDirectory.mockResolvedValue({ path: '/', entries: [], parentPath: null });
    await state.navigateTo('/');

    mockService.listDirectory.mockResolvedValue({ path: '/home', entries: [], parentPath: '/' });
    await state.navigateTo('/home');

    mockService.listDirectory.mockResolvedValue({ path: '/home/user', entries: [], parentPath: '/home' });
    await state.navigateTo('/home/user');

    expect(state.canGoBack()).toBe(true);
    expect(state.canGoForward()).toBe(false);

    // Go back
    mockService.listDirectory.mockResolvedValue({ path: '/home', entries: [], parentPath: '/' });
    await state.goBack();
    expect(state.currentPath()).toBe('/home');
    expect(state.canGoForward()).toBe(true);

    // Go forward
    mockService.listDirectory.mockResolvedValue({ path: '/home/user', entries: [], parentPath: '/home' });
    await state.goForward();
    expect(state.currentPath()).toBe('/home/user');
  });

  it('should navigate up to parent', async () => {
    state.setContext('sys-1');
    mockService.listDirectory.mockResolvedValue({ path: '/home/user', entries: [], parentPath: '/home' });
    await state.navigateTo('/home/user');

    mockService.listDirectory.mockResolvedValue({ path: '/home', entries: [], parentPath: '/' });
    await state.goUp();
    expect(state.currentPath()).toBe('/home');
  });

  it('should extract error from various formats', async () => {
    state.setContext('sys-1');

    // String error
    mockService.listDirectory.mockRejectedValue('string error');
    await state.navigateTo('/test');
    expect(state.error()).toBe('string error');

    // Object with stderr
    mockService.listDirectory.mockRejectedValue({ CommandFailed: { stderr: 'cmd failed' } });
    await state.navigateTo('/test2');
    expect(state.error()).toBe('cmd failed');
  });

  it('should select and deselect entry', () => {
    const entry = makeEntry();
    state.selectEntry(entry);
    expect(state.selectedEntry()).toEqual(entry);

    state.selectEntry(null);
    expect(state.selectedEntry()).toBeNull();
  });

  it('should set editor dirty', () => {
    state.setEditorDirty(true);
    expect(state.editorDirty()).toBe(true);
  });

  it('should clear error', () => {
    state.clearError();
    expect(state.error()).toBeNull();
  });
});
