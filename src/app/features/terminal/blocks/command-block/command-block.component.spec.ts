import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Injector,
  runInInjectionContext,
  ɵChangeDetectionScheduler,
  ɵEffectScheduler,
} from '@angular/core';
import { CommandBlockComponent } from './command-block.component';

function makeComponent() {
  const injector = Injector.create({
    providers: [
      {
        provide: ɵChangeDetectionScheduler,
        useValue: { notify: vi.fn(), runningTick: false },
      },
      {
        provide: ɵEffectScheduler,
        useValue: {
          add: vi.fn(),
          remove: vi.fn(),
          schedule: vi.fn(),
          flush: vi.fn(),
        },
      },
    ],
  });

  return runInInjectionContext(injector, () => new CommandBlockComponent());
}

function setRequiredInputs(
  component: CommandBlockComponent,
  options: { blockId?: string; command?: string } = {}
) {
  (component as any).blockId = vi.fn(() => options.blockId ?? 'block-1');
  (component as any).command = vi.fn(() => options.command ?? 'docker ps');
}

describe('CommandBlockComponent', () => {
  describe('creation', () => {
    it('should create the component', () => {
      const component = makeComponent();
      expect(component).toBeTruthy();
    });

    it('should expose Lucide icon constants', () => {
      const component = makeComponent();
      expect(component.Check).toBeDefined();
      expect(component.X).toBeDefined();
      expect(component.Loader2).toBeDefined();
      expect(component.Copy).toBeDefined();
      expect(component.RotateCcw).toBeDefined();
    });
  });

  describe('statusIcon computed', () => {
    it('should return Loader2 when status is running', () => {
      const component = makeComponent();
      (component as any).status = vi.fn(() => 'running');
      (component as any).exitCode = vi.fn(() => null);
      expect(component.statusIcon()).toBe(component.Loader2);
    });

    it('should return Check when status is completed with exitCode 0', () => {
      const component = makeComponent();
      (component as any).status = vi.fn(() => 'completed');
      (component as any).exitCode = vi.fn(() => 0);
      expect(component.statusIcon()).toBe(component.Check);
    });

    it('should return X when status is completed with non-zero exitCode', () => {
      const component = makeComponent();
      (component as any).status = vi.fn(() => 'completed');
      (component as any).exitCode = vi.fn(() => 1);
      expect(component.statusIcon()).toBe(component.X);
    });

    it('should return X when status is failed', () => {
      const component = makeComponent();
      (component as any).status = vi.fn(() => 'failed');
      (component as any).exitCode = vi.fn(() => null);
      expect(component.statusIcon()).toBe(component.X);
    });
  });

  describe('statusColor computed', () => {
    it('should return blue for running status', () => {
      const component = makeComponent();
      (component as any).status = vi.fn(() => 'running');
      (component as any).exitCode = vi.fn(() => null);
      expect(component.statusColor()).toBe('text-blue-400');
    });

    it('should return green for completed with exit code 0', () => {
      const component = makeComponent();
      (component as any).status = vi.fn(() => 'completed');
      (component as any).exitCode = vi.fn(() => 0);
      expect(component.statusColor()).toBe('text-green-400');
    });

    it('should return red for completed with non-zero exit code', () => {
      const component = makeComponent();
      (component as any).status = vi.fn(() => 'completed');
      (component as any).exitCode = vi.fn(() => 2);
      expect(component.statusColor()).toBe('text-red-400');
    });
  });

  describe('statusBorderColor computed', () => {
    it('should return blue border for running', () => {
      const component = makeComponent();
      (component as any).status = vi.fn(() => 'running');
      (component as any).exitCode = vi.fn(() => null);
      expect(component.statusBorderColor()).toBe('border-blue-400');
    });

    it('should return green border for successful completion', () => {
      const component = makeComponent();
      (component as any).status = vi.fn(() => 'completed');
      (component as any).exitCode = vi.fn(() => 0);
      expect(component.statusBorderColor()).toBe('border-green-500');
    });

    it('should return red border for failed completion', () => {
      const component = makeComponent();
      (component as any).status = vi.fn(() => 'completed');
      (component as any).exitCode = vi.fn(() => 1);
      expect(component.statusBorderColor()).toBe('border-red-500');
    });
  });

  describe('isSuccess / isError / isRunning computed', () => {
    it('isSuccess returns true for completed with exitCode 0', () => {
      const component = makeComponent();
      (component as any).status = vi.fn(() => 'completed');
      (component as any).exitCode = vi.fn(() => 0);
      expect(component.isSuccess()).toBe(true);
    });

    it('isSuccess returns false when exitCode is not 0', () => {
      const component = makeComponent();
      (component as any).status = vi.fn(() => 'completed');
      (component as any).exitCode = vi.fn(() => 1);
      expect(component.isSuccess()).toBe(false);
    });

    it('isError returns true when status is failed', () => {
      const component = makeComponent();
      (component as any).status = vi.fn(() => 'failed');
      (component as any).exitCode = vi.fn(() => null);
      expect(component.isError()).toBe(true);
    });

    it('isError returns true when exitCode is non-zero', () => {
      const component = makeComponent();
      (component as any).status = vi.fn(() => 'completed');
      (component as any).exitCode = vi.fn(() => 1);
      expect(component.isError()).toBe(true);
    });

    it('isRunning returns true when status is running', () => {
      const component = makeComponent();
      (component as any).status = vi.fn(() => 'running');
      expect(component.isRunning()).toBe(true);
    });

    it('isRunning returns false when status is completed', () => {
      const component = makeComponent();
      (component as any).status = vi.fn(() => 'completed');
      (component as any).exitCode = vi.fn(() => 0);
      expect(component.isRunning()).toBe(false);
    });
  });

  describe('formattedDuration computed', () => {
    it('should return empty string when duration is undefined', () => {
      const component = makeComponent();
      (component as any).duration = vi.fn(() => undefined);
      expect(component.formattedDuration()).toBe('');
    });

    it('should return milliseconds for durations under 1 second', () => {
      const component = makeComponent();
      (component as any).duration = vi.fn(() => 500);
      expect(component.formattedDuration()).toBe('500ms');
    });

    it('should return seconds for durations between 1s and 60s', () => {
      const component = makeComponent();
      (component as any).duration = vi.fn(() => 2500);
      expect(component.formattedDuration()).toBe('2.5s');
    });

    it('should return minutes and seconds for durations >= 60s', () => {
      const component = makeComponent();
      (component as any).duration = vi.fn(() => 90000); // 1m 30s
      expect(component.formattedDuration()).toBe('1m 30s');
    });
  });

  describe('event emissions', () => {
    it('onToggle should emit toggleCollapse', () => {
      const component = makeComponent();
      const spy = vi.fn();
      component.toggleCollapse.subscribe(spy);

      component.onToggle();

      expect(spy).toHaveBeenCalled();
    });

    it('onCopy should emit copyCommand with the current command', () => {
      const component = makeComponent();
      setRequiredInputs(component, { command: 'docker info' });
      const spy = vi.fn();
      component.copyCommand.subscribe(spy);

      component.onCopy();

      expect(spy).toHaveBeenCalledWith('docker info');
    });

    it('onRerun should emit rerunCommand with the current command', () => {
      const component = makeComponent();
      setRequiredInputs(component, { command: 'docker ps -a' });
      const spy = vi.fn();
      component.rerunCommand.subscribe(spy);

      component.onRerun();

      expect(spy).toHaveBeenCalledWith('docker ps -a');
    });
  });
});
