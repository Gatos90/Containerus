import { Injectable, inject, Type, ComponentRef } from '@angular/core';
import { BlockInjectorAddon } from '../addons/block-injector';
import {
  BlockType,
  AnyBlockData,
  CommandBlockData,
  AIPromptBlockData,
  AIResponseBlockData,
  AICommandBlockData,
  createAICommandBlockDataFromResponse,
} from '../addons/block-injector/types';
import { BlockState } from '../../../state/block.state';
import { BlockRendererService } from './block-renderer.service';
import { CommandBlockComponent } from '../blocks/command-block/command-block.component';
import { AIPromptBlockComponent } from '../blocks/ai-prompt-block/ai-prompt-block.component';
import { AIResponseBlockComponent } from '../blocks/ai-response-block/ai-response-block.component';
import { AICommandBlockComponent } from '../blocks/ai-command-block/ai-command-block.component';
import type { ShellCommandResponse } from '../../../core/models/ai-settings.model';

/**
 * Callback types for AI command actions
 */
export type AICommandInsertCallback = (blockId: string, command: string) => void;
export type AICommandExecuteCallback = (blockId: string, command: string) => void;
export type AICommandRejectCallback = (blockId: string) => void;

/**
 * Maps block types to their Angular components
 */
const BLOCK_COMPONENTS: Partial<Record<BlockType, Type<unknown>>> = {
  'command': CommandBlockComponent,
  'ai-prompt': AIPromptBlockComponent,
  'ai-response': AIResponseBlockComponent,
  'ai-command': AICommandBlockComponent,
};

/**
 * BlockFactoryService creates and manages terminal blocks.
 *
 * Acts as a facade that coordinates:
 * - BlockInjectorAddon (xterm integration)
 * - BlockState (signal-based state)
 * - BlockRendererService (Angular component mounting)
 */
@Injectable({ providedIn: 'root' })
export class BlockFactoryService {
  private readonly blockState = inject(BlockState);
  private readonly blockRenderer = inject(BlockRendererService);

  private addon: BlockInjectorAddon | null = null;

  // AI command action callbacks
  private onInsertCallbacks: AICommandInsertCallback[] = [];
  private onExecuteCallbacks: AICommandExecuteCallback[] = [];
  private onRejectCallbacks: AICommandRejectCallback[] = [];

  /**
   * Initialize the factory with a BlockInjectorAddon instance.
   * Must be called before creating blocks.
   */
  initialize(addon: BlockInjectorAddon): void {
    this.addon = addon;

    // Listen for container ready events to mount components
    addon.onContainerReady((handle, data) => {
      const Component = BLOCK_COMPONENTS[handle.type];
      if (Component && handle.container) {
        this.mountBlockComponent(handle.id, Component, handle.container, data);
      }
    });

    // Listen for block updates to update component inputs
    addon.onBlockUpdate((id, data) => {
      this.blockState.updateBlock(id, data);
      this.blockRenderer.updateInputs(id, this.dataToInputs(data));
    });

    // Listen for block removal to cleanup
    addon.onBlockRemove((id) => {
      this.blockState.removeBlock(id);
      this.blockRenderer.destroyComponent(id);
    });
  }

  /**
   * Dispose and cleanup
   */
  dispose(): void {
    this.blockRenderer.destroyAll();
    this.blockState.clearAll();
    this.addon = null;
    this.onInsertCallbacks = [];
    this.onExecuteCallbacks = [];
    this.onRejectCallbacks = [];
  }

  /**
   * Register a callback for when an AI command is inserted
   */
  onAICommandInsert(callback: AICommandInsertCallback): void {
    this.onInsertCallbacks.push(callback);
  }

  /**
   * Register a callback for when an AI command is executed
   */
  onAICommandExecute(callback: AICommandExecuteCallback): void {
    this.onExecuteCallbacks.push(callback);
  }

  /**
   * Register a callback for when an AI command is rejected
   */
  onAICommandReject(callback: AICommandRejectCallback): void {
    this.onRejectCallbacks.push(callback);
  }

  /**
   * Create a command block for an executed command
   */
  createCommandBlock(command: string, workingDirectory?: string): string | null {
    if (!this.addon) {
      console.error('BlockFactoryService: Not initialized');
      return null;
    }

    const handle = this.addon.createBlock({
      type: 'command',
      data: {
        command,
        workingDirectory,
        status: 'running',
        exitCode: null,
      } as Partial<CommandBlockData>,
    });

    if (!handle) return null;

    // Add to state
    const data = this.addon.getBlockData(handle.id);
    if (data) {
      this.blockState.addBlock(data);
    }

    return handle.id;
  }

