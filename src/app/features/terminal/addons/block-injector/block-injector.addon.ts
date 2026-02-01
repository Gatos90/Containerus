import type { Terminal, ITerminalAddon, IMarker, IDecoration, IDisposable } from '@xterm/xterm';
import type {
  BlockType,
  BlockHandle,
  AnyBlockData,
  CreateBlockOptions,
  OnContainerReadyCallback,
  OnBlockUpdateCallback,
  OnBlockRemoveCallback,
  CommandBlockData,
  AIPromptBlockData,
  AIResponseBlockData,
  AICommandBlockData,
} from './types';

/**
 * Default heights for different block types (in terminal rows)
 */
const DEFAULT_HEIGHTS: Record<BlockType, number> = {
  'command': 2,
  'ai-prompt': 2,
  'ai-response': 4,
  'ai-command': 3,
  'directory': 1,
  'status': 2,
  'session-divider': 1,
};

/**
 * Generate a unique ID for blocks
 */
function generateBlockId(): string {
  return `block-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * BlockInjectorAddon - xterm addon for injecting Angular components as blocks
 *
 * Uses xterm's marker and decoration APIs to position DOM containers
 * at specific buffer lines, allowing Angular components to be mounted
 * while preserving natural terminal scrolling.
 */
export class BlockInjectorAddon implements ITerminalAddon {
  private terminal: Terminal | null = null;
  private blocks = new Map<string, BlockHandle>();
  private blockData = new Map<string, AnyBlockData>();
  private disposables: IDisposable[] = [];

  // Event callbacks
  private onContainerReadyCallbacks: OnContainerReadyCallback[] = [];
  private onBlockUpdateCallbacks: OnBlockUpdateCallback[] = [];
  private onBlockRemoveCallbacks: OnBlockRemoveCallback[] = [];

  /**
   * Called when the addon is loaded into the terminal
   */
  activate(terminal: Terminal): void {
    this.terminal = terminal;
  }

  /**
   * Called when the addon is disposed
   */
  dispose(): void {
    // Dispose all blocks
    for (const [id] of this.blocks) {
      this.removeBlock(id);
    }
    this.blocks.clear();
    this.blockData.clear();

    // Dispose all subscriptions
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];

    // Clear callbacks
    this.onContainerReadyCallbacks = [];
    this.onBlockUpdateCallbacks = [];
    this.onBlockRemoveCallbacks = [];

    this.terminal = null;
  }

  /**
   * Create a new block at the current cursor position
   */
  createBlock(options: CreateBlockOptions): BlockHandle | null {
    if (!this.terminal) {
      console.error('BlockInjectorAddon: Terminal not initialized');
      return null;
    }

    const id = generateBlockId();
    const height = options.heightInRows ?? DEFAULT_HEIGHTS[options.type];
    const cursorYOffset = options.cursorYOffset ?? 0;

    // Create marker at the specified position
    const marker = this.terminal.registerMarker(cursorYOffset);
    if (!marker) {
      console.error('BlockInjectorAddon: Failed to create marker');
      return null;
    }

    // Determine if this should be an inline decoration
    // All blocks use inline mode to push content down and scroll naturally
    const isInline = options.type === 'ai-prompt' ||
                     options.type === 'ai-response' ||
                     options.type === 'ai-command' ||
                     options.type === 'command';

    // Create decoration attached to the marker
    const decoration = this.terminal.registerDecoration({
      marker,
      anchor: 'left',
      width: this.terminal.cols,
      height,
      inline: isInline,
    } as any); // 'inline' is our custom extension

    if (!decoration) {
      console.error('BlockInjectorAddon: Failed to create decoration');
      marker.dispose();
      return null;
    }

    // Create block handle
    const handle: BlockHandle = {
      id,
      type: options.type,
      marker,
      decoration,
      container: null,
    };

    // Create block data
    const data = this.createBlockData(id, options);
    this.blocks.set(id, handle);
    this.blockData.set(id, data);

    // Listen for decoration render event
    const renderDisposable = decoration.onRender((element) => {
      if (!handle.container) {
        // Style the container
        this.styleBlockContainer(element, options.type);
        handle.container = element;

        // Notify listeners
        this.notifyContainerReady(handle, data);
      }
    });
    this.disposables.push(renderDisposable);

    // Listen for marker disposal
    const disposeDisposable = marker.onDispose(() => {
      this.removeBlock(id);
    });
    this.disposables.push(disposeDisposable);

    return handle;
  }

  /**
   * Update block data
   */
  updateBlock(id: string, updates: Partial<AnyBlockData>): void {
    const data = this.blockData.get(id);
    if (!data) {
      console.warn(`BlockInjectorAddon: Block ${id} not found`);
      return;
    }

    // Merge updates
    const updatedData = { ...data, ...updates } as AnyBlockData;
    this.blockData.set(id, updatedData);

    // Notify listeners
    this.notifyBlockUpdate(id, updatedData);
  }

  /**
   * Remove a block
   */
  removeBlock(id: string): void {
    const handle = this.blocks.get(id);
    if (!handle) {
      return;
    }

    // Dispose decoration and marker
    handle.decoration.dispose();
    // Marker may already be disposed, so we don't dispose it here

    // Remove from maps
    this.blocks.delete(id);
    this.blockData.delete(id);

    // Notify listeners
    this.notifyBlockRemove(id);
  }

  /**
   * Get a block by ID
   */
  getBlock(id: string): BlockHandle | null {
    return this.blocks.get(id) ?? null;
  }

  /**
   * Get block data by ID
   */
  getBlockData(id: string): AnyBlockData | null {
    return this.blockData.get(id) ?? null;
  }

  /**
   * Get all blocks
   */
  getAllBlocks(): BlockHandle[] {
    return Array.from(this.blocks.values());
  }

  /**
   * Get all block data
   */
  getAllBlockData(): AnyBlockData[] {
    return Array.from(this.blockData.values());
  }

  /**
   * Get blocks by type
   */
  getBlocksByType(type: BlockType): BlockHandle[] {
    return Array.from(this.blocks.values()).filter((b) => b.type === type);
  }

  /**
   * Scroll to a specific block
   */
  scrollToBlock(id: string): void {
    const handle = this.blocks.get(id);
    if (!handle || !this.terminal) {
      return;
    }

    const line = handle.marker.line;
    if (line >= 0) {
      this.terminal.scrollToLine(line);
    }
  }

  /**
   * Register callback for when a block's container becomes ready
   */
  onContainerReady(callback: OnContainerReadyCallback): IDisposable {
    this.onContainerReadyCallbacks.push(callback);
    return {
      dispose: () => {
        const index = this.onContainerReadyCallbacks.indexOf(callback);
        if (index >= 0) {
          this.onContainerReadyCallbacks.splice(index, 1);
        }
      },
    };
  }

  /**
   * Register callback for block updates
   */
  onBlockUpdate(callback: OnBlockUpdateCallback): IDisposable {
    this.onBlockUpdateCallbacks.push(callback);
    return {
      dispose: () => {
        const index = this.onBlockUpdateCallbacks.indexOf(callback);
        if (index >= 0) {
          this.onBlockUpdateCallbacks.splice(index, 1);
        }
      },
    };
  }

  /**
   * Register callback for block removal
   */
  onBlockRemove(callback: OnBlockRemoveCallback): IDisposable {
    this.onBlockRemoveCallbacks.push(callback);
    return {
      dispose: () => {
        const index = this.onBlockRemoveCallbacks.indexOf(callback);
        if (index >= 0) {
          this.onBlockRemoveCallbacks.splice(index, 1);
        }
      },
    };
  }

  /**
   * Get the current cursor line in the buffer
   */
  getCurrentLine(): number {
    if (!this.terminal) {
      return -1;
    }
    return this.terminal.buffer.active.baseY + this.terminal.buffer.active.cursorY;
  }

  /**
   * Create initial block data based on type
   */
  private createBlockData(id: string, options: CreateBlockOptions): AnyBlockData {
    const baseData = {
      id,
      timestamp: new Date(),
      isCollapsed: false,
      ...options.data,
    };

    switch (options.type) {
      case 'command':
        return {
          type: 'command',
          command: '',
          exitCode: null,
          status: 'running',
          ...baseData, // Spread LAST so options.data values win
        } as CommandBlockData;

      case 'ai-prompt':
        return {
          type: 'ai-prompt',
          query: '',
          ...baseData, // Spread LAST so options.data values win
        } as AIPromptBlockData;

      case 'ai-response':
        return {
          type: 'ai-response',
          content: '',
          isStreaming: false,
          ...baseData, // Spread LAST so options.data values win
        } as AIResponseBlockData;

      case 'ai-command':
        return {
          type: 'ai-command',
          query: '',
          command: '',
          explanation: '',
          isDangerous: false,
          requiresSudo: false,
          affectsFiles: [],
          alternatives: [],
          status: 'pending',
          ...baseData, // Spread LAST so options.data values win
        } as AICommandBlockData;

      default:
        return baseData as AnyBlockData;
    }
  }

  /**
   * Style the block container element
   * Only adds CSS classes - visual styling is handled by CSS
   */
  private styleBlockContainer(element: HTMLElement, type: BlockType): void {
    // Add classes for CSS targeting (styling handled by terminal-view.component.css)
    element.classList.add('terminal-block');
    element.classList.add(`terminal-block-${type}`);
  }

  /**
   * Notify listeners that a container is ready
   */
  private notifyContainerReady(handle: BlockHandle, data: AnyBlockData): void {
    for (const callback of this.onContainerReadyCallbacks) {
      try {
        callback(handle, data);
      } catch (error) {
        console.error('BlockInjectorAddon: Error in onContainerReady callback', error);
      }
    }
  }

  /**
   * Notify listeners of a block update
   */
  private notifyBlockUpdate(id: string, data: AnyBlockData): void {
    for (const callback of this.onBlockUpdateCallbacks) {
      try {
        callback(id, data);
      } catch (error) {
        console.error('BlockInjectorAddon: Error in onBlockUpdate callback', error);
      }
    }
  }

  /**
   * Notify listeners of a block removal
   */
  private notifyBlockRemove(id: string): void {
    for (const callback of this.onBlockRemoveCallbacks) {
      try {
        callback(id);
      } catch (error) {
        console.error('BlockInjectorAddon: Error in onBlockRemove callback', error);
      }
    }
  }
}
