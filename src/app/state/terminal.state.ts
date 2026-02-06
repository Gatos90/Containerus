import { computed, Injectable, signal } from '@angular/core';
import { Terminal, ITerminalOptions } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { TerminalService, TerminalSession } from '../core/services/terminal.service';
import { ContainerRuntime } from '../core/models/container.model';

export type LayoutMode = 'single' | 'split-h' | 'split-v' | 'quad';

// Default terminal options for consistent theming
export const DEFAULT_TERMINAL_OPTIONS: ITerminalOptions = {
  cursorBlink: true,
  fontSize: 14,
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  theme: {
    background: '#09090b',
    foreground: '#fafafa',
    cursor: '#fafafa',
    cursorAccent: '#09090b',
    selectionBackground: '#3f3f46',
    black: '#18181b',
    red: '#ef4444',
    green: '#22c55e',
    yellow: '#eab308',
    blue: '#3b82f6',
    magenta: '#a855f7',
    cyan: '#06b6d4',
    white: '#f4f4f5',
    brightBlack: '#52525b',
    brightRed: '#f87171',
    brightGreen: '#4ade80',
    brightYellow: '#facc15',
    brightBlue: '#60a5fa',
    brightMagenta: '#c084fc',
    brightCyan: '#22d3ee',
    brightWhite: '#fafafa',
  },
};

export interface DockedTerminal {
  id: string;
  session: TerminalSession;
  systemId: string;
  containerId?: string;
  systemName: string;
  containerName?: string;
  // Store serialized state instead of terminal instance
  serializedState: string;
  terminalOptions: ITerminalOptions;
  // Active terminal instance (created fresh in workspace)
  terminal?: Terminal;
  fitAddon?: FitAddon;
  searchAddon?: SearchAddon;
  // Display mode: xterm or warp terminal view
  displayMode?: 'xterm' | 'warp';
}

export interface DockedFileBrowser {
  id: string;
  systemId: string;
  containerId?: string;
  runtime?: ContainerRuntime;
  systemName: string;
  containerName?: string;
  currentPath: string;
}

export type SlotContentType = 'terminal' | 'file-browser' | 'empty';

export interface TerminalSlot {
  contentType: SlotContentType;
  contentId: string | null;
}

@Injectable({ providedIn: 'root' })
export class TerminalState {
  private _dockedTerminals = signal<DockedTerminal[]>([]);
  private _layoutMode = signal<LayoutMode>('single');
  private _slots = signal<TerminalSlot[]>([{ contentType: 'empty', contentId: null }]);
  private _activeSlotIndex = signal<number>(0);
  private _isDockMinimized = signal<boolean>(false);
  private _isDockExpanded = signal<boolean>(true);
  private _isDockFullscreen = signal<boolean>(false);
  private _dockHeightPercent = signal<number>(50);
  private _dockedFileBrowsers = signal<DockedFileBrowser[]>([]);

  readonly dockedTerminals = this._dockedTerminals.asReadonly();
  readonly dockedFileBrowsers = this._dockedFileBrowsers.asReadonly();
  readonly layoutMode = this._layoutMode.asReadonly();
  readonly slots = this._slots.asReadonly();
  readonly activeSlotIndex = this._activeSlotIndex.asReadonly();
  readonly isDockMinimized = this._isDockMinimized.asReadonly();
  readonly isDockExpanded = this._isDockExpanded.asReadonly();
  readonly isDockFullscreen = this._isDockFullscreen.asReadonly();
  readonly dockHeightPercent = this._dockHeightPercent.asReadonly();

  readonly isDockVisible = signal(true);

  readonly hasDockedItems = computed(() =>
    this._dockedTerminals().length > 0 || this._dockedFileBrowsers().length > 0
  );

  readonly activeSlot = computed(() => {
    const slots = this._slots();
    const index = this._activeSlotIndex();
    return slots[index] ?? null;
  });

  readonly activeTerminal = computed(() => {
    const slot = this.activeSlot();
    if (!slot || slot.contentType !== 'terminal' || !slot.contentId) return null;
    return this._dockedTerminals().find(t => t.id === slot.contentId) ?? null;
  });

  readonly activeFileBrowser = computed(() => {
    const slot = this.activeSlot();
    if (!slot || slot.contentType !== 'file-browser' || !slot.contentId) return null;
    return this._dockedFileBrowsers().find(b => b.id === slot.contentId) ?? null;
  });

  readonly slotCount = computed(() => {
    const mode = this._layoutMode();
    switch (mode) {
      case 'single': return 1;
      case 'split-h':
      case 'split-v': return 2;
      case 'quad': return 4;
    }
  });

  constructor(private terminalService: TerminalService) {}

