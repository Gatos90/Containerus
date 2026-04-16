import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { ContainerDetailModalComponent } from './container-detail-modal.component';
import { TerminalState } from '../../../../state/terminal.state';
import { TerminalService } from '../../../../core/services/terminal.service';
import { SystemState } from '../../../../state/system.state';
import { ToastState } from '../../../../state/toast.state';
import { Container } from '../../../../core/models/container.model';

function makeComponent(): { component: ContainerDetailModalComponent; mocks: ReturnType<typeof buildMocks> } {
  const mocks = buildMocks();

  const injector = Injector.create({
    providers: [
      { provide: TerminalState, useValue: mocks.terminalState },
      { provide: TerminalService, useValue: mocks.terminalService },
      { provide: SystemState, useValue: mocks.systemState },
      { provide: ToastState, useValue: mocks.toastState },
    ],
  });

  const component = runInInjectionContext(injector, () => new ContainerDetailModalComponent());
  return { component, mocks };
}

function buildMocks() {
  const terminalState = {
    addTerminal: vi.fn(),
    addFileBrowser: vi.fn(),
    generateTerminalId: vi.fn().mockReturnValue('terminal-new-id'),
    generateFileBrowserId: vi.fn().mockReturnValue('filebrowser-new-id'),
  };

  const terminalService = {
    startSession: vi.fn().mockResolvedValue({ id: 'sess-1', systemId: 'sys-1', shell: '/bin/sh' }),
  };

  const systemState = {
    systems: signal<any[]>([{ id: 'sys-1', name: 'My Production Server' }]),
  };

  const toastState = {
    error: vi.fn(),
    success: vi.fn(),
  };

  return { terminalState, terminalService, systemState, toastState };
}

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'container-abc',
    name: 'web-server',
    image: 'nginx:1.25',
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
    restartPolicy: { name: 'always', maximumRetryCount: 0 },
    healthCheck: null,
    state: { pid: 101, exitCode: 0, error: null, startedAt: null, finishedAt: null, healthStatus: null },
    config: { cmd: null, entrypoint: null, workingDir: null, user: null, hostname: null, domainname: null, tty: false, stopSignal: null },
    hostConfig: { networkMode: 'bridge', privileged: false, capAdd: [], capDrop: [], devices: [], shmSize: null, logConfig: null, securityOpt: [], ulimits: [] },
    ...overrides,
  } as Container;
}

