import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Injector,
  runInInjectionContext,
  signal,
  ɵChangeDetectionScheduler,
  ɵEffectScheduler,
} from '@angular/core';
import { TerminalWorkspaceComponent } from './terminal-workspace.component';
import { TerminalState } from '../../../state/terminal.state';
import { SystemState } from '../../../state/system.state';
import { ContainerState } from '../../../state/container.state';
import { TerminalService } from '../../../core/services/terminal.service';
import { ToastState } from '../../../state/toast.state';

function makeContainer(): { component: TerminalWorkspaceComponent; mocks: ReturnType<typeof buildMocks> } {
  const mocks = buildMocks();

  const injector = Injector.create({
    providers: [
      { provide: TerminalState, useValue: mocks.terminalState },
      { provide: SystemState, useValue: mocks.systemState },
      { provide: ContainerState, useValue: mocks.containerState },
      { provide: TerminalService, useValue: mocks.terminalService },
      { provide: ToastState, useValue: mocks.toastState },
      { provide: ɵChangeDetectionScheduler, useValue: { notify: vi.fn(), runningTick: false } },
      { provide: ɵEffectScheduler, useValue: { add: vi.fn(), remove: vi.fn(), schedule: vi.fn(), flush: vi.fn() } },
    ],
  });

  const component = runInInjectionContext(injector, () => new TerminalWorkspaceComponent());

  // Stub the @ViewChildren QueryList so setTimeout-based attachTerminalsToHosts() doesn't crash
  (component as any).terminalHosts = { toArray: () => [], changes: { subscribe: () => {} } };

  return { component, mocks };
}

function buildMocks() {
  const terminalState = {
    slots: signal<any[]>([{ contentType: 'empty', contentId: null }]),
    dockedTerminals: signal<any[]>([]),
    dockedFileBrowsers: signal<any[]>([]),
    isDockMinimized: signal(false),
    isDockVisible: signal(true),
    isDockFullscreen: signal(false),
    layoutMode: signal<string>('single'),
    getTerminalById: vi.fn().mockReturnValue(undefined),
    getTerminalForSlot: vi.fn().mockReturnValue(null),
    getFileBrowserForSlot: vi.fn().mockReturnValue(null),
    isFileBrowserInSlot: vi.fn().mockReturnValue(false),
    isTerminalInSlot: vi.fn().mockReturnValue(false),
    setLayoutMode: vi.fn(),
    setActiveSlot: vi.fn(),
    focusTerminal: vi.fn(),
    focusFileBrowser: vi.fn(),
    removeTerminal: vi.fn().mockResolvedValue(undefined),
    removeFileBrowser: vi.fn(),
    toggleDockMinimized: vi.fn(),
    toggleDockFullscreen: vi.fn(),
    toggleTerminalDisplayMode: vi.fn(),
    addTerminal: vi.fn(),
    addFileBrowser: vi.fn(),
    generateTerminalId: vi.fn().mockReturnValue('terminal-abc123'),
    generateFileBrowserId: vi.fn().mockReturnValue('filebrowser-xyz789'),
    reorderTerminals: vi.fn(),
    reorderFileBrowsers: vi.fn(),
    assignTerminalToSlot: vi.fn(),
    assignFileBrowserToSlot: vi.fn(),
  };

  const systemState = {
    systems: signal<any[]>([]),
  };

  const containerState = {
    containersBySystem: signal<Record<string, any[]>>({}),
  };

  const terminalService = {
    startSession: vi.fn().mockResolvedValue({ id: 'sess-1', systemId: 'sys-1', shell: '/bin/sh' }),
    sendInput: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
    onOutput: vi.fn().mockResolvedValue(undefined),
  };

  const toastState = {
    error: vi.fn(),
    success: vi.fn(),
  };

  return { terminalState, systemState, containerState, terminalService, toastState };
}

// Helper to build a minimal Container object
function makeContainer_model(overrides: Partial<any> = {}): any {
  return {
    id: 'container-1',
    name: 'my-container',
    image: 'nginx:latest',
    status: 'running',
    runtime: 'docker',
    systemId: 'sys-1',
    createdAt: '2024-01-01T00:00:00Z',
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
  };
}