  /**
   * Complete a command block with exit code
   */
  completeCommand(blockId: string, exitCode: number, duration?: number): void {
    if (!this.addon) return;

    const updates: Partial<CommandBlockData> = {
      exitCode,
      status: exitCode === 0 ? 'completed' : 'failed',
      duration,
    };

    this.addon.updateBlock(blockId, updates);
  }

  /**
   * Create an AI prompt block
   */
  createAIPromptBlock(
    query: string,
    contextLines?: number,
    options?: { isLoading?: boolean; contextContent?: string }
  ): string | null {
    if (!this.addon) {
      console.error('BlockFactoryService: Not initialized');
      return null;
    }

    const handle = this.addon.createBlock({
      type: 'ai-prompt',
      heightInRows: 2,
      data: {
        query,
        contextLines,
        contextContent: options?.contextContent,
        isLoading: options?.isLoading ?? false,
      } as Partial<AIPromptBlockData>,
    });

    if (!handle) return null;

    const data = this.addon.getBlockData(handle.id);
    if (data) {
      this.blockState.addBlock(data);
    }

    return handle.id;
  }

  /**
   * Update AI prompt block (e.g., to clear loading state)
   */
  updateAIPromptBlock(blockId: string, updates: Partial<AIPromptBlockData>): void {
    if (!this.addon) return;

    this.addon.updateBlock(blockId, updates);
  }

  /**
   * Create an AI response block
   */
  createAIResponseBlock(content: string, isStreaming = false): string | null {
    if (!this.addon) {
      console.error('BlockFactoryService: Not initialized');
      return null;
    }

    // Calculate height based on content length
    const lines = content.split('\n').length;
    const heightInRows = Math.max(2, Math.min(lines + 1, 10));

    const handle = this.addon.createBlock({
      type: 'ai-response',
      heightInRows,
      data: {
        content,
        isStreaming,
      } as Partial<AIResponseBlockData>,
    });

    if (!handle) return null;

    const data = this.addon.getBlockData(handle.id);
    if (data) {
      this.blockState.addBlock(data);
    }

    return handle.id;
  }

  /**
   * Update AI response content (for streaming)
   */
  updateAIResponseContent(blockId: string, content: string, isStreaming: boolean): void {
    if (!this.addon) return;

    this.addon.updateBlock(blockId, {
      content,
      isStreaming,
    } as Partial<AIResponseBlockData>);
  }

  /**
   * Create an AI command block from a ShellCommandResponse
   */
  createAICommandBlock(
    response: ShellCommandResponse,
    query: string,
    contextLines?: number
  ): string | null {
    if (!this.addon) {
      console.error('BlockFactoryService: Not initialized');
      return null;
    }

    const commandData = createAICommandBlockDataFromResponse(response);

    const handle = this.addon.createBlock({
      type: 'ai-command',
      heightInRows: 3,
      data: {
        ...commandData,
        query,
        contextLines,
      } as Partial<AICommandBlockData>,
    });

    if (!handle) return null;

    const data = this.addon.getBlockData(handle.id);
    if (data) {
      this.blockState.addBlock(data);
    }

    return handle.id;
  }

  /**
   * Update AI command status
   */
  updateAICommandStatus(
    blockId: string,
    status: 'pending' | 'inserted' | 'executed' | 'rejected'
  ): void {
    if (!this.addon) return;

    this.addon.updateBlock(blockId, {
      status,
    } as Partial<AICommandBlockData>);
  }

  /**
   * Create an AI command block in loading state (shows immediately while waiting for AI)
   */
  createLoadingAICommandBlock(query: string, contextLines?: number): string | null {
    if (!this.addon) {
      console.error('BlockFactoryService: Not initialized');
      return null;
    }

    const handle = this.addon.createBlock({
      type: 'ai-command',
      heightInRows: 2, // Smaller height while loading
      data: {
        query,
        contextLines,
        isLoading: true,
        command: '',
        explanation: '',
        isDangerous: false,
        requiresSudo: false,
        affectsFiles: [],
        alternatives: [],
        status: 'pending',
      } as Partial<AICommandBlockData>,
    });

    if (!handle) return null;

    const data = this.addon.getBlockData(handle.id);
    if (data) {
      this.blockState.addBlock(data);
    }

    return handle.id;
  }

  /**
   * Update an AI command block with the actual response data
   */
  updateAICommandBlockWithResponse(blockId: string, response: ShellCommandResponse): void {
    if (!this.addon) return;

    const commandData = createAICommandBlockDataFromResponse(response);

    this.addon.updateBlock(blockId, {
      ...commandData,
      isLoading: false,
    } as Partial<AICommandBlockData>);
  }

