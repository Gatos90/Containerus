import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Injector,
  runInInjectionContext,
  ɵChangeDetectionScheduler,
  ɵEffectScheduler,
} from '@angular/core';
import { CommandCardComponent } from './command-card.component';
import type { CommandTemplate } from '../../../../core/models/command-template.model';
import { Ship, Container, Apple } from 'lucide-angular';

function makeTemplate(overrides: Partial<CommandTemplate> = {}): CommandTemplate {
  return {
    id: 'tpl-1',
    name: 'List Containers',
    description: 'List all running containers',
    command: 'docker ps',
    category: 'container-management',
    tags: ['containers', 'docker'],
    variables: [],
    compatibility: { runtimes: ['docker'] },
    isFavorite: false,
    isBuiltIn: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeComponent(): CommandCardComponent {
  // CommandCardComponent uses input() signal-based inputs — needs injection context
  const injector = Injector.create({
    providers: [
      {
        provide: ɵChangeDetectionScheduler,
        useValue: { notify: vi.fn(), runningTick: false },
      },
      {
        provide: ɵEffectScheduler,
        useValue: { add: vi.fn(), remove: vi.fn(), schedule: vi.fn(), flush: vi.fn() },
      },
    ],
  });
  return runInInjectionContext(injector, () => new CommandCardComponent());
}

/** Helper to set signal-based inputs on the component */
function setInputs(
  comp: CommandCardComponent,
  tpl: CommandTemplate,
  selected = false
): void {
  // Angular signal inputs are not directly settable from outside in unit tests,
  // but we can access the underlying signal via the property descriptor trick.
  // The InputSignal is a function — we call it with the value via internal API.
  // Simplest approach: cast to any and set via prototype chain knowledge.
  (comp as any).template = vi.fn().mockReturnValue(tpl) as any;
  (comp as any).selected = vi.fn().mockReturnValue(selected) as any;
}

describe('CommandCardComponent', () => {
  let component: CommandCardComponent;
  let template: CommandTemplate;

  beforeEach(() => {
    component = makeComponent();
    template = makeTemplate();
    setInputs(component, template);
  });

  describe('showMenu state', () => {
    it('should initialize showMenu as false', () => {
      expect(component.showMenu).toBe(false);
    });
  });

  describe('toggleMenu', () => {
    it('should set showMenu to true when currently false', () => {
      const event = new MouseEvent('click');
      const stopPropagationSpy = vi.spyOn(event, 'stopPropagation');

      component.toggleMenu(event);

      expect(stopPropagationSpy).toHaveBeenCalled();
      expect(component.showMenu).toBe(true);
    });

    it('should set showMenu to false when currently true', () => {
      component.showMenu = true;
      const event = new MouseEvent('click');
      vi.spyOn(event, 'stopPropagation');

      component.toggleMenu(event);

      expect(component.showMenu).toBe(false);
    });

    it('should call stopPropagation on event', () => {
      const event = new MouseEvent('click');
      const stopPropagationSpy = vi.spyOn(event, 'stopPropagation');

      component.toggleMenu(event);

      expect(stopPropagationSpy).toHaveBeenCalled();
    });
  });

  describe('closeMenu', () => {
    it('should set showMenu to false', () => {
      component.showMenu = true;
      component.closeMenu();
      expect(component.showMenu).toBe(false);
    });

    it('should remain false when already false', () => {
      component.closeMenu();
      expect(component.showMenu).toBe(false);
    });
  });

  describe('onToggleFavorite', () => {
    it('should call stopPropagation on event', () => {
      const event = new MouseEvent('click');
      const stopSpy = vi.spyOn(event, 'stopPropagation');

      component.onToggleFavorite(event);

      expect(stopSpy).toHaveBeenCalled();
    });

    it('should emit toggleFavorite with the template', () => {
      const emitted: CommandTemplate[] = [];
      component.toggleFavorite.subscribe((t) => emitted.push(t));

      const event = new MouseEvent('click');
      component.onToggleFavorite(event);

      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toEqual(template);
    });
  });

  describe('onEdit', () => {
    it('should close the menu', () => {
      component.showMenu = true;
      component.onEdit();
      expect(component.showMenu).toBe(false);
    });

    it('should emit edit with the template', () => {
      const emitted: CommandTemplate[] = [];
      component.edit.subscribe((t) => emitted.push(t));

      component.onEdit();

      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toEqual(template);
    });
  });

  describe('onDuplicate', () => {
    it('should close the menu', () => {
      component.showMenu = true;
      component.onDuplicate();
      expect(component.showMenu).toBe(false);
    });

    it('should emit duplicate with the template', () => {
      const emitted: CommandTemplate[] = [];
      component.duplicate.subscribe((t) => emitted.push(t));

      component.onDuplicate();

      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toEqual(template);
    });
  });

  describe('onDelete', () => {
    it('should close the menu', () => {
      component.showMenu = true;
      component.onDelete();
      expect(component.showMenu).toBe(false);
    });

    it('should emit delete with the template', () => {
      const emitted: CommandTemplate[] = [];
      component.delete.subscribe((t) => emitted.push(t));

      component.onDelete();

      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toEqual(template);
    });
  });

  describe('getRuntimeIcon', () => {
    it('should return Ship for docker runtime', () => {
      expect(component.getRuntimeIcon('docker')).toBe(Ship);
    });

    it('should return Container for podman runtime', () => {
      expect(component.getRuntimeIcon('podman')).toBe(Container);
    });

    it('should return Apple for apple runtime', () => {
      expect(component.getRuntimeIcon('apple')).toBe(Apple);
    });

    it('should return Container for unknown runtime', () => {
      expect(component.getRuntimeIcon('unknown' as any)).toBe(Container);
    });
  });

  describe('getCategoryIcon', () => {
    it('should return icon name for container-management', () => {
      const icon = component.getCategoryIcon('container-management');
      expect(icon).toBe('package');
    });

    it('should return icon name for debugging', () => {
      const icon = component.getCategoryIcon('debugging');
      expect(icon).toBe('bug');
    });
  });

  describe('getRuntimeLabel', () => {
    it('should return "Docker" for docker', () => {
      expect(component.getRuntimeLabel('docker')).toBe('Docker');
    });

    it('should return "Podman" for podman', () => {
      expect(component.getRuntimeLabel('podman')).toBe('Podman');
    });

    it('should return "Apple" for apple', () => {
      expect(component.getRuntimeLabel('apple')).toBe('Apple');
    });
  });

  describe('icon properties', () => {
    it('should expose all required icon references', () => {
      expect(component.Star).toBeDefined();
      expect(component.Copy).toBeDefined();
      expect(component.Trash2).toBeDefined();
      expect(component.Edit).toBeDefined();
      expect(component.MoreHorizontal).toBeDefined();
      expect(component.Ship).toBeDefined();
      expect(component.Container).toBeDefined();
      expect(component.Apple).toBeDefined();
      expect(component.Lock).toBeDefined();
    });
  });

  describe('multiple emit calls', () => {
    it('should emit toggleFavorite multiple times', () => {
      const emitted: CommandTemplate[] = [];
      component.toggleFavorite.subscribe((t) => emitted.push(t));

      const event = new MouseEvent('click');
      component.onToggleFavorite(event);
      component.onToggleFavorite(event);

      expect(emitted).toHaveLength(2);
    });

    it('should emit edit and duplicate independently', () => {
      const edited: CommandTemplate[] = [];
      const duplicated: CommandTemplate[] = [];
      component.edit.subscribe((t) => edited.push(t));
      component.duplicate.subscribe((t) => duplicated.push(t));

      component.onEdit();
      component.onDuplicate();

      expect(edited).toHaveLength(1);
      expect(duplicated).toHaveLength(1);
    });
  });
});
