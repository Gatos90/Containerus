import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { CommandHistoryService } from './command-history.service';
import { TerminalService } from '../../../core/services/terminal.service';

describe('CommandHistoryService', () => {
  let service: CommandHistoryService;
  let mockTerminalService: any;

  beforeEach(() => {
    // Clear localStorage
    localStorage.clear();

    mockTerminalService = {
      fetchShellHistory: vi.fn().mockResolvedValue([]),
    };

    const injector = Injector.create({
      providers: [
        { provide: TerminalService, useValue: mockTerminalService },
      ],
    });

    service = runInInjectionContext(injector, () => new CommandHistoryService());
  });

  it('should start with empty history', () => {
    expect(service.history()).toEqual([]);
    expect(service.commands()).toEqual([]);
  });

  it('should add a command to history', () => {
    service.add('ls -la');

    expect(service.history()).toHaveLength(1);
    expect(service.history()[0].text).toBe('ls -la');
    expect(service.history()[0].source).toBe('user');
  });

  it('should add AI commands', () => {
    service.add('docker ps', 'ai');

    expect(service.history()[0].source).toBe('ai');
  });

  it('should trim whitespace', () => {
    service.add('  ls -la  ');

    expect(service.history()[0].text).toBe('ls -la');
  });

  it('should not add empty commands', () => {
    service.add('');
    service.add('   ');

    expect(service.history()).toHaveLength(0);
  });

  it('should deduplicate entries', () => {
    service.add('ls');
    service.add('pwd');
    service.add('ls'); // duplicate

    expect(service.history()).toHaveLength(2);
    // Most recent first
    expect(service.history()[0].text).toBe('ls');
    expect(service.history()[1].text).toBe('pwd');
  });

  it('should return all commands via getAll()', () => {
    service.add('ls');
    service.add('pwd');

    expect(service.getAll()).toEqual(['pwd', 'ls']);
  });

  it('should return commands via computed signal', () => {
    service.add('ls');
    service.add('pwd');

    expect(service.commands()).toEqual(['pwd', 'ls']);
  });

  it('should clear history', () => {
    service.add('ls');
    service.add('pwd');

    service.clear();

    expect(service.history()).toHaveLength(0);
  });

  it('should load remote history', async () => {
    mockTerminalService.fetchShellHistory.mockResolvedValue(['git status', 'npm install']);

    await service.loadRemoteHistory('sys-1');

    expect(service.history()).toHaveLength(2);
    expect(service.history()[0].source).toBe('shell');
  });

  it('should not load remote history twice for same system', async () => {
    mockTerminalService.fetchShellHistory.mockResolvedValue(['git status']);

    await service.loadRemoteHistory('sys-1');
    await service.loadRemoteHistory('sys-1');

    expect(mockTerminalService.fetchShellHistory).toHaveBeenCalledTimes(1);
  });

  it('should load remote history for different systems', async () => {
    mockTerminalService.fetchShellHistory.mockResolvedValue(['cmd1']);

    await service.loadRemoteHistory('sys-1');
    await service.loadRemoteHistory('sys-2');

    expect(mockTerminalService.fetchShellHistory).toHaveBeenCalledTimes(2);
  });

  it('should not duplicate remote commands that already exist locally', async () => {
    service.add('git status');
    mockTerminalService.fetchShellHistory.mockResolvedValue(['git status', 'npm install']);

    await service.loadRemoteHistory('sys-1');

    // git status already exists, only npm install is new
    const texts = service.history().map((e) => e.text);
    const gitCount = texts.filter((t) => t === 'git status').length;
    expect(gitCount).toBe(1);
  });

  it('should handle remote history load error gracefully', async () => {
    mockTerminalService.fetchShellHistory.mockRejectedValue(new Error('SSH error'));

    await service.loadRemoteHistory('sys-1');

    // Should not crash, history stays as is
    expect(service.history()).toHaveLength(0);
  });

  it('should search remote history', async () => {
    mockTerminalService.fetchShellHistory.mockResolvedValue(['git log']);

    // Need to set currentSystemId first via loadRemoteHistory
    await service.loadRemoteHistory('sys-1');

    mockTerminalService.fetchShellHistory.mockResolvedValue(['git diff', 'git log']);
    const results = await service.searchRemoteHistory('git');

    expect(results).toEqual(['git diff', 'git log']);
  });

  it('should return empty for search without system', async () => {
    const results = await service.searchRemoteHistory('git');
    expect(results).toEqual([]);
  });

  it('should return empty for empty search query', async () => {
    mockTerminalService.fetchShellHistory.mockResolvedValue([]);
    await service.loadRemoteHistory('sys-1');

    const results = await service.searchRemoteHistory('');
    expect(results).toEqual([]);
  });

  it('should handle search error gracefully', async () => {
    mockTerminalService.fetchShellHistory.mockResolvedValue([]);
    await service.loadRemoteHistory('sys-1');

    mockTerminalService.fetchShellHistory.mockRejectedValue(new Error('timeout'));
    const results = await service.searchRemoteHistory('git');

    expect(results).toEqual([]);
  });

  it('should persist to localStorage', () => {
    service.add('ls');

    const stored = JSON.parse(localStorage.getItem('warp-command-history') || '[]');
    expect(stored).toHaveLength(1);
    expect(stored[0].text).toBe('ls');
  });

  it('should clear from localStorage on clear()', () => {
    service.add('ls');
    service.clear();

    expect(localStorage.getItem('warp-command-history')).toBeNull();
  });
});
