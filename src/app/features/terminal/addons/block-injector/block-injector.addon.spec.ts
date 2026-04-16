import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BlockInjectorAddon } from './block-injector.addon';
import type { CreateBlockOptions, AnyBlockData, CommandBlockData, AIPromptBlockData, AIResponseBlockData, AICommandBlockData } from './types';

// ── Terminal mock ────────────────────────────────────────────────────────────

function makeMockMarker(line = 5) {
  const callbacks: Array<() => void> = [];
  return {
    line,
    dispose: vi.fn(),
    onDispose: vi.fn((cb: () => void) => {
      callbacks.push(cb);
      return { dispose: vi.fn() };
    }),
    _triggerDispose: () => callbacks.forEach((cb) => cb()),
  };
}

function makeMockDecoration() {
  const renderCallbacks: Array<(el: HTMLElement) => void> = [];
  return {
    dispose: vi.fn(),
    onRender: vi.fn((cb: (el: HTMLElement) => void) => {
      renderCallbacks.push(cb);
      return { dispose: vi.fn() };
    }),
    _triggerRender: (el: HTMLElement) => renderCallbacks.forEach((cb) => cb(el)),
  };
}

function makeMockTerminal() {
  const markers: ReturnType<typeof makeMockMarker>[] = [];
  const decorations: ReturnType<typeof makeMockDecoration>[] = [];

  return {
    cols: 80,
    buffer: {
      active: {
        baseY: 0,
        cursorY: 5,
      },
    },
    registerMarker: vi.fn((offset: number) => {
      const m = makeMockMarker(5 + offset);
      markers.push(m);
      return m;
    }),
    registerDecoration: vi.fn(() => {
      const d = makeMockDecoration();
      decorations.push(d);
      return d;
    }),
    scrollToLine: vi.fn(),
    _markers: markers,
    _decorations: decorations,
  };
}

