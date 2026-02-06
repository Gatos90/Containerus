import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileBrowserService } from './file-browser.service';

describe('FileBrowserService', () => {
  let service: FileBrowserService;
  let mockTauri: any;

  beforeEach(() => {
    mockTauri = { invoke: vi.fn() };
    service = new FileBrowserService(mockTauri);
  });

  it('should list a directory', async () => {
    const listing = { path: '/home', entries: [], parentPath: '/' };
    mockTauri.invoke.mockResolvedValue(listing);

    const result = await service.listDirectory('sys-1', '/home', 'c-1', 'docker');
    expect(result).toEqual(listing);
    expect(mockTauri.invoke).toHaveBeenCalledWith('list_directory', {
      systemId: 'sys-1',
      path: '/home',
      containerId: 'c-1',
      runtime: 'docker',
    });
  });

  it('should list directory without container', async () => {
    mockTauri.invoke.mockResolvedValue({ path: '/', entries: [], parentPath: null });

    await service.listDirectory('sys-1', '/');
    expect(mockTauri.invoke).toHaveBeenCalledWith('list_directory', {
      systemId: 'sys-1',
      path: '/',
      containerId: undefined,
      runtime: undefined,
    });
  });

  it('should read a file', async () => {
    const content = { path: '/etc/hosts', content: '127.0.0.1 localhost', size: 19, isBinary: false };
    mockTauri.invoke.mockResolvedValue(content);

    const result = await service.readFile('sys-1', '/etc/hosts');
    expect(result).toEqual(content);
    expect(mockTauri.invoke).toHaveBeenCalledWith('read_file', {
      systemId: 'sys-1',
      path: '/etc/hosts',
      containerId: undefined,
      runtime: undefined,
    });
  });

  it('should write a file', async () => {
    mockTauri.invoke.mockResolvedValue(undefined);

    await service.writeFile('sys-1', '/tmp/test.txt', 'hello');
    expect(mockTauri.invoke).toHaveBeenCalledWith('write_file', {
      systemId: 'sys-1',
      path: '/tmp/test.txt',
      content: 'hello',
      containerId: undefined,
      runtime: undefined,
    });
  });

  it('should create a directory', async () => {
    mockTauri.invoke.mockResolvedValue(undefined);

    await service.createDirectory('sys-1', '/tmp/newdir');
    expect(mockTauri.invoke).toHaveBeenCalledWith('create_directory', {
      systemId: 'sys-1',
      path: '/tmp/newdir',
      containerId: undefined,
      runtime: undefined,
    });
  });

  it('should delete a path', async () => {
    mockTauri.invoke.mockResolvedValue(undefined);

    await service.deletePath('sys-1', '/tmp/old', true, 'c-1', 'docker');
    expect(mockTauri.invoke).toHaveBeenCalledWith('delete_path', {
      systemId: 'sys-1',
      path: '/tmp/old',
      isDirectory: true,
      containerId: 'c-1',
      runtime: 'docker',
    });
  });

  it('should rename a path', async () => {
    mockTauri.invoke.mockResolvedValue(undefined);

    await service.renamePath('sys-1', '/tmp/old', '/tmp/new');
    expect(mockTauri.invoke).toHaveBeenCalledWith('rename_path', {
      systemId: 'sys-1',
      oldPath: '/tmp/old',
      newPath: '/tmp/new',
      containerId: undefined,
      runtime: undefined,
    });
  });

  it('should download a file', async () => {
    mockTauri.invoke.mockResolvedValue(undefined);

    await service.downloadFile('sys-1', '/remote/file.txt', '/local/file.txt');
    expect(mockTauri.invoke).toHaveBeenCalledWith('download_file', {
      systemId: 'sys-1',
      remotePath: '/remote/file.txt',
      localPath: '/local/file.txt',
      containerId: undefined,
      runtime: undefined,
    });
  });

  it('should upload a file', async () => {
    mockTauri.invoke.mockResolvedValue(undefined);

    await service.uploadFile('sys-1', '/local/file.txt', '/remote/file.txt');
    expect(mockTauri.invoke).toHaveBeenCalledWith('upload_file', {
      systemId: 'sys-1',
      localPath: '/local/file.txt',
      remotePath: '/remote/file.txt',
      containerId: undefined,
      runtime: undefined,
    });
  });
});
