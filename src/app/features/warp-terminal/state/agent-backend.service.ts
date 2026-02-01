import { Injectable, OnDestroy, inject } from '@angular/core';
import { Subscription, filter } from 'rxjs';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { TauriService } from '@/core/services/tauri.service';
import { TerminalService } from '@/core/services/terminal.service';
import { TerminalEventBus } from './warp-terminal.bus';
import { WarpTerminalStore } from './warp-terminal-store.service';
import { CommandHistoryService } from './command-history.service';
import type { UserSubmittedCommand } from '../models/terminal-events';
import type {
  AgentSessionInfo,
  AgentQueryRequest,
  AgentThinkingEvent,
  AgentResponseChunkEvent,
  AgentQueryCompletedEvent,
  AgentErrorEvent,
  AgentCommandStartedEvent,
  AgentCommandOutputEvent,
  AgentCommandCompletedEvent,
} from '../models/agent-events';

/**
 * AgentBackendService
 *
 * Connects the warp-terminal frontend to the Tauri agent backend.
 * Replaces MockTerminalBackend for AI interactions.
 */
@Injectable({ providedIn: 'root' })
export class AgentBackendService implements OnDestroy {
  private agentSessionId: string | null = null;
  private terminalSessionId: string | null = null;
  private readonly subscriptions = new Subscription();
  private readonly unlistenFns: UnlistenFn[] = [];
  private readonly store = inject(WarpTerminalStore);
  private queryBlockMap = new Map<string, number>();

  // Accumulator for thinking chunks per query - buffers tokens before display
  private thinkingAccumulators = new Map<
    string,
    {
      chunks: string[];
      flushTimeout: ReturnType<typeof setTimeout> | null;
      blockId: number;
    }
  >();
  private readonly THINKING_FLUSH_DELAY = 300; // ms

  // User command tracking - maps blockId to state
  private activeUserCommandBlock: number | null = null;
  private userCommandUnlisten: UnlistenFn | null = null;
  private userCommandIdleTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly USER_COMMAND_IDLE_MS = 2000; // Consider command done after 2s of no output

  private readonly historyService = inject(CommandHistoryService);
  private readonly terminalService = inject(TerminalService);

  constructor(
    private readonly eventBus: TerminalEventBus,
    private readonly tauri: TauriService
  ) {
    console.log('[AgentBackend] Constructor called, subscribing to event bus...');
    // Subscribe to user commands - both AI and direct user commands
    this.subscriptions.add(
      this.eventBus.events$
        .pipe(
          filter((e): e is UserSubmittedCommand => {
            const isMatch =
              e.type === 'UserSubmittedCommand' &&
              (e.source === 'aiExecuted' || e.source === 'aiSuggested' || e.source === 'user');
            if (e.type === 'UserSubmittedCommand') {
              console.log('[AgentBackend] Received UserSubmittedCommand, source:', (e as UserSubmittedCommand).source, 'isMatch:', isMatch);
            }
            return isMatch;
          })
        )
        .subscribe((event) => {
          if (event.source === 'user') {
            console.log('[AgentBackend] Handling user command via PTY:', event);
            this.handleUserCommand(event);
          } else {
            console.log('[AgentBackend] Handling AI command:', event);
            this.handleAiCommand(event);
          }
        })
    );
  }

  ngOnDestroy(): void {
    // Only unsubscribe from event bus when the service is actually being destroyed
    // (app shutdown), not when components call destroy()
    this.subscriptions.unsubscribe();
    this.destroy();
  }

  /**
   * Initialize the agent backend for a terminal session.
   * Should be called when the warp-terminal view is initialized.
   * Idempotent - safe to call multiple times with the same session ID.
   *
   * @param terminalSessionId - The PTY terminal session ID
   * @param containerId - Optional container ID if the terminal is inside a container
   */
  async initialize(terminalSessionId: string, containerId?: string | null): Promise<void> {
    // Skip if already initialized with this session
    if (this.terminalSessionId === terminalSessionId && this.agentSessionId) {
      console.log('[AgentBackend] Already initialized for this session, skipping');
      return;
    }

    // Clean up previous session if switching to a different one
    if (this.terminalSessionId && this.terminalSessionId !== terminalSessionId) {
      console.log('[AgentBackend] Switching sessions, cleaning up previous');
      this.cleanupSession();
    }

    this.terminalSessionId = terminalSessionId;

    try {
      // Start agent session linked to the terminal
      // Pass containerId to set up container context if inside a container
      const session = await this.tauri.invoke<AgentSessionInfo>(
        'start_agent_session',
        {
          terminalSessionId,
          containerId: containerId ?? undefined,
        }
      );
      this.agentSessionId = session.id;

      // Set up backend event listeners
      await this.setupBackendListeners();

      console.log(
        `[AgentBackend] Initialized session ${this.agentSessionId} for terminal ${terminalSessionId}`
      );
    } catch (error) {
      console.error('[AgentBackend] Failed to initialize:', error);
      this.eventBus.emit({
        type: 'AiErrorOccurred',
        message: `Failed to initialize AI agent: ${error}`,
        recoverable: true,
        suggestion: 'Check your AI provider settings',
      });
    }
  }

