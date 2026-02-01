import { Injectable, signal, computed } from '@angular/core';
import type {
  AnyBlockData,
  BlockType,
  CommandBlockData,
  AIPromptBlockData,
  AIResponseBlockData,
  AICommandBlockData,
} from '../features/terminal/addons/block-injector/types';

/**
 * Signal-based state management for terminal blocks.
 *
 * Provides reactive state for tracking all blocks in the terminal,
 * their collapsed/expanded state, and the currently focused block.
 */
@Injectable({ providedIn: 'root' })
export class BlockState {
  /** Internal map of all blocks */
  private readonly _blocks = signal<Map<string, AnyBlockData>>(new Map());

  /** Set of collapsed block IDs */
  private readonly _collapsedIds = signal<Set<string>>(new Set());

  /** Currently focused block ID */
  private readonly _focusedBlockId = signal<string | null>(null);

  // ============ Public readonly signals ============

  /** All blocks as a readonly signal */
  readonly blocks = this._blocks.asReadonly();

  /** Collapsed block IDs as a readonly signal */
  readonly collapsedIds = this._collapsedIds.asReadonly();

  /** Focused block ID as a readonly signal */
  readonly focusedBlockId = this._focusedBlockId.asReadonly();

  // ============ Computed signals ============

  /** Array of all blocks sorted by timestamp */
  readonly blockList = computed(() => {
    const blocks = Array.from(this._blocks().values());
    return blocks.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  });

  /** Count of all blocks */
  readonly blockCount = computed(() => this._blocks().size);

  /** Command blocks only */
  readonly commandBlocks = computed(() =>
    this.blockList().filter((b): b is CommandBlockData => b.type === 'command')
  );

  /** AI prompt blocks only */
  readonly aiPromptBlocks = computed(() =>
    this.blockList().filter((b): b is AIPromptBlockData => b.type === 'ai-prompt')
  );

  /** AI response blocks only */
  readonly aiResponseBlocks = computed(() =>
    this.blockList().filter((b): b is AIResponseBlockData => b.type === 'ai-response')
  );

  /** AI command blocks only */
  readonly aiCommandBlocks = computed(() =>
    this.blockList().filter((b): b is AICommandBlockData => b.type === 'ai-command')
  );

  /** Running commands */
  readonly runningCommands = computed(() =>
    this.commandBlocks().filter((b) => b.status === 'running')
  );

  /** Focused block data */
  readonly focusedBlock = computed(() => {
    const id = this._focusedBlockId();
    return id ? this._blocks().get(id) ?? null : null;
  });

  // ============ Block CRUD operations ============

  /**
   * Add a new block
   */
  addBlock(block: AnyBlockData): void {
    this._blocks.update((blocks) => {
      const newBlocks = new Map(blocks);
      newBlocks.set(block.id, block);
      return newBlocks;
    });
  }

  /**
   * Update an existing block
   */
  updateBlock(id: string, updates: Partial<AnyBlockData>): void {
    this._blocks.update((blocks) => {
      const existing = blocks.get(id);
      if (!existing) {
        console.warn(`BlockState: Block ${id} not found`);
        return blocks;
      }

      const newBlocks = new Map(blocks);
      newBlocks.set(id, { ...existing, ...updates } as AnyBlockData);
      return newBlocks;
    });
  }

  /**
   * Remove a block
   */
  removeBlock(id: string): void {
    this._blocks.update((blocks) => {
      const newBlocks = new Map(blocks);
      newBlocks.delete(id);
      return newBlocks;
    });

    // Also remove from collapsed set
    this._collapsedIds.update((ids) => {
      const newIds = new Set(ids);
      newIds.delete(id);
      return newIds;
    });

    // Clear focus if this was the focused block
    if (this._focusedBlockId() === id) {
      this._focusedBlockId.set(null);
    }
  }

  /**
   * Get a block by ID
   */
  getBlock(id: string): AnyBlockData | null {
    return this._blocks().get(id) ?? null;
  }

  /**
   * Get blocks by type
   */
  getBlocksByType(type: BlockType): AnyBlockData[] {
    return this.blockList().filter((b) => b.type === type);
  }

  /**
   * Clear all blocks
   */
  clearAll(): void {
    this._blocks.set(new Map());
    this._collapsedIds.set(new Set());
    this._focusedBlockId.set(null);
  }

  // ============ Collapse/Expand operations ============