describe('ContainerDetailModalComponent', () => {
  let component: ContainerDetailModalComponent;
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(() => {
    const result = makeComponent();
    component = result.component;
    mocks = result.mocks;
  });

  // --- Construction ---

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // --- Icon references ---

  it('should expose icon references', () => {
    expect(component.X).toBeDefined();
    expect(component.Terminal).toBeDefined();
    expect(component.FileText).toBeDefined();
    expect(component.FolderOpen).toBeDefined();
  });

  // --- Helper function references ---

  it('should expose getDisplayName helper', () => {
    expect(typeof component.getDisplayName).toBe('function');
  });

  it('should expose getStatusText helper', () => {
    expect(typeof component.getStatusText).toBe('function');
  });

  it('should expose isRunning helper', () => {
    expect(typeof component.isRunning).toBe('function');
  });

  // --- onBackdropClick ---

  it('onBackdropClick emits close when target equals currentTarget', () => {
    component.container = (() => makeContainer()) as any;
    const closeSpy = vi.fn();
    component.close.subscribe(closeSpy);
    const ref = {};
    const event = { target: ref, currentTarget: ref } as any;
    component.onBackdropClick(event);
    expect(closeSpy).toHaveBeenCalled();
  });

  it('onBackdropClick does NOT emit close when target differs from currentTarget', () => {
    component.container = (() => makeContainer()) as any;
    const closeSpy = vi.fn();
    component.close.subscribe(closeSpy);
    const event = { target: {}, currentTarget: {} } as any;
    component.onBackdropClick(event);
    expect(closeSpy).not.toHaveBeenCalled();
  });

  // --- dockTerminal ---

  it('dockTerminal starts session with systemId and containerId', async () => {
    component.container = (() => makeContainer()) as any;
    await component.dockTerminal();
    expect(mocks.terminalService.startSession).toHaveBeenCalledWith('sys-1', 'container-abc');
  });

  it('dockTerminal adds terminal to terminalState', async () => {
    component.container = (() => makeContainer()) as any;
    await component.dockTerminal();
    expect(mocks.terminalState.addTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'terminal-new-id',
        systemId: 'sys-1',
        systemName: 'My Production Server',
        containerName: 'web-server',
      })
    );
  });

  it('dockTerminal emits close after success', async () => {
    component.container = (() => makeContainer()) as any;
    const closeSpy = vi.fn();
    component.close.subscribe(closeSpy);
    await component.dockTerminal();
    expect(closeSpy).toHaveBeenCalled();
  });

  it('dockTerminal does nothing when system not found', async () => {
    component.container = (() => makeContainer({ systemId: 'sys-missing' })) as any;
    await component.dockTerminal();
    expect(mocks.terminalService.startSession).not.toHaveBeenCalled();
    expect(mocks.terminalState.addTerminal).not.toHaveBeenCalled();
  });

  it('dockTerminal shows error toast on service failure', async () => {
    component.container = (() => makeContainer()) as any;
    mocks.terminalService.startSession.mockRejectedValue(new Error('Connection lost'));
    await component.dockTerminal();
    expect(mocks.toastState.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to open terminal')
    );
    expect(mocks.toastState.error).toHaveBeenCalledWith(
      expect.stringContaining('Connection lost')
    );
  });

  it('dockTerminal error message handles non-Error rejection', async () => {
    component.container = (() => makeContainer()) as any;
    mocks.terminalService.startSession.mockRejectedValue('raw string error');
    await component.dockTerminal();
    expect(mocks.toastState.error).toHaveBeenCalledWith(
      expect.stringContaining('raw string error')
    );
  });

  it('dockTerminal does not emit close on failure', async () => {
    component.container = (() => makeContainer()) as any;
    const closeSpy = vi.fn();
    component.close.subscribe(closeSpy);
    mocks.terminalService.startSession.mockRejectedValue(new Error('fail'));
    await component.dockTerminal();
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('dockTerminal passes correct session to addTerminal', async () => {
    component.container = (() => makeContainer()) as any;
    const session = { id: 'sess-42', systemId: 'sys-1', shell: '/bin/bash' };
    mocks.terminalService.startSession.mockResolvedValue(session);
    await component.dockTerminal();
    expect(mocks.terminalState.addTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ session })
    );
  });

  // --- dockFileBrowser ---

  it('dockFileBrowser calls addFileBrowser with correct data', () => {
    component.container = (() => makeContainer()) as any;
    component.dockFileBrowser();
    expect(mocks.terminalState.addFileBrowser).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'filebrowser-new-id',
        systemId: 'sys-1',
        systemName: 'My Production Server',
        containerId: 'container-abc',
        containerName: 'web-server',
        runtime: 'docker',
        currentPath: '/',
      })
    );
  });

  it('dockFileBrowser emits close after adding', () => {
    component.container = (() => makeContainer()) as any;
    const closeSpy = vi.fn();
    component.close.subscribe(closeSpy);
    component.dockFileBrowser();
    expect(closeSpy).toHaveBeenCalled();
  });

  it('dockFileBrowser does nothing when system not found', () => {
    component.container = (() => makeContainer({ systemId: 'sys-nonexistent' })) as any;
    component.dockFileBrowser();
    expect(mocks.terminalState.addFileBrowser).not.toHaveBeenCalled();
  });

  it('dockFileBrowser uses container display name correctly', () => {
    const containerWithoutName = makeContainer({ name: '', id: 'shortidxyz12345' });
    component.container = (() => containerWithoutName) as any;
    component.dockFileBrowser();
    expect(mocks.terminalState.addFileBrowser).toHaveBeenCalledWith(
      expect.objectContaining({
        containerName: 'shortidxyz12', // getDisplayName slices to 12 chars
      })
    );
  });

  it('dockFileBrowser generates a unique file browser id', () => {
    component.container = (() => makeContainer()) as any;
    component.dockFileBrowser();
    expect(mocks.terminalState.generateFileBrowserId).toHaveBeenCalled();
  });

  // --- viewLogs output ---

  it('viewLogs output is defined', () => {
    // The output exists and can be subscribed to
    expect(component.viewLogs).toBeDefined();
  });

  // --- isRunning helper integration ---

  it('isRunning returns true for running container', () => {
    const c = makeContainer({ status: 'running' });
    expect(component.isRunning(c)).toBe(true);
  });

  it('isRunning returns false for stopped container', () => {
    const c = makeContainer({ status: 'exited' });
    expect(component.isRunning(c)).toBe(false);
  });

  // --- getDisplayName helper integration ---

  it('getDisplayName returns container name when present', () => {
    const c = makeContainer({ name: 'my-service' });
    expect(component.getDisplayName(c)).toBe('my-service');
  });

  it('getDisplayName returns id slice when name is empty', () => {
    const c = makeContainer({ name: '', id: 'abc123456789xyz' });
    expect(component.getDisplayName(c)).toBe('abc123456789');
  });

  // --- getStatusText helper integration ---

  it('getStatusText returns Running for running status', () => {
    expect(component.getStatusText('running')).toBe('Running');
  });

  it('getStatusText returns Exited for exited status', () => {
    expect(component.getStatusText('exited')).toBe('Exited');
  });
});
