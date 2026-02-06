import { describe, it, expect, beforeEach } from 'vitest';
import { BlockState } from './block.state';
import type {
  CommandBlockData,
  AIPromptBlockData,
  AIResponseBlockData,
  AICommandBlockData,
  AnyBlockData,
} from '../features/terminal/addons/block-injector/types';

describe('BlockState', () => {
  let state: BlockState;

  const makeCommandBlock = (overrides: Partial<CommandBlockData> = {}): CommandBlockData => ({
    id: 'cmd-1',
    type: 'command',
    timestamp: new Date('2024-01-01T00:00:00Z'),
    isCollapsed: false,
    command: 'ls -la',
    exitCode: null,
    status: 'running',
    ...overrides,
  });

  const makeAIPromptBlock = (overrides: Partial<AIPromptBlockData> = {}): AIPromptBlockData => ({
    id: 'prompt-1',
    type: 'ai-prompt',
    timestamp: new Date('2024-01-01T00:01:00Z'),
    isCollapsed: false,
    query: 'list files',
    ...overrides,
  });

  const makeAIResponseBlock = (overrides: Partial<AIResponseBlockData> = {}): AIResponseBlockData => ({
    id: 'resp-1',
    type: 'ai-response',
    timestamp: new Date('2024-01-01T00:02:00Z'),
    isCollapsed: false,
    content: 'Use `ls` command',
    isStreaming: false,
    ...overrides,
  });

  const makeAICommandBlock = (overrides: Partial<AICommandBlockData> = {}): AICommandBlockData => ({
    id: 'aicmd-1',
    type: 'ai-command',
    timestamp: new Date('2024-01-01T00:03:00Z'),
    isCollapsed: false,
    query: 'list files',
    isLoading: false,
    command: 'ls -la',
    explanation: 'Lists all files including hidden',
    isDangerous: false,
    requiresSudo: false,
    affectsFiles: [],
    alternatives: [],
    status: 'pending',
    ...overrides,
  });

  beforeEach(() => {
    state = new BlockState();
  });

  it('should start with empty state', () => {
    expect(state.blockCount()).toBe(0);
    expect(state.blockList()).toEqual([]);
    expect(state.focusedBlockId()).toBeNull();
  });

  it('should add a block', () => {
    const block = makeCommandBlock();
    state.addBlock(block);
    expect(state.blockCount()).toBe(1);
    expect(state.getBlock('cmd-1')).toEqual(block);
  });

  it('should update a block', () => {
    state.addBlock(makeCommandBlock());
    state.updateBlock('cmd-1', { exitCode: 0, status: 'completed' } as Partial<CommandBlockData>);

    const updated = state.getBlock('cmd-1') as CommandBlockData;
    expect(updated.exitCode).toBe(0);
    expect(updated.status).toBe('completed');
  });

  it('should not crash on updating nonexistent block', () => {
    state.updateBlock('nonexistent', { isCollapsed: true });
    expect(state.blockCount()).toBe(0);
  });

  it('should remove a block', () => {
    state.addBlock(makeCommandBlock());
    state.removeBlock('cmd-1');
    expect(state.blockCount()).toBe(0);
    expect(state.getBlock('cmd-1')).toBeNull();
  });

  it('should clear focus when focused block is removed', () => {
    state.addBlock(makeCommandBlock());
    state.focusBlock('cmd-1');
    state.removeBlock('cmd-1');
    expect(state.focusedBlockId()).toBeNull();
  });

  it('should remove from collapsed set when block is removed', () => {
    state.addBlock(makeCommandBlock());
    state.setCollapsed('cmd-1', true);
    expect(state.isCollapsed('cmd-1')).toBe(true);

    state.removeBlock('cmd-1');
    expect(state.isCollapsed('cmd-1')).toBe(false);
  });

  it('should return block list sorted by timestamp', () => {
    state.addBlock(makeCommandBlock({ id: 'b2', timestamp: new Date('2024-01-02') }));
    state.addBlock(makeCommandBlock({ id: 'b1', timestamp: new Date('2024-01-01') }));
    state.addBlock(makeCommandBlock({ id: 'b3', timestamp: new Date('2024-01-03') }));

    const list = state.blockList();
    expect(list[0].id).toBe('b1');
    expect(list[1].id).toBe('b2');
    expect(list[2].id).toBe('b3');
  });

  it('should filter command blocks', () => {
    state.addBlock(makeCommandBlock());
    state.addBlock(makeAIPromptBlock());
    state.addBlock(makeAIResponseBlock());

    expect(state.commandBlocks()).toHaveLength(1);
    expect(state.commandBlocks()[0].id).toBe('cmd-1');
  });

  it('should filter AI prompt blocks', () => {
    state.addBlock(makeCommandBlock());
    state.addBlock(makeAIPromptBlock());

    expect(state.aiPromptBlocks()).toHaveLength(1);
    expect(state.aiPromptBlocks()[0].id).toBe('prompt-1');
  });

  it('should filter AI response blocks', () => {
    state.addBlock(makeAIResponseBlock());
    state.addBlock(makeCommandBlock());

    expect(state.aiResponseBlocks()).toHaveLength(1);
  });

  it('should filter AI command blocks', () => {
    state.addBlock(makeAICommandBlock());
    state.addBlock(makeCommandBlock());

    expect(state.aiCommandBlocks()).toHaveLength(1);
  });

  it('should compute running commands', () => {
    state.addBlock(makeCommandBlock({ id: 'c1', status: 'running' }));
    state.addBlock(makeCommandBlock({ id: 'c2', status: 'completed', timestamp: new Date('2024-01-01T00:05:00Z') }));

    expect(state.runningCommands()).toHaveLength(1);
    expect(state.runningCommands()[0].id).toBe('c1');
  });

  it('should get blocks by type', () => {
    state.addBlock(makeCommandBlock());
    state.addBlock(makeAIPromptBlock());
    state.addBlock(makeAIResponseBlock());

    expect(state.getBlocksByType('command')).toHaveLength(1);
    expect(state.getBlocksByType('ai-prompt')).toHaveLength(1);
    expect(state.getBlocksByType('ai-response')).toHaveLength(1);
    expect(state.getBlocksByType('directory')).toHaveLength(0);
  });

  it('should clear all blocks', () => {
    state.addBlock(makeCommandBlock());
    state.addBlock(makeAIPromptBlock());
    state.setCollapsed('cmd-1', true);
    state.focusBlock('cmd-1');

    state.clearAll();

    expect(state.blockCount()).toBe(0);
    expect(state.collapsedIds().size).toBe(0);
    expect(state.focusedBlockId()).toBeNull();
  });

  // Collapse/Expand
  it('should toggle collapse', () => {
    state.addBlock(makeCommandBlock());
    expect(state.isCollapsed('cmd-1')).toBe(false);

    state.toggleCollapse('cmd-1');
    expect(state.isCollapsed('cmd-1')).toBe(true);

    state.toggleCollapse('cmd-1');
    expect(state.isCollapsed('cmd-1')).toBe(false);
  });

  it('should set collapsed state', () => {
    state.addBlock(makeCommandBlock());

    state.setCollapsed('cmd-1', true);
    expect(state.isCollapsed('cmd-1')).toBe(true);

    state.setCollapsed('cmd-1', false);
    expect(state.isCollapsed('cmd-1')).toBe(false);
  });

  it('should collapse all blocks', () => {
    state.addBlock(makeCommandBlock({ id: 'b1' }));
    state.addBlock(makeCommandBlock({ id: 'b2', timestamp: new Date('2024-01-02') }));

    state.collapseAll();

    expect(state.isCollapsed('b1')).toBe(true);
    expect(state.isCollapsed('b2')).toBe(true);
    const b1 = state.getBlock('b1') as CommandBlockData;
    expect(b1.isCollapsed).toBe(true);
  });

  it('should expand all blocks', () => {
    state.addBlock(makeCommandBlock({ id: 'b1' }));
    state.addBlock(makeCommandBlock({ id: 'b2', timestamp: new Date('2024-01-02') }));
    state.collapseAll();

    state.expandAll();

    expect(state.isCollapsed('b1')).toBe(false);
    expect(state.isCollapsed('b2')).toBe(false);
    const b1 = state.getBlock('b1') as CommandBlockData;
    expect(b1.isCollapsed).toBe(false);
  });

  // Focus
  it('should focus and unfocus block', () => {
    state.addBlock(makeCommandBlock());
    state.focusBlock('cmd-1');
    expect(state.focusedBlockId()).toBe('cmd-1');
    expect(state.isFocused('cmd-1')).toBe(true);

    state.focusBlock(null);
    expect(state.focusedBlockId()).toBeNull();
    expect(state.isFocused('cmd-1')).toBe(false);
  });

  it('should compute focused block data', () => {
    const block = makeCommandBlock();
    state.addBlock(block);
    state.focusBlock('cmd-1');

    expect(state.focusedBlock()?.id).toBe('cmd-1');

    state.focusBlock(null);
    expect(state.focusedBlock()).toBeNull();
  });

  it('should focus next block', () => {
    state.addBlock(makeCommandBlock({ id: 'b1', timestamp: new Date('2024-01-01') }));
    state.addBlock(makeCommandBlock({ id: 'b2', timestamp: new Date('2024-01-02') }));
    state.addBlock(makeCommandBlock({ id: 'b3', timestamp: new Date('2024-01-03') }));

    // No focus -> first block
    state.focusNext();
    expect(state.focusedBlockId()).toBe('b1');

    state.focusNext();
    expect(state.focusedBlockId()).toBe('b2');

    state.focusNext();
    expect(state.focusedBlockId()).toBe('b3');

    // Wrap around
    state.focusNext();
    expect(state.focusedBlockId()).toBe('b1');
  });

  it('should focus previous block', () => {
    state.addBlock(makeCommandBlock({ id: 'b1', timestamp: new Date('2024-01-01') }));
    state.addBlock(makeCommandBlock({ id: 'b2', timestamp: new Date('2024-01-02') }));

    // No focus -> last block
    state.focusPrevious();
    expect(state.focusedBlockId()).toBe('b2');

    state.focusPrevious();
    expect(state.focusedBlockId()).toBe('b1');

    // Wrap around
    state.focusPrevious();
    expect(state.focusedBlockId()).toBe('b2');
  });

  it('should handle focus next/prev with empty blocks', () => {
    state.focusNext();
    expect(state.focusedBlockId()).toBeNull();

    state.focusPrevious();
    expect(state.focusedBlockId()).toBeNull();
  });

  // Command-specific
  it('should complete a command', () => {
    state.addBlock(makeCommandBlock({ id: 'c1', status: 'running' }));

    state.completeCommand('c1', 0);
    const block = state.getBlock('c1') as CommandBlockData;
    expect(block.exitCode).toBe(0);
    expect(block.status).toBe('completed');
  });

  it('should mark command as failed for non-zero exit code', () => {
    state.addBlock(makeCommandBlock({ id: 'c1', status: 'running' }));

    state.completeCommand('c1', 1);
    const block = state.getBlock('c1') as CommandBlockData;
    expect(block.exitCode).toBe(1);
    expect(block.status).toBe('failed');
  });

  it('should not complete non-command block', () => {
    state.addBlock(makeAIPromptBlock({ id: 'p1' }));
    state.completeCommand('p1', 0);
    const block = state.getBlock('p1') as AIPromptBlockData;
    expect(block.type).toBe('ai-prompt');
  });

  it('should get last command', () => {
    state.addBlock(makeCommandBlock({ id: 'c1', command: 'first', timestamp: new Date('2024-01-01') }));
    state.addBlock(makeCommandBlock({ id: 'c2', command: 'second', timestamp: new Date('2024-01-02') }));

    expect(state.getLastCommand()?.command).toBe('second');
  });

  it('should return null for last command when none exist', () => {
    expect(state.getLastCommand()).toBeNull();
  });

  it('should get running command', () => {
    state.addBlock(makeCommandBlock({ id: 'c1', status: 'completed', timestamp: new Date('2024-01-01') }));
    state.addBlock(makeCommandBlock({ id: 'c2', status: 'running', timestamp: new Date('2024-01-02') }));

    expect(state.getRunningCommand()?.id).toBe('c2');
  });

  it('should return null when no running command', () => {
    state.addBlock(makeCommandBlock({ id: 'c1', status: 'completed' }));
    expect(state.getRunningCommand()).toBeNull();
  });

  // AI-specific
  it('should update AI command status', () => {
    state.addBlock(makeAICommandBlock({ id: 'ac1', status: 'pending' }));

    state.updateAICommandStatus('ac1', 'executed');
    const block = state.getBlock('ac1') as AICommandBlockData;
    expect(block.status).toBe('executed');
  });

  it('should not update status for non-AI-command block', () => {
    state.addBlock(makeCommandBlock({ id: 'c1' }));
    state.updateAICommandStatus('c1', 'executed');
    // Should not crash, block unchanged
    expect(state.getBlock('c1')?.type).toBe('command');
  });

  it('should update AI response streaming state', () => {
    state.addBlock(makeAIResponseBlock({ id: 'r1', isStreaming: true }));

    state.updateAIResponseStreaming('r1', false);
    const block = state.getBlock('r1') as AIResponseBlockData;
    expect(block.isStreaming).toBe(false);
  });

  it('should not update streaming for non-AI-response block', () => {
    state.addBlock(makeCommandBlock({ id: 'c1' }));
    state.updateAIResponseStreaming('c1', true);
    expect(state.getBlock('c1')?.type).toBe('command');
  });
});
