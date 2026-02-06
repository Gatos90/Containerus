import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TerminalState, DockedTerminal, DEFAULT_TERMINAL_OPTIONS } from './terminal.state';

describe('TerminalState', () => {
  let state: TerminalState;
  let mockTerminalService: any;

  const makeTerminal = (id: string): DockedTerminal => ({
    id,
    session: { id: `sess-${id}`, systemId: 'sys-1', shell: '/bin/sh' },
    systemId: 'sys-1',
    systemName: 'Test System',
    serializedState: '',
    terminalOptions: DEFAULT_TERMINAL_OPTIONS,
  });

  beforeEach(() => {
    mockTerminalService = {
      closeSession: vi.fn().mockResolvedValue(undefined),
    };
    state = new TerminalState(mockTerminalService);
  });

  it('should start with default state', () => {
    expect(state.dockedTerminals()).toEqual([]);
    expect(state.layoutMode()).toBe('single');
    expect(state.activeSlotIndex()).toBe(0);
    expect(state.isDockMinimized()).toBe(false);
    expect(state.isDockExpanded()).toBe(true);
    expect(state.isDockFullscreen()).toBe(false);
    expect(state.dockHeightPercent()).toBe(50);
  });

  it('should have no docked items initially', () => {
    expect(state.hasDockedItems()).toBe(false);
  });

  it('should add a terminal to first empty slot', () => {
    const terminal = makeTerminal('t1');
    state.addTerminal(terminal);

    expect(state.dockedTerminals()).toHaveLength(1);
    expect(state.hasDockedItems()).toBe(true);
    expect(state.slots()[0].contentType).toBe('terminal');
    expect(state.slots()[0].contentId).toBe('t1');
  });

  it('should add terminal to specified slot', () => {
    state.setLayoutMode('split-h');
    const terminal = makeTerminal('t1');
    state.addTerminal(terminal, 1);

    expect(state.slots()[1].contentId).toBe('t1');
  });

  it('should remove a terminal', async () => {
    const terminal = makeTerminal('t1');
    state.addTerminal(terminal);

    await state.removeTerminal('t1');
    expect(state.dockedTerminals()).toHaveLength(0);
    expect(state.slots()[0].contentType).toBe('empty');
    expect(mockTerminalService.closeSession).toHaveBeenCalledWith('sess-t1');
  });

  it('should get terminal by id', () => {
    const terminal = makeTerminal('t1');
    state.addTerminal(terminal);

    expect(state.getTerminalById('t1')?.id).toBe('t1');
    expect(state.getTerminalById('nonexistent')).toBeUndefined();
  });

  it('should compute slot count based on layout', () => {
    expect(state.slotCount()).toBe(1);

    state.setLayoutMode('split-h');
    expect(state.slotCount()).toBe(2);

    state.setLayoutMode('split-v');
    expect(state.slotCount()).toBe(2);

    state.setLayoutMode('quad');
    expect(state.slotCount()).toBe(4);
  });

  it('should adjust slots when changing layout mode', () => {
    state.setLayoutMode('quad');
    expect(state.slots()).toHaveLength(4);

    state.setLayoutMode('single');
    expect(state.slots()).toHaveLength(1);
  });

  it('should clamp active slot when shrinking layout', () => {
    state.setLayoutMode('quad');
    state.setActiveSlot(3);
    expect(state.activeSlotIndex()).toBe(3);

    state.setLayoutMode('single');
    expect(state.activeSlotIndex()).toBe(0);
  });

  it('should set active slot within bounds', () => {
    state.setLayoutMode('split-h');
    state.setActiveSlot(1);
    expect(state.activeSlotIndex()).toBe(1);

    // Out of bounds should not change
    state.setActiveSlot(5);
    expect(state.activeSlotIndex()).toBe(1);

    state.setActiveSlot(-1);
    expect(state.activeSlotIndex()).toBe(1);
  });

  it('should toggle dock minimized', () => {
    state.toggleDockMinimized();
    expect(state.isDockMinimized()).toBe(true);

    state.toggleDockMinimized();
    expect(state.isDockMinimized()).toBe(false);
  });

  it('should exit fullscreen when minimizing', () => {
    state.toggleDockFullscreen(); // Go fullscreen
    expect(state.isDockFullscreen()).toBe(true);

    state.toggleDockMinimized(); // Minimize
    expect(state.isDockMinimized()).toBe(true);
    expect(state.isDockFullscreen()).toBe(false);
  });

  it('should auto-expand when going fullscreen', () => {
    state.toggleDockMinimized(); // Minimize
    expect(state.isDockMinimized()).toBe(true);

    state.toggleDockFullscreen(); // Go fullscreen
    expect(state.isDockFullscreen()).toBe(true);
    expect(state.isDockMinimized()).toBe(false);
  });

  it('should toggle dock expanded', () => {
    state.toggleDockExpanded();
    expect(state.isDockExpanded()).toBe(false);

    state.toggleDockExpanded();
    expect(state.isDockExpanded()).toBe(true);
  });

  it('should clamp dock height percent', () => {
    state.setDockHeightPercent(50);
    expect(state.dockHeightPercent()).toBe(50);

    state.setDockHeightPercent(5);
    expect(state.dockHeightPercent()).toBe(15);

    state.setDockHeightPercent(95);
    expect(state.dockHeightPercent()).toBe(85);
  });

  it('should swap slots', () => {
    state.setLayoutMode('split-h');
    const t1 = makeTerminal('t1');
    const t2 = makeTerminal('t2');
    state.addTerminal(t1, 0);
    state.addTerminal(t2, 1);

    state.swapSlots(0, 1);
    expect(state.slots()[0].contentId).toBe('t2');
    expect(state.slots()[1].contentId).toBe('t1');
  });

  it('should toggle terminal display mode', () => {
    const terminal = makeTerminal('t1');
    state.addTerminal(terminal);

    // Default is undefined (xterm)
    state.toggleTerminalDisplayMode('t1');
    expect(state.dockedTerminals()[0].displayMode).toBe('warp');

    state.toggleTerminalDisplayMode('t1');
    expect(state.dockedTerminals()[0].displayMode).toBe('xterm');
  });

  it('should check if terminal is in slot', () => {
    const terminal = makeTerminal('t1');
    state.addTerminal(terminal);

    expect(state.isTerminalInSlot('t1')).toBe(true);
    expect(state.isTerminalInSlot('t2')).toBe(false);
  });

  it('should generate unique terminal IDs', () => {
    const id1 = state.generateTerminalId();
    const id2 = state.generateTerminalId();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^terminal-/);
  });

  it('should focus terminal already in slot', () => {
    state.setLayoutMode('split-h');
    const t1 = makeTerminal('t1');
    state.addTerminal(t1, 1);
    state.setActiveSlot(0);

    state.focusTerminal('t1');
    expect(state.activeSlotIndex()).toBe(1);
  });

  it('should get active terminal', () => {
    const terminal = makeTerminal('t1');
    state.addTerminal(terminal);

    expect(state.activeTerminal()?.id).toBe('t1');
  });

  it('should return null active terminal for empty slot', () => {
    expect(state.activeTerminal()).toBeNull();
  });

  it('should add and manage file browsers', () => {
    state.addFileBrowser({
      id: 'fb-1',
      systemId: 'sys-1',
      systemName: 'Test',
      currentPath: '/home',
    });

    expect(state.dockedFileBrowsers()).toHaveLength(1);
    expect(state.hasDockedItems()).toBe(true);
  });

  it('should remove file browser', () => {
    state.addFileBrowser({
      id: 'fb-1',
      systemId: 'sys-1',
      systemName: 'Test',
      currentPath: '/home',
    });

    state.removeFileBrowser('fb-1');
    expect(state.dockedFileBrowsers()).toHaveLength(0);
  });

  it('should update file browser path', () => {
    state.addFileBrowser({
      id: 'fb-1',
      systemId: 'sys-1',
      systemName: 'Test',
      currentPath: '/home',
    });

    state.updateFileBrowserPath('fb-1', '/tmp');
    expect(state.dockedFileBrowsers()[0].currentPath).toBe('/tmp');
  });

  it('should generate unique file browser IDs', () => {
    const id1 = state.generateFileBrowserId();
    const id2 = state.generateFileBrowserId();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^filebrowser-/);
  });

  it('should reorder terminals', () => {
    state.addTerminal(makeTerminal('t1'));
    state.addTerminal(makeTerminal('t2'));
    state.addTerminal(makeTerminal('t3'));

    state.reorderTerminals(0, 2);
    expect(state.dockedTerminals()[0].id).toBe('t2');
    expect(state.dockedTerminals()[2].id).toBe('t1');
  });

  it('should clear all', async () => {
    state.addTerminal(makeTerminal('t1'));
    state.addFileBrowser({
      id: 'fb-1',
      systemId: 'sys-1',
      systemName: 'Test',
      currentPath: '/',
    });

    await state.clearAll();
    expect(state.dockedTerminals()).toHaveLength(0);
    expect(state.dockedFileBrowsers()).toHaveLength(0);
    expect(state.layoutMode()).toBe('single');
    expect(state.activeSlotIndex()).toBe(0);
  });

  describe('DEFAULT_TERMINAL_OPTIONS', () => {
    it('should have cursor blink enabled', () => {
      expect(DEFAULT_TERMINAL_OPTIONS.cursorBlink).toBe(true);
    });

    it('should have font size 14', () => {
      expect(DEFAULT_TERMINAL_OPTIONS.fontSize).toBe(14);
    });

    it('should have a dark theme', () => {
      expect(DEFAULT_TERMINAL_OPTIONS.theme?.background).toBe('#09090b');
      expect(DEFAULT_TERMINAL_OPTIONS.theme?.foreground).toBe('#fafafa');
    });
  });
});