describe('TerminalWorkspaceComponent', () => {
  let component: TerminalWorkspaceComponent;
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(() => {
    const result = makeContainer();
    component = result.component;
    mocks = result.mocks;
  });

  // --- Construction & state ---

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should expose terminalState, systemState, containerState publicly', () => {
    expect(component.terminalState).toBe(mocks.terminalState);
    expect(component.systemState).toBe(mocks.systemState);
    expect(component.containerState).toBe(mocks.containerState);
  });

  it('should initialize showNewMenu as false', () => {
    expect(component.showNewMenu()).toBe(false);
  });

  it('should initialize showShortcuts as false', () => {
    expect(component.showShortcuts()).toBe(false);
  });

  it('should initialize expandedSlotSystemId as null', () => {
    expect(component.expandedSlotSystemId()).toBeNull();
  });

  it('should initialize drag state signals as null', () => {
    expect(component.dragTabIndex()).toBeNull();
    expect(component.dragTabType()).toBeNull();
    expect(component.dropTargetIndex()).toBeNull();
    expect(component.slotDropTarget()).toBeNull();
  });

  // --- Layout ---

  it('should delegate setLayout to terminalState.setLayoutMode', () => {
    component.setLayout('split-h');
    expect(mocks.terminalState.setLayoutMode).toHaveBeenCalledWith('split-h');
  });

  it('isSplitView should return false when layoutMode is single', () => {
    mocks.terminalState.layoutMode.set('single');
    expect(component.isSplitView()).toBe(false);
  });

  it('isSplitView should return true when layoutMode is not single', () => {
    mocks.terminalState.layoutMode.set('split-h');
    expect(component.isSplitView()).toBe(true);
  });

  // --- Active slot ---

  it('should set active slot and focus terminal if present', () => {
    const mockTerminal = { terminal: { focus: vi.fn() } };
    mocks.terminalState.getTerminalForSlot.mockReturnValue(mockTerminal);
    component.setActiveSlot(0);
    expect(mocks.terminalState.setActiveSlot).toHaveBeenCalledWith(0);
    expect(mockTerminal.terminal.focus).toHaveBeenCalled();
  });

  it('should set active slot without focus if no terminal in slot', () => {
    mocks.terminalState.getTerminalForSlot.mockReturnValue(null);
    component.setActiveSlot(1);
    expect(mocks.terminalState.setActiveSlot).toHaveBeenCalledWith(1);
  });

  // --- Terminal host click ---

  it('onTerminalHostClick should stop propagation and focus terminal', () => {
    const mockTerminal = { terminal: { focus: vi.fn() } };
    mocks.terminalState.getTerminalForSlot.mockReturnValue(mockTerminal);
    const event = { stopPropagation: vi.fn() } as any;
    component.onTerminalHostClick(0, event);
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(mockTerminal.terminal.focus).toHaveBeenCalled();
  });

  // --- Close terminal ---

  it('closeTerminal should stop propagation and call removeTerminal', async () => {
    const event = { stopPropagation: vi.fn() } as any;
    await component.closeTerminal('term-1', event);
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(mocks.terminalState.removeTerminal).toHaveBeenCalledWith('term-1');
  });

  // --- Toggle actions ---

  it('toggleDockMinimized should delegate to terminalState', () => {
    component.toggleDockMinimized();
    expect(mocks.terminalState.toggleDockMinimized).toHaveBeenCalled();
  });

  it('toggleDockFullscreen should delegate to terminalState', () => {
    component.toggleDockFullscreen();
    expect(mocks.terminalState.toggleDockFullscreen).toHaveBeenCalled();
  });

  it('toggleTerminalMode should call toggleTerminalDisplayMode', () => {
    component.toggleTerminalMode('term-1');
    expect(mocks.terminalState.toggleTerminalDisplayMode).toHaveBeenCalledWith('term-1');
  });

  it('toggleTerminalMode should do nothing when id is undefined', () => {
    component.toggleTerminalMode(undefined);
    expect(mocks.terminalState.toggleTerminalDisplayMode).not.toHaveBeenCalled();
  });

  it('toggleNewMenu should flip showNewMenu', () => {
    expect(component.showNewMenu()).toBe(false);
    component.toggleNewMenu();
    expect(component.showNewMenu()).toBe(true);
    component.toggleNewMenu();
    expect(component.showNewMenu()).toBe(false);
  });

  it('toggleShortcuts should flip showShortcuts', () => {
    expect(component.showShortcuts()).toBe(false);
    component.toggleShortcuts();
    expect(component.showShortcuts()).toBe(true);
  });

  it('toggleSlotSystem should set expandedSlotSystemId', () => {
    component.toggleSlotSystem('sys-1');
    expect(component.expandedSlotSystemId()).toBe('sys-1');
  });

  it('toggleSlotSystem should collapse when same system toggled again', () => {
    component.toggleSlotSystem('sys-1');
    component.toggleSlotSystem('sys-1');
    expect(component.expandedSlotSystemId()).toBeNull();
  });

  // --- Getters ---

  it('getTerminalForSlot delegates to terminalState', () => {
    const mockTerminal = { id: 'term-1' };
    mocks.terminalState.getTerminalForSlot.mockReturnValue(mockTerminal);
    const result = component.getTerminalForSlot(0);
    expect(result).toBe(mockTerminal);
  });

  it('getFileBrowserForSlot delegates to terminalState', () => {
    const mockFb = { id: 'fb-1' };
    mocks.terminalState.getFileBrowserForSlot.mockReturnValue(mockFb);
    const result = component.getFileBrowserForSlot(0);
    expect(result).toBe(mockFb);
  });

  it('isFileBrowserInSlot delegates to terminalState', () => {
    mocks.terminalState.isFileBrowserInSlot.mockReturnValue(true);
    expect(component.isFileBrowserInSlot('fb-1')).toBe(true);
  });

  it('isTerminalInSlot delegates to terminalState', () => {
    mocks.terminalState.isTerminalInSlot.mockReturnValue(false);
    expect(component.isTerminalInSlot('term-1')).toBe(false);
  });

  it('getSlotIndex returns correct index for terminal in slot', () => {
    mocks.terminalState.slots.set([
      { contentType: 'terminal', contentId: 'term-1' },
      { contentType: 'terminal', contentId: 'term-2' },
    ]);
    expect(component.getSlotIndex('term-2')).toBe(1);
  });

  it('getSlotIndex returns -1 when terminal not in any slot', () => {
    mocks.terminalState.slots.set([
      { contentType: 'terminal', contentId: 'term-1' },
    ]);
    expect(component.getSlotIndex('term-999')).toBe(-1);
  });

  it('getFileBrowserSlotIndex returns correct index', () => {
    mocks.terminalState.slots.set([
      { contentType: 'file-browser', contentId: 'fb-1' },
      { contentType: 'file-browser', contentId: 'fb-2' },
    ]);
    expect(component.getFileBrowserSlotIndex('fb-2')).toBe(1);
  });

  // --- File browser ---

  it('openFileBrowser should call focusFileBrowser', () => {
    const fb: any = { id: 'fb-1', systemId: 'sys-1', systemName: 'My Server', currentPath: '/' };
    component.openFileBrowser(fb);
    expect(mocks.terminalState.focusFileBrowser).toHaveBeenCalledWith('fb-1');
  });

  it('closeFileBrowser should stop propagation and remove file browser', () => {
    const event = { stopPropagation: vi.fn() } as any;
    component.closeFileBrowser('fb-1', event);
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(mocks.terminalState.removeFileBrowser).toHaveBeenCalledWith('fb-1');
  });

  // --- Tracking ---

  it('trackByTerminalId returns terminal id', () => {
    const terminal: any = { id: 'term-abc', session: {}, systemId: 's', systemName: 'n', serializedState: '', terminalOptions: {} };
    expect(component.trackByTerminalId(0, terminal)).toBe('term-abc');
  });

  it('trackByFileBrowserId returns fb id', () => {
    const fb: any = { id: 'fb-xyz', systemId: 's', systemName: 'n', currentPath: '/' };
    expect(component.trackByFileBrowserId(0, fb)).toBe('fb-xyz');
  });

  it('trackByIndex returns the index', () => {
    expect(component.trackByIndex(3)).toBe(3);
  });

  // --- openNewTerminal ---

  it('openNewTerminal should close menu and start session', async () => {
    mocks.systemState.systems.set([{ id: 'sys-1', name: 'My Server' }]);
    component.showNewMenu.set(true);
    await component.openNewTerminal('sys-1');
    expect(component.showNewMenu()).toBe(false);
    expect(mocks.terminalService.startSession).toHaveBeenCalledWith('sys-1');
    expect(mocks.terminalState.addTerminal).toHaveBeenCalled();
  });

  it('openNewTerminal should do nothing when system not found', async () => {
    mocks.systemState.systems.set([]);
    await component.openNewTerminal('sys-missing');
    expect(mocks.terminalService.startSession).not.toHaveBeenCalled();
  });

  it('openNewTerminal should call toastState.error on failure', async () => {
    mocks.systemState.systems.set([{ id: 'sys-1', name: 'My Server' }]);
    mocks.terminalService.startSession.mockRejectedValue(new Error('SSH error'));
    await component.openNewTerminal('sys-1');
    expect(mocks.toastState.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to open terminal')
    );
  });

  // --- openContainerTerminal ---

  it('openContainerTerminal should start session with containerId', async () => {
    mocks.systemState.systems.set([{ id: 'sys-1', name: 'My Server' }]);
    const container = makeContainer_model();
    await component.openContainerTerminal('sys-1', container);
    expect(mocks.terminalService.startSession).toHaveBeenCalledWith('sys-1', 'container-1');
    expect(mocks.terminalState.addTerminal).toHaveBeenCalled();
  });

  it('openContainerTerminal should toast on error', async () => {
    mocks.systemState.systems.set([{ id: 'sys-1', name: 'My Server' }]);
    mocks.terminalService.startSession.mockRejectedValue(new Error('Timeout'));
    const container = makeContainer_model();
    await component.openContainerTerminal('sys-1', container);
    expect(mocks.toastState.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to open container terminal')
    );
  });

  // --- openNewFileBrowser ---

  it('openNewFileBrowser should add file browser when system exists', () => {
    mocks.systemState.systems.set([{ id: 'sys-1', name: 'My Server' }]);
    component.openNewFileBrowser('sys-1');
    expect(mocks.terminalState.addFileBrowser).toHaveBeenCalled();
    expect(component.showNewMenu()).toBe(false);
  });

  it('openNewFileBrowser should do nothing when system not found', () => {
    mocks.systemState.systems.set([]);
    component.openNewFileBrowser('sys-missing');
    expect(mocks.terminalState.addFileBrowser).not.toHaveBeenCalled();
  });

  it('openNewFileBrowser should pass containerId and containerName when provided', () => {
    mocks.systemState.systems.set([{ id: 'sys-1', name: 'My Server' }]);
    component.openNewFileBrowser('sys-1', undefined, 'cnt-1', 'my-container', 'docker');
    const call = mocks.terminalState.addFileBrowser.mock.calls[0][0];
    expect(call.containerId).toBe('cnt-1');
    expect(call.containerName).toBe('my-container');
    expect(call.runtime).toBe('docker');
  });

  // --- getRunningContainers ---

  it('getRunningContainers returns only running containers', () => {
    const containers = [
      makeContainer_model({ id: 'c1', status: 'running', systemId: 'sys-1' }),
      makeContainer_model({ id: 'c2', status: 'exited', systemId: 'sys-1' }),
      makeContainer_model({ id: 'c3', status: 'running', systemId: 'sys-1' }),
    ];
    mocks.containerState.containersBySystem.set({ 'sys-1': containers });
    const result = component.getRunningContainers('sys-1');
    expect(result).toHaveLength(2);
    expect(result.every((c: any) => c.status === 'running')).toBe(true);
  });

  it('getRunningContainers returns empty array when system has no containers', () => {
    mocks.containerState.containersBySystem.set({});
    const result = component.getRunningContainers('sys-unknown');
    expect(result).toEqual([]);
  });

  // --- focusTerminal ---

  it('focusTerminal should delegate to terminalState.focusTerminal', () => {
    component.focusTerminal('term-1');
    expect(mocks.terminalState.focusTerminal).toHaveBeenCalledWith('term-1');
  });

  // --- Drag and drop tabs ---

  it('onTabDragStart should set drag state', () => {
    component.onTabDragStart(2, 'terminal', 'term-1');
    expect(component.dragTabIndex()).toBe(2);
    expect(component.dragTabType()).toBe('terminal');
  });

  it('onTabDragOver should set dropTargetIndex when type matches', () => {
    component.onTabDragStart(0, 'terminal', 'term-1');
    const event = { preventDefault: vi.fn(), dataTransfer: { dropEffect: '' } } as any;
    component.onTabDragOver(event, 1, 'terminal');
    expect(component.dropTargetIndex()).toBe(1);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('onTabDragOver should not update when type mismatches', () => {
    component.onTabDragStart(0, 'terminal', 'term-1');
    const event = { preventDefault: vi.fn(), dataTransfer: null } as any;
    component.onTabDragOver(event, 1, 'file-browser');
    expect(component.dropTargetIndex()).toBeNull();
  });

  it('onTabDrop should reorder terminals and reset drag state', () => {
    component.onTabDragStart(0, 'terminal', 'term-1');
    const event = { preventDefault: vi.fn() } as any;
    component.onTabDrop(event, 2, 'terminal');
    expect(mocks.terminalState.reorderTerminals).toHaveBeenCalledWith(0, 2);
    expect(component.dragTabIndex()).toBeNull();
  });

  it('onTabDrop should reset state when same index', () => {
    component.onTabDragStart(1, 'terminal', 'term-1');
    const event = { preventDefault: vi.fn() } as any;
    component.onTabDrop(event, 1, 'terminal');
    expect(mocks.terminalState.reorderTerminals).not.toHaveBeenCalled();
    expect(component.dragTabIndex()).toBeNull();
  });

  it('onTabDrop should reorder file browsers', () => {
    component.onTabDragStart(0, 'file-browser', 'fb-1');
    const event = { preventDefault: vi.fn() } as any;
    component.onTabDrop(event, 1, 'file-browser');
    expect(mocks.terminalState.reorderFileBrowsers).toHaveBeenCalledWith(0, 1);
  });

  it('onTabDragEnd should reset all drag state', () => {
    component.onTabDragStart(1, 'terminal', 'term-1');
    component.onTabDragEnd();
    expect(component.dragTabIndex()).toBeNull();
    expect(component.dragTabType()).toBeNull();
  });

  // --- Drag slots ---

  it('onSlotDrop should assign terminal to slot and set active', () => {
    component.onTabDragStart(0, 'terminal', 'term-1');
    const event = { preventDefault: vi.fn() } as any;
    component.onSlotDrop(event, 2);
    expect(mocks.terminalState.assignTerminalToSlot).toHaveBeenCalledWith('term-1', 2);
    expect(mocks.terminalState.setActiveSlot).toHaveBeenCalledWith(2);
  });

  it('onSlotDrop should assign file browser to slot', () => {
    component.onTabDragStart(0, 'file-browser', 'fb-1');
    const event = { preventDefault: vi.fn() } as any;
    component.onSlotDrop(event, 1);
    expect(mocks.terminalState.assignFileBrowserToSlot).toHaveBeenCalledWith('fb-1', 1);
  });

  it('onSlotDrop resets drag state when type is null', () => {
    const event = { preventDefault: vi.fn() } as any;
    component.onSlotDrop(event, 0);
    expect(mocks.terminalState.assignTerminalToSlot).not.toHaveBeenCalled();
  });

  it('onSlotDragOver should call preventDefault and set slotDropTarget when dragging', () => {
    component.onTabDragStart(0, 'terminal', 'term-1');
    const event = { preventDefault: vi.fn(), dataTransfer: { dropEffect: '' } } as any;
    component.onSlotDragOver(event, 2);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(component.slotDropTarget()).toBe(2);
  });

  it('onSlotDragOver should not call preventDefault when no drag active', () => {
    const event = { preventDefault: vi.fn(), dataTransfer: null } as any;
    component.onSlotDragOver(event, 0);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  // --- Keyboard shortcuts ---

  it('onKeyDown Ctrl+Shift+F should toggle fullscreen when dock visible', () => {
    mocks.terminalState.isDockVisible.set(true);
    const event = new KeyboardEvent('keydown', { ctrlKey: true, shiftKey: true, key: 'F' });
    Object.defineProperty(event, 'preventDefault', { value: vi.fn() });
    component.onKeyDown(event);
    expect(mocks.terminalState.toggleDockFullscreen).toHaveBeenCalled();
  });

  it('onKeyDown Ctrl+Shift+M should toggle minimize when dock visible', () => {
    mocks.terminalState.isDockVisible.set(true);
    const event = new KeyboardEvent('keydown', { ctrlKey: true, shiftKey: true, key: 'M' });
    Object.defineProperty(event, 'preventDefault', { value: vi.fn() });
    component.onKeyDown(event);
    expect(mocks.terminalState.toggleDockMinimized).toHaveBeenCalled();
  });

  it('onKeyDown should do nothing when dock is not visible', () => {
    mocks.terminalState.isDockVisible.set(false);
    const event = new KeyboardEvent('keydown', { ctrlKey: true, shiftKey: true, key: 'F' });
    Object.defineProperty(event, 'preventDefault', { value: vi.fn() });
    component.onKeyDown(event);
    expect(mocks.terminalState.toggleDockFullscreen).not.toHaveBeenCalled();
  });

  it('onKeyDown Ctrl+1 should focus first terminal', () => {
    mocks.terminalState.isDockVisible.set(true);
    mocks.terminalState.dockedTerminals.set([{ id: 'term-1' }] as any);
    mocks.terminalState.dockedFileBrowsers.set([]);
    const event = new KeyboardEvent('keydown', { ctrlKey: true, key: '1' });
    Object.defineProperty(event, 'preventDefault', { value: vi.fn() });
    component.onKeyDown(event);
    expect(mocks.terminalState.focusTerminal).toHaveBeenCalledWith('term-1');
  });

  it('onKeyDown Ctrl+2 should focus second terminal', () => {
    mocks.terminalState.isDockVisible.set(true);
    mocks.terminalState.dockedTerminals.set([{ id: 'term-1' }, { id: 'term-2' }] as any);
    mocks.terminalState.dockedFileBrowsers.set([]);
    const event = new KeyboardEvent('keydown', { ctrlKey: true, key: '2' });
    Object.defineProperty(event, 'preventDefault', { value: vi.fn() });
    component.onKeyDown(event);
    expect(mocks.terminalState.focusTerminal).toHaveBeenCalledWith('term-2');
  });

  it('onKeyDown Ctrl+1 should focus file browser when terminals list is empty', () => {
    mocks.terminalState.isDockVisible.set(true);
    mocks.terminalState.dockedTerminals.set([]);
    mocks.terminalState.dockedFileBrowsers.set([{ id: 'fb-1' }] as any);
    const event = new KeyboardEvent('keydown', { ctrlKey: true, key: '1' });
    Object.defineProperty(event, 'preventDefault', { value: vi.fn() });
    component.onKeyDown(event);
    expect(mocks.terminalState.focusFileBrowser).toHaveBeenCalledWith('fb-1');
  });

  it('onKeyDown does not focus out-of-bounds index', () => {
    mocks.terminalState.isDockVisible.set(true);
    mocks.terminalState.dockedTerminals.set([{ id: 'term-1' }] as any);
    mocks.terminalState.dockedFileBrowsers.set([]);
    const event = new KeyboardEvent('keydown', { ctrlKey: true, key: '5' });
    Object.defineProperty(event, 'preventDefault', { value: vi.fn() });
    component.onKeyDown(event);
    expect(mocks.terminalState.focusTerminal).not.toHaveBeenCalled();
  });

  // --- ngOnDestroy ---

  it('ngOnDestroy should disconnect all resize observers', () => {
    const disconnect = vi.fn();
    (component as any).resizeObservers.set(0, { disconnect });
    (component as any).resizeObservers.set(1, { disconnect });
    component.ngOnDestroy();
    expect(disconnect).toHaveBeenCalledTimes(2);
    expect((component as any).resizeObservers.size).toBe(0);
  });
});
