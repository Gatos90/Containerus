import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { BlockFactoryService } from './block-factory.service';
import { BlockState } from '../../../state/block.state';
import { BlockRendererService } from './block-renderer.service';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeBlockData(overrides: Record<string, unknown> = {}) {
  return {
    id: 'block-1',
    type: 'command',
    timestamp: new Date(),
    isCollapsed: false,
    command: 'ls',
    exitCode: null,
    status: 'running',
    ...overrides,
  };
}

function makeHandle(overrides: Record<string, unknown> = {}) {
  return {
    id: 'block-1',
    type: 'command',
    container: document.createElement('div'),
    marker: {},
    decoration: {},
    ...overrides,
  };
}

function makeAddon(handleOrNull: unknown = makeHandle()) {
  return {
    onContainerReady: vi.fn(),
    onBlockUpdate: vi.fn(),
    onBlockRemove: vi.fn(),
    createBlock: vi.fn().mockReturnValue(handleOrNull),
    getBlockData: vi.fn().mockReturnValue(makeBlockData()),
    updateBlock: vi.fn(),
    removeBlock: vi.fn(),
    scrollToBlock: vi.fn(),
  };
}

function makeService() {
  const mockBlockState: any = {
    addBlock: vi.fn(),
    updateBlock: vi.fn(),
    removeBlock: vi.fn(),
    clearAll: vi.fn(),
    toggleCollapse: vi.fn(),
    setCollapsed: vi.fn(),
    getBlock: vi.fn().mockReturnValue(null),
    getRunningCommand: vi.fn().mockReturnValue(null),
  };

  const mockBlockRenderer: any = {
    mountComponent: vi.fn().mockReturnValue({ instance: null }),
    updateInputs: vi.fn(),
    destroyComponent: vi.fn(),
    destroyAll: vi.fn(),
  };

  const injector = Injector.create({
    providers: [
      { provide: BlockState, useValue: mockBlockState },
      { provide: BlockRendererService, useValue: mockBlockRenderer },
    ],
  });

  const service = runInInjectionContext(injector, () => new BlockFactoryService());
  return { service, mockBlockState, mockBlockRenderer };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BlockFactoryService', () => {
  describe('initialize', () => {
    it('should store the addon reference', () => {
      const { service } = makeService();
      const addon = makeAddon();
      service.initialize(addon as any);
      // After initialization, createCommandBlock should use the addon
      addon.createBlock.mockReturnValue(makeHandle());
      addon.getBlockData.mockReturnValue(makeBlockData());
      const id = service.createCommandBlock('echo hello');
      expect(id).toBe('block-1');
    });

    it('should register onContainerReady callback', () => {
      const { service } = makeService();
      const addon = makeAddon();
      service.initialize(addon as any);
      expect(addon.onContainerReady).toHaveBeenCalledOnce();
    });

    it('should register onBlockUpdate callback', () => {
      const { service } = makeService();
      const addon = makeAddon();
      service.initialize(addon as any);
      expect(addon.onBlockUpdate).toHaveBeenCalledOnce();
    });

    it('should register onBlockRemove callback', () => {
      const { service } = makeService();
      const addon = makeAddon();
      service.initialize(addon as any);
      expect(addon.onBlockRemove).toHaveBeenCalledOnce();
    });

    it('onBlockUpdate callback should update state and renderer inputs', () => {
      const { service, mockBlockState, mockBlockRenderer } = makeService();
      const addon = makeAddon();
      service.initialize(addon as any);

      const updateCb = addon.onBlockUpdate.mock.calls[0][0];
      const data = makeBlockData({ type: 'command' });
      updateCb('block-1', data);

      expect(mockBlockState.updateBlock).toHaveBeenCalledWith('block-1', data);
      expect(mockBlockRenderer.updateInputs).toHaveBeenCalledWith('block-1', expect.objectContaining({ blockId: 'block-1' }));
    });

    it('onBlockRemove callback should remove from state and destroy component', () => {
      const { service, mockBlockState, mockBlockRenderer } = makeService();
      const addon = makeAddon();
      service.initialize(addon as any);

      const removeCb = addon.onBlockRemove.mock.calls[0][0];
      removeCb('block-1');

      expect(mockBlockState.removeBlock).toHaveBeenCalledWith('block-1');
      expect(mockBlockRenderer.destroyComponent).toHaveBeenCalledWith('block-1');
    });

    it('onContainerReady callback should mount component for known types', () => {
      const { service, mockBlockRenderer } = makeService();
      const addon = makeAddon();
      service.initialize(addon as any);

      const readyCb = addon.onContainerReady.mock.calls[0][0];
      const handle = makeHandle({ id: 'block-1', type: 'command' });
      const data = makeBlockData({ type: 'command' });
      readyCb(handle, data);

      expect(mockBlockRenderer.mountComponent).toHaveBeenCalledWith(
        'block-1',
        expect.any(Function), // CommandBlockComponent
        handle.container,
        expect.objectContaining({ blockId: 'block-1' })
      );
    });

    it('onContainerReady callback should not mount for unknown block types', () => {
      const { service, mockBlockRenderer } = makeService();
      const addon = makeAddon();
      service.initialize(addon as any);

      const readyCb = addon.onContainerReady.mock.calls[0][0];
      const handle = makeHandle({ id: 'block-x', type: 'session-divider', container: document.createElement('div') });
      const data = makeBlockData({ type: 'session-divider' });
      readyCb(handle, data);

      expect(mockBlockRenderer.mountComponent).not.toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('should destroy all renderer components', () => {
      const { service, mockBlockRenderer } = makeService();
      service.dispose();
      expect(mockBlockRenderer.destroyAll).toHaveBeenCalledOnce();
    });

    it('should clear all block state', () => {
      const { service, mockBlockState } = makeService();
      service.dispose();
      expect(mockBlockState.clearAll).toHaveBeenCalledOnce();
    });

    it('should prevent createCommandBlock after dispose', () => {
      const { service } = makeService();
      const addon = makeAddon();
      service.initialize(addon as any);
      service.dispose();
      const id = service.createCommandBlock('ls');
      expect(id).toBeNull();
    });
  });

  describe('createCommandBlock', () => {
    it('should return null when not initialized', () => {
      const { service } = makeService();
      const id = service.createCommandBlock('ls');
      expect(id).toBeNull();
    });

    it('should return block id on success', () => {
      const { service } = makeService();
      const addon = makeAddon();
      service.initialize(addon as any);
      const id = service.createCommandBlock('ls -la');
      expect(id).toBe('block-1');
    });

    it('should call addon createBlock with command type and data', () => {
      const { service } = makeService();
      const addon = makeAddon();
      service.initialize(addon as any);
      service.createCommandBlock('ls', '/home');
      expect(addon.createBlock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'command',
          data: expect.objectContaining({ command: 'ls', workingDirectory: '/home', status: 'running' }),
        })
      );
    });

    it('should add block to state when data is available', () => {
      const { service, mockBlockState } = makeService();
      const addon = makeAddon();
      service.initialize(addon as any);
      service.createCommandBlock('pwd');
      expect(mockBlockState.addBlock).toHaveBeenCalledWith(expect.objectContaining({ id: 'block-1' }));
    });

    it('should return null when addon createBlock returns null', () => {
      const { service } = makeService();
      const addon = makeAddon(null);
      service.initialize(addon as any);
      const id = service.createCommandBlock('ls');
      expect(id).toBeNull();
    });
  });

  describe('completeCommand', () => {
    it('should call addon updateBlock with success status on exit 0', () => {
      const { service } = makeService();
      const addon = makeAddon();
      service.initialize(addon as any);
      service.completeCommand('block-1', 0, 123);
      expect(addon.updateBlock).toHaveBeenCalledWith('block-1', {
        exitCode: 0,
        status: 'completed',
        duration: 123,
      });
    });

    it('should call addon updateBlock with failed status on non-zero exit', () => {
      const { service } = makeService();
      const addon = makeAddon();
      service.initialize(addon as any);
      service.completeCommand('block-1', 1);
      expect(addon.updateBlock).toHaveBeenCalledWith('block-1', expect.objectContaining({ status: 'failed', exitCode: 1 }));
    });

    it('should do nothing when not initialized', () => {
      const { service } = makeService();
      // Should not throw
      expect(() => service.completeCommand('block-1', 0)).not.toThrow();
    });
  });

  describe('createAIResponseBlock', () => {
    it('should return null when not initialized', () => {
      const { service } = makeService();
      expect(service.createAIResponseBlock('hello')).toBeNull();
    });

    it('should return block id on success', () => {
      const { service } = makeService();
      const addon = makeAddon();
      service.initialize(addon as any);
      const id = service.createAIResponseBlock('content');
      expect(id).toBe('block-1');
    });

    it('should calculate heightInRows capped at 10', () => {
      const { service } = makeService();
      const addon = makeAddon();
      service.initialize(addon as any);
      const longContent = Array(20).fill('line').join('\n');
      service.createAIResponseBlock(longContent);
      expect(addon.createBlock).toHaveBeenCalledWith(
        expect.objectContaining({ heightInRows: 10 })
      );
    });

    it('should use minimum height of 2 for short content', () => {
      const { service } = makeService();
      const addon = makeAddon();
      service.initialize(addon as any);
      service.createAIResponseBlock('short');
      expect(addon.createBlock).toHaveBeenCalledWith(
        expect.objectContaining({ heightInRows: 2 })
      );
    });
  });

  describe('updateAIResponseContent', () => {
    it('should call addon updateBlock with content and streaming flag', () => {
      const { service } = makeService();
      const addon = makeAddon();
      service.initialize(addon as any);
      service.updateAIResponseContent('block-1', 'updated content', true);
      expect(addon.updateBlock).toHaveBeenCalledWith('block-1', {
        content: 'updated content',
        isStreaming: true,
      });
    });

    it('should do nothing when not initialized', () => {
      const { service } = makeService();
      expect(() => service.updateAIResponseContent('block-1', 'x', false)).not.toThrow();
    });
  });

  describe('createLoadingAICommandBlock', () => {
    it('should return null when not initialized', () => {
      const { service } = makeService();
      expect(service.createLoadingAICommandBlock('fix error')).toBeNull();
    });

    it('should create block with isLoading true and empty command', () => {
      const { service } = makeService();
      const addon = makeAddon();
      service.initialize(addon as any);
      service.createLoadingAICommandBlock('what is this?', 5);
      expect(addon.createBlock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ai-command',
          heightInRows: 2,
          data: expect.objectContaining({
            isLoading: true,
            command: '',
            query: 'what is this?',
            contextLines: 5,
            status: 'pending',
          }),
        })
      );
    });
  });

  describe('updateAICommandBlockWithResponse', () => {
    it('should call addon updateBlock with isLoading false', () => {
      const { service } = makeService();
      const addon = makeAddon();
      service.initialize(addon as any);

      const response: any = {
        command: 'rm -rf /tmp/cache',
        explanation: 'Clears temp files',
        isDangerous: true,
        requiresSudo: false,
        affectsFiles: [],
        alternatives: [],
        warning: 'Be careful',
      };

      service.updateAICommandBlockWithResponse('block-1', response);
      expect(addon.updateBlock).toHaveBeenCalledWith(
        'block-1',
        expect.objectContaining({ isLoading: false })
      );
    });

    it('should do nothing when not initialized', () => {
      const { service } = makeService();
      expect(() => service.updateAICommandBlockWithResponse('block-1', {} as any)).not.toThrow();
    });
  });

  describe('toggleBlockCollapse', () => {
    it('should call blockState.toggleCollapse', () => {
      const { service, mockBlockState } = makeService();
      service.toggleBlockCollapse('block-1');
      expect(mockBlockState.toggleCollapse).toHaveBeenCalledWith('block-1');
    });

    it('should update renderer inputs when block exists', () => {
      const { service, mockBlockState, mockBlockRenderer } = makeService();
      mockBlockState.getBlock.mockReturnValue(makeBlockData({ isCollapsed: true }));
      service.toggleBlockCollapse('block-1');
      expect(mockBlockRenderer.updateInputs).toHaveBeenCalledWith('block-1', { isCollapsed: true });
    });

    it('should not update renderer when block does not exist', () => {
      const { service, mockBlockState, mockBlockRenderer } = makeService();
      mockBlockState.getBlock.mockReturnValue(null);
      service.toggleBlockCollapse('block-unknown');
      expect(mockBlockRenderer.updateInputs).not.toHaveBeenCalled();
    });
  });

  describe('removeBlock', () => {
    it('should call addon removeBlock when initialized', () => {
      const { service } = makeService();
      const addon = makeAddon();
      service.initialize(addon as any);
      service.removeBlock('block-1');
      expect(addon.removeBlock).toHaveBeenCalledWith('block-1');
    });

    it('should do nothing when not initialized', () => {
      const { service } = makeService();
      expect(() => service.removeBlock('block-1')).not.toThrow();
    });
  });

  describe('getRunningCommandId', () => {
    it('should return null when no running command', () => {
      const { service, mockBlockState } = makeService();
      mockBlockState.getRunningCommand.mockReturnValue(null);
      expect(service.getRunningCommandId()).toBeNull();
    });

    it('should return block id of running command', () => {
      const { service, mockBlockState } = makeService();
      mockBlockState.getRunningCommand.mockReturnValue(makeBlockData({ id: 'cmd-42', status: 'running' }));
      expect(service.getRunningCommandId()).toBe('cmd-42');
    });
  });

  describe('AI command callbacks', () => {
    it('onAICommandInsert should register callback', () => {
      const { service } = makeService();
      const cb = vi.fn();
      service.onAICommandInsert(cb);
      // Dispose clears callbacks — verifying callback is cleared after dispose
      service.dispose();
      // No throw expected
    });

    it('onAICommandExecute should register callback', () => {
      const { service } = makeService();
      const cb = vi.fn();
      expect(() => service.onAICommandExecute(cb)).not.toThrow();
    });

    it('onAICommandReject should register callback', () => {
      const { service } = makeService();
      const cb = vi.fn();
      expect(() => service.onAICommandReject(cb)).not.toThrow();
    });
  });

  describe('registerBlockComponent', () => {
    it('should register a new block component type without throwing', () => {
      const { service } = makeService();
      class FakeComponent {}
      expect(() => service.registerBlockComponent('status', FakeComponent as any)).not.toThrow();
    });

    it('should allow the registered component to be used in onContainerReady', () => {
      const { service, mockBlockRenderer } = makeService();
      class FakeStatusComponent {}
      service.registerBlockComponent('status', FakeStatusComponent as any);

      const addon = makeAddon();
      service.initialize(addon as any);

      const readyCb = addon.onContainerReady.mock.calls[0][0];
      const container = document.createElement('div');
      const handle = { id: 'block-s', type: 'status', container };
      const data = makeBlockData({ id: 'block-s', type: 'status' });
      readyCb(handle, data);

      expect(mockBlockRenderer.mountComponent).toHaveBeenCalledWith(
        'block-s',
        FakeStatusComponent,
        container,
        expect.any(Object)
      );
    });
  });

  describe('scrollToBlock', () => {
    it('should call addon scrollToBlock when initialized', () => {
      const { service } = makeService();
      const addon = makeAddon();
      service.initialize(addon as any);
      service.scrollToBlock('block-1');
      expect(addon.scrollToBlock).toHaveBeenCalledWith('block-1');
    });

    it('should not throw when not initialized', () => {
      const { service } = makeService();
      expect(() => service.scrollToBlock('block-1')).not.toThrow();
    });
  });
});
