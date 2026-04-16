import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { TerminalViewComponent } from './terminal-view.component';
import { ActivatedRoute, Router } from '@angular/router';
import { TerminalService } from '../../../core/services/terminal.service';
import { SystemState } from '../../../state/system.state';
import { TerminalState } from '../../../state/terminal.state';
import { CommandHistoryService } from '../../warp-terminal/state/command-history.service';
import { TerminalEventBus } from '../../warp-terminal/state/warp-terminal.bus';
import { ContainerSystem } from '../../../core/models/system.model';

// ---------------------------------------------------------------------------
// Tauri and xterm heavy dependencies — stub them out
// ---------------------------------------------------------------------------

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    loadAddon: vi.fn(),
    open: vi.fn(),
    writeln: vi.fn(),
    write: vi.fn(),
    clear: vi.fn(),
    focus: vi.fn(),
    dispose: vi.fn(),
    onData: vi.fn(),
    attachCustomKeyEventHandler: vi.fn(),
    cols: 80,
    rows: 24,
  })),
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: vi.fn(),
  })),
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@xterm/addon-search', () => ({
  SearchAddon: vi.fn().mockImplementation(() => ({
    findNext: vi.fn(),
    findPrevious: vi.fn(),
    clearDecorations: vi.fn(),
  })),
}));

vi.mock('@xterm/addon-serialize', () => ({
  SerializeAddon: vi.fn().mockImplementation(() => ({
    serialize: vi.fn().mockReturnValue('serialized-state'),
  })),
}));

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function makeSystem(overrides: Partial<ContainerSystem> = {}): ContainerSystem {
  return {
    id: 'sys-1',
    name: 'My Server',
    hostname: 'server.local',
    primaryRuntime: 'docker',
    autoConnect: false,
    availableRuntimes: ['docker'],
    ...overrides,
  } as ContainerSystem;
}