  /**
   * Clean up session-specific resources (Tauri listeners, agent session).
   * Does NOT unsubscribe from event bus - that's only done in ngOnDestroy.
   */
  private cleanupSession(): void {
    // Clean up Tauri event listeners
    this.unlistenFns.forEach((fn) => fn());
    this.unlistenFns.length = 0;

    // Clear user command listener if active
    this.cleanupUserCommandListener();

    // Clear all thinking accumulators and their timeouts
    for (const [, acc] of this.thinkingAccumulators) {
      if (acc.flushTimeout) {
        clearTimeout(acc.flushTimeout);
      }
    }
    this.thinkingAccumulators.clear();

    // Close agent session if active
    if (this.agentSessionId) {
      this.tauri
        .invoke('close_agent_session', { sessionId: this.agentSessionId })
        .catch((error) => console.error('[AgentBackend] Error closing session:', error));
      this.agentSessionId = null;
    }

    this.terminalSessionId = null;
  }

  /**
   * Clean up resources. Called by components when unmounting.
   * Does NOT kill the event bus subscription - service may be reused.
   */
  destroy(): void {
    this.cleanupSession();
  }

  /**
   * Handle a direct user command submission (not AI).
   * Sends the command to the PTY and captures output for warp blocks.
   */
  private async handleUserCommand(event: UserSubmittedCommand): Promise<void> {
    if (!this.terminalSessionId) {
      console.warn('[AgentBackend] No terminal session for user command');
      return;
    }

    // Clean up any previous user command listener
    this.cleanupUserCommandListener();

    const blockId = this.store.getNextBlockId();

    // Create block for the user command
    this.eventBus.emit({
      type: 'BlockCreated',
      blockId,
      commandText: event.text,
      source: 'user',
    });

    // Mark block as started
    this.eventBus.emit({
      type: 'BlockStarted',
      blockId,
      startedAt: Date.now(),
    });

    // Track this as the active user command block
    this.activeUserCommandBlock = blockId;

    // Listen for PTY output and route to warp block
    this.userCommandUnlisten = await listen<{ sessionId: string; data: string }>(
      'terminal:output',
      (outputEvent) => {
        if (outputEvent.payload.sessionId === this.terminalSessionId && this.activeUserCommandBlock === blockId) {
          // Route PTY output to warp block
          this.eventBus.emit({
            type: 'BlockOutputChunk',
            blockId,
            payload: outputEvent.payload.data,
            sectionType: 'output',
          });

          // Reset idle timeout - more output means command is still running
          this.resetUserCommandIdleTimeout(blockId);
        }
      }
    );

    // Send command to PTY (this will also show in xterm via the same terminal:output event)
    try {
      await this.terminalService.sendInput(this.terminalSessionId, event.text + '\n');
      console.log(`[AgentBackend] Sent user command to PTY: ${event.text}`);

      // Start idle timeout to auto-complete the block
      this.resetUserCommandIdleTimeout(blockId);
    } catch (error) {
      console.error('[AgentBackend] Error sending user command to PTY:', error);
      this.cleanupUserCommandListener();
      this.eventBus.emit({
        type: 'BlockEnded',
        blockId,
        exitCode: 1,
        endedAt: Date.now(),
      });
    }
  }

  /**
   * Reset the idle timeout for user commands.
   * After USER_COMMAND_IDLE_MS of no output, consider the command done.
   */
  private resetUserCommandIdleTimeout(blockId: number): void {
    if (this.userCommandIdleTimeout) {
      clearTimeout(this.userCommandIdleTimeout);
    }

    this.userCommandIdleTimeout = setTimeout(() => {
      if (this.activeUserCommandBlock === blockId) {
        console.log(`[AgentBackend] User command idle timeout - completing block ${blockId}`);
        this.cleanupUserCommandListener();
        this.eventBus.emit({
          type: 'BlockEnded',
          blockId,
          exitCode: 0, // Assume success since we can't detect exit code from PTY stream
          endedAt: Date.now(),
        });
      }
    }, this.USER_COMMAND_IDLE_MS);
  }

