import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { WarpTerminalStateManager } from './warp-terminal-state-manager.service';
import { WarpTerminalStore, type TerminalStateSnapshot } from './warp-terminal-store.service';

describe('WarpTerminalStateManager', () => {
  let manager: WarpTerminalStateManager;
  let mockStore: any;

  const makeSnapshot = (systemId: string): TerminalStateSnapshot => ({
    systemId,
    blocks: new Map(),
    blockOrder: ['b-1'],
    selection: { kind: 'none' },
    followMode: true,
    searchOpen: false,
    searchQuery: '',
    currentCwd: '~',
    nextBlockId: 2,
    createdAt: Date.now(),
  });

  beforeEach(() => {
    mockStore = {
      createSnapshot: vi.fn((systemId: string) => makeSnapshot(systemId)),
      restoreFromSnapshot: vi.fn(),
      clearAllState: vi.fn(),
    };

    const injector = Injector.create({
      providers: [
        { provide: WarpTerminalStore, useValue: mockStore },
      ],
    });

    manager = runInInjectionContext(injector, () => new WarpTerminalStateManager());
  });

  it('should start with no active system', () => {
    expect(manager.activeSystemId()).toBeNull();
  });

  it('should switch to a new system', () => {
    manager.switchToSystem('sys-1');

    expect(manager.activeSystemId()).toBe('sys-1');
    expect(mockStore.clearAllState).toHaveBeenCalled();
  });

  it('should no-op when switching to same system', () => {
    manager.switchToSystem('sys-1');
    mockStore.clearAllState.mockClear();

    manager.switchToSystem('sys-1');

    expect(mockStore.clearAllState).not.toHaveBeenCalled();
  });

  it('should save snapshot when switching away from a system', () => {
    manager.switchToSystem('sys-1');
    manager.switchToSystem('sys-2');

    expect(mockStore.createSnapshot).toHaveBeenCalledWith('sys-1');
    expect(manager.hasSnapshot('sys-1')).toBe(true);
  });

  it('should restore snapshot when switching back to a system', () => {
    manager.switchToSystem('sys-1');
    manager.switchToSystem('sys-2');
    manager.switchToSystem('sys-1');

    expect(mockStore.restoreFromSnapshot).toHaveBeenCalled();
    const restoredSnapshot = mockStore.restoreFromSnapshot.mock.calls[0][0];
    expect(restoredSnapshot.systemId).toBe('sys-1');
  });

  it('should not restore when switching to a system with no snapshot', () => {
    manager.switchToSystem('sys-1');

    // First switch to sys-1 has no existing snapshot
    expect(mockStore.restoreFromSnapshot).not.toHaveBeenCalled();
  });

  it('should clear all state when switching to null', () => {
    manager.switchToSystem('sys-1');
    manager.switchToSystem(null);

    expect(manager.activeSystemId()).toBeNull();
    expect(mockStore.createSnapshot).toHaveBeenCalledWith('sys-1');
    expect(mockStore.clearAllState).toHaveBeenCalled();
  });

  it('should check hasSnapshot', () => {
    expect(manager.hasSnapshot('sys-1')).toBe(false);

    manager.switchToSystem('sys-1');
    manager.switchToSystem('sys-2');

    expect(manager.hasSnapshot('sys-1')).toBe(true);
    expect(manager.hasSnapshot('sys-3')).toBe(false);
  });

  it('should clear snapshot for a system', () => {
    manager.switchToSystem('sys-1');
    manager.switchToSystem('sys-2');
    expect(manager.hasSnapshot('sys-1')).toBe(true);

    manager.clearSnapshot('sys-1');
    expect(manager.hasSnapshot('sys-1')).toBe(false);
  });

  it('should clear all snapshots', () => {
    manager.switchToSystem('sys-1');
    manager.switchToSystem('sys-2');
    manager.switchToSystem('sys-3');

    expect(manager.hasSnapshot('sys-1')).toBe(true);
    expect(manager.hasSnapshot('sys-2')).toBe(true);

    manager.clearAllSnapshots();

    expect(manager.hasSnapshot('sys-1')).toBe(false);
    expect(manager.hasSnapshot('sys-2')).toBe(false);
  });
});
