import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WarpTerminalStore } from './warp-terminal-store.service';
import { TerminalEventBus } from './warp-terminal.bus';
import type { TerminalEvent } from '../models/terminal-events';

describe('WarpTerminalStore', () => {
  let store: WarpTerminalStore;
  let bus: TerminalEventBus;

  beforeEach(() => {
    // Mock requestAnimationFrame for the pipeline
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      setTimeout(cb, 0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    bus = new TerminalEventBus();
    store = new WarpTerminalStore(bus);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should start with empty state', () => {
    expect(store.blocks()).toEqual([]);
    expect(store.blockOrder()).toEqual([]);
    expect(store.selection()).toEqual({ kind: 'none' });
    expect(store.isFollowing()).toBe(true);
    expect(store.searchIsOpen()).toBe(false);
    expect(store.searchText()).toBe('');
    expect(store.isAiThinking()).toBe(false);
    expect(store.aiError()).toBeNull();
  });

  it('should create a block on BlockCreated event', () => {
    bus.emit({
      type: 'BlockCreated',
      blockId: 'b-1',
      commandText: 'ls -la',
      source: 'user',
    } as TerminalEvent);

    expect(store.blocks()).toHaveLength(1);
    expect(store.blocks()[0].id).toBe('b-1');
    expect(store.blocks()[0].commandText).toBe('ls -la');
    expect(store.blocks()[0].status.state).toBe('queued');
    expect(store.blockOrder()).toEqual(['b-1']);
  });

  it('should start a block on BlockStarted event', () => {
    bus.emit({
      type: 'BlockCreated',
      blockId: 'b-1',
      commandText: 'ls',
      source: 'user',
    } as TerminalEvent);
    bus.emit({
      type: 'BlockStarted',
      blockId: 'b-1',
      startedAt: 1000,
    } as TerminalEvent);

    expect(store.blocks()[0].status.state).toBe('running');
  });

  it('should complete a block on BlockEnded event', () => {
    bus.emit({
      type: 'BlockCreated',
      blockId: 'b-1',
      commandText: 'ls',
      source: 'user',
    } as TerminalEvent);
    bus.emit({
      type: 'BlockStarted',
      blockId: 'b-1',
      startedAt: 1000,
    } as TerminalEvent);
    bus.emit({
      type: 'BlockEnded',
      blockId: 'b-1',
      exitCode: 0,
      endedAt: 2000,
    } as TerminalEvent);

    const block = store.blocks()[0];
    expect(block.status.state).toBe('finished');
    expect((block.status as any).exitCode).toBe(0);
  });

  it('should cancel a block on BlockCancelled event', () => {
    bus.emit({
      type: 'BlockCreated',
      blockId: 'b-1',
      commandText: 'sleep 100',
      source: 'user',
    } as TerminalEvent);
    bus.emit({
      type: 'BlockCancelled',
      blockId: 'b-1',
      reason: 'user',
      endedAt: 1500,
    } as TerminalEvent);

    expect(store.blocks()[0].status.state).toBe('cancelled');
  });

  it('should toggle follow mode on UserScrolled', () => {
    bus.emit({ type: 'UserScrolled' } as TerminalEvent);
    expect(store.isFollowing()).toBe(false);
  });

  it('should handle UserToggledFollowMode', () => {
    bus.emit({ type: 'UserToggledFollowMode', on: false } as TerminalEvent);
    expect(store.isFollowing()).toBe(false);

    bus.emit({ type: 'UserToggledFollowMode', on: true } as TerminalEvent);
    expect(store.isFollowing()).toBe(true);
  });

  it('should handle UserSelectedBlock', () => {
    bus.emit({ type: 'UserSelectedBlock', blockId: 'b-1' } as TerminalEvent);
    expect(store.selection()).toEqual({ kind: 'block', blockId: 'b-1' });

    bus.emit({ type: 'UserSelectedBlock', blockId: null } as TerminalEvent);
    expect(store.selection()).toEqual({ kind: 'none' });
  });

  it('should handle UserToggledSearch', () => {
    bus.emit({ type: 'UserToggledSearch', open: true } as TerminalEvent);
    expect(store.searchIsOpen()).toBe(true);

    store.setSearchQuery('hello');
    expect(store.searchText()).toBe('hello');

    bus.emit({ type: 'UserToggledSearch', open: false } as TerminalEvent);
    expect(store.searchIsOpen()).toBe(false);
    expect(store.searchText()).toBe('');
  });

  it('should handle AI thinking events', () => {
    bus.emit({
      type: 'AiThinkingStarted',
      queryId: 'q-1',
    } as TerminalEvent);
    expect(store.isAiThinking()).toBe(true);

    bus.emit({ type: 'AiThinkingEnded' } as TerminalEvent);
    expect(store.isAiThinking()).toBe(false);
  });

  it('should handle AI error event', () => {
    bus.emit({
      type: 'AiErrorOccurred',
      message: 'API error',
      suggestion: 'Check your key',
    } as TerminalEvent);

    expect(store.isAiThinking()).toBe(false);
    expect(store.aiError()).toEqual({
      message: 'API error',
      suggestion: 'Check your key',
    });
  });

  it('should clear AI error', () => {
    bus.emit({
      type: 'AiErrorOccurred',
      message: 'fail',
    } as TerminalEvent);
    expect(store.aiError()).not.toBeNull();

    store.clearAiError();
    expect(store.aiError()).toBeNull();
  });

  it('should toggle block collapse', () => {
    bus.emit({
      type: 'BlockCreated',
      blockId: 'b-1',
      commandText: 'ls',
      source: 'user',
    } as TerminalEvent);

    expect(store.blocks()[0].isCollapsed).toBe(false);

    store.toggleCollapse('b-1');
    expect(store.blocks()[0].isCollapsed).toBe(true);

    store.toggleCollapse('b-1');
    expect(store.blocks()[0].isCollapsed).toBe(false);
  });

  it('should not crash on toggling nonexistent block', () => {
    store.toggleCollapse('nonexistent');
    expect(store.blocks()).toEqual([]);
  });

  it('should update CWD', () => {
    store.updateCwd('/home/user');
    expect(store.currentCwd()).toBe('/home/user');
  });

  it('should set selection', () => {
    store.setSelection({ kind: 'block', blockId: 'b-1' });
    expect(store.selection()).toEqual({ kind: 'block', blockId: 'b-1' });
  });

  it('should dispatch events to bus', () => {
    const callback = vi.fn();
    bus.subscribe(callback);

    const event = { type: 'UserScrolled' } as TerminalEvent;
    store.dispatch(event);

    expect(callback).toHaveBeenCalledWith(event);
  });

  it('should get next block ID and increment', () => {
    const id1 = store.getNextBlockId();
    const id2 = store.getNextBlockId();
    expect(id1).toBe(1);
    expect(id2).toBe(2);
  });

  it('should create and restore snapshots', () => {
    // Create some state
    bus.emit({
      type: 'BlockCreated',
      blockId: 'b-1',
      commandText: 'ls',
      source: 'user',
    } as TerminalEvent);
    store.updateCwd('/home');
    store.setSelection({ kind: 'block', blockId: 'b-1' });
    store.getNextBlockId(); // increment to 2

    // Create snapshot
    const snapshot = store.createSnapshot('sys-1');
    expect(snapshot.systemId).toBe('sys-1');
    expect(snapshot.blockOrder).toEqual(['b-1']);
    expect(snapshot.currentCwd).toBe('/home');

    // Clear state
    store.clearAllState();
    expect(store.blocks()).toEqual([]);

    // Restore
    store.restoreFromSnapshot(snapshot);
    expect(store.blocks()).toHaveLength(1);
    expect(store.currentCwd()).toBe('/home');
  });

  it('should clear all state', () => {
    bus.emit({
      type: 'BlockCreated',
      blockId: 'b-1',
      commandText: 'ls',
      source: 'user',
    } as TerminalEvent);
    store.setSearchQuery('test');
    bus.emit({
      type: 'AiThinkingStarted',
      queryId: 'q-1',
    } as TerminalEvent);

    store.clearAllState();

    expect(store.blocks()).toEqual([]);
    expect(store.blockOrder()).toEqual([]);
    expect(store.selection()).toEqual({ kind: 'none' });
    expect(store.isFollowing()).toBe(true);
    expect(store.searchIsOpen()).toBe(false);
    expect(store.searchText()).toBe('');
    expect(store.isAiThinking()).toBe(false);
  });

  it('should clear terminal only', () => {
    bus.emit({
      type: 'BlockCreated',
      blockId: 'b-1',
      commandText: 'ls',
      source: 'user',
    } as TerminalEvent);
    store.updateCwd('/custom');
    const idBefore = store.getNextBlockId();

    store.clearTerminal();

    expect(store.blocks()).toEqual([]);
    expect(store.blockOrder()).toEqual([]);
    expect(store.currentCwd()).toBe('/custom'); // CWD preserved
    // Block ID counter preserved (should still increment)
    const idAfter = store.getNextBlockId();
    expect(idAfter).toBe(idBefore + 1);
  });

  it('should set search query', () => {
    store.setSearchQuery('hello');
    expect(store.searchText()).toBe('hello');
  });

  it('should use CWD label when creating blocks', () => {
    store.updateCwd('/var/log');
    bus.emit({
      type: 'BlockCreated',
      blockId: 'b-1',
      commandText: 'tail -f syslog',
      source: 'user',
    } as TerminalEvent);

    expect(store.blocks()[0].cwdLabel).toBe('/var/log');
  });
});