  /**
   * Clean up user command listener and state.
   */
  private cleanupUserCommandListener(): void {
    if (this.userCommandUnlisten) {
      this.userCommandUnlisten();
      this.userCommandUnlisten = null;
    }
    if (this.userCommandIdleTimeout) {
      clearTimeout(this.userCommandIdleTimeout);
      this.userCommandIdleTimeout = null;
    }
    this.activeUserCommandBlock = null;
  }

  /**
   * Handle an AI command submission from the frontend
   */
  private async handleAiCommand(event: UserSubmittedCommand): Promise<void> {
    if (!this.agentSessionId) {
      console.warn('[AgentBackend] No agent session, initializing...');
      if (this.terminalSessionId) {
        await this.initialize(this.terminalSessionId);
      } else {
        this.eventBus.emit({
          type: 'AiErrorOccurred',
          message: 'No terminal session available',
          recoverable: false,
        });
        return;
      }
    }

    const blockId = this.store.getNextBlockId();
    // Generate queryId on frontend to avoid race condition with events
    const queryId = crypto.randomUUID();

    // Set up mapping BEFORE making the call, so event listeners can find the blockId
    this.queryBlockMap.set(queryId, blockId);
    console.log(`[AgentBackend] Preparing query: queryId=${queryId}, blockId=${blockId}`);

    // Create block for the AI query/response
    this.eventBus.emit({
      type: 'BlockCreated',
      blockId,
      commandText: event.text,
      source: event.source,
    });

    // Mark block as started immediately
    this.eventBus.emit({
      type: 'BlockStarted',
      blockId,
      startedAt: Date.now(),
    });

    try {
      const request: AgentQueryRequest = {
        sessionId: this.agentSessionId!,
        query: event.text,
        contextBlockIds: event.contextBlockIds,
        autoExecute: true,
        streaming: true,
        queryId, // Send our queryId to backend
      };

      // Submit query - backend will use our queryId
      await this.tauri.invoke<string>('submit_agent_query', { request });
      console.log(`[AgentBackend] Query submitted successfully: queryId=${queryId}`);
    } catch (error) {
      console.error('[AgentBackend] Error submitting query:', error);
      this.eventBus.emit({
        type: 'BlockEnded',
        blockId,
        exitCode: 1,
        endedAt: Date.now(),
      });
      this.eventBus.emit({
        type: 'AiErrorOccurred',
        message: `Failed to submit query: ${error}`,
        recoverable: true,
        suggestion: 'Try again or check your AI provider settings',
      });
    }
  }