  /**
   * Toggle collapse state for a block
   */
  toggleBlockCollapse(blockId: string): void {
    this.blockState.toggleCollapse(blockId);

    // Update component inputs
    const data = this.blockState.getBlock(blockId);
    if (data) {
      this.blockRenderer.updateInputs(blockId, { isCollapsed: data.isCollapsed });
    }
  }

  /**
   * Set collapse state for a block (updates both state and rendered component)
   */
  private setBlockCollapsed(blockId: string, collapsed: boolean): void {
    this.blockState.setCollapsed(blockId, collapsed);
    this.blockRenderer.updateInputs(blockId, { isCollapsed: collapsed });
  }

  /**
   * Remove a block by ID
   */
  removeBlock(blockId: string): void {
    if (!this.addon) return;

    // This will trigger the onBlockRemove callback which handles
    // cleaning up state and destroying the component
    this.addon.removeBlock(blockId);
  }

  /**
   * Scroll to a specific block
   */
  scrollToBlock(blockId: string): void {
    this.addon?.scrollToBlock(blockId);
  }

  /**
   * Get the most recent running command block ID
   */
  getRunningCommandId(): string | null {
    const running = this.blockState.getRunningCommand();
    return running?.id ?? null;
  }

  /**
   * Mount an Angular component for a block
   */
  private mountBlockComponent(
    id: string,
    component: Type<unknown>,
    container: HTMLElement,
    data: AnyBlockData
  ): void {
    const inputs = this.dataToInputs(data);
    const componentRef = this.blockRenderer.mountComponent(id, component, container, inputs);

    // Wire up outputs for AI command blocks
    if (data.type === 'ai-command') {
      this.wireUpAICommandOutputs(id, componentRef as ComponentRef<AICommandBlockComponent>);
    }
  }

  /**
   * Wire up outputs for an AICommandBlockComponent
   */
  private wireUpAICommandOutputs(
    blockId: string,
    componentRef: ComponentRef<AICommandBlockComponent>
  ): void {
    const instance = componentRef.instance;

    // Subscribe to insert output
    instance.insert.subscribe((command: string) => {
      this.updateAICommandStatus(blockId, 'inserted');
      this.setBlockCollapsed(blockId, true); // Auto-collapse after action
      for (const callback of this.onInsertCallbacks) {
        callback(blockId, command);
      }
    });

    // Subscribe to execute output
    instance.execute.subscribe((command: string) => {
      this.updateAICommandStatus(blockId, 'executed');
      this.setBlockCollapsed(blockId, true); // Auto-collapse after action
      for (const callback of this.onExecuteCallbacks) {
        callback(blockId, command);
      }
    });

    // Subscribe to reject output
    instance.reject.subscribe(() => {
      this.updateAICommandStatus(blockId, 'rejected');
      this.setBlockCollapsed(blockId, true); // Auto-collapse after action
      for (const callback of this.onRejectCallbacks) {
        callback(blockId);
      }
    });

    // Subscribe to toggleCollapse output
    instance.toggleCollapse.subscribe(() => {
      this.toggleBlockCollapse(blockId);
    });

    // Subscribe to copyCommand output
    instance.copyCommand.subscribe((command: string) => {
      navigator.clipboard.writeText(command).catch((err) => {
        console.error('Failed to copy command:', err);
      });
    });
  }

  /**
   * Convert block data to component inputs
   */
  private dataToInputs(data: AnyBlockData): Record<string, unknown> {
    const baseInputs = {
      blockId: data.id,
      isCollapsed: data.isCollapsed,
    };

    switch (data.type) {
      case 'command':
        return {
          ...baseInputs,
          command: data.command,
          exitCode: data.exitCode,
          status: data.status,
          workingDirectory: data.workingDirectory,
          duration: data.duration,
        };

      case 'ai-prompt':
        return {
          ...baseInputs,
          query: data.query,
          contextLines: data.contextLines,
          contextContent: data.contextContent,
          isLoading: data.isLoading,
        };

      case 'ai-response':
        return {
          ...baseInputs,
          content: data.content,
          isStreaming: data.isStreaming,
        };

      case 'ai-command':
        return {
          ...baseInputs,
          query: data.query,
          contextLines: data.contextLines,
          isLoading: data.isLoading,
          command: data.command,
          explanation: data.explanation,
          isDangerous: data.isDangerous,
          requiresSudo: data.requiresSudo,
          affectsFiles: data.affectsFiles,
          alternatives: data.alternatives,
          warning: data.warning,
          status: data.status,
        };

      default:
        return baseInputs;
    }
  }

  /**
   * Register an additional block component type
   */
  registerBlockComponent(type: BlockType, component: Type<unknown>): void {
    BLOCK_COMPONENTS[type] = component;
  }
}
