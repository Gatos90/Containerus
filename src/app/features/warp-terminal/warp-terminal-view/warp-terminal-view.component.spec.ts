import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  Injector,
  runInInjectionContext,
  signal,
  computed,
  ɵChangeDetectionScheduler,
  ɵEffectScheduler,
} from '@angular/core';
import { WarpTerminalViewComponent } from './warp-terminal-view.component';
import { WarpTerminalStore } from '../state/warp-terminal-store.service';
import { WarpTerminalStateManager } from '../state/warp-terminal-state-manager.service';
import { MockTerminalBackend } from '../state/mock-terminal-backend.service';
import { AgentBackendService } from '../state/agent-backend.service';
import type { CommandBlock, SelectionState, SearchResult } from '../models/terminal-block.model';
import { OutputBuffer } from '../models/terminal-output.model';

// ---- Helpers ---------------------------------------------------------------

function makeBlock(id: number, commandText = 'echo hello'): CommandBlock {
  return {
    id,
    commandText,
    source: 'user',
    status: { state: 'finished', exitCode: 0, endedAt: Date.now() },
    cwdLabel: '~',
    hostLabel: 'local',
    renderState: new OutputBuffer(),
    metrics: { bytesReceived: 0, lineCount: 0 },
    isCollapsed: false,
  };
}

function makeMockStore(overrides: Record<string, any> = {}) {
  const blocksSignal = signal<CommandBlock[]>([]);
  const isFollowingSignal = signal(true);
  const selectionSignal = signal<SelectionState>({ kind: 'none' });
  const searchIsOpenSignal = signal(false);
  const searchTextSignal = signal('');
  const searchResultsSignal = signal<SearchResult[]>([]);
  const isAiThinkingSignal = signal(false);
  const aiErrorSignal = signal<{ message: string; suggestion?: string } | null>(null);

  return {
    blocks: blocksSignal,
    isFollowing: isFollowingSignal,
    selection: selectionSignal,
    searchIsOpen: searchIsOpenSignal,
    searchText: searchTextSignal,
    searchResults: searchResultsSignal,
    isAiThinking: isAiThinkingSignal,
    aiError: aiErrorSignal,
    dispatch: vi.fn(),
    toggleCollapse: vi.fn(),
    setSearchQuery: vi.fn(),
    setSelection: vi.fn(),
    clearAiError: vi.fn(),
    clearTerminal: vi.fn(),
    ...overrides,
  };
}

function makeMockStateManager() {
  return { switchToSystem: vi.fn() };
}

function makeMockMockBackend() {
  return {};
}

function makeMockAgentBackend() {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
    cancelCurrentQuery: vi.fn(),
  };
}

function makeComponent(
  storeMock = makeMockStore(),
  stateManagerMock = makeMockStateManager(),
  mockBackendMock = makeMockMockBackend(),
  agentBackendMock = makeMockAgentBackend()
): WarpTerminalViewComponent {
  const injector = Injector.create({
    providers: [
      {
        provide: ɵChangeDetectionScheduler,
        useValue: { notify: vi.fn(), runningTick: false },
      },
      {
        provide: ɵEffectScheduler,
        useValue: { add: vi.fn(), remove: vi.fn(), schedule: vi.fn(), flush: vi.fn() },
      },
      { provide: WarpTerminalStore, useValue: storeMock },
      { provide: WarpTerminalStateManager, useValue: stateManagerMock },
      { provide: MockTerminalBackend, useValue: mockBackendMock },
      { provide: AgentBackendService, useValue: agentBackendMock },
    ],
  });
  return runInInjectionContext(injector, () => new WarpTerminalViewComponent());
}

// ---- Tests -----------------------------------------------------------------