  /**
   * Set up listeners for backend agent events
   */
  private async setupBackendListeners(): Promise<void> {
    console.log('[AgentBackend] Setting up backend event listeners...');

    // Agent thinking event
    // Note: Rust sends snake_case field names (query_id, session_id)
    this.unlistenFns.push(
      await listen<Record<string, unknown>>('agent:thinking', (event) => {
        console.log('[AgentBackend] Received agent:thinking event:', event.payload);
        const payload = event.payload as { query_id: string; session_id: string };

        // Just emit the AiThinkingStarted event, no visual indicator
        // (AI text will be shown via streaming response chunks)
        this.eventBus.emit({
          type: 'AiThinkingStarted',
          queryId: payload.query_id,
        });
      })
    );
    console.log('[AgentBackend] Listening for agent:thinking');

    // Response chunk event
    this.unlistenFns.push(
      await listen<Record<string, unknown>>('agent:response-chunk', (event) => {
        console.log('[AgentBackend] Received agent:response-chunk event:', event.payload);
        const payload = event.payload as {
          query_id: string;
          session_id: string;
          chunk_type: string;
          content: string;
          is_final: boolean;
        };
        const blockId = this.queryBlockMap.get(payload.query_id);
        console.log(`[AgentBackend] Mapped queryId=${payload.query_id} to blockId=${blockId}`);

        if (blockId === undefined) {
          console.warn('[AgentBackend] No blockId found for queryId:', payload.query_id);
          console.warn('[AgentBackend] Current queryBlockMap:', Array.from(this.queryBlockMap.entries()));
          return;
        }

        if (payload.chunk_type === 'thinking') {
          // Accumulate thinking chunks instead of emitting immediately
          this.accumulateThinkingChunk(payload.query_id, blockId, payload.content);
        } else {
          // Flush any pending thinking before non-thinking content
          this.flushThinkingChunks(payload.query_id);

          // Determine section type based on chunk type
          let formattedContent = payload.content;
          let sectionType: 'command' | 'response' = 'response';

          if (payload.chunk_type === 'command') {
            // Show commands with a shell prompt indicator
            formattedContent = `\x1b[36m$ ${payload.content}\x1b[0m\n`;
            sectionType = 'command';
          }

          this.eventBus.emit({
            type: 'BlockOutputChunk',
            blockId,
            payload: formattedContent,
            sectionType,
          });
        }
      })
    );
    console.log('[AgentBackend] Listening for agent:response-chunk');

    // Command started (from backend-initiated commands)
    this.unlistenFns.push(
      await listen<Record<string, unknown>>('agent:command-started', (event) => {
        const payload = event.payload as {
          session_id: string;
          query_id: string;
          block_id: number;
          command: string;
        };
        // DON'T overwrite the mapping - use existing frontend blockId
        const blockId = this.queryBlockMap.get(payload.query_id);
        if (blockId === undefined) {
          console.warn('[AgentBackend] agent:command-started - No blockId found for queryId:', payload.query_id);
          return;
        }
        console.log(`[AgentBackend] agent:command-started - Using frontend blockId=${blockId} (backend blockId=${payload.block_id})`);

        // Flush any pending thinking before the command
        this.flushThinkingChunks(payload.query_id);

        this.eventBus.emit({
          type: 'BlockStarted',
          blockId: blockId,
          startedAt: Date.now(),
        });

        // Emit the command text as a 'command' section in the output
        this.eventBus.emit({
          type: 'BlockOutputChunk',
          blockId: blockId,
          payload: `\x1b[36m$ ${payload.command}\x1b[0m\n`,
          sectionType: 'command',
        });

        // Add AI-executed command to history
        this.historyService.add(payload.command, 'ai');
      })
    );

    // Command output
    this.unlistenFns.push(
      await listen<Record<string, unknown>>('agent:command-output', (event) => {
        const payload = event.payload as {
          session_id: string;
          query_id: string;
          block_id: number;
          payload: string;
        };
        // Use frontend blockId from queryBlockMap instead of backend's block_id
        const blockId = this.queryBlockMap.get(payload.query_id);
        if (blockId === undefined) {
          console.warn('[AgentBackend] agent:command-output - No blockId found for queryId:', payload.query_id);
          return;
        }
        console.log(`[AgentBackend] agent:command-output - Routing to frontend blockId=${blockId}`);
        this.eventBus.emit({
          type: 'BlockOutputChunk',
          blockId: blockId,
          payload: payload.payload,
          sectionType: 'output', // Terminal output - collapsible
        });
      })
    );

    // Command completed
    this.unlistenFns.push(
      await listen<Record<string, unknown>>('agent:command-completed', (event) => {
        const payload = event.payload as {
          session_id: string;
          query_id: string;
          block_id: number;
          exit_code: number;
          duration_ms: number;
        };
        // Use frontend blockId from queryBlockMap instead of backend's block_id
        const blockId = this.queryBlockMap.get(payload.query_id);
        if (blockId === undefined) {
          console.warn('[AgentBackend] agent:command-completed - No blockId found for queryId:', payload.query_id);
          return;
        }
        console.log(`[AgentBackend] agent:command-completed - Ending frontend blockId=${blockId}`);
        this.eventBus.emit({
          type: 'BlockEnded',
          blockId: blockId,
          exitCode: payload.exit_code,
          endedAt: Date.now(),
        });
      })
    );

    // Query completed event
    this.unlistenFns.push(
      await listen<Record<string, unknown>>('agent:query-completed', (event) => {
        console.log('[AgentBackend] Received agent:query-completed event:', event.payload);
        const payload = event.payload as {
          query_id: string;
          session_id: string;
          status: string;
          summary?: string;
          blocks_created: number[];
        };

        // Flush any remaining thinking chunks before completing
        this.flushThinkingChunks(payload.query_id);

        const blockId = this.queryBlockMap.get(payload.query_id);
        if (blockId !== undefined) {
          const exitCode =
            payload.status === 'success' || payload.status === 'partial_success'
              ? 0
              : 1;

          this.eventBus.emit({
            type: 'BlockEnded',
            blockId,
            exitCode,
            endedAt: Date.now(),
          });
        }

        this.eventBus.emit({
          type: 'AiThinkingEnded',
          queryId: payload.query_id,
        });

        // Clean up the mappings
        this.queryBlockMap.delete(payload.query_id);
        this.thinkingAccumulators.delete(payload.query_id);
      })
    );
    console.log('[AgentBackend] Listening for agent:query-completed');

    // Error event
    this.unlistenFns.push(
      await listen<Record<string, unknown>>('agent:error', (event) => {
        console.log('[AgentBackend] Received agent:error event:', event.payload);
        const payload = event.payload as {
          session_id: string;
          query_id?: string;
          error_type: string;
          message: string;
          recoverable: boolean;
          suggestion?: string;
        };
        const blockId = payload.query_id
          ? this.queryBlockMap.get(payload.query_id)
          : undefined;

        if (blockId !== undefined) {
          // Append error message to block output
          this.eventBus.emit({
            type: 'BlockOutputChunk',
            blockId,
            payload: `\n\x1b[31mError: ${payload.message}\x1b[0m\n`,
            sectionType: 'response',
          });

          this.eventBus.emit({
            type: 'BlockEnded',
            blockId,
            exitCode: 1,
            endedAt: Date.now(),
          });
        }

        this.eventBus.emit({
          type: 'AiErrorOccurred',
          queryId: payload.query_id,
          message: payload.message,
          recoverable: payload.recoverable,
          suggestion: payload.suggestion,
        });

        // End thinking state if active
        if (payload.query_id) {
          this.eventBus.emit({
            type: 'AiThinkingEnded',
            queryId: payload.query_id,
          });
        }
      })
    );
  }

