import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandBlockCardComponent } from './command-block-card.component';
import type { CommandBlock } from '../../models/terminal-block.model';
import { OutputBuffer } from '../../models/terminal-output.model';

function makeBlock(overrides: Partial<CommandBlock> = {}): CommandBlock {
  return {
    id: 1,
    commandText: 'docker ps',
    source: 'user',
    status: { state: 'queued' },
    cwdLabel: '~',
    hostLabel: 'local',
    renderState: new OutputBuffer(),
    metrics: { bytesReceived: 0, lineCount: 0 },
    isCollapsed: false,
    ...overrides,
  };
}

describe('CommandBlockCardComponent', () => {
  let component: CommandBlockCardComponent;

  beforeEach(() => {
    component = new CommandBlockCardComponent();
    component.block = makeBlock();
  });

  describe('statusLabel', () => {
    it('should return "Queued" for queued state', () => {
      component.block = makeBlock({ status: { state: 'queued' } });
      expect(component.statusLabel).toBe('Queued');
    });

    it('should return "Running" for running state', () => {
      component.block = makeBlock({ status: { state: 'running', startedAt: Date.now() } });
      expect(component.statusLabel).toBe('Running');
    });

    it('should return "Success" for finished with exitCode 0', () => {
      component.block = makeBlock({
        status: { state: 'finished', exitCode: 0, endedAt: Date.now() },
      });
      expect(component.statusLabel).toBe('Success');
    });

    it('should return "Failed" for finished with non-zero exitCode', () => {
      component.block = makeBlock({
        status: { state: 'finished', exitCode: 1, endedAt: Date.now() },
      });
      expect(component.statusLabel).toBe('Failed');
    });

    it('should return "Cancelled" for cancelled state', () => {
      component.block = makeBlock({
        status: { state: 'cancelled', reason: 'user request', endedAt: Date.now() },
      });
      expect(component.statusLabel).toBe('Cancelled');
    });

    it('should return "Idle" for unknown state', () => {
      component.block = makeBlock({ status: { state: 'unknown' as any } });
      expect(component.statusLabel).toBe('Idle');
    });
  });

  describe('statusTone', () => {
    it('should return "queued" for queued state', () => {
      component.block = makeBlock({ status: { state: 'queued' } });
      expect(component.statusTone).toBe('queued');
    });

    it('should return "running" for running state', () => {
      component.block = makeBlock({ status: { state: 'running', startedAt: Date.now() } });
      expect(component.statusTone).toBe('running');
    });

    it('should return "success" for finished with exitCode 0', () => {
      component.block = makeBlock({
        status: { state: 'finished', exitCode: 0, endedAt: Date.now() },
      });
      expect(component.statusTone).toBe('success');
    });

    it('should return "failure" for finished with non-zero exitCode', () => {
      component.block = makeBlock({
        status: { state: 'finished', exitCode: 2, endedAt: Date.now() },
      });
      expect(component.statusTone).toBe('failure');
    });

    it('should return "failure" for cancelled state', () => {
      component.block = makeBlock({
        status: { state: 'cancelled', reason: 'timeout', endedAt: Date.now() },
      });
      expect(component.statusTone).toBe('failure');
    });

    it('should return "queued" for unknown state (default)', () => {
      component.block = makeBlock({ status: { state: 'unknown' as any } });
      expect(component.statusTone).toBe('queued');
    });
  });

  describe('onTextSelection', () => {
    it('should emit text kind with blockId when active=true', () => {
      const emitted: any[] = [];
      component.textSelection.subscribe((v) => emitted.push(v));

      component.onTextSelection(true);
      expect(emitted).toEqual([{ kind: 'text', blockId: 1 }]);
    });

    it('should emit none kind when active=false', () => {
      const emitted: any[] = [];
      component.textSelection.subscribe((v) => emitted.push(v));

      component.onTextSelection(false);
      expect(emitted).toEqual([{ kind: 'none' }]);
    });

    it('should use block id from current block', () => {
      component.block = makeBlock({ id: 42 });
      const emitted: any[] = [];
      component.textSelection.subscribe((v) => emitted.push(v));

      component.onTextSelection(true);
      expect(emitted[0]).toEqual({ kind: 'text', blockId: 42 });
    });
  });

  describe('formatBytes', () => {
    it('should format bytes under 1024 as B', () => {
      expect(component.formatBytes(0)).toBe('0 B');
      expect(component.formatBytes(512)).toBe('512 B');
      expect(component.formatBytes(1023)).toBe('1023 B');
    });

    it('should format bytes in KB range', () => {
      expect(component.formatBytes(1024)).toBe('1.0 KB');
      expect(component.formatBytes(2048)).toBe('2.0 KB');
      expect(component.formatBytes(1536)).toBe('1.5 KB');
    });

    it('should format bytes in MB range', () => {
      expect(component.formatBytes(1024 * 1024)).toBe('1.0 MB');
      expect(component.formatBytes(2 * 1024 * 1024)).toBe('2.0 MB');
    });

    it('should format fractional KB correctly', () => {
      expect(component.formatBytes(1124)).toBe('1.1 KB');
    });
  });

  describe('outputs', () => {
    it('should emit select event', () => {
      const emitted: void[] = [];
      component.select.subscribe(() => emitted.push(undefined));
      component.select.emit();
      expect(emitted).toHaveLength(1);
    });

    it('should emit copyCommand event', () => {
      const emitted: void[] = [];
      component.copyCommand.subscribe(() => emitted.push(undefined));
      component.copyCommand.emit();
      expect(emitted).toHaveLength(1);
    });

    it('should emit copyOutput event', () => {
      const emitted: void[] = [];
      component.copyOutput.subscribe(() => emitted.push(undefined));
      component.copyOutput.emit();
      expect(emitted).toHaveLength(1);
    });

    it('should emit rerun event', () => {
      const emitted: void[] = [];
      component.rerun.subscribe(() => emitted.push(undefined));
      component.rerun.emit();
      expect(emitted).toHaveLength(1);
    });

    it('should emit toggleCollapse event', () => {
      const emitted: void[] = [];
      component.toggleCollapse.subscribe(() => emitted.push(undefined));
      component.toggleCollapse.emit();
      expect(emitted).toHaveLength(1);
    });
  });

  describe('icon properties', () => {
    it('should expose lucide icon references', () => {
      expect(component.CheckCircle2).toBeDefined();
      expect(component.XCircle).toBeDefined();
      expect(component.Loader2).toBeDefined();
      expect(component.Copy).toBeDefined();
      expect(component.Play).toBeDefined();
      expect(component.ChevronDown).toBeDefined();
      expect(component.ChevronRight).toBeDefined();
      expect(component.Terminal).toBeDefined();
      expect(component.FileText).toBeDefined();
    });
  });

  describe('inputs', () => {
    it('should default selected to false', () => {
      expect(component.selected).toBe(false);
    });

    it('should accept selected true', () => {
      component.selected = true;
      expect(component.selected).toBe(true);
    });

    it('should accept highlightLines set', () => {
      component.highlightLines = new Set([1, 2, 3]);
      expect(component.highlightLines?.size).toBe(3);
    });
  });
});