function makeComponent() {
  const mockRoute: any = {
    snapshot: {
      paramMap: {
        get: vi.fn((key: string) => {
          if (key === 'systemId') return 'sys-1';
          if (key === 'containerId') return null;
          return null;
        }),
      },
    },
  };

  const mockRouter: any = {
    navigate: vi.fn().mockResolvedValue(true),
  };

  const mockSession = { id: 'sess-1', systemId: 'sys-1', shell: '/bin/sh' };
  const mockTerminalService: any = {
    startSession: vi.fn().mockResolvedValue(mockSession),
    sendInput: vi.fn().mockResolvedValue(undefined),
    closeSession: vi.fn().mockResolvedValue(undefined),
    onOutput: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
    fetchShellHistory: vi.fn().mockResolvedValue([]),
  };

  const systemsSignal = signal<ContainerSystem[]>([makeSystem()]);
  const mockSystemState: any = {
    systems: systemsSignal,
  };

  const mockTerminalState: any = {
    generateTerminalId: vi.fn().mockReturnValue('terminal-test-123'),
    addTerminal: vi.fn(),
  };

  const mockHistoryService: any = {
    loadRemoteHistory: vi.fn().mockResolvedValue(undefined),
    add: vi.fn(),
  };

  const mockEventBus: any = {
    emit: vi.fn(),
  };

  const injector = Injector.create({
    providers: [
      { provide: ActivatedRoute, useValue: mockRoute },
      { provide: Router, useValue: mockRouter },
      { provide: TerminalService, useValue: mockTerminalService },
      { provide: SystemState, useValue: mockSystemState },
      { provide: TerminalState, useValue: mockTerminalState },
      { provide: CommandHistoryService, useValue: mockHistoryService },
      { provide: TerminalEventBus, useValue: mockEventBus },
    ],
  });

  const component = runInInjectionContext(injector, () => new TerminalViewComponent());

  return {
    component,
    mockRoute,
    mockRouter,
    mockTerminalService,
    mockSystemState,
    systemsSignal,
    mockTerminalState,
    mockHistoryService,
    mockEventBus,
    mockSession,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TerminalViewComponent', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Instantiation / warpEnabled
  // -------------------------------------------------------------------------

  describe('warpEnabled getter', () => {
    it('should return false by default', () => {
      const { component } = makeComponent();
      expect(component.warpEnabled).toBe(false);
    });

    it('should return true after toggleWarpTerminal is called', () => {
      const { component } = makeComponent();
      component.toggleWarpTerminal();
      expect(component.warpEnabled).toBe(true);
    });

    it('should toggle back to false on second call', () => {
      const { component } = makeComponent();
      component.toggleWarpTerminal();
      component.toggleWarpTerminal();
      expect(component.warpEnabled).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // ngOnInit
  // -------------------------------------------------------------------------

  describe('ngOnInit', () => {
    it('should read systemId from route params', () => {
      const { component } = makeComponent();
      component.ngOnInit();
      expect(component.systemId).toBe('sys-1');
    });

    it('should set containerId to null when not in route', () => {
      const { component } = makeComponent();
      component.ngOnInit();
      expect(component.containerId).toBeNull();
    });

    it('should read containerId from route params when present', () => {
      const { component, mockRoute } = makeComponent();
      mockRoute.snapshot.paramMap.get = vi.fn((key: string) => {
        if (key === 'systemId') return 'sys-1';
        if (key === 'containerId') return 'container-abc';
        return null;
      });
      component.ngOnInit();
      expect(component.containerId).toBe('container-abc');
    });
  });

  // -------------------------------------------------------------------------
  // getRecentOutput
  // -------------------------------------------------------------------------

  describe('getRecentOutput', () => {
    it('should return empty string when output buffer is empty', () => {
      const { component } = makeComponent();
      expect(component.getRecentOutput()).toBe('');
    });

    it('should join all buffered strings', () => {
      const { component } = makeComponent();
      // Access private outputBuffer signal via bracket notation
      (component as any)['outputBuffer'].set(['hello ', 'world\n', 'done']);
      expect(component.getRecentOutput()).toBe('hello world\ndone');
    });
  });

  // -------------------------------------------------------------------------
  // getSystemName
  // -------------------------------------------------------------------------

  describe('getSystemName', () => {
    it('should return "Unknown" when systemId is null', () => {
      const { component } = makeComponent();
      component.systemId = null;
      expect(component.getSystemName()).toBe('Unknown');
    });

    it('should return system name when system is found', () => {
      const { component, systemsSignal } = makeComponent();
      component.systemId = 'sys-1';
      systemsSignal.set([makeSystem({ id: 'sys-1', name: 'Production Server' })]);
      expect(component.getSystemName()).toBe('Production Server');
    });

    it('should fall back to systemId when system is not in list', () => {
      const { component, systemsSignal } = makeComponent();
      component.systemId = 'sys-unknown';
      systemsSignal.set([]);
      expect(component.getSystemName()).toBe('sys-unknown');
    });
  });

  // -------------------------------------------------------------------------
  // getCurrentRuntime
  // -------------------------------------------------------------------------

  describe('getCurrentRuntime', () => {
    it('should return "docker" when systemId is null', () => {
      const { component } = makeComponent();
      component.systemId = null;
      expect(component.getCurrentRuntime()).toBe('docker');
    });

    it('should return primaryRuntime of the matching system', () => {
      const { component, systemsSignal } = makeComponent();
      component.systemId = 'sys-1';
      systemsSignal.set([makeSystem({ id: 'sys-1', primaryRuntime: 'podman' })]);
      expect(component.getCurrentRuntime()).toBe('podman');
    });

    it('should return "docker" when system is not found', () => {
      const { component, systemsSignal } = makeComponent();
      component.systemId = 'not-found';
      systemsSignal.set([]);
      expect(component.getCurrentRuntime()).toBe('docker');
    });
  });

  // -------------------------------------------------------------------------
  // getRuntimeIcon
  // -------------------------------------------------------------------------

  describe('getRuntimeIcon', () => {
    it('should return Ship icon for docker runtime', () => {
      const { component, systemsSignal } = makeComponent();
      component.systemId = 'sys-1';
      systemsSignal.set([makeSystem({ primaryRuntime: 'docker' })]);
      const { Ship } = require('lucide-angular');
      expect(component.getRuntimeIcon()).toBe(Ship);
    });

    it('should return Container icon for podman runtime', () => {
      const { component, systemsSignal } = makeComponent();
      component.systemId = 'sys-1';
      systemsSignal.set([makeSystem({ primaryRuntime: 'podman' })]);
      const { Container } = require('lucide-angular');
      expect(component.getRuntimeIcon()).toBe(Container);
    });

    it('should return Apple icon for apple runtime', () => {
      const { component, systemsSignal } = makeComponent();
      component.systemId = 'sys-1';
      systemsSignal.set([makeSystem({ primaryRuntime: 'apple' })]);
      const { Apple } = require('lucide-angular');
      expect(component.getRuntimeIcon()).toBe(Apple);
    });

    it('should return Container icon for unknown runtime', () => {
      const { component, systemsSignal } = makeComponent();
      component.systemId = 'sys-1';
      systemsSignal.set([makeSystem({ primaryRuntime: 'unknown' as any })]);
      const { Container } = require('lucide-angular');
      expect(component.getRuntimeIcon()).toBe(Container);
    });
  });

  // -------------------------------------------------------------------------
  // toggleFullscreen
  // -------------------------------------------------------------------------

  describe('toggleFullscreen', () => {
    it('should toggle isFullscreen from false to true', () => {
      const { component } = makeComponent();
      expect(component.isFullscreen).toBe(false);
      component.toggleFullscreen();
      expect(component.isFullscreen).toBe(true);
    });

    it('should toggle isFullscreen from true to false', () => {
      const { component } = makeComponent();
      component.isFullscreen = true;
      component.toggleFullscreen();
      expect(component.isFullscreen).toBe(false);
    });

    it('should call document.documentElement.requestFullscreen when entering fullscreen', () => {
      const { component } = makeComponent();
      const requestFullscreen = vi.fn().mockResolvedValue(undefined);
      (document.documentElement as any).requestFullscreen = requestFullscreen;
      component.toggleFullscreen();
      expect(requestFullscreen).toHaveBeenCalled();
    });

    it('should call document.exitFullscreen when leaving fullscreen', () => {
      const { component } = makeComponent();
      const exitFullscreen = vi.fn().mockResolvedValue(undefined);
      document.exitFullscreen = exitFullscreen;
      component.isFullscreen = true;
      component.toggleFullscreen();
      expect(exitFullscreen).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // toggleWarpTerminal
  // -------------------------------------------------------------------------

  describe('toggleWarpTerminal', () => {
    it('should toggle showWarpTerminal signal', () => {
      const { component } = makeComponent();
      expect(component.showWarpTerminal()).toBe(false);
      component.toggleWarpTerminal();
      expect(component.showWarpTerminal()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // openCommandPalette / closeCommandPalette
  // -------------------------------------------------------------------------

  describe('openCommandPalette', () => {
    it('should set showCommandPalette to true', () => {
      const { component } = makeComponent();
      expect(component.showCommandPalette).toBe(false);
      component.openCommandPalette();
      expect(component.showCommandPalette).toBe(true);
    });
  });

  describe('closeCommandPalette', () => {
    it('should set showCommandPalette to false', () => {
      const { component } = makeComponent();
      component.showCommandPalette = true;
      component.closeCommandPalette();
      expect(component.showCommandPalette).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // closeVariableInput
  // -------------------------------------------------------------------------

  describe('closeVariableInput', () => {
    it('should set showVariableInput to false', () => {
      const { component } = makeComponent();
      component.showVariableInput = true;
      component.closeVariableInput();
      expect(component.showVariableInput).toBe(false);
    });

    it('should clear pendingCommand', () => {
      const { component } = makeComponent();
      component.pendingCommand = 'docker ps';
      component.closeVariableInput();
      expect(component.pendingCommand).toBeNull();
    });

    it('should clear pendingTemplate', () => {
      const { component } = makeComponent();
      component.pendingTemplate = { id: '1', name: 'test', command: 'echo hi', category: 'General' };
      component.closeVariableInput();
      expect(component.pendingTemplate).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // executeCommand
  // -------------------------------------------------------------------------

  describe('executeCommand', () => {
    it('should do nothing when there is no session', () => {
      const { component, mockTerminalService } = makeComponent();
      component.session = null;
      component.executeCommand('ls -la');
      expect(mockTerminalService.sendInput).not.toHaveBeenCalled();
    });

    it('should do nothing when command is empty', () => {
      const { component, mockTerminalService, mockSession } = makeComponent();
      component.session = mockSession;
      component.executeCommand('');
      expect(mockTerminalService.sendInput).not.toHaveBeenCalled();
    });

    it('should send command via PTY when warp is disabled', () => {
      const { component, mockTerminalService, mockSession } = makeComponent();
      component.session = mockSession;
      component.showWarpTerminal.set(false);
      component.executeCommand('ls -la');
      expect(mockTerminalService.sendInput).toHaveBeenCalledWith('sess-1', 'ls -la\n');
    });

    it('should emit event to event bus when warp is enabled', () => {
      const { component, mockEventBus, mockSession } = makeComponent();
      component.session = mockSession;
      component.showWarpTerminal.set(true);
      component.executeCommand('docker ps');
      expect(mockEventBus.emit).toHaveBeenCalledWith({
        type: 'UserSubmittedCommand',
        text: 'docker ps',
        source: 'user',
      });
    });

    it('should close command palette after execution', () => {
      const { component, mockSession } = makeComponent();
      component.session = mockSession;
      component.showCommandPalette = true;
      component.executeCommand('ls');
      expect(component.showCommandPalette).toBe(false);
    });

    it('should close variable input after execution', () => {
      const { component, mockSession } = makeComponent();
      component.session = mockSession;
      component.showVariableInput = true;
      component.executeCommand('ls');
      expect(component.showVariableInput).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // openSearch / closeSearch
  // -------------------------------------------------------------------------

  describe('openSearch', () => {
    it('should set showSearchBar to true', () => {
      const { component } = makeComponent();
      expect(component.showSearchBar).toBe(false);
      component.openSearch();
      expect(component.showSearchBar).toBe(true);
    });
  });

  describe('closeSearch', () => {
    it('should set showSearchBar to false', () => {
      const { component } = makeComponent();
      component.showSearchBar = true;
      component.closeSearch();
      expect(component.showSearchBar).toBe(false);
    });

    it('should clear searchQuery', () => {
      const { component } = makeComponent();
      component.searchQuery = 'hello';
      component.closeSearch();
      expect(component.searchQuery).toBe('');
    });

    it('should call searchAddon.clearDecorations when addon is set', () => {
      const { component } = makeComponent();
      const clearDecorations = vi.fn();
      (component as any)['searchAddon'] = { clearDecorations, findNext: vi.fn(), findPrevious: vi.fn() };
      component.closeSearch();
      expect(clearDecorations).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // onSearchInput
  // -------------------------------------------------------------------------

  describe('onSearchInput', () => {
    it('should call searchAddon.findNext when searchQuery is non-empty', () => {
      const { component } = makeComponent();
      const findNext = vi.fn();
      (component as any)['searchAddon'] = { findNext, findPrevious: vi.fn(), clearDecorations: vi.fn() };
      component.searchQuery = 'error';
      component.onSearchInput();
      expect(findNext).toHaveBeenCalledWith('error', { caseSensitive: false });
    });

    it('should call searchAddon.clearDecorations when searchQuery is empty', () => {
      const { component } = makeComponent();
      const clearDecorations = vi.fn();
      (component as any)['searchAddon'] = { findNext: vi.fn(), findPrevious: vi.fn(), clearDecorations };
      component.searchQuery = '';
      component.onSearchInput();
      expect(clearDecorations).toHaveBeenCalled();
    });

    it('should not throw when searchAddon is null', () => {
      const { component } = makeComponent();
      (component as any)['searchAddon'] = null;
      component.searchQuery = 'test';
      expect(() => component.onSearchInput()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // findNext / findPrevious
  // -------------------------------------------------------------------------

  describe('findNext', () => {
    it('should call searchAddon.findNext with current query', () => {
      const { component } = makeComponent();
      const findNext = vi.fn();
      (component as any)['searchAddon'] = { findNext, findPrevious: vi.fn(), clearDecorations: vi.fn() };
      component.searchQuery = 'foo';
      component.findNext();
      expect(findNext).toHaveBeenCalledWith('foo');
    });

    it('should not call findNext when searchQuery is empty', () => {
      const { component } = makeComponent();
      const findNext = vi.fn();
      (component as any)['searchAddon'] = { findNext };
      component.searchQuery = '';
      component.findNext();
      expect(findNext).not.toHaveBeenCalled();
    });
  });

  describe('findPrevious', () => {
    it('should call searchAddon.findPrevious with current query', () => {
      const { component } = makeComponent();
      const findPrevious = vi.fn();
      (component as any)['searchAddon'] = { findNext: vi.fn(), findPrevious, clearDecorations: vi.fn() };
      component.searchQuery = 'bar';
      component.findPrevious();
      expect(findPrevious).toHaveBeenCalledWith('bar');
    });

    it('should not call findPrevious when searchQuery is empty', () => {
      const { component } = makeComponent();
      const findPrevious = vi.fn();
      (component as any)['searchAddon'] = { findPrevious };
      component.searchQuery = '';
      component.findPrevious();
      expect(findPrevious).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // close
  // -------------------------------------------------------------------------

  describe('close', () => {
    it('should call terminalService.closeSession when session exists', async () => {
      const { component, mockTerminalService, mockSession } = makeComponent();
      component.session = mockSession;
      await component.close();
      expect(mockTerminalService.closeSession).toHaveBeenCalledWith('sess-1');
    });

    it('should not call closeSession when session is null', async () => {
      const { component, mockTerminalService } = makeComponent();
      component.session = null;
      await component.close();
      expect(mockTerminalService.closeSession).not.toHaveBeenCalled();
    });

    it('should navigate to /containers after close', async () => {
      const { component, mockRouter, mockSession } = makeComponent();
      component.session = mockSession;
      await component.close();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/containers']);
    });

    it('should still navigate even when session is null', async () => {
      const { component, mockRouter } = makeComponent();
      component.session = null;
      await component.close();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/containers']);
    });
  });
});