  /**
   * Accumulate thinking chunks for a query.
   * Buffers tokens until a sentence boundary or timeout.
   */
  private accumulateThinkingChunk(queryId: string, blockId: number, content: string): void {
    let acc = this.thinkingAccumulators.get(queryId);
    if (!acc) {
      acc = { chunks: [], flushTimeout: null, blockId };
      this.thinkingAccumulators.set(queryId, acc);
    }

    acc.chunks.push(content);

    // Clear existing timeout
    if (acc.flushTimeout) {
      clearTimeout(acc.flushTimeout);
    }

    // Check for sentence boundaries to flush immediately
    const combined = acc.chunks.join('');
    if (this.hasSentenceBoundary(combined)) {
      this.flushThinkingChunks(queryId);
      return;
    }

    // Set new flush timeout
    acc.flushTimeout = setTimeout(() => {
      this.flushThinkingChunks(queryId);
    }, this.THINKING_FLUSH_DELAY);
  }

  /**
   * Check if text ends with a sentence boundary.
   * Avoids matching periods in version numbers (e.g., "v3.6", "0.0.18") or decimals.
   */
  private hasSentenceBoundary(text: string): boolean {
    const trimmed = text.trimEnd();
    if (!trimmed) return false;

    // Check for newline - always a boundary
    if (/\n\s*$/.test(text)) return true;

    // Check for ! or ? - always a boundary
    if (/[!?]\s*$/.test(text)) return true;

    // For periods, only consider it a boundary if:
    // 1. It's followed by whitespace, OR
    // 2. It's at the end AND the character before it is NOT a digit
    // This prevents matching "0.0.18" or "v3.6" as sentence boundaries
    if (/\.\s+$/.test(text)) return true; // Period followed by space

    if (/\.$/.test(text)) {
      // Period at end - check if preceded by a digit (likely version/decimal)
      const beforePeriod = trimmed.slice(-2, -1);
      if (/\d/.test(beforePeriod)) {
        return false; // Looks like a version number, don't flush
      }
      return true; // Real sentence end
    }

    return false;
  }

  /**
   * Flush accumulated thinking chunks for a query.
   * Emits as normal response text (no special styling).
   */
  private flushThinkingChunks(queryId: string): void {
    const acc = this.thinkingAccumulators.get(queryId);
    if (!acc || acc.chunks.length === 0) return;

    if (acc.flushTimeout) {
      clearTimeout(acc.flushTimeout);
    }

    const combined = acc.chunks.join('').trim();
    if (combined) {
      // Emit as normal response text (no 💭, no dim styling)
      this.eventBus.emit({
        type: 'BlockOutputChunk',
        blockId: acc.blockId,
        payload: `${combined}\n`,
        sectionType: 'response',
      });
    }

    // Clear the accumulator but keep the entry for future chunks
    acc.chunks = [];
    acc.flushTimeout = null;
  }

  /**
   * Cancel the current query if one is in progress
   */
  async cancelCurrentQuery(): Promise<void> {
    if (!this.agentSessionId) return;

    try {
      await this.tauri.invoke('cancel_agent_query', {
        sessionId: this.agentSessionId,
      });
    } catch (error) {
      console.error('[AgentBackend] Error cancelling query:', error);
    }
  }

  /**
   * Check if the agent backend is initialized
   */
  get isInitialized(): boolean {
    return this.agentSessionId !== null;
  }

  /**
   * Get the current agent session ID
   */
  get sessionId(): string | null {
    return this.agentSessionId;
  }
}