describe('BlockInjectorAddon', () => {
  let addon: BlockInjectorAddon;
  let terminal: ReturnType<typeof makeMockTerminal>;

  beforeEach(() => {
    addon = new BlockInjectorAddon();
    terminal = makeMockTerminal();
    addon.activate(terminal as any);
  });

  // ── activate / dispose ─────────────────────────────────────────────────────

  describe('activate', () => {
    it('should bind terminal on activate', () => {
      // getCurrentLine should work after activate
      expect(addon.getCurrentLine()).toBeGreaterThanOrEqual(0);
    });
  });

  describe('dispose', () => {
    it('should clear all blocks on dispose', () => {
      addon.createBlock({ type: 'command' });
      addon.dispose();
      expect(addon.getAllBlocks()).toHaveLength(0);
    });

    it('should set terminal to null (getCurrentLine returns -1)', () => {
      addon.dispose();
      expect(addon.getCurrentLine()).toBe(-1);
    });

    it('should clear callbacks on dispose', () => {
      const cb = vi.fn();
      addon.onContainerReady(cb);
      addon.dispose();
      // After dispose, creating a block on a fresh addon would not call old cb
      // We just verify no throws
      expect(() => addon.dispose()).not.toThrow();
    });
  });

  // ── getCurrentLine ─────────────────────────────────────────────────────────

  describe('getCurrentLine', () => {
    it('should return baseY + cursorY', () => {
      terminal.buffer.active.baseY = 10;
      terminal.buffer.active.cursorY = 3;
      expect(addon.getCurrentLine()).toBe(13);
    });

    it('should return -1 when not activated', () => {
      const freshAddon = new BlockInjectorAddon();
      expect(freshAddon.getCurrentLine()).toBe(-1);
    });
  });

  // ── createBlock ────────────────────────────────────────────────────────────

  describe('createBlock', () => {
    it('should return null when terminal is not initialized', () => {
      const freshAddon = new BlockInjectorAddon();
      const result = freshAddon.createBlock({ type: 'command' });
      expect(result).toBeNull();
    });

    it('should return null when registerMarker returns null', () => {
      terminal.registerMarker = vi.fn(() => null);
      const result = addon.createBlock({ type: 'command' });
      expect(result).toBeNull();
    });

    it('should return null when registerDecoration returns null', () => {
      terminal.registerDecoration = vi.fn(() => null);
      const result = addon.createBlock({ type: 'command' });
      expect(result).toBeNull();
    });

    it('should return a BlockHandle with id, type, marker, decoration', () => {
      const handle = addon.createBlock({ type: 'command' });
      expect(handle).not.toBeNull();
      expect(handle!.id).toMatch(/^block-/);
      expect(handle!.type).toBe('command');
      expect(handle!.marker).toBeTruthy();
      expect(handle!.decoration).toBeTruthy();
      expect(handle!.container).toBeNull();
    });

    it('should use cursorYOffset when provided', () => {
      addon.createBlock({ type: 'command', cursorYOffset: 3 });
      expect(terminal.registerMarker).toHaveBeenCalledWith(3);
    });

    it('should default cursorYOffset to 0', () => {
      addon.createBlock({ type: 'command' });
      expect(terminal.registerMarker).toHaveBeenCalledWith(0);
    });

    it('should use heightInRows when provided', () => {
      addon.createBlock({ type: 'command', heightInRows: 5 });
      const call = terminal.registerDecoration.mock.calls[0][0];
      expect(call.height).toBe(5);
    });

    it('should use default height for command block when heightInRows not provided', () => {
      addon.createBlock({ type: 'command' });
      const call = terminal.registerDecoration.mock.calls[0][0];
      expect(call.height).toBe(2); // DEFAULT_HEIGHTS['command'] = 2
    });

    it('should use default height for ai-response block', () => {
      addon.createBlock({ type: 'ai-response' });
      const call = terminal.registerDecoration.mock.calls[0][0];
      expect(call.height).toBe(4); // DEFAULT_HEIGHTS['ai-response'] = 4
    });

    it('should add block to getAllBlocks after creation', () => {
      addon.createBlock({ type: 'command' });
      expect(addon.getAllBlocks()).toHaveLength(1);
    });

    it('should create command block data with defaults', () => {
      const handle = addon.createBlock({ type: 'command' });
      const data = addon.getBlockData(handle!.id) as CommandBlockData;
      expect(data.type).toBe('command');
      expect(data.command).toBe('');
      expect(data.exitCode).toBeNull();
      expect(data.status).toBe('running');
    });

    it('should create ai-prompt block data with defaults', () => {
      const handle = addon.createBlock({ type: 'ai-prompt' });
      const data = addon.getBlockData(handle!.id) as AIPromptBlockData;
      expect(data.type).toBe('ai-prompt');
      expect(data.query).toBe('');
    });

    it('should create ai-response block data with defaults', () => {
      const handle = addon.createBlock({ type: 'ai-response' });
      const data = addon.getBlockData(handle!.id) as AIResponseBlockData;
      expect(data.type).toBe('ai-response');
      expect(data.content).toBe('');
      expect(data.isStreaming).toBe(false);
    });

    it('should create ai-command block data with defaults', () => {
      const handle = addon.createBlock({ type: 'ai-command' });
      const data = addon.getBlockData(handle!.id) as AICommandBlockData;
      expect(data.type).toBe('ai-command');
      expect(data.status).toBe('pending');
      expect(data.isDangerous).toBe(false);
      expect(data.requiresSudo).toBe(false);
    });

    it('should merge provided data options into block data', () => {
      const handle = addon.createBlock({
        type: 'command',
        data: { command: 'docker ps' } as Partial<CommandBlockData>,
      });
      const data = addon.getBlockData(handle!.id) as CommandBlockData;
      expect(data.command).toBe('docker ps');
    });

    it('should remove block when marker onDispose fires', () => {
      const handle = addon.createBlock({ type: 'command' });
      const marker = terminal._markers[0] as any;
      marker._triggerDispose();
      expect(addon.getBlock(handle!.id)).toBeNull();
    });

    it('should notify onContainerReady when decoration renders', () => {
      const readyCb = vi.fn();
      addon.onContainerReady(readyCb);
      const handle = addon.createBlock({ type: 'command' });
      const decoration = terminal._decorations[0] as any;
      const el = document.createElement('div');
      decoration._triggerRender(el);
      expect(readyCb).toHaveBeenCalledWith(handle, expect.any(Object));
    });

    it('should set container on handle when decoration renders', () => {
      const handle = addon.createBlock({ type: 'command' });
      const decoration = terminal._decorations[0] as any;
      const el = document.createElement('div');
      decoration._triggerRender(el);
      expect(handle!.container).toBe(el);
    });

    it('should add CSS classes when decoration renders', () => {
      addon.createBlock({ type: 'command' });
      const decoration = terminal._decorations[0] as any;
      const el = document.createElement('div');
      decoration._triggerRender(el);
      expect(el.classList.contains('terminal-block')).toBe(true);
      expect(el.classList.contains('terminal-block-command')).toBe(true);
    });

    it('should not re-set container on second render event', () => {
      const handle = addon.createBlock({ type: 'command' });
      const decoration = terminal._decorations[0] as any;
      const el1 = document.createElement('div');
      const el2 = document.createElement('div');
      decoration._triggerRender(el1);
      decoration._triggerRender(el2);
      // Container should still be el1 (first render)
      expect(handle!.container).toBe(el1);
    });
  });

  // ── updateBlock ────────────────────────────────────────────────────────────

  describe('updateBlock', () => {
    it('should update block data', () => {
      const handle = addon.createBlock({ type: 'command' });
      addon.updateBlock(handle!.id, { command: 'ls -la' } as Partial<CommandBlockData>);
      const data = addon.getBlockData(handle!.id) as CommandBlockData;
      expect(data.command).toBe('ls -la');
    });

    it('should notify onBlockUpdate listeners', () => {
      const updateCb = vi.fn();
      addon.onBlockUpdate(updateCb);
      const handle = addon.createBlock({ type: 'command' });
      addon.updateBlock(handle!.id, { command: 'pwd' } as Partial<CommandBlockData>);
      expect(updateCb).toHaveBeenCalledWith(handle!.id, expect.any(Object));
    });

    it('should do nothing (warn) when block id is not found', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      addon.updateBlock('nonexistent-id', {});
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  // ── removeBlock ────────────────────────────────────────────────────────────

  describe('removeBlock', () => {
    it('should remove block from getAllBlocks', () => {
      const handle = addon.createBlock({ type: 'command' });
      addon.removeBlock(handle!.id);
      expect(addon.getAllBlocks()).toHaveLength(0);
    });

    it('should notify onBlockRemove listeners', () => {
      const removeCb = vi.fn();
      addon.onBlockRemove(removeCb);
      const handle = addon.createBlock({ type: 'command' });
      addon.removeBlock(handle!.id);
      expect(removeCb).toHaveBeenCalledWith(handle!.id);
    });

    it('should dispose decoration on removeBlock', () => {
      const handle = addon.createBlock({ type: 'command' });
      const decoration = terminal._decorations[0];
      addon.removeBlock(handle!.id);
      expect(decoration.dispose).toHaveBeenCalled();
    });

    it('should do nothing for unknown block id', () => {
      expect(() => addon.removeBlock('unknown-id')).not.toThrow();
    });

    it('should remove block data too', () => {
      const handle = addon.createBlock({ type: 'command' });
      addon.removeBlock(handle!.id);
      expect(addon.getBlockData(handle!.id)).toBeNull();
    });
  });

  // ── getBlock / getBlockData ────────────────────────────────────────────────

  describe('getBlock / getBlockData', () => {
    it('should return block handle by id', () => {
      const handle = addon.createBlock({ type: 'command' });
      expect(addon.getBlock(handle!.id)).toBe(handle);
    });

    it('should return null for unknown block id', () => {
      expect(addon.getBlock('no-such-id')).toBeNull();
    });

    it('should return block data by id', () => {
      const handle = addon.createBlock({ type: 'command' });
      expect(addon.getBlockData(handle!.id)).not.toBeNull();
    });

    it('should return null data for unknown block id', () => {
      expect(addon.getBlockData('no-such-id')).toBeNull();
    });
  });

  // ── getAllBlocks / getAllBlockData ─────────────────────────────────────────

  describe('getAllBlocks / getAllBlockData', () => {
    it('should return empty arrays initially', () => {
      expect(addon.getAllBlocks()).toHaveLength(0);
      expect(addon.getAllBlockData()).toHaveLength(0);
    });

    it('should return all created blocks', () => {
      addon.createBlock({ type: 'command' });
      addon.createBlock({ type: 'ai-prompt' });
      expect(addon.getAllBlocks()).toHaveLength(2);
    });

    it('should return all block data', () => {
      addon.createBlock({ type: 'command' });
      addon.createBlock({ type: 'ai-response' });
      expect(addon.getAllBlockData()).toHaveLength(2);
    });
  });

  // ── getBlocksByType ────────────────────────────────────────────────────────

  describe('getBlocksByType', () => {
    it('should return only blocks of the given type', () => {
      addon.createBlock({ type: 'command' });
      addon.createBlock({ type: 'ai-prompt' });
      addon.createBlock({ type: 'command' });
      expect(addon.getBlocksByType('command')).toHaveLength(2);
      expect(addon.getBlocksByType('ai-prompt')).toHaveLength(1);
    });

    it('should return empty array when no blocks of given type', () => {
      addon.createBlock({ type: 'command' });
      expect(addon.getBlocksByType('ai-response')).toHaveLength(0);
    });
  });

  // ── scrollToBlock ─────────────────────────────────────────────────────────

  describe('scrollToBlock', () => {
    it('should call terminal.scrollToLine with marker line', () => {
      const handle = addon.createBlock({ type: 'command' });
      addon.scrollToBlock(handle!.id);
      expect(terminal.scrollToLine).toHaveBeenCalledWith(handle!.marker.line);
    });

    it('should do nothing for unknown block id', () => {
      addon.scrollToBlock('unknown');
      expect(terminal.scrollToLine).not.toHaveBeenCalled();
    });

    it('should do nothing when terminal is null', () => {
      const freshAddon = new BlockInjectorAddon();
      // Not activated, so terminal is null
      // Just ensure no throw
      expect(() => freshAddon.scrollToBlock('any')).not.toThrow();
    });
  });

  // ── onContainerReady / onBlockUpdate / onBlockRemove ─────────────────────

  describe('event subscription lifecycle', () => {
    it('should allow disposing onContainerReady subscription', () => {
      const cb = vi.fn();
      const sub = addon.onContainerReady(cb);
      sub.dispose();
      // Now add a block and trigger render — cb should NOT be called
      addon.createBlock({ type: 'command' });
      const decoration = terminal._decorations[0] as any;
      decoration._triggerRender(document.createElement('div'));
      expect(cb).not.toHaveBeenCalled();
    });

    it('should allow disposing onBlockUpdate subscription', () => {
      const cb = vi.fn();
      const sub = addon.onBlockUpdate(cb);
      sub.dispose();
      const handle = addon.createBlock({ type: 'command' });
      addon.updateBlock(handle!.id, {});
      expect(cb).not.toHaveBeenCalled();
    });

    it('should allow disposing onBlockRemove subscription', () => {
      const cb = vi.fn();
      const sub = addon.onBlockRemove(cb);
      sub.dispose();
      const handle = addon.createBlock({ type: 'command' });
      addon.removeBlock(handle!.id);
      expect(cb).not.toHaveBeenCalled();
    });

    it('should not throw when onContainerReady callback throws', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      addon.onContainerReady(() => {
        throw new Error('callback error');
      });
      addon.createBlock({ type: 'command' });
      const decoration = terminal._decorations[0] as any;
      expect(() => decoration._triggerRender(document.createElement('div'))).not.toThrow();
      errorSpy.mockRestore();
    });

    it('should not throw when onBlockUpdate callback throws', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      addon.onBlockUpdate(() => {
        throw new Error('update error');
      });
      const handle = addon.createBlock({ type: 'command' });
      expect(() => addon.updateBlock(handle!.id, {})).not.toThrow();
      errorSpy.mockRestore();
    });

    it('should not throw when onBlockRemove callback throws', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      addon.onBlockRemove(() => {
        throw new Error('remove error');
      });
      const handle = addon.createBlock({ type: 'command' });
      expect(() => addon.removeBlock(handle!.id)).not.toThrow();
      errorSpy.mockRestore();
    });
  });
});