  addTerminal(terminal: DockedTerminal, targetSlot?: number): void {
    this._dockedTerminals.update(terminals => [...terminals, terminal]);

    if (targetSlot !== undefined) {
      this.assignTerminalToSlot(terminal.id, targetSlot);
      return;
    }

    // Assign to first empty slot or active slot
    const slots = this._slots();
    const emptySlotIndex = slots.findIndex(s => s.contentType === 'empty');

    if (emptySlotIndex !== -1) {
      this.assignTerminalToSlot(terminal.id, emptySlotIndex);
    } else {
      // Replace active slot terminal
      this.assignTerminalToSlot(terminal.id, this._activeSlotIndex());
    }
  }

  async removeTerminal(terminalId: string): Promise<void> {
    const terminal = this._dockedTerminals().find(t => t.id === terminalId);
    if (!terminal) return;

    // Close the session
    await this.terminalService.closeSession(terminal.session.id);

    // Dispose xterm instance if it exists
    terminal.terminal?.dispose();

    // Remove from slots
    this._slots.update(slots =>
      slots.map(s => s.contentType === 'terminal' && s.contentId === terminalId
        ? { contentType: 'empty' as SlotContentType, contentId: null }
        : s)
    );

    // Remove from docked terminals
    this._dockedTerminals.update(terminals =>
      terminals.filter(t => t.id !== terminalId)
    );
  }

  assignTerminalToSlot(terminalId: string, slotIndex: number): void {
    this._slots.update(slots =>
      slots.map((slot, i) => i === slotIndex
        ? { contentType: 'terminal' as SlotContentType, contentId: terminalId }
        : slot)
    );
  }

  assignFileBrowserToSlot(fileBrowserId: string, slotIndex: number): void {
    this._slots.update(slots =>
      slots.map((slot, i) => i === slotIndex
        ? { contentType: 'file-browser' as SlotContentType, contentId: fileBrowserId }
        : slot)
    );
  }

  setActiveSlot(index: number): void {
    if (index >= 0 && index < this._slots().length) {
      this._activeSlotIndex.set(index);
    }
  }

  setLayoutMode(mode: LayoutMode): void {
    const oldSlotCount = this.slotCount();
    this._layoutMode.set(mode);
    const newSlotCount = this.slotCount();

    // Adjust slots array
    if (newSlotCount > oldSlotCount) {
      // Add empty slots
      const newSlots = Array(newSlotCount - oldSlotCount)
        .fill(null)
        .map(() => ({ contentType: 'empty' as SlotContentType, contentId: null }));
      this._slots.update(slots => [...slots, ...newSlots]);
    } else if (newSlotCount < oldSlotCount) {
      // Remove extra slots (terminals stay docked, just not visible)
      this._slots.update(slots => slots.slice(0, newSlotCount));
      // Ensure active slot index is valid
      if (this._activeSlotIndex() >= newSlotCount) {
        this._activeSlotIndex.set(newSlotCount - 1);
      }
    }
  }

  toggleDockMinimized(): void {
    const goingMinimized = !this._isDockMinimized();
    this._isDockMinimized.set(goingMinimized);

    // Exit fullscreen when minimizing (fullscreen + minimized makes no sense)
    if (goingMinimized && this._isDockFullscreen()) {
      this._isDockFullscreen.set(false);
    }
  }

  toggleDockFullscreen(): void {
    const goingFullscreen = !this._isDockFullscreen();
    this._isDockFullscreen.set(goingFullscreen);

    // Auto-expand when going fullscreen (don't require two clicks)
    if (goingFullscreen && this._isDockMinimized()) {
      this._isDockMinimized.set(false);
    }
  }

  toggleDockExpanded(): void {
    this._isDockExpanded.update(v => !v);
  }

  setDockExpanded(expanded: boolean): void {
    this._isDockExpanded.set(expanded);
  }

  setDockMinimized(minimized: boolean): void {
    this._isDockMinimized.set(minimized);
  }

  setDockHeightPercent(percent: number): void {
    this._dockHeightPercent.set(Math.max(15, Math.min(85, percent)));
  }

  getTerminalById(id: string): DockedTerminal | undefined {
    return this._dockedTerminals().find(t => t.id === id);
  }

  getTerminalForSlot(slotIndex: number): DockedTerminal | null {
    const slot = this._slots()[slotIndex];
    if (!slot || slot.contentType !== 'terminal' || !slot.contentId) return null;
    return this._dockedTerminals().find(t => t.id === slot.contentId) ?? null;
  }

  getFileBrowserForSlot(slotIndex: number): DockedFileBrowser | null {
    const slot = this._slots()[slotIndex];
    if (!slot || slot.contentType !== 'file-browser' || !slot.contentId) return null;
    return this._dockedFileBrowsers().find(b => b.id === slot.contentId) ?? null;
  }

  isTerminalInSlot(terminalId: string): boolean {
    return this._slots().some(s => s.contentType === 'terminal' && s.contentId === terminalId);
  }

