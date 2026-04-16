import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Injector,
  runInInjectionContext,
  ɵChangeDetectionScheduler,
  ɵEffectScheduler,
} from '@angular/core';
import { CommandFormModalComponent } from './command-form-modal.component';
import { CommandTemplateState } from '../../../../state/command-template.state';
import type { CommandTemplate } from '../../../../core/models/command-template.model';

function makeComponent(commandStateOverrides: Partial<CommandTemplateState> = {}) {
  const mockCommandState: any = {
    createTemplate: vi.fn().mockResolvedValue({ id: 'new-1', name: 'Test' }),
    updateTemplate: vi.fn().mockResolvedValue({ id: 'edit-1', name: 'Edited' }),
    ...commandStateOverrides,
  };

  const injector = Injector.create({
    providers: [
      { provide: CommandTemplateState, useValue: mockCommandState },
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

  const component = runInInjectionContext(injector, () => new CommandFormModalComponent());
  return { component, mockCommandState };
}

const sampleTemplate: CommandTemplate = {
  id: 'tpl-1',
  name: 'My Template',
  description: 'Does stuff',
  command: 'docker ps ${CONTAINER_NAME}',
  category: 'container-management',
  tags: ['docker', 'list'],
  variables: [{ name: 'CONTAINER_NAME', description: 'Container', defaultValue: '', required: true }],
  compatibility: { runtimes: ['docker', 'podman'] },
  isFavorite: true,
  isBuiltIn: false,
  createdAt: '2024-01-01',
  updatedAt: '2024-01-02',
};

describe('CommandFormModalComponent', () => {
  describe('initial state (create mode)', () => {
    it('should create with empty form', () => {
      const { component } = makeComponent();
      expect(component).toBeTruthy();
      expect(component.form.name).toBe('');
      expect(component.form.command).toBe('');
      expect(component.form.description).toBe('');
    });

    it('should default category to custom', () => {
      const { component } = makeComponent();
      expect(component.form.category).toBe('custom');
    });

    it('should default runtimes all to false', () => {
      const { component } = makeComponent();
      expect(component.form.runtimes.docker).toBe(false);
      expect(component.form.runtimes.podman).toBe(false);
      expect(component.form.runtimes.apple).toBe(false);
    });

    it('should default isFavorite to false', () => {
      const { component } = makeComponent();
      expect(component.form.isFavorite).toBe(false);
    });

    it('should default detectedVariables to empty', () => {
      const { component } = makeComponent();
      expect(component.detectedVariables()).toEqual([]);
    });

    it('isEditing() should return false when no template input', () => {
      const { component } = makeComponent();
      expect(component.isEditing()).toBe(false);
    });
  });

  describe('ngOnInit with existing template (edit mode)', () => {
    it('should populate form fields from template', () => {
      const { component } = makeComponent();
      // Simulate input signal by setting directly for test
      (component as any).template = () => sampleTemplate;

      component.ngOnInit();

      expect(component.form.name).toBe('My Template');
      expect(component.form.description).toBe('Does stuff');
      expect(component.form.command).toBe('docker ps ${CONTAINER_NAME}');
    });

    it('should set runtimes from template compatibility', () => {
      const { component } = makeComponent();
      (component as any).template = () => sampleTemplate;

      component.ngOnInit();

      expect(component.form.runtimes.docker).toBe(true);
      expect(component.form.runtimes.podman).toBe(true);
      expect(component.form.runtimes.apple).toBe(false);
    });

    it('should join tags with comma-space separator', () => {
      const { component } = makeComponent();
      (component as any).template = () => sampleTemplate;

      component.ngOnInit();

      expect(component.form.tags).toBe('docker, list');
    });

    it('should copy variables from template', () => {
      const { component } = makeComponent();
      (component as any).template = () => sampleTemplate;

      component.ngOnInit();

      expect(component.form.variables.length).toBe(1);
      expect(component.form.variables[0].name).toBe('CONTAINER_NAME');
    });

    it('should set isFavorite from template', () => {
      const { component } = makeComponent();
      (component as any).template = () => sampleTemplate;

      component.ngOnInit();

      expect(component.form.isFavorite).toBe(true);
    });

    it('isEditing() should return true when template is provided', () => {
      const { component } = makeComponent();
      (component as any).template = () => sampleTemplate;

      expect(component.isEditing()).toBe(true);
    });
  });

  describe('detectVariables', () => {
    it('should detect variables from command string', () => {
      const { component } = makeComponent();
      component.form.command = 'docker run ${IMAGE_NAME} --name ${CONTAINER_NAME}';

      component.detectVariables();

      expect(component.detectedVariables()).toEqual(['IMAGE_NAME', 'CONTAINER_NAME']);
    });

    it('should sync variables array with detected variables', () => {
      const { component } = makeComponent();
      component.form.command = 'docker stop ${CONTAINER_NAME}';

      component.detectVariables();

      expect(component.form.variables.length).toBe(1);
      expect(component.form.variables[0].name).toBe('CONTAINER_NAME');
      expect(component.form.variables[0].required).toBe(true);
    });

    it('should preserve existing variable metadata when re-detecting', () => {
      const { component } = makeComponent();
      component.form.variables = [
        { name: 'CONTAINER_NAME', description: 'Existing desc', defaultValue: 'mycontainer', required: true },
      ];
      component.form.command = 'docker stop ${CONTAINER_NAME}';

      component.detectVariables();

      expect(component.form.variables[0].description).toBe('Existing desc');
      expect(component.form.variables[0].defaultValue).toBe('mycontainer');
    });

    it('should clear detected variables when command has none', () => {
      const { component } = makeComponent();
      component.form.command = 'docker ps';

      component.detectVariables();

      expect(component.detectedVariables()).toEqual([]);
      expect(component.form.variables).toEqual([]);
    });
  });

  describe('isValid', () => {
    it('should return false when form is empty', () => {
      const { component } = makeComponent();
      expect(component.isValid()).toBe(false);
    });

    it('should return true when name, description, and command are filled', () => {
      const { component } = makeComponent();
      component.form.name = 'My Command';
      component.form.description = 'A description';
      component.form.command = 'docker ps';
      expect(component.isValid()).toBe(true);
    });

    it('should return false when name is whitespace only', () => {
      const { component } = makeComponent();
      component.form.name = '   ';
      component.form.description = 'desc';
      component.form.command = 'cmd';
      expect(component.isValid()).toBe(false);
    });

    it('should return false when description is empty', () => {
      const { component } = makeComponent();
      component.form.name = 'Name';
      component.form.description = '';
      component.form.command = 'cmd';
      expect(component.isValid()).toBe(false);
    });

    it('should return false when command is empty', () => {
      const { component } = makeComponent();
      component.form.name = 'Name';
      component.form.description = 'Desc';
      component.form.command = '';
      expect(component.isValid()).toBe(false);
    });
  });

  describe('onSave (create mode)', () => {
    it('should not call createTemplate when form is invalid', async () => {
      const { component, mockCommandState } = makeComponent();

      await component.onSave();

      expect(mockCommandState.createTemplate).not.toHaveBeenCalled();
    });

    it('should call createTemplate with correct request when valid', async () => {
      const { component, mockCommandState } = makeComponent();
      component.form.name = 'My Cmd';
      component.form.description = 'Does stuff';
      component.form.command = 'docker ps';
      component.form.category = 'debugging';
      component.form.tags = 'a, b, c';
      component.form.runtimes = { docker: true, podman: false, apple: true };
      component.form.isFavorite = false;
      component.form.variables = [];

      const saveSpy = vi.fn();
      component.save.subscribe(saveSpy);

      await component.onSave();

      expect(mockCommandState.createTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My Cmd',
          description: 'Does stuff',
          command: 'docker ps',
          category: 'debugging',
          tags: ['a', 'b', 'c'],
          compatibility: { runtimes: ['docker', 'apple'] },
          isFavorite: false,
        })
      );
    });

    it('should emit save event after successful create', async () => {
      const { component } = makeComponent();
      component.form.name = 'Cmd';
      component.form.description = 'Desc';
      component.form.command = 'ls';

      const saveSpy = vi.fn();
      component.save.subscribe(saveSpy);

      await component.onSave();

      expect(saveSpy).toHaveBeenCalled();
    });

    it('should trim whitespace from name, description, and command', async () => {
      const { component, mockCommandState } = makeComponent();
      component.form.name = '  My Cmd  ';
      component.form.description = '  Does stuff  ';
      component.form.command = '  docker ps  ';

      await component.onSave();

      expect(mockCommandState.createTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My Cmd',
          description: 'Does stuff',
          command: 'docker ps',
        })
      );
    });
  });

  describe('onSave (edit mode)', () => {
    it('should call updateTemplate when editing', async () => {
      const { component, mockCommandState } = makeComponent();
      (component as any).template = () => sampleTemplate;
      component.form.name = 'Updated Name';
      component.form.description = 'Updated description';
      component.form.command = 'docker info';
      component.form.category = 'system';
      component.form.tags = '';
      component.form.runtimes = { docker: true, podman: false, apple: false };
      component.form.isFavorite = false;
      component.form.variables = [];

      await component.onSave();

      expect(mockCommandState.updateTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'tpl-1',
          name: 'Updated Name',
        })
      );
      expect(mockCommandState.createTemplate).not.toHaveBeenCalled();
    });
  });

  describe('onCancel', () => {
    it('should emit cancel event', () => {
      const { component } = makeComponent();
      const cancelSpy = vi.fn();
      component.cancel.subscribe(cancelSpy);

      component.onCancel();

      expect(cancelSpy).toHaveBeenCalled();
    });
  });
});