describe('WarpTerminalViewComponent', () => {
  let component: WarpTerminalViewComponent;
  let storeMock: ReturnType<typeof makeMockStore>;
  let agentBackendMock: ReturnType<typeof makeMockAgentBackend>;
  let stateManagerMock: ReturnType<typeof makeMockStateManager>;

  beforeEach(() => {
    storeMock = makeMockStore();
    agentBackendMock = makeMockAgentBackend();
    stateManagerMock = makeMockStateManager();
    component = makeComponent(storeMock, stateManagerMock, makeMockMockBackend(), agentBackendMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should create successfully', () => {
      expect(component).toBeTruthy();
    });

    it('should expose icon references', () => {
      expect(component.ArrowDownToLine).toBeDefined();
      expect(component.Search).toBeDefined();
      expect(component.Sparkles).toBeDefined();
      expect(component.Terminal).toBeDefined();
      expect(component.Trash2).toBeDefined();
    });

    it('should wire store signals as component properties', () => {
      expect(component.blocks).toBeDefined();
      expect(component.followMode).toBeDefined();
      expect(component.selection).toBeDefined();
      expect(component.searchOpen).toBeDefined();
      expect(component.isAiThinking).toBeDefined();
    });
  });

  describe('ngOnInit', () => {
    it('should call agentBackend.initialize with fallback ID when no sessionId', async () => {
      await component.ngOnInit();
      expect(agentBackendMock.initialize).toHaveBeenCalled();
      const [sessionId] = agentBackendMock.initialize.mock.calls[0];
      expect(sessionId).toMatch(/^warp-terminal-/);
    });

    it('should pass null containerId when containerId input is null', async () => {
      await component.ngOnInit();
      const [, containerId] = agentBackendMock.initialize.mock.calls[0];
      expect(containerId).toBeNull();
    });

    it('should handle agentBackend.initialize rejection gracefully', async () => {
      agentBackendMock.initialize.mockRejectedValue(new Error('backend error'));
      // ngOnInit catches the rejection internally; should not throw
      component.ngOnInit();
      // Give the microtask queue a chance to flush the catch
      await new Promise((r) => setTimeout(r, 0));
      expect(agentBackendMock.initialize).toHaveBeenCalled();
    });
  });

  describe('ngOnDestroy', () => {
    it('should call agentBackend.destroy', () => {
      component.ngOnDestroy();
      expect(agentBackendMock.destroy).toHaveBeenCalled();
    });
  });

  describe('submitCommand', () => {
    it('should dispatch UserSubmittedCommand with user source for command mode', () => {
      component.submitCommand({ text: 'docker ps', mode: 'command' });

      expect(storeMock.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'UserSubmittedCommand', text: 'docker ps', source: 'user' })
      );
    });

    it('should dispatch UserSubmittedCommand with aiExecuted source for ai mode', () => {
      component.submitCommand({ text: 'list containers', mode: 'ai' });

      expect(storeMock.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'UserSubmittedCommand',
          text: 'list containers',
          source: 'aiExecuted',
        })
      );
    });

    it('should dispatch UserToggledFollowMode after submitting', () => {
      component.submitCommand({ text: 'ls', mode: 'command' });
      expect(storeMock.dispatch).toHaveBeenCalledWith({ type: 'UserToggledFollowMode', on: true });
    });

    it('should trim whitespace from text', () => {
      component.submitCommand({ text: '  ls -la  ', mode: 'command' });
      expect(storeMock.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'ls -la' })
      );
    });

    it('should not dispatch when text is empty after trim', () => {
      component.submitCommand({ text: '   ', mode: 'command' });
      expect(storeMock.dispatch).not.toHaveBeenCalled();
    });

    it('should not dispatch when text is empty string', () => {
      component.submitCommand({ text: '', mode: 'command' });
      expect(storeMock.dispatch).not.toHaveBeenCalled();
    });
  });

  describe('selectBlock', () => {
    it('should dispatch UserSelectedBlock with blockId', () => {
      component.selectBlock(5);
      expect(storeMock.dispatch).toHaveBeenCalledWith({ type: 'UserSelectedBlock', blockId: 5 });
    });

    it('should dispatch UserSelectedBlock with null', () => {
      component.selectBlock(null);
      expect(storeMock.dispatch).toHaveBeenCalledWith({ type: 'UserSelectedBlock', blockId: null });
    });
  });

  describe('setSelection', () => {
    it('should call store.setSelection with the provided selection', () => {
      const selection: SelectionState = { kind: 'block', blockId: 3 };
      component.setSelection(selection);
      expect(storeMock.setSelection).toHaveBeenCalledWith(selection);
    });
  });

  describe('toggleCollapse', () => {
    it('should call store.toggleCollapse with blockId', () => {
      component.toggleCollapse(7);
      expect(storeMock.toggleCollapse).toHaveBeenCalledWith(7);
    });
  });

  describe('toggleSearch', () => {
    it('should dispatch UserToggledSearch with open=true', () => {
      component.toggleSearch(true);
      expect(storeMock.dispatch).toHaveBeenCalledWith({ type: 'UserToggledSearch', open: true });
    });

    it('should dispatch UserToggledSearch with open=false', () => {
      component.toggleSearch(false);
      expect(storeMock.dispatch).toHaveBeenCalledWith({ type: 'UserToggledSearch', open: false });
    });
  });

  describe('updateSearch', () => {
    it('should call store.setSearchQuery', () => {
      component.updateSearch('docker');
      expect(storeMock.setSearchQuery).toHaveBeenCalledWith('docker');
    });
  });

  describe('handleUserScroll', () => {
    it('should dispatch UserScrolled event', () => {
      component.handleUserScroll();
      expect(storeMock.dispatch).toHaveBeenCalledWith({ type: 'UserScrolled' });
    });
  });

  describe('scrollToLatest', () => {
    it('should dispatch UserToggledFollowMode with on=true', () => {
      component.scrollToLatest();
      expect(storeMock.dispatch).toHaveBeenCalledWith({ type: 'UserToggledFollowMode', on: true });
    });

    it('should call blockList.scrollToBottom when blockList is set', () => {
      const mockScrollToBottom = vi.fn();
      (component as any).blockList = { scrollToBottom: mockScrollToBottom };
      component.scrollToLatest();
      expect(mockScrollToBottom).toHaveBeenCalledWith(true);
    });

    it('should not throw when blockList is not set', () => {
      (component as any).blockList = undefined;
      expect(() => component.scrollToLatest()).not.toThrow();
    });
  });

  describe('selectSearchResult', () => {
    it('should dispatch UserSelectedBlock for blockId', () => {
      component.selectSearchResult({ blockId: 3, lineIndex: 2 });
      expect(storeMock.dispatch).toHaveBeenCalledWith({ type: 'UserSelectedBlock', blockId: 3 });
    });

    it('should call blockList.scrollToBlock when blockList is set', () => {
      const mockScrollToBlock = vi.fn();
      (component as any).blockList = { scrollToBlock: mockScrollToBlock };
      component.selectSearchResult({ blockId: 5 });
      expect(mockScrollToBlock).toHaveBeenCalledWith(5);
    });
  });

  describe('copyBlockCommand', () => {
    it('should write commandText to clipboard when block exists', () => {
      const block = makeBlock(1, 'docker ps -a');
      storeMock.blocks.set([block]);
      const writeSpy = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeSpy },
        configurable: true,
      });

      component.copyBlockCommand(1);
      expect(writeSpy).toHaveBeenCalledWith('docker ps -a');
    });

    it('should not call clipboard when block is not found', () => {
      storeMock.blocks.set([]);
      const writeSpy = vi.fn();
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeSpy },
        configurable: true,
      });

      component.copyBlockCommand(999);
      expect(writeSpy).not.toHaveBeenCalled();
    });
  });

  describe('copyBlockOutput', () => {
    it('should write getAllText() to clipboard when block exists', () => {
      const buffer = new OutputBuffer();
      buffer.appendText('hello world\n');
      const block = makeBlock(2, 'echo hello');
      block.renderState = buffer;
      storeMock.blocks.set([block]);

      const writeSpy = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeSpy },
        configurable: true,
      });

      component.copyBlockOutput(2);
      expect(writeSpy).toHaveBeenCalledWith('hello world');
    });

    it('should not call clipboard when block is not found', () => {
      storeMock.blocks.set([]);
      const writeSpy = vi.fn();
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeSpy },
        configurable: true,
      });

      component.copyBlockOutput(404);
      expect(writeSpy).not.toHaveBeenCalled();
    });
  });

  describe('rerunBlock', () => {
    it('should submit the block command when block exists', () => {
      const block = makeBlock(1, 'npm install');
      storeMock.blocks.set([block]);

      component.rerunBlock(1);

      expect(storeMock.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'UserSubmittedCommand', text: 'npm install', source: 'user' })
      );
    });

    it('should not dispatch when block is not found', () => {
      storeMock.blocks.set([]);
      component.rerunBlock(999);
      expect(storeMock.dispatch).not.toHaveBeenCalled();
    });
  });

  describe('toggleFollowMode', () => {
    it('should dispatch UserToggledFollowMode toggling from true to false', () => {
      storeMock.isFollowing.set(true);
      component.toggleFollowMode();
      expect(storeMock.dispatch).toHaveBeenCalledWith({ type: 'UserToggledFollowMode', on: false });
    });

    it('should dispatch UserToggledFollowMode toggling from false to true', () => {
      storeMock.isFollowing.set(false);
      component.toggleFollowMode();
      expect(storeMock.dispatch).toHaveBeenCalledWith({ type: 'UserToggledFollowMode', on: true });
    });
  });

  describe('dismissAiError', () => {
    it('should call store.clearAiError', () => {
      component.dismissAiError();
      expect(storeMock.clearAiError).toHaveBeenCalled();
    });
  });

  describe('cancelAiQuery', () => {
    it('should call agentBackend.cancelCurrentQuery', () => {
      component.cancelAiQuery();
      expect(agentBackendMock.cancelCurrentQuery).toHaveBeenCalled();
    });
  });

  describe('clearTerminal', () => {
    it('should call store.clearTerminal', () => {
      component.clearTerminal();
      expect(storeMock.clearTerminal).toHaveBeenCalled();
    });
  });

  describe('onKeyDown', () => {
    it('should prevent default and toggle search on Ctrl+F', () => {
      const event = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      component.onKeyDown(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(storeMock.dispatch).toHaveBeenCalledWith({ type: 'UserToggledSearch', open: true });
    });

    it('should prevent default and toggle search on Meta+F', () => {
      const event = new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
      component.onKeyDown(event);
      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('should close search on Escape when search is open', () => {
      storeMock.searchIsOpen.set(true);
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      component.onKeyDown(event);
      expect(storeMock.dispatch).toHaveBeenCalledWith({ type: 'UserToggledSearch', open: false });
    });

    it('should not close search on Escape when search is closed', () => {
      storeMock.searchIsOpen.set(false);
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      component.onKeyDown(event);
      expect(storeMock.dispatch).not.toHaveBeenCalledWith({ type: 'UserToggledSearch', open: false });
    });

    it('should copy block output on Ctrl+C when block is selected', () => {
      const buffer = new OutputBuffer();
      buffer.appendText('output text\n');
      const block = makeBlock(3, 'ls');
      block.renderState = buffer;
      storeMock.blocks.set([block]);
      storeMock.selection.set({ kind: 'block', blockId: 3 });

      const writeSpy = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeSpy },
        configurable: true,
      });

      const event = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
      component.onKeyDown(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(writeSpy).toHaveBeenCalled();
    });

    it('should NOT copy on Ctrl+C when selection is none', () => {
      storeMock.selection.set({ kind: 'none' });
      const writeSpy = vi.fn();
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeSpy },
        configurable: true,
      });

      const event = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true });
      component.onKeyDown(event);
      expect(writeSpy).not.toHaveBeenCalled();
    });

    it('should clear terminal on Ctrl+L', () => {
      const event = new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, bubbles: true });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
      component.onKeyDown(event);
      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(storeMock.clearTerminal).toHaveBeenCalled();
    });

    it('should clear terminal on Meta+L', () => {
      const event = new KeyboardEvent('keydown', { key: 'l', metaKey: true, bubbles: true });
      component.onKeyDown(event);
      expect(storeMock.clearTerminal).toHaveBeenCalled();
    });

    it('should do nothing for unhandled keys', () => {
      const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true });
      component.onKeyDown(event);
      expect(storeMock.dispatch).not.toHaveBeenCalled();
    });
  });

  describe('highlightMap computed', () => {
    it('should build a map from search results with lineIndex', () => {
      const localStore = makeMockStore();
      localStore.searchResults.set([
        { blockId: 1, kind: 'output', lineIndex: 5, preview: 'hello' },
        { blockId: 1, kind: 'output', lineIndex: 6, preview: 'world' },
        { blockId: 2, kind: 'output', lineIndex: 0, preview: 'foo' },
      ]);

      const comp = makeComponent(localStore);
      const map = comp.highlightMap();

      expect(map.get(1)?.has(5)).toBe(true);
      expect(map.get(1)?.has(6)).toBe(true);
      expect(map.get(2)?.has(0)).toBe(true);
    });

    it('should ignore command-kind results in highlight map', () => {
      const localStore = makeMockStore();
      localStore.searchResults.set([
        { blockId: 1, kind: 'command', preview: 'docker ps' },
      ]);
      const comp = makeComponent(localStore);
      const map = comp.highlightMap();
      expect(map.size).toBe(0);
    });

    it('should return empty map when no search results', () => {
      const localStore = makeMockStore();
      localStore.searchResults.set([]);
      const comp = makeComponent(localStore);
      const map = comp.highlightMap();
      expect(map.size).toBe(0);
    });

    it('should group multiple line indices for same block', () => {
      const localStore = makeMockStore();
      localStore.searchResults.set([
        { blockId: 10, kind: 'output', lineIndex: 1, preview: 'a' },
        { blockId: 10, kind: 'output', lineIndex: 2, preview: 'b' },
        { blockId: 10, kind: 'output', lineIndex: 3, preview: 'c' },
      ]);
      const comp = makeComponent(localStore);
      const map = comp.highlightMap();
      expect(map.get(10)?.size).toBe(3);
    });
  });
});
