import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Injector,
  runInInjectionContext,
  ɵChangeDetectionScheduler,
  ɵEffectScheduler,
} from '@angular/core';
import { LogsViewerModalComponent } from './logs-viewer-modal.component';
import { ContainerService } from '../../../../core/services/container.service';
import { ClipboardService } from '../../../../core/services/clipboard.service';
import { Container } from '../../../../core/models/container.model';

function makeComponent(): { component: LogsViewerModalComponent; mockContainerService: any; mockClipboard: any } {
  const mockContainerService = {
    getLogs: vi.fn().mockResolvedValue('line1\nline2\nline3'),
  };

  const mockClipboard = {
    copy: vi.fn().mockResolvedValue(true),
  };

  const injector = Injector.create({
    providers: [
      { provide: ContainerService, useValue: mockContainerService },
      { provide: ClipboardService, useValue: mockClipboard },
      { provide: ɵChangeDetectionScheduler, useValue: { notify: vi.fn(), runningTick: false } },
      { provide: ɵEffectScheduler, useValue: { add: vi.fn(), remove: vi.fn(), schedule: vi.fn(), flush: vi.fn() } },
    ],
  });

  const component = runInInjectionContext(injector, () => new LogsViewerModalComponent());
  return { component, mockContainerService, mockClipboard };
}

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'abc123def456',
    name: 'my-container',
    image: 'nginx:latest',
    status: 'running',
    runtime: 'docker',
    systemId: 'sys-1',
    createdAt: '2024-06-01T12:00:00Z',
    ports: [],
    environmentVariables: {},
    volumes: [],
    networkSettings: { networks: {}, portBindings: [] },
    resourceLimits: {},
    labels: {},
    restartPolicy: { name: 'no', maximumRetryCount: 0 },
    healthCheck: null,
    state: { pid: 0, exitCode: 0, error: null, startedAt: null, finishedAt: null, healthStatus: null },
    config: { cmd: null, entrypoint: null, workingDir: null, user: null, hostname: null, domainname: null, tty: false, stopSignal: null },
    hostConfig: { networkMode: null, privileged: false, capAdd: [], capDrop: [], devices: [], shmSize: null, logConfig: null, securityOpt: [], ulimits: [] },
    ...overrides,
  } as Container;
}

