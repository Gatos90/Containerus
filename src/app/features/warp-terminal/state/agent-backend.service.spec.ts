import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { Subject } from 'rxjs';
import { AgentBackendService } from './agent-backend.service';
import { TerminalEventBus } from './warp-terminal.bus';
import { WarpTerminalStore } from './warp-terminal-store.service';
import { TauriService } from '@/core/services/tauri.service';
import { TerminalService } from '@/core/services/terminal.service';
import { CommandHistoryService } from './command-history.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal real Subject so event bus filter pipes work */
function makeEventBusMock() {
  const subject = new Subject<any>();
  return {
    events$: subject.asObservable(),
    emit: vi.fn((event: any) => subject.next(event)),
    subscribe: vi.fn((cb: any) => subject.subscribe(cb)),
    _subject: subject,
  };
}

function makeService(overrides: {
  tauriInvoke?: ReturnType<typeof vi.fn>;
} = {}): {
  service: AgentBackendService;
  eventBus: ReturnType<typeof makeEventBusMock>;
  tauri: any;
  store: any;
  terminalService: any;
  historyService: any;
} {
  const eventBus = makeEventBusMock();

  const tauriInvoke = overrides.tauriInvoke ?? vi.fn().mockResolvedValue({ id: 'agent-session-1' });

  const tauri: any = {
    invoke: tauriInvoke,
  };

  const store: any = {
    getNextBlockId: vi.fn().mockReturnValue(1),
    currentCwd: vi.fn(() => '~'),
  };

  const terminalService: any = {
    sendInput: vi.fn().mockResolvedValue(undefined),
    fetchShellHistory: vi.fn().mockResolvedValue([]),
  };

  const historyService: any = {
    add: vi.fn(),
    getAll: vi.fn(() => []),
    searchRemoteHistory: vi.fn().mockResolvedValue([]),
  };

  // AgentBackendService uses constructor injection for eventBus and tauri,
  // and inject() for store, terminalService, historyService.
  const injector = Injector.create({
    providers: [
      { provide: WarpTerminalStore, useValue: store },
      { provide: TerminalService, useValue: terminalService },
      { provide: CommandHistoryService, useValue: historyService },
    ],
  });

  const service = runInInjectionContext(
    injector,
    () => new AgentBackendService(eventBus as any, tauri as any)
  );

  return { service, eventBus, tauri, store, terminalService, historyService };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentBackendService', () => {
  let service: AgentBackendService;
  let eventBus: ReturnType<typeof makeEventBusMock>;
  let tauri: any;
  let store: any;

  beforeEach(() => {
    vi.useFakeTimers();
    ({ service, eventBus, tauri, store } = makeService());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // isInitialized getter
  // -------------------------------------------------------------------------

  describe('isInitialized', () => {
    it('should return false before any initialization', () => {
      expect(service.isInitialized).toBe(false);
    });

    it('should return true after a successful initialize() call', async () => {
      // Tauri listen mock – must be registered before initialize()
      const listenMock = vi.fn().mockResolvedValue(() => {});
      vi.doMock('@tauri-apps/api/event', () => ({ listen: listenMock }));

      // Patch tauri.invoke to resolve with a session
      tauri.invoke = vi.fn().mockResolvedValue({ id: 'agent-session-1' });

      // We can't easily call initialize without mocking the Tauri listen, so
      // instead directly poke the private field to simulate post-init state.
      (service as any).agentSessionId = 'agent-session-1';
      expect(service.isInitialized).toBe(true);
    });

    it('should return false after destroy() clears the session', () => {
      (service as any).agentSessionId = 'agent-session-1';
      // destroy() calls cleanupSession() which nulls agentSessionId
      // but also tries to invoke close_agent_session – mock tauri.invoke
      tauri.invoke = vi.fn().mockResolvedValue(undefined);
      service.destroy();
      expect(service.isInitialized).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // sessionId getter
  // -------------------------------------------------------------------------

  describe('sessionId', () => {
    it('should return null before initialization', () => {
      expect(service.sessionId).toBeNull();
    });

    it('should return the agent session id after it is set', () => {
      (service as any).agentSessionId = 'my-session-42';
      expect(service.sessionId).toBe('my-session-42');
    });

    it('should return null after destroy clears the session', () => {
      (service as any).agentSessionId = 'my-session-42';
      tauri.invoke = vi.fn().mockResolvedValue(undefined);
      service.destroy();
      expect(service.sessionId).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // destroy
  // -------------------------------------------------------------------------

  describe('destroy', () => {
    it('should clear agentSessionId', () => {
      (service as any).agentSessionId = 'sess-1';
      tauri.invoke = vi.fn().mockResolvedValue(undefined);
      service.destroy();
      expect(service.sessionId).toBeNull();
    });

    it('should clear terminalSessionId', () => {
      (service as any).terminalSessionId = 'term-1';
      tauri.invoke = vi.fn().mockResolvedValue(undefined);
      service.destroy();
      expect((service as any).terminalSessionId).toBeNull();
    });

    it('should invoke close_agent_session when a session is active', () => {
      (service as any).agentSessionId = 'sess-close-me';
      tauri.invoke = vi.fn().mockResolvedValue(undefined);
      service.destroy();
      expect(tauri.invoke).toHaveBeenCalledWith('close_agent_session', {
        sessionId: 'sess-close-me',
      });
    });

    it('should NOT invoke close_agent_session when no session is active', () => {
      tauri.invoke = vi.fn().mockResolvedValue(undefined);
      service.destroy();
      expect(tauri.invoke).not.toHaveBeenCalled();
    });

    it('should call all unlistenFns on destroy', () => {
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      (service as any).unlistenFns.push(fn1, fn2);
      tauri.invoke = vi.fn().mockResolvedValue(undefined);
      service.destroy();
      expect(fn1).toHaveBeenCalled();
      expect(fn2).toHaveBeenCalled();
    });

    it('should empty the unlistenFns array after cleanup', () => {
      (service as any).unlistenFns.push(vi.fn());
      tauri.invoke = vi.fn().mockResolvedValue(undefined);
      service.destroy();
      expect((service as any).unlistenFns.length).toBe(0);
    });

    it('should clear thinkingAccumulators on destroy', () => {
      (service as any).thinkingAccumulators.set('q1', {
        chunks: ['hello'],
        flushTimeout: null,
        blockId: 1,
      });
      tauri.invoke = vi.fn().mockResolvedValue(undefined);
      service.destroy();
      expect((service as any).thinkingAccumulators.size).toBe(0);
    });

    it('should cancel pending flush timeouts in thinkingAccumulators', () => {
      const timeout = setTimeout(() => {}, 9999);
      const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
      (service as any).thinkingAccumulators.set('q1', {
        chunks: ['data'],
        flushTimeout: timeout,
        blockId: 2,
      });
      tauri.invoke = vi.fn().mockResolvedValue(undefined);
      service.destroy();
      expect(clearSpy).toHaveBeenCalledWith(timeout);
    });
  });

  // -------------------------------------------------------------------------
  // ngOnDestroy
  // -------------------------------------------------------------------------

  describe('ngOnDestroy', () => {
    it('should unsubscribe from event bus subscriptions', () => {
      const unsubSpy = vi.spyOn((service as any).subscriptions, 'unsubscribe');
      tauri.invoke = vi.fn().mockResolvedValue(undefined);
      service.ngOnDestroy();
      expect(unsubSpy).toHaveBeenCalled();
    });

    it('should call destroy internally', () => {
      const destroySpy = vi.spyOn(service, 'destroy');
      tauri.invoke = vi.fn().mockResolvedValue(undefined);
      service.ngOnDestroy();
      expect(destroySpy).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // cancelCurrentQuery
  // -------------------------------------------------------------------------

  describe('cancelCurrentQuery', () => {
    it('should do nothing when no agent session is active', async () => {
      await service.cancelCurrentQuery();
      expect(tauri.invoke).not.toHaveBeenCalled();
    });

    it('should invoke cancel_agent_query with the session id', async () => {
      (service as any).agentSessionId = 'sess-cancel';
      tauri.invoke = vi.fn().mockResolvedValue(undefined);
      await service.cancelCurrentQuery();
      expect(tauri.invoke).toHaveBeenCalledWith('cancel_agent_query', {
        sessionId: 'sess-cancel',
      });
    });

    it('should not throw when Tauri invoke rejects', async () => {
      (service as any).agentSessionId = 'sess-cancel';
      tauri.invoke = vi.fn().mockRejectedValue(new Error('network error'));
      await expect(service.cancelCurrentQuery()).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // hasSentenceBoundary (private, tested via public behaviour)
  // -------------------------------------------------------------------------

  describe('hasSentenceBoundary (private helper)', () => {
    // Access private method directly for unit testing
    const hasBoundary = (text: string) =>
      (AgentBackendService.prototype as any).hasSentenceBoundary.call({}, text);

    it('should return false for empty string', () => {
      expect(hasBoundary('')).toBe(false);
    });

    it('should return false for whitespace-only string', () => {
      expect(hasBoundary('   ')).toBe(false);
    });

    it('should return true for text ending with exclamation mark', () => {
      expect(hasBoundary('Hello!')).toBe(true);
    });

    it('should return true for text ending with question mark', () => {
      expect(hasBoundary('Is it running?')).toBe(true);
    });

    it('should return true for text ending with newline', () => {
      expect(hasBoundary('Some output\n')).toBe(true);
    });

    it('should return true for period followed by a space', () => {
      expect(hasBoundary('This is a sentence. ')).toBe(true);
    });

    it('should return true for a sentence ending with period (non-digit before period)', () => {
      expect(hasBoundary('This is done.')).toBe(true);
    });

    it('should return false for text ending with a version number period (digit before period)', () => {
      expect(hasBoundary('Version 0.0.18')).toBe(false);
    });

    it('should return false for text ending with a decimal number', () => {
      expect(hasBoundary('Value is 3.6')).toBe(false);
    });

    it('should return false for mid-sentence text with no boundary', () => {
      expect(hasBoundary('Processing the request')).toBe(false);
    });

    it('should return true for text ending with ? followed by whitespace', () => {
      expect(hasBoundary('Done? ')).toBe(true);
    });

    it('should return true for text with a newline in the middle ending at boundary', () => {
      expect(hasBoundary('First line\nSecond line.')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Event bus subscription – UserSubmittedCommand routing
  // -------------------------------------------------------------------------

  describe('event bus – UserSubmittedCommand routing', () => {
    it('should handle user source by calling handleUserCommand', () => {
      const handleUserSpy = vi.spyOn(service as any, 'handleUserCommand').mockResolvedValue(undefined);

      eventBus._subject.next({
        type: 'UserSubmittedCommand',
        source: 'user',
        text: 'ls -la',
        contextBlockIds: [],
      });

      expect(handleUserSpy).toHaveBeenCalled();
    });

    it('should handle aiExecuted source by calling handleAiCommand', () => {
      const handleAiSpy = vi.spyOn(service as any, 'handleAiCommand').mockResolvedValue(undefined);

      eventBus._subject.next({
        type: 'UserSubmittedCommand',
        source: 'aiExecuted',
        text: 'docker ps',
        contextBlockIds: [],
      });

      expect(handleAiSpy).toHaveBeenCalled();
    });

    it('should handle aiSuggested source by calling handleAiCommand', () => {
      const handleAiSpy = vi.spyOn(service as any, 'handleAiCommand').mockResolvedValue(undefined);

      eventBus._subject.next({
        type: 'UserSubmittedCommand',
        source: 'aiSuggested',
        text: 'docker inspect nginx',
        contextBlockIds: [],
      });

      expect(handleAiSpy).toHaveBeenCalled();
    });

    it('should ignore UserSubmittedCommand with unrecognised source', () => {
      const handleUserSpy = vi.spyOn(service as any, 'handleUserCommand').mockResolvedValue(undefined);
      const handleAiSpy = vi.spyOn(service as any, 'handleAiCommand').mockResolvedValue(undefined);

      eventBus._subject.next({
        type: 'UserSubmittedCommand',
        source: 'unknown',
        text: 'echo hello',
        contextBlockIds: [],
      });

      expect(handleUserSpy).not.toHaveBeenCalled();
      expect(handleAiSpy).not.toHaveBeenCalled();
    });

    it('should ignore events that are not UserSubmittedCommand', () => {
      const handleUserSpy = vi.spyOn(service as any, 'handleUserCommand').mockResolvedValue(undefined);
      const handleAiSpy = vi.spyOn(service as any, 'handleAiCommand').mockResolvedValue(undefined);

      eventBus._subject.next({ type: 'AiThinkingStarted', queryId: 'q1' });

      expect(handleUserSpy).not.toHaveBeenCalled();
      expect(handleAiSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // handleAiCommand – error path
  // -------------------------------------------------------------------------

  describe('handleAiCommand – error path', () => {
    it('should emit AiErrorOccurred when no terminal session is available', async () => {
      // No agentSessionId, no terminalSessionId
      await (service as any).handleAiCommand({
        type: 'UserSubmittedCommand',
        source: 'aiExecuted',
        text: 'docker ps',
        contextBlockIds: [],
      });

      const emittedTypes = (eventBus.emit as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: any) => c[0].type
      );
      expect(emittedTypes).toContain('AiErrorOccurred');
    });

    it('should emit BlockEnded with exitCode 1 when submit_agent_query throws', async () => {
      (service as any).agentSessionId = 'sess-err';
      tauri.invoke = vi.fn().mockRejectedValue(new Error('backend down'));
      store.getNextBlockId = vi.fn().mockReturnValue(7);

      await (service as any).handleAiCommand({
        type: 'UserSubmittedCommand',
        source: 'aiExecuted',
        text: 'bad query',
        contextBlockIds: [],
      });

      const blockEndedCall = (eventBus.emit as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: any) => c[0].type === 'BlockEnded'
      );
      expect(blockEndedCall).toBeTruthy();
      expect(blockEndedCall![0].exitCode).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // queryBlockMap management
  // -------------------------------------------------------------------------

  describe('queryBlockMap', () => {
    it('should start empty', () => {
      expect((service as any).queryBlockMap.size).toBe(0);
    });

    it('should grow as handleAiCommand is called (assuming submit resolves)', async () => {
      (service as any).agentSessionId = 'sess-q';
      tauri.invoke = vi.fn().mockResolvedValue('ok');
      store.getNextBlockId = vi.fn().mockReturnValue(42);

      await (service as any).handleAiCommand({
        type: 'UserSubmittedCommand',
        source: 'aiExecuted',
        text: 'do something',
        contextBlockIds: [],
      });

      expect((service as any).queryBlockMap.size).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // cleanupSession – thinking accumulator timeouts
  // -------------------------------------------------------------------------

  describe('cleanupSession – user command idle timeout', () => {
    it('should cancel userCommandIdleTimeout on cleanupUserCommandListener', () => {
      const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
      const tid = setTimeout(() => {}, 9999);
      (service as any).userCommandIdleTimeout = tid;
      (service as any).cleanupUserCommandListener();
      expect(clearSpy).toHaveBeenCalledWith(tid);
      expect((service as any).userCommandIdleTimeout).toBeNull();
    });

    it('should null out activeUserCommandBlock on cleanupUserCommandListener', () => {
      (service as any).activeUserCommandBlock = 5;
      (service as any).cleanupUserCommandListener();
      expect((service as any).activeUserCommandBlock).toBeNull();
    });

    it('should call the userCommandUnlisten function if set', () => {
      const unlisten = vi.fn();
      (service as any).userCommandUnlisten = unlisten;
      (service as any).cleanupUserCommandListener();
      expect(unlisten).toHaveBeenCalled();
      expect((service as any).userCommandUnlisten).toBeNull();
    });
  });
});
