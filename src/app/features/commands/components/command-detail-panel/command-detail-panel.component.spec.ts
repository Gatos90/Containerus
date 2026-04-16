import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext, ɵSIGNAL } from '@angular/core';
import { CommandDetailPanelComponent } from './command-detail-panel.component';
import type { CommandTemplate } from '../../../../core/models/command-template.model';
import type { ContainerRuntime } from '../../../../core/models/container.model';

/**
 * Set a signal-input value for unit testing.
 * Angular `input.required()` signals are read-only from the outside;
 * we poke the internal signal node directly.
 */
function setInputSignal<T>(signalFn: any, value: T): void {
  const node = signalFn[ɵSIGNAL as unknown as symbol] ?? signalFn[ɵSIGNAL];
  if (node) {
    node.value = value;
  } else {
    // Fallback: override as a plain function returning the value
    signalFn.__proto__ = null;
    Object.setPrototypeOf(signalFn, Function.prototype);
    (signalFn as any).value = value;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeTemplate = (overrides: Partial<CommandTemplate> = {}): CommandTemplate => ({
  id: 'tpl-1',
  name: 'Inspect Container',
  description: 'Inspect a running container',
  command: 'docker inspect ${CONTAINER_NAME}',
  category: 'container-management',
  tags: ['inspect', 'debug'],
  variables: [],
  compatibility: { runtimes: [] },
  isFavorite: false,
  isBuiltIn: false,
  createdAt: '2024-01-15T10:00:00Z',
  updatedAt: '2024-06-20T08:30:00Z',
  ...overrides,
});

/**
 * CommandDetailPanelComponent has no inject() dependencies – it uses
 * only signal inputs and outputs.  We still go through runInInjectionContext
 * for consistency with the project pattern.
 */
function makeComponent(template: CommandTemplate): CommandDetailPanelComponent {
  const injector = Injector.create({ providers: [] });
  const comp = runInInjectionContext(injector, () => new CommandDetailPanelComponent());
  // Set the required signal input by writing directly to the internal signal node
  setInputSignal(comp.template, template);
  return comp;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommandDetailPanelComponent', () => {
  let template: CommandTemplate;
  let component: CommandDetailPanelComponent;

  beforeEach(() => {
    template = makeTemplate();
    component = makeComponent(template);
  });

  // -------------------------------------------------------------------------
  // Icon constants
  // -------------------------------------------------------------------------

  describe('icon constants', () => {
    it('should expose icon references as truthy values', () => {
      expect(component.X).toBeTruthy();
      expect(component.Star).toBeTruthy();
      expect(component.Copy).toBeTruthy();
      expect(component.Trash2).toBeTruthy();
      expect(component.Edit).toBeTruthy();
      expect(component.Play).toBeTruthy();
      expect(component.Variable).toBeTruthy();
      expect(component.Globe).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // detectedVariables
  // -------------------------------------------------------------------------

  describe('detectedVariables', () => {
    it('should return variable names found in the command', () => {
      const comp = makeComponent(makeTemplate({ command: 'docker exec ${CONTAINER_NAME} ${SHELL}' }));
      expect(comp.detectedVariables).toContain('CONTAINER_NAME');
      expect(comp.detectedVariables).toContain('SHELL');
    });

    it('should return empty array when command has no variables', () => {
      const comp = makeComponent(makeTemplate({ command: 'docker ps' }));
      expect(comp.detectedVariables).toEqual([]);
    });

    it('should not return duplicates for repeated variables', () => {
      const comp = makeComponent(
        makeTemplate({ command: 'docker stop ${CONTAINER_NAME} && docker rm ${CONTAINER_NAME}' })
      );
      const vars = comp.detectedVariables;
      expect(vars.filter((v) => v === 'CONTAINER_NAME').length).toBe(1);
    });

    it('should only match uppercase variable names', () => {
      const comp = makeComponent(makeTemplate({ command: 'echo ${lowercase} ${UPPER_CASE}' }));
      expect(comp.detectedVariables).toContain('UPPER_CASE');
      expect(comp.detectedVariables).not.toContain('lowercase');
    });
  });

  // -------------------------------------------------------------------------
  // getRuntimeIcon
  // -------------------------------------------------------------------------

  describe('getRuntimeIcon', () => {
    it('should return Ship icon for docker', () => {
      expect(component.getRuntimeIcon('docker' as ContainerRuntime)).toBe(component.Ship);
    });

    it('should return Container icon for podman', () => {
      expect(component.getRuntimeIcon('podman' as ContainerRuntime)).toBe(component.Container);
    });

    it('should return Apple icon for apple', () => {
      expect(component.getRuntimeIcon('apple' as ContainerRuntime)).toBe(component.Apple);
    });

    it('should return Container icon for unknown runtimes', () => {
      expect(component.getRuntimeIcon('unknown' as ContainerRuntime)).toBe(component.Container);
    });
  });

  // -------------------------------------------------------------------------
  // formatDate
  // -------------------------------------------------------------------------

  describe('formatDate', () => {
    it('should return a non-empty localised date string', () => {
      const result = component.formatDate('2024-01-15T10:00:00Z');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should include the year 2024 in the formatted string', () => {
      const result = component.formatDate('2024-06-20T08:30:00Z');
      expect(result).toContain('2024');
    });

    it('should produce different strings for different dates', () => {
      const d1 = component.formatDate('2024-01-01T00:00:00Z');
      const d2 = component.formatDate('2025-12-31T00:00:00Z');
      expect(d1).not.toBe(d2);
    });
  });

  // -------------------------------------------------------------------------
  // getCategoryLabel / getCategoryIcon / getRuntimeLabel
  // -------------------------------------------------------------------------

  describe('utility function references', () => {
    it('getCategoryLabel should return Container Management for container-management', () => {
      expect(component.getCategoryLabel('container-management')).toBe('Container Management');
    });

    it('getCategoryLabel should return Debugging for debugging', () => {
      expect(component.getCategoryLabel('debugging')).toBe('Debugging');
    });

    it('getCategoryIcon should return a non-empty string for container-management', () => {
      expect(component.getCategoryIcon('container-management')).toBeTruthy();
    });

    it('getRuntimeLabel should return Docker for docker', () => {
      expect(component.getRuntimeLabel('docker' as ContainerRuntime)).toBe('Docker');
    });

    it('getRuntimeLabel should return Podman for podman', () => {
      expect(component.getRuntimeLabel('podman' as ContainerRuntime)).toBe('Podman');
    });
  });

  // -------------------------------------------------------------------------
  // output event emitters
  // -------------------------------------------------------------------------

  describe('onToggleFavorite', () => {
    it('should emit the current template via toggleFavorite output', () => {
      const spy = vi.fn();
      component.toggleFavorite.subscribe(spy);
      component.onToggleFavorite();
      expect(spy).toHaveBeenCalledWith(template);
    });
  });

  describe('onEdit', () => {
    it('should emit the current template via edit output', () => {
      const spy = vi.fn();
      component.edit.subscribe(spy);
      component.onEdit();
      expect(spy).toHaveBeenCalledWith(template);
    });
  });

  describe('onDuplicate', () => {
    it('should emit the current template via duplicate output', () => {
      const spy = vi.fn();
      component.duplicate.subscribe(spy);
      component.onDuplicate();
      expect(spy).toHaveBeenCalledWith(template);
    });
  });

  describe('onDelete', () => {
    it('should emit the current template via delete output', () => {
      const spy = vi.fn();
      component.delete.subscribe(spy);
      component.onDelete();
      expect(spy).toHaveBeenCalledWith(template);
    });
  });

  describe('close output', () => {
    it('should emit via close output when subscribed', () => {
      // close is void output – just verify the subscription works
      const spy = vi.fn();
      component.close.subscribe(spy);
      // The close output is emitted from the template; test that the EventEmitter
      // is wired and subscribable (component exposes it as a signal-output)
      component.close.emit();
      expect(spy).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // template input signal
  // -------------------------------------------------------------------------

  describe('template input signal', () => {
    it('should return the template set as input', () => {
      expect(component.template()).toEqual(template);
    });

    it('should reflect a changed template after updating the input', () => {
      const newTemplate = makeTemplate({ id: 'tpl-99', name: 'New Command' });
      setInputSignal(component.template,newTemplate);
      expect(component.template().id).toBe('tpl-99');
      expect(component.template().name).toBe('New Command');
    });

    it('should reflect isFavorite state from template', () => {
      const favTemplate = makeTemplate({ isFavorite: true });
      setInputSignal(component.template,favTemplate);
      expect(component.template().isFavorite).toBe(true);
    });

    it('should reflect isBuiltIn state from template', () => {
      const builtIn = makeTemplate({ isBuiltIn: true });
      setInputSignal(component.template,builtIn);
      expect(component.template().isBuiltIn).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // detectedVariables vs defined variables interaction
  // -------------------------------------------------------------------------

  describe('detectedVariables with defined variables', () => {
    it('should still parse variables from command even when template.variables is populated', () => {
      const comp = makeComponent(
        makeTemplate({
          command: 'docker exec ${CONTAINER_NAME} sh',
          variables: [{ name: 'CONTAINER_NAME', description: 'Container', required: true }],
        })
      );
      // detectedVariables always parses the command regardless
      expect(comp.detectedVariables).toContain('CONTAINER_NAME');
    });
  });

  // -------------------------------------------------------------------------
  // Compatibility – runtime coverage
  // -------------------------------------------------------------------------

  describe('getRuntimeIcon coverage', () => {
    const runtimes: ContainerRuntime[] = ['docker', 'podman', 'apple'];

    for (const runtime of runtimes) {
      it(`should return a truthy icon for runtime: ${runtime}`, () => {
        expect(component.getRuntimeIcon(runtime)).toBeTruthy();
      });
    }
  });
});