  /**
   * Toggle collapse state for a block
   */
  toggleCollapse(id: string): void {
    this._collapsedIds.update((ids) => {
      const newIds = new Set(ids);
      if (newIds.has(id)) {
        newIds.delete(id);
      } else {
        newIds.add(id);
      }
      return newIds;
    });

    // Also update the block's isCollapsed property
    this.updateBlock(id, { isCollapsed: !this.isCollapsed(id) });
  }

  /**
   * Set collapse state for a block
   */
  setCollapsed(id: string, collapsed: boolean): void {
    this._collapsedIds.update((ids) => {
      const newIds = new Set(ids);
      if (collapsed) {
        newIds.add(id);
      } else {
        newIds.delete(id);
      }
      return newIds;
    });

    this.updateBlock(id, { isCollapsed: collapsed });
  }

  /**
   * Check if a block is collapsed
   */
  isCollapsed(id: string): boolean {
    return this._collapsedIds().has(id);
  }

  /**
   * Collapse all blocks
   */
  collapseAll(): void {
    const allIds = Array.from(this._blocks().keys());
    this._collapsedIds.set(new Set(allIds));

    this._blocks.update((blocks) => {
      const newBlocks = new Map(blocks);
      for (const [id, block] of newBlocks) {
        newBlocks.set(id, { ...block, isCollapsed: true } as AnyBlockData);
      }
      return newBlocks;
    });
  }

  /**
   * Expand all blocks
   */
  expandAll(): void {
    this._collapsedIds.set(new Set());

    this._blocks.update((blocks) => {
      const newBlocks = new Map(blocks);
      for (const [id, block] of newBlocks) {
        newBlocks.set(id, { ...block, isCollapsed: false } as AnyBlockData);
      }
      return newBlocks;
    });
  }

  // ============ Focus operations ============

  /**
   * Focus a block
   */
  focusBlock(id: string | null): void {
    this._focusedBlockId.set(id);
  }

  /**
   * Check if a block is focused
   */
  isFocused(id: string): boolean {
    return this._focusedBlockId() === id;
  }

  /**
   * Focus the next block
   */
  focusNext(): void {
    const blocks = this.blockList();
    if (blocks.length === 0) return;

    const currentId = this._focusedBlockId();
    if (!currentId) {
      this._focusedBlockId.set(blocks[0].id);
      return;
    }

    const currentIndex = blocks.findIndex((b) => b.id === currentId);
    const nextIndex = (currentIndex + 1) % blocks.length;
    this._focusedBlockId.set(blocks[nextIndex].id);
  }

  /**
   * Focus the previous block
   */
  focusPrevious(): void {
    const blocks = this.blockList();
    if (blocks.length === 0) return;

    const currentId = this._focusedBlockId();
    if (!currentId) {
      this._focusedBlockId.set(blocks[blocks.length - 1].id);
      return;
    }

    const currentIndex = blocks.findIndex((b) => b.id === currentId);
    const prevIndex = currentIndex <= 0 ? blocks.length - 1 : currentIndex - 1;
    this._focusedBlockId.set(blocks[prevIndex].id);
  }

  // ============ Command-specific operations ============

  /**
   * Mark a command as completed
   */
  completeCommand(id: string, exitCode: number): void {
    const block = this.getBlock(id);
    if (!block || block.type !== 'command') return;

    this.updateBlock(id, {
      exitCode,
      status: exitCode === 0 ? 'completed' : 'failed',
    } as Partial<CommandBlockData>);
  }

  /**
   * Get the most recent command block
   */
  getLastCommand(): CommandBlockData | null {
    const commands = this.commandBlocks();
    return commands.length > 0 ? commands[commands.length - 1] : null;
  }

  /**
   * Get the most recent running command
   */
  getRunningCommand(): CommandBlockData | null {
    const running = this.runningCommands();
    return running.length > 0 ? running[running.length - 1] : null;
  }

  // ============ AI-specific operations ============

  /**
   * Update AI command block status
   */
  updateAICommandStatus(
    id: string,
    status: 'pending' | 'inserted' | 'executed' | 'rejected'
  ): void {
    const block = this.getBlock(id);
    if (!block || block.type !== 'ai-command') return;

    this.updateBlock(id, { status } as Partial<AICommandBlockData>);
  }

  /**
   * Update AI response streaming state
   */
  updateAIResponseStreaming(id: string, isStreaming: boolean): void {
    const block = this.getBlock(id);
    if (!block || block.type !== 'ai-response') return;

    this.updateBlock(id, { isStreaming } as Partial<AIResponseBlockData>);
  }
}
