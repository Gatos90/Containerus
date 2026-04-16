import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MockTerminalBackend } from './mock-terminal-backend.service';
import { TerminalEventBus } from './warp-terminal.bus';

describe('MockTerminalBackend', () => {
  let backend: MockTerminalBackend;
  let eventBus: TerminalEventBus;
  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    eventBus = new TerminalEventBus();
    emitSpy = vi.spyOn(eventBus, 'emit');
    backend = new MockTerminalBackend(eventBus);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should create', () => {
    expect(backend).toBeTruthy();
  });

  it('should skip user commands (handled by AgentBackendService)', () => {
    emitSpy.mockClear();
    eventBus.emit({ type: 'UserSubmittedCommand', text: 'ls -la', source: 'user' });
    // Should not emit BlockCreated for user source
    const blockCreatedCalls = emitSpy.mock.calls.filter(
      (call) => call[0].type === 'BlockCreated'
    );
    expect(blockCreatedCalls).toHaveLength(0);
  });

  it('should skip aiExecuted commands', () => {
    emitSpy.mockClear();
    eventBus.emit({ type: 'UserSubmittedCommand', text: 'docker ps', source: 'aiExecuted' });
    const blockCreatedCalls = emitSpy.mock.calls.filter(
      (call) => call[0].type === 'BlockCreated'
    );
    expect(blockCreatedCalls).toHaveLength(0);
  });

  it('should skip aiSuggested commands', () => {
    emitSpy.mockClear();
    eventBus.emit({ type: 'UserSubmittedCommand', text: 'docker ps', source: 'aiSuggested' });
    const blockCreatedCalls = emitSpy.mock.calls.filter(
      (call) => call[0].type === 'BlockCreated'
    );
    expect(blockCreatedCalls).toHaveLength(0);
  });

  it('should process commands from unknown/automation source', () => {
    vi.useFakeTimers();
    emitSpy.mockClear();
    eventBus.emit({ type: 'UserSubmittedCommand', text: 'run-script', source: 'automation' as any });
    const blockCreatedCalls = emitSpy.mock.calls.filter(
      (call) => call[0].type === 'BlockCreated'
    );
    expect(blockCreatedCalls).toHaveLength(1);
    expect(blockCreatedCalls[0][0]).toMatchObject({
      type: 'BlockCreated',
      commandText: 'run-script',
    });
  });

  it('should emit BlockStarted after timeout for automation source', () => {
    vi.useFakeTimers();
    emitSpy.mockClear();
    eventBus.emit({ type: 'UserSubmittedCommand', text: 'run-script', source: 'automation' as any });

    vi.advanceTimersByTime(120);

    const blockStartedCalls = emitSpy.mock.calls.filter(
      (call) => call[0].type === 'BlockStarted'
    );
    expect(blockStartedCalls).toHaveLength(1);
  });

  it('should emit BlockOutputChunk during streaming for automation source', () => {
    vi.useFakeTimers();
    emitSpy.mockClear();
    eventBus.emit({ type: 'UserSubmittedCommand', text: 'run-script', source: 'automation' as any });

    // Start streaming
    vi.advanceTimersByTime(120);
    // Advance through several output chunks
    vi.advanceTimersByTime(140 * 5);

    const chunkCalls = emitSpy.mock.calls.filter(
      (call) => call[0].type === 'BlockOutputChunk'
    );
    expect(chunkCalls.length).toBeGreaterThan(0);
  });

  it('should eventually emit BlockEnded for automation source', () => {
    vi.useFakeTimers();
    emitSpy.mockClear();
    eventBus.emit({ type: 'UserSubmittedCommand', text: 'run-script', source: 'automation' as any });

    // Advance past all streaming + start delay
    vi.advanceTimersByTime(120 + 140 * 20);

    const blockEndedCalls = emitSpy.mock.calls.filter(
      (call) => call[0].type === 'BlockEnded'
    );
    expect(blockEndedCalls).toHaveLength(1);
  });

  it('should increment blockId for each new command', () => {
    vi.useFakeTimers();
    emitSpy.mockClear();
    eventBus.emit({ type: 'UserSubmittedCommand', text: 'cmd1', source: 'automation' as any });
    eventBus.emit({ type: 'UserSubmittedCommand', text: 'cmd2', source: 'automation' as any });

    const blockCreatedCalls = emitSpy.mock.calls.filter(
      (call) => call[0].type === 'BlockCreated'
    );
    expect(blockCreatedCalls).toHaveLength(2);
    expect(blockCreatedCalls[0][0].blockId).not.toBe(blockCreatedCalls[1][0].blockId);
  });

  it('should not respond to non-UserSubmittedCommand events', () => {
    emitSpy.mockClear();
    eventBus.emit({ type: 'BlockCreated', blockId: 1, commandText: 'test', source: 'user' });
    const blockCreatedCalls = emitSpy.mock.calls.filter(
      (call) => call[0].type === 'BlockCreated' && call[0].commandText === 'test'
    );
    // The already-emitted event is re-emitted by emit(), but no new BlockCreated should be created
    expect(blockCreatedCalls).toHaveLength(1); // Just the original one we emitted
  });

  it('should unsubscribe on ngOnDestroy', () => {
    const unsubscribeSpy = vi.spyOn((backend as any).subscriptions, 'unsubscribe');
    backend.ngOnDestroy();
    expect(unsubscribeSpy).toHaveBeenCalled();
  });
});