describe('LogsViewerModalComponent', () => {
  let component: LogsViewerModalComponent;
  let mockContainerService: any;
  let mockClipboard: any;

  beforeEach(() => {
    const result = makeComponent();
    component = result.component;
    mockContainerService = result.mockContainerService;
    mockClipboard = result.mockClipboard;
  });

  // --- Construction ---

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize logs as empty string', () => {
    expect(component.logs()).toBe('');
  });

  it('should initialize isLoading as true', () => {
    expect(component.isLoading()).toBe(true);
  });

  it('should initialize error as null', () => {
    expect(component.error()).toBeNull();
  });

  it('should initialize tailSize as 500', () => {
    expect(component.tailSize()).toBe(500);
  });

  it('should initialize showTimestamps as true', () => {
    expect(component.showTimestamps()).toBe(true);
  });

  it('should initialize searchQuery as empty string', () => {
    expect(component.searchQuery()).toBe('');
  });

  it('should initialize currentMatchIndex as 0', () => {
    expect(component.currentMatchIndex()).toBe(0);
  });

  // --- containerName computed ---

  it('containerName returns display name from container', () => {
    component.container = (() => makeContainer({ name: 'web-server' })) as any;
    expect(component.containerName()).toBe('web-server');
  });

  it('containerName falls back to short id when name is empty', () => {
    component.container = (() => makeContainer({ name: '', id: 'abcdef123456789' })) as any;
    expect(component.containerName()).toBe('abcdef123456');
  });

  // --- lineCount computed ---

  it('lineCount returns 0 when logs is empty', () => {
    component.logs.set('');
    expect(component.lineCount()).toBe(0);
  });

  it('lineCount counts non-empty lines', () => {
    component.logs.set('line1\nline2\nline3\n');
    expect(component.lineCount()).toBe(3);
  });

  it('lineCount ignores blank lines', () => {
    component.logs.set('line1\n\n\nline2\n');
    expect(component.lineCount()).toBe(2);
  });

  // --- matchCount computed ---

  it('matchCount returns 0 when no search query', () => {
    component.logs.set('hello world hello');
    component.searchQuery.set('');
    expect(component.matchCount()).toBe(0);
  });

  it('matchCount returns 0 when logs are empty', () => {
    component.logs.set('');
    component.searchQuery.set('hello');
    expect(component.matchCount()).toBe(0);
  });

  it('matchCount returns number of case-insensitive matches', () => {
    component.logs.set('Hello HELLO hello world');
    component.searchQuery.set('hello');
    expect(component.matchCount()).toBe(3);
  });

  // --- highlightedLogs computed ---

  it('highlightedLogs returns escaped HTML with no query', () => {
    component.logs.set('<script>alert("xss")</script>');
    component.searchQuery.set('');
    const result = component.highlightedLogs();
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  it('highlightedLogs wraps matches in mark tags', () => {
    component.logs.set('hello world');
    component.searchQuery.set('world');
    const result = component.highlightedLogs();
    expect(result).toContain('<mark');
    expect(result).toContain('world');
  });

  it('highlightedLogs returns empty string when logs are empty', () => {
    component.logs.set('');
    expect(component.highlightedLogs()).toBe('');
  });

  // --- loadLogs ---

  it('loadLogs calls containerService.getLogs with correct args', async () => {
    component.container = (() => makeContainer()) as any;
    component.tailSize.set(100);
    component.showTimestamps.set(false);
    await component.loadLogs();
    expect(mockContainerService.getLogs).toHaveBeenCalledWith('sys-1', 'abc123def456', 'docker', 100, false);
  });

  it('loadLogs sets logs on success', async () => {
    mockContainerService.getLogs.mockResolvedValue('log line 1\nlog line 2');
    component.container = (() => makeContainer()) as any;
    await component.loadLogs();
    expect(component.logs()).toBe('log line 1\nlog line 2');
  });

  it('loadLogs sets isLoading to false after success', async () => {
    component.container = (() => makeContainer()) as any;
    await component.loadLogs();
    expect(component.isLoading()).toBe(false);
  });

  it('loadLogs sets error on failure', async () => {
    mockContainerService.getLogs.mockRejectedValue(new Error('Connection refused'));
    component.container = (() => makeContainer()) as any;
    await component.loadLogs();
    expect(component.error()).toBe('Connection refused');
    expect(component.logs()).toBe('');
    expect(component.isLoading()).toBe(false);
  });

  it('loadLogs sets unknown error message for non-Error rejections', async () => {
    mockContainerService.getLogs.mockRejectedValue('string error');
    component.container = (() => makeContainer()) as any;
    await component.loadLogs();
    expect(component.error()).toBe('Unknown error');
  });

  // --- onTailChange ---

  it('onTailChange updates tailSize and reloads logs', async () => {
    component.container = (() => makeContainer()) as any;
    await component.onTailChange(200);
    expect(component.tailSize()).toBe(200);
    expect(mockContainerService.getLogs).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), expect.any(String), 200, expect.any(Boolean)
    );
  });

  // --- onTimestampsChange ---

  it('onTimestampsChange updates showTimestamps and reloads logs', async () => {
    component.container = (() => makeContainer()) as any;
    await component.onTimestampsChange(false);
    expect(component.showTimestamps()).toBe(false);
    expect(mockContainerService.getLogs).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), expect.any(String), expect.any(Number), false
    );
  });

  // --- copyLogs ---

  it('copyLogs copies logs to clipboard when non-empty', async () => {
    component.logs.set('log content');
    await component.copyLogs();
    expect(mockClipboard.copy).toHaveBeenCalledWith('log content');
  });

  it('copyLogs does not call clipboard when logs are empty', async () => {
    component.logs.set('');
    await component.copyLogs();
    expect(mockClipboard.copy).not.toHaveBeenCalled();
  });

  // --- downloadLogs ---

  it('downloadLogs creates and clicks a download link', () => {
    component.container = (() => makeContainer()) as any;
    component.logs.set('log content');

    const mockLink = { href: '', download: '', click: vi.fn() };
    const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(mockLink as any);
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:url');
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);

    component.downloadLogs();

    expect(createElementSpy).toHaveBeenCalledWith('a');
    expect(mockLink.href).toBe('blob:url');
    expect(mockLink.download).toContain('my-container-logs-');
    expect(mockLink.click).toHaveBeenCalled();
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:url');

    createElementSpy.mockRestore();
    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
  });

  it('downloadLogs does nothing when logs are empty', () => {
    component.logs.set('');
    const createElementSpy = vi.spyOn(document, 'createElement');
    component.downloadLogs();
    expect(createElementSpy).not.toHaveBeenCalled();
    createElementSpy.mockRestore();
  });

  it('downloadLogs uses container id slice when name is empty', () => {
    component.container = (() => makeContainer({ name: '', id: 'abcdefghijklmnop' })) as any;
    component.logs.set('some logs');

    const mockLink = { href: '', download: '', click: vi.fn() };
    vi.spyOn(document, 'createElement').mockReturnValue(mockLink as any);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:url');
    vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);

    component.downloadLogs();
    expect(mockLink.download).toContain('abcdefghijkl');

    vi.restoreAllMocks();
  });

  // --- onBackdropClick ---

  it('onBackdropClick emits close when target equals currentTarget', () => {
    const closeSpy = vi.fn();
    component.close.subscribe(closeSpy);
    const target = {};
    const event = { target, currentTarget: target } as any;
    component.onBackdropClick(event);
    expect(closeSpy).toHaveBeenCalled();
  });

  it('onBackdropClick does not emit close when target differs from currentTarget', () => {
    const closeSpy = vi.fn();
    component.close.subscribe(closeSpy);
    const event = { target: {}, currentTarget: {} } as any;
    component.onBackdropClick(event);
    expect(closeSpy).not.toHaveBeenCalled();
  });

  // --- onSearchChange ---

  it('onSearchChange updates searchQuery and resets match index', () => {
    component.currentMatchIndex.set(5);
    component.onSearchChange('error');
    expect(component.searchQuery()).toBe('error');
    expect(component.currentMatchIndex()).toBe(0);
  });

  it('onSearchChange with empty query just resets index', () => {
    component.currentMatchIndex.set(3);
    component.onSearchChange('');
    expect(component.currentMatchIndex()).toBe(0);
  });

  // --- clearSearch ---

  it('clearSearch resets searchQuery and currentMatchIndex', () => {
    component.searchQuery.set('error');
    component.currentMatchIndex.set(4);
    component.clearSearch();
    expect(component.searchQuery()).toBe('');
    expect(component.currentMatchIndex()).toBe(0);
  });

  // --- nextMatch / previousMatch ---

  it('nextMatch advances to next match index', () => {
    component.logs.set('hello hello hello');
    component.searchQuery.set('hello');
    component.currentMatchIndex.set(0);
    component.nextMatch();
    expect(component.currentMatchIndex()).toBe(1);
  });

  it('nextMatch wraps around to first match', () => {
    component.logs.set('hello hello hello');
    component.searchQuery.set('hello');
    component.currentMatchIndex.set(2);
    component.nextMatch();
    expect(component.currentMatchIndex()).toBe(0);
  });

  it('nextMatch does nothing when no matches', () => {
    component.logs.set('no matches here');
    component.searchQuery.set('xyz');
    component.currentMatchIndex.set(0);
    component.nextMatch();
    expect(component.currentMatchIndex()).toBe(0);
  });

  it('previousMatch goes to previous match index', () => {
    component.logs.set('hello hello hello');
    component.searchQuery.set('hello');
    component.currentMatchIndex.set(2);
    component.previousMatch();
    expect(component.currentMatchIndex()).toBe(1);
  });

  it('previousMatch wraps around to last match', () => {
    component.logs.set('hello hello hello');
    component.searchQuery.set('hello');
    component.currentMatchIndex.set(0);
    component.previousMatch();
    expect(component.currentMatchIndex()).toBe(2);
  });

  it('previousMatch does nothing when no matches', () => {
    component.logs.set('no matches');
    component.searchQuery.set('xyz');
    component.currentMatchIndex.set(0);
    component.previousMatch();
    expect(component.currentMatchIndex()).toBe(0);
  });

  // --- onMatchIndexInput ---

  it('onMatchIndexInput jumps to specified match (1-based input)', () => {
    component.logs.set('hello hello hello');
    component.searchQuery.set('hello');
    const input = { value: '2' } as HTMLInputElement;
    component.onMatchIndexInput({ target: input } as any);
    expect(component.currentMatchIndex()).toBe(1);
  });

  it('onMatchIndexInput clamps to 1 when value is below range', () => {
    component.logs.set('hello hello hello');
    component.searchQuery.set('hello');
    const input = { value: '0' } as HTMLInputElement;
    component.onMatchIndexInput({ target: input } as any);
    expect(component.currentMatchIndex()).toBe(0);
    expect(input.value).toBe('1');
  });

  it('onMatchIndexInput clamps to max when value exceeds count', () => {
    component.logs.set('hello hello hello');
    component.searchQuery.set('hello');
    const input = { value: '99' } as HTMLInputElement;
    component.onMatchIndexInput({ target: input } as any);
    expect(component.currentMatchIndex()).toBe(2);
    expect(input.value).toBe('3');
  });
});
