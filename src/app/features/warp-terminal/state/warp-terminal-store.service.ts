import { Injectable, computed, signal } from '@angular/core';
import { TerminalEventBus } from './warp-terminal.bus';
import type { OutputSectionType, TerminalEvent } from '../models/terminal-events';
import {
  type BlockId,
  type BlockMetrics,
  type CommandBlock,
  type SelectionState,
  type SearchResult,
} from '../models/terminal-block.model';

/** Snapshot of terminal state for a specific system */
export interface TerminalStateSnapshot {
  systemId: string;
  blocks: Map<BlockId, CommandBlock>;
  blockOrder: BlockId[];
  selection: SelectionState;
  followMode: boolean;
  searchOpen: boolean;
  searchQuery: string;
  nextBlockId: number;
  createdAt: number;
}
import { OutputBuffer } from '../models/terminal-output.model';
import { OutputAppendPipeline } from './output-append-pipeline';

const SEARCH_LINE_LIMIT = 1500;

/** AI thinking state */
interface AiState {
  isThinking: boolean;
  currentQueryId: string | null;
  lastError: { message: string; suggestion?: string } | null;
}

@Injectable({ providedIn: 'root' })
export class WarpTerminalStore {
  readonly blocksMap = signal<Map<BlockId, CommandBlock>>(new Map());
  readonly blockOrder = signal<BlockId[]>([]);
  readonly selectionState = signal<SelectionState>({ kind: 'none' });
  readonly followMode = signal(true);
  readonly searchOpen = signal(false);
  readonly searchQuery = signal('');
  private _nextBlockId = 1;
  private readonly aiState = signal<AiState>({
    isThinking: false,
    currentQueryId: null,
    lastError: null,
  });

  private readonly pipeline = new OutputAppendPipeline((blockId, buffer) => {
    this.updateMetrics(blockId, buffer);
  });

  readonly blocks = computed(() =>
    this.blockOrder()
      .map((id) => this.blocksMap().get(id))
      .filter((block): block is CommandBlock => Boolean(block))
  );

  readonly selection = this.selectionState.asReadonly();
  readonly isFollowing = this.followMode.asReadonly();
  readonly searchIsOpen = this.searchOpen.asReadonly();
  readonly searchText = this.searchQuery.asReadonly();
  readonly isAiThinking = computed(() => this.aiState().isThinking);
  readonly aiError = computed(() => this.aiState().lastError);

  readonly searchResults = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    if (!query) return [] as SearchResult[];

    const results: SearchResult[] = [];
    for (const block of this.blocks()) {
      if (block.commandText.toLowerCase().includes(query)) {
        results.push({
          blockId: block.id,
          kind: 'command',
          preview: block.commandText,
        });
      }

      const lineCount = Math.min(block.renderState.getLineCount(), SEARCH_LINE_LIMIT);
      for (let i = 0; i < lineCount; i += 1) {
        const line = block.renderState.getLine(i);
        const text = line.spans.map((span) => span.text).join('');
        if (text.toLowerCase().includes(query)) {
          results.push({
            blockId: block.id,
            kind: 'output',
            lineIndex: i,
            preview: text.trim() || '(blank line)',
          });
        }
      }
    }