  isFileBrowserInSlot(id: string): boolean {
    return this._slots().some(s => s.contentType === 'file-browser' && s.contentId === id);
  }

  focusTerminal(terminalId: string): void {
    // If terminal is already in a slot, activate that slot
    const slotIndex = this._slots().findIndex(
      s => s.contentType === 'terminal' && s.contentId === terminalId
    );
    if (slotIndex !== -1) {
      this.setActiveSlot(slotIndex);
      return;
    }

    // Otherwise assign to active slot
    this.assignTerminalToSlot(terminalId, this._activeSlotIndex());
  }

  focusFileBrowser(id: string): void {
    // If file browser is already in a slot, activate that slot
    const slotIndex = this._slots().findIndex(
      s => s.contentType === 'file-browser' && s.contentId === id
    );
    if (slotIndex !== -1) {
      this.setActiveSlot(slotIndex);
      return;
    }

    // Otherwise assign to active slot
    this.assignFileBrowserToSlot(id, this._activeSlotIndex());
  }

  // Generate unique ID for new terminals
  generateTerminalId(): string {
    return `terminal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // Swap terminals between two slots
  swapSlots(slotA: number, slotB: number): void {
    this._slots.update(slots => {
      const newSlots = [...slots];
      const temp = newSlots[slotA];
      newSlots[slotA] = newSlots[slotB];
      newSlots[slotB] = temp;
      return newSlots;
    });
  }

  // Toggle terminal display mode between xterm and warp
  toggleTerminalDisplayMode(terminalId: string): void {
    this._dockedTerminals.update(terminals =>
      terminals.map(t =>
        t.id === terminalId
          ? { ...t, displayMode: t.displayMode === 'warp' ? 'xterm' : 'warp' }
          : t
      )
    );
  }

  // Clear all terminals (cleanup)
  async clearAll(): Promise<void> {
    const terminals = this._dockedTerminals();
    for (const terminal of terminals) {
      await this.terminalService.closeSession(terminal.session.id);
      terminal.terminal?.dispose();
    }
    this._dockedTerminals.set([]);
    this._dockedFileBrowsers.set([]);
    this._slots.set([{ contentType: 'empty', contentId: null }]);
    this._layoutMode.set('single');
    this._activeSlotIndex.set(0);
  }

  // --- File Browser Dock ---

  addFileBrowser(fb: DockedFileBrowser, targetSlot?: number): void {
    // Prevent duplicates for same system+container — update path instead
    const existing = this._dockedFileBrowsers().find(
      f => f.systemId === fb.systemId && f.containerId === fb.containerId
    );
    if (existing) {
      this._dockedFileBrowsers.update(browsers =>
        browsers.map(b => b.id === existing.id ? { ...b, currentPath: fb.currentPath } : b)
      );
      if (targetSlot !== undefined) {
        this.assignFileBrowserToSlot(existing.id, targetSlot);
      } else {
        this.focusFileBrowser(existing.id);
      }
      return;
    }
    this._dockedFileBrowsers.update(browsers => [...browsers, fb]);

    if (targetSlot !== undefined) {
      this.assignFileBrowserToSlot(fb.id, targetSlot);
      return;
    }

    // Assign to first empty slot or active slot
    const slots = this._slots();
    const emptySlotIndex = slots.findIndex(s => s.contentType === 'empty');
    if (emptySlotIndex !== -1) {
      this.assignFileBrowserToSlot(fb.id, emptySlotIndex);
    } else {
      this.assignFileBrowserToSlot(fb.id, this._activeSlotIndex());
    }
  }

  removeFileBrowser(id: string): void {
    // Clear from any slot
    this._slots.update(slots =>
      slots.map(s => s.contentType === 'file-browser' && s.contentId === id
        ? { contentType: 'empty' as SlotContentType, contentId: null }
        : s)
    );
    this._dockedFileBrowsers.update(browsers => browsers.filter(b => b.id !== id));
  }

  updateFileBrowserPath(id: string, path: string): void {
    const current = this._dockedFileBrowsers().find(b => b.id === id);
    if (current?.currentPath === path) return;
    this._dockedFileBrowsers.update(browsers =>
      browsers.map(b => b.id === id ? { ...b, currentPath: path } : b)
    );
  }

  generateFileBrowserId(): string {
    return `filebrowser-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  reorderTerminals(fromIndex: number, toIndex: number): void {
    this._dockedTerminals.update(terminals => {
      const arr = [...terminals];
      const [moved] = arr.splice(fromIndex, 1);
      arr.splice(toIndex, 0, moved);
      return arr;
    });
  }

  reorderFileBrowsers(fromIndex: number, toIndex: number): void {
    this._dockedFileBrowsers.update(browsers => {
      const arr = [...browsers];
      const [moved] = arr.splice(fromIndex, 1);
      arr.splice(toIndex, 0, moved);
      return arr;
    });
  }
}
