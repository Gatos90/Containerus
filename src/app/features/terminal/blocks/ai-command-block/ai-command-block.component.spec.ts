import { describe, it, expect, vi } from 'vitest';
import {
  Injector,
  runInInjectionContext,
  ɵChangeDetectionScheduler,
  ɵEffectScheduler,
} from '@angular/core';
import { AICommandBlockComponent } from './ai-command-block.component';

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

  return runInInjectionContext(injector, () => new AICommandBlockComponent());
}

function setStatus(component: AICommandBlockComponent, status: 'pending' | 'inserted' | 'executed' | 'rejected') {
  (component as any).status = vi.fn(() => status);
}

function setCommand(component: AICommandBlockComponent, command: string) {
  (component as any).command = vi.fn(() => command);
}

function setIsDangerous(component: AICommandBlockComponent, dangerous: boolean) {
  (component as any).isDangerous = vi.fn(() => dangerous);
}

function setAlternatives(
  component: AICommandBlockComponent,
  alternatives: Array<{ command: string; description: string }>
) {
  (component as any).alternatives = vi.fn(() => alternatives);
}

describe('AICommandBlockComponent', () => {
  describe('creation', () => {
    it('should create the component', () => {
      const component = makeComponent();
      expect(component).toBeTruthy();
    });

    it('should expose Lucide icon constants', () => {
      const component = makeComponent();
      expect(component.Terminal).toBeDefined();
      expect(component.Play).toBeDefined();
      expect(component.Copy).toBeDefined();
      expect(component.AlertTriangle).toBeDefined();
      expect(component.Check).toBeDefined();
      expect(component.X).toBeDefined();
    });

    it('should default showAlternatives to false', () => {
      const component = makeComponent();
      expect(component.showAlternatives).toBe(false);
    });

    it('should default showAffectsFiles to false', () => {
      const component = makeComponent();
      expect(component.showAffectsFiles).toBe(false);
    });
  });

  describe('status computed properties', () => {
    it('isPending returns true when status is pending', () => {
      const component = makeComponent();
      setStatus(component, 'pending');
      expect(component.isPending()).toBe(true);
    });

    it('isPending returns false when status is not pending', () => {
      const component = makeComponent();
      setStatus(component, 'executed');
      expect(component.isPending()).toBe(false);
    });

    it('isInserted returns true when status is inserted', () => {
      const component = makeComponent();
      setStatus(component, 'inserted');
      expect(component.isInserted()).toBe(true);
    });

    it('isExecuted returns true when status is executed', () => {
      const component = makeComponent();
      setStatus(component, 'executed');
      expect(component.isExecuted()).toBe(true);
    });

    it('isRejected returns true when status is rejected', () => {
      const component = makeComponent();
      setStatus(component, 'rejected');
      expect(component.isRejected()).toBe(true);
    });
  });

  describe('statusIcon computed', () => {
    it('should return Terminal for pending status', () => {
      const component = makeComponent();
      setStatus(component, 'pending');
      expect(component.statusIcon()).toBe(component.Terminal);
    });

    it('should return Copy for inserted status', () => {
      const component = makeComponent();
      setStatus(component, 'inserted');
      expect(component.statusIcon()).toBe(component.Copy);
    });

    it('should return Check for executed status', () => {
      const component = makeComponent();
      setStatus(component, 'executed');
      expect(component.statusIcon()).toBe(component.Check);
    });

    it('should return X for rejected status', () => {
      const component = makeComponent();
      setStatus(component, 'rejected');
      expect(component.statusIcon()).toBe(component.X);
    });
  });

  describe('statusColor computed', () => {
    it('should return green for pending', () => {
      const component = makeComponent();
      setStatus(component, 'pending');
      expect(component.statusColor()).toBe('text-green-400');
    });

    it('should return blue for inserted', () => {
      const component = makeComponent();
      setStatus(component, 'inserted');
      expect(component.statusColor()).toBe('text-blue-400');
    });

    it('should return green for executed', () => {
      const component = makeComponent();
      setStatus(component, 'executed');
      expect(component.statusColor()).toBe('text-green-400');
    });

    it('should return zinc for rejected', () => {
      const component = makeComponent();
      setStatus(component, 'rejected');
      expect(component.statusColor()).toBe('text-zinc-500');
    });
  });

  describe('borderColor computed', () => {
    it('should return red border when isDangerous is true regardless of status', () => {
      const component = makeComponent();
      setStatus(component, 'pending');
      setIsDangerous(component, true);
      expect(component.borderColor()).toBe('border-red-500');
    });

    it('should return green border for pending non-dangerous', () => {
      const component = makeComponent();
      setStatus(component, 'pending');
      setIsDangerous(component, false);
      expect(component.borderColor()).toBe('border-green-500');
    });

    it('should return blue border for inserted', () => {
      const component = makeComponent();
      setStatus(component, 'inserted');
      setIsDangerous(component, false);
      expect(component.borderColor()).toBe('border-blue-500');
    });

    it('should return zinc border for rejected', () => {
      const component = makeComponent();
      setStatus(component, 'rejected');
      setIsDangerous(component, false);
      expect(component.borderColor()).toBe('border-zinc-600');
    });
  });

  describe('statusText computed', () => {
    it('should return empty string for pending', () => {
      const component = makeComponent();
      setStatus(component, 'pending');
      expect(component.statusText()).toBe('');
    });

    it('should return "Inserted" for inserted status', () => {
      const component = makeComponent();
      setStatus(component, 'inserted');
      expect(component.statusText()).toBe('Inserted');
    });

    it('should return "Executed" for executed status', () => {
      const component = makeComponent();
      setStatus(component, 'executed');
      expect(component.statusText()).toBe('Executed');
    });

    it('should return "Rejected" for rejected status', () => {
      const component = makeComponent();
      setStatus(component, 'rejected');
      expect(component.statusText()).toBe('Rejected');
    });
  });

  describe('hasAlternatives computed', () => {
    it('should return false when no alternatives', () => {
      const component = makeComponent();
      setAlternatives(component, []);
      expect(component.hasAlternatives()).toBe(false);
    });

    it('should return true when alternatives exist', () => {
      const component = makeComponent();
      setAlternatives(component, [{ command: 'docker ps -a', description: 'Show all' }]);
      expect(component.hasAlternatives()).toBe(true);
    });
  });

  describe('event emissions', () => {
    it('onInsert should emit the current command', () => {
      const component = makeComponent();
      setCommand(component, 'docker ps');
      const spy = vi.fn();
      component.insert.subscribe(spy);

      component.onInsert();

      expect(spy).toHaveBeenCalledWith('docker ps');
    });

    it('onExecute should emit the current command', () => {
      const component = makeComponent();
      setCommand(component, 'docker stop myapp');
      const spy = vi.fn();
      component.execute.subscribe(spy);

      component.onExecute();

      expect(spy).toHaveBeenCalledWith('docker stop myapp');
    });

    it('onReject should emit void', () => {
      const component = makeComponent();
      const spy = vi.fn();
      component.reject.subscribe(spy);

      component.onReject();

      expect(spy).toHaveBeenCalled();
    });

    it('onCopy should emit the current command', () => {
      const component = makeComponent();
      setCommand(component, 'docker info');
      const spy = vi.fn();
      component.copyCommand.subscribe(spy);

      component.onCopy();

      expect(spy).toHaveBeenCalledWith('docker info');
    });

    it('onToggleCollapse should emit toggleCollapse', () => {
      const component = makeComponent();
      const spy = vi.fn();
      component.toggleCollapse.subscribe(spy);

      component.onToggleCollapse();

      expect(spy).toHaveBeenCalled();
    });

    it('onInsertAlternative should emit the provided alternative command', () => {
      const component = makeComponent();
      const spy = vi.fn();
      component.insert.subscribe(spy);

      component.onInsertAlternative('docker ps -a');

      expect(spy).toHaveBeenCalledWith('docker ps -a');
    });

    it('onExecuteAlternative should emit the provided alternative command', () => {
      const component = makeComponent();
      const spy = vi.fn();
      component.execute.subscribe(spy);

      component.onExecuteAlternative('docker images');

      expect(spy).toHaveBeenCalledWith('docker images');
    });
  });

  describe('toggleAlternatives', () => {
    it('should toggle showAlternatives from false to true', () => {
      const component = makeComponent();
      expect(component.showAlternatives).toBe(false);

      component.toggleAlternatives();

      expect(component.showAlternatives).toBe(true);
    });

    it('should toggle showAlternatives back to false', () => {
      const component = makeComponent();
      component.showAlternatives = true;

      component.toggleAlternatives();

      expect(component.showAlternatives).toBe(false);
    });
  });

  describe('toggleAffectsFiles', () => {
    it('should toggle showAffectsFiles from false to true', () => {
      const component = makeComponent();
      expect(component.showAffectsFiles).toBe(false);

      component.toggleAffectsFiles();

      expect(component.showAffectsFiles).toBe(true);
    });

    it('should toggle showAffectsFiles back to false', () => {
      const component = makeComponent();
      component.showAffectsFiles = true;

      component.toggleAffectsFiles();

      expect(component.showAffectsFiles).toBe(false);
    });
  });
});