    return results.slice(0, 200);
  });

  constructor(private readonly eventBus: TerminalEventBus) {
    this.eventBus.events$.subscribe((event) => this.reduce(event));
  }

  dispatch(event: TerminalEvent): void {
    this.eventBus.emit(event);
  }

  toggleCollapse(blockId: BlockId): void {
    const block = this.blocksMap().get(blockId);
    if (!block) return;
    this.updateBlock(blockId, { isCollapsed: !block.isCollapsed });
  }

  setSearchQuery(query: string): void {
    this.searchQuery.set(query);
  }

  setSelection(selection: SelectionState): void {
    this.selectionState.set(selection);
  }

  clearAiError(): void {
    this.aiState.update((state) => ({
      ...state,
      lastError: null,
    }));
  }

  private reduce(event: TerminalEvent): void {
    switch (event.type) {
      case 'BlockCreated':
        this.addBlock(event.blockId, event.commandText, event.source);
        return;
      case 'BlockStarted':
        this.updateBlock(event.blockId, {
          status: { state: 'running', startedAt: event.startedAt },
        });
        return;
      case 'BlockOutputChunk':
        this.appendOutput(event.blockId, event.payload, event.sectionType);
        return;
      case 'BlockEnded':
        this.completeBlock(event.blockId, event.exitCode, event.endedAt);
        return;
      case 'BlockCancelled':
        this.updateBlock(event.blockId, {
          status: {
            state: 'cancelled',
            reason: event.reason,
            endedAt: event.endedAt,
          },
        });
        return;
      case 'UserScrolled':
        this.followMode.set(false);
        return;
      case 'UserSelectedBlock':
        this.selectionState.set(
          event.blockId ? { kind: 'block', blockId: event.blockId } : { kind: 'none' }
        );
        return;
      case 'UserToggledFollowMode':
        this.followMode.set(event.on);
        return;
      case 'UserToggledSearch':
        this.searchOpen.set(event.open);
        if (!event.open) {
          this.searchQuery.set('');
        }
        return;
      case 'AiThinkingStarted':
        this.aiState.set({
          isThinking: true,
          currentQueryId: event.queryId,
          lastError: null,
        });
        return;
      case 'AiThinkingEnded':
        this.aiState.update((state) => ({
          ...state,
          isThinking: false,
          currentQueryId: null,
        }));
        return;
      case 'AiErrorOccurred':
        this.aiState.update((state) => ({
          ...state,
          isThinking: false,
          lastError: {
            message: event.message,
            suggestion: event.suggestion,
          },
        }));
        return;
      default:
        return;
    }
  }

  private addBlock(blockId: BlockId, commandText: string, source: CommandBlock['source']): void {
    const buffer = new OutputBuffer();
    const metrics: BlockMetrics = { bytesReceived: 0, lineCount: 0 };
    const block: CommandBlock = {
      id: blockId,
      commandText,
      source,
      status: { state: 'queued' },
      cwdLabel: 'E:\\development\\Containerus',
      hostLabel: 'local',
      renderState: buffer,
      metrics,
      isCollapsed: false,
    };

    this.blocksMap.update((map) => {
      const next = new Map(map);
      next.set(blockId, block);
      return next;
    });
    this.blockOrder.update((order) => [...order, blockId]);
  }

  private updateBlock(blockId: BlockId, updates: Partial<CommandBlock>): void {
    this.blocksMap.update((map) => {
      const existing = map.get(blockId);
      if (!existing) return map;
      const next = new Map(map);
      next.set(blockId, { ...existing, ...updates });
      return next;
    });
  }

  private appendOutput(
    blockId: BlockId,
    payload: string,
    sectionType: OutputSectionType = 'output'
  ): void {
    const block = this.blocksMap().get(blockId);
    if (!block) return;
    this.pipeline.enqueue(blockId, block.renderState, payload, sectionType);
  }

  toggleSectionCollapse(blockId: BlockId, sectionId: string): void {
    const block = this.blocksMap().get(blockId);
    if (!block) return;
    block.renderState.toggleSectionCollapse(sectionId);
  }

  private updateMetrics(blockId: BlockId, buffer: OutputBuffer): void {
    const block = this.blocksMap().get(blockId);
    if (!block) return;
    const metrics: BlockMetrics = {
      ...block.metrics,
      bytesReceived: buffer.getBytes(),
      lineCount: buffer.getLineCount(),
    };
    this.updateBlock(blockId, { metrics });
  }

  private completeBlock(blockId: BlockId, exitCode: number, endedAt: number): void {
    const block = this.blocksMap().get(blockId);
    if (!block) return;
    const startedAt = block.status.state === 'running' ? block.status.startedAt : undefined;
    const duration = startedAt ? endedAt - startedAt : undefined;
    this.updateBlock(blockId, {
      status: { state: 'finished', exitCode, endedAt },
      metrics: {
        ...block.metrics,
        durationMs: duration,
      },
    });
  }

  /** Get the next block ID and increment the counter */
  getNextBlockId(): number {
    return this._nextBlockId++;
  }

  /** Create a snapshot of the current terminal state */
  createSnapshot(systemId: string): TerminalStateSnapshot {
    return {
      systemId,
      blocks: new Map(this.blocksMap()),
      blockOrder: [...this.blockOrder()],
      selection: this.selectionState(),
      followMode: this.followMode(),
      searchOpen: this.searchOpen(),
      searchQuery: this.searchQuery(),
      nextBlockId: this._nextBlockId,
      createdAt: Date.now(),
    };
  }

  /** Restore state from a snapshot */
  restoreFromSnapshot(snapshot: TerminalStateSnapshot): void {
    this.blocksMap.set(new Map(snapshot.blocks));
    this.blockOrder.set([...snapshot.blockOrder]);
    this.selectionState.set(snapshot.selection);
    this.followMode.set(snapshot.followMode);
    this.searchOpen.set(snapshot.searchOpen);
    this.searchQuery.set(snapshot.searchQuery);
    this._nextBlockId = snapshot.nextBlockId;
    this.pipeline.clear();
  }

  /** Clear all state to empty */
  clearAllState(): void {
    this.blocksMap.set(new Map());
    this.blockOrder.set([]);
    this.selectionState.set({ kind: 'none' });
    this.followMode.set(true);
    this.searchOpen.set(false);
    this.searchQuery.set('');
    this.aiState.set({ isThinking: false, currentQueryId: null, lastError: null });
    this.pipeline.clear();
  }

  /** Clear terminal blocks only (user-initiated clear, keeps block ID counter) */
  clearTerminal(): void {
    this.blocksMap.set(new Map());
    this.blockOrder.set([]);
    this.selectionState.set({ kind: 'none' });
    this.followMode.set(true);
    this.pipeline.clear();
  }
}
