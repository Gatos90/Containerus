import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext, ɵChangeDetectionScheduler, ɵEffectScheduler } from '@angular/core';
import { VariableInputModalComponent } from './variable-input-modal.component';
import { ContainerState } from '../../../state/container.state';
import { ImageState } from '../../../state/image.state';
import { VolumeState } from '../../../state/volume.state';
import { NetworkState } from '../../../state/network.state';
import { SystemState } from '../../../state/system.state';
import type { CommandTemplate } from '../../../core/models/command-template.model';
import type { ContainerSystem } from '../../../core/models/system.model';

const makeTemplate = (overrides: Partial<CommandTemplate> = {}): CommandTemplate => ({
  id: 'tpl-1',
  name: 'Test Template',
  description: 'A test template',
  command: 'docker ps',
  category: 'container-management',
  tags: [],
  variables: [],
  compatibility: { runtimes: [] },
  isFavorite: false,
  isBuiltIn: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  ...overrides,
});

const makeSystem = (overrides: Partial<ContainerSystem> = {}): ContainerSystem => ({
  id: 'sys-1',
  name: 'Test Server',
  host: 'localhost',
  port: 22,
  username: 'user',
  primaryRuntime: 'docker',
  availableRuntimes: ['docker'],
  authMethod: 'password',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  ...overrides,
} as ContainerSystem);

interface MakeOptions {
  template?: CommandTemplate;
  command?: string;
  systemId?: string | null;
  containers?: any[];
  images?: any[];
  volumes?: any[];
  networks?: any[];
  systems?: ContainerSystem[];
  connectedSystems?: ContainerSystem[];
}

function makeComponent(opts: MakeOptions = {}): VariableInputModalComponent {
  const {
    template = makeTemplate(),
    command = 'docker ps',
    systemId = null,
    containers = [],
    images = [],
    volumes = [],
    networks = [],
    systems = [],
    connectedSystems = [],
  } = opts;

  const mockContainerState: any = {
    containers: vi.fn(() => containers),
  };

  const mockImageState: any = {
    images: vi.fn(() => images),
  };

  const mockVolumeState: any = {
    volumes: vi.fn(() => volumes),
  };

  const mockNetworkState: any = {
    networks: vi.fn(() => networks),
  };

  const mockSystemState: any = {
    systems: vi.fn(() => systems),
    connectedSystems: vi.fn(() => connectedSystems),
  };

  const injector = Injector.create({
    providers: [
      { provide: ContainerState, useValue: mockContainerState },
      { provide: ImageState, useValue: mockImageState },
      { provide: VolumeState, useValue: mockVolumeState },
      { provide: NetworkState, useValue: mockNetworkState },
      { provide: SystemState, useValue: mockSystemState },
      { provide: ɵChangeDetectionScheduler, useValue: { notify: vi.fn(), runningTick: false } },
      {
        provide: ɵEffectScheduler,
        useValue: { add: vi.fn(), remove: vi.fn(), schedule: vi.fn(), flush: vi.fn() },
      },
    ],
  });

  const comp = runInInjectionContext(injector, () => new VariableInputModalComponent());

  // Simulate required inputs by overriding the signal functions
  (comp as any).template = vi.fn(() => template);
  (comp as any).command = vi.fn(() => command);
  (comp as any).systemId = vi.fn(() => systemId);

  return comp;
}

describe('VariableInputModalComponent', () => {
  // ── ngOnInit / initializeVariables ────────────────────────────────────────

  describe('ngOnInit / variable initialization', () => {
    it('should initialize empty variables for a command with no placeholders', () => {
      const comp = makeComponent({ command: 'docker ps -a' });
      comp.ngOnInit();
      expect(comp.variables()).toEqual([]);
    });

    it('should parse variables from command', () => {
      const comp = makeComponent({ command: 'docker exec ${CONTAINER_NAME} bash' });
      comp.ngOnInit();
      expect(comp.variables()).toHaveLength(1);
      expect(comp.variables()[0].name).toBe('CONTAINER_NAME');
    });

    it('should auto-fill RUNTIME variable from connected system', () => {
      const sys = makeSystem({ primaryRuntime: 'podman' });
      const comp = makeComponent({
        command: '${RUNTIME} ps',
        connectedSystems: [sys],
      });
      comp.ngOnInit();
      const runtimeVar = comp.variables().find((v) => v.name === 'RUNTIME');
      expect(runtimeVar?.value).toBe('podman');
    });

    it('should default RUNTIME to docker when no system is connected', () => {
      const comp = makeComponent({ command: '${RUNTIME} ps' });
      comp.ngOnInit();
      const runtimeVar = comp.variables().find((v) => v.name === 'RUNTIME');
      expect(runtimeVar?.value).toBe('docker');
    });

    it('should use templateVar defaultValue when available', () => {
      const template = makeTemplate({
        variables: [{ name: 'SHELL', description: 'Shell', defaultValue: '/bin/bash', required: true }],
      });
      const comp = makeComponent({ template, command: 'docker exec ${CONTAINER_NAME} ${SHELL}' });
      comp.ngOnInit();
      const shellVar = comp.variables().find((v) => v.name === 'SHELL');
      expect(shellVar?.value).toBe('/bin/bash');
    });

    it('should mark required=true by default when no template var', () => {
      const comp = makeComponent({ command: 'docker exec ${CONTAINER_NAME} bash' });
      comp.ngOnInit();
      expect(comp.variables()[0].required).toBe(true);
    });

    it('should respect required=false from template variable', () => {
      const template = makeTemplate({
        variables: [{ name: 'FLAGS', description: 'Extra flags', required: false }],
      });
      const comp = makeComponent({ template, command: 'docker ps ${FLAGS}' });
      comp.ngOnInit();
      const flagVar = comp.variables().find((v) => v.name === 'FLAGS');
      expect(flagVar?.required).toBe(false);
    });

    it('should include container suggestions for CONTAINER_NAME', () => {
      const comp = makeComponent({
        command: 'docker exec ${CONTAINER_NAME} bash',
        containers: [
          { id: 'abc123def456', name: 'my-app' },
          { id: 'xyz789', name: '' },
        ],
      });
      comp.ngOnInit();
      const v = comp.variables()[0];
      expect(v.suggestions).toContain('my-app');
    });

    it('should include image suggestions for IMAGE_NAME', () => {
      const comp = makeComponent({
        command: 'docker run ${IMAGE_NAME}',
        images: [{ repository: 'nginx', tag: 'latest' }],
      });
      comp.ngOnInit();
      const v = comp.variables()[0];
      expect(v.suggestions).toContain('nginx:latest');
    });

    it('should include volume suggestions for VOLUME_NAME', () => {
      const comp = makeComponent({
        command: 'docker run -v ${VOLUME_NAME}:/data nginx',
        volumes: [{ name: 'my-vol' }],
      });
      comp.ngOnInit();
      const v = comp.variables()[0];
      expect(v.suggestions).toContain('my-vol');
    });

    it('should include network suggestions for NETWORK_NAME', () => {
      const comp = makeComponent({
        command: 'docker network inspect ${NETWORK_NAME}',
        networks: [{ name: 'bridge' }],
      });
      comp.ngOnInit();
      const v = comp.variables()[0];
      expect(v.suggestions).toContain('bridge');
    });

    it('should include system id suggestions for SYSTEM_ID', () => {
      const sys = makeSystem({ id: 'sys-42' });
      const comp = makeComponent({
        command: 'some-command ${SYSTEM_ID}',
        connectedSystems: [sys],
      });
      comp.ngOnInit();
      const v = comp.variables()[0];
      expect(v.suggestions).toContain('sys-42');
    });

    it('should deduplicate variable names in command', () => {
      const comp = makeComponent({ command: 'docker exec ${CONTAINER_NAME} echo ${CONTAINER_NAME}' });
      comp.ngOnInit();
      expect(comp.variables()).toHaveLength(1);
    });
  });

  // ── previewCommand computed ────────────────────────────────────────────────

  describe('previewCommand', () => {
    it('should show command as-is when no variables', () => {
      const comp = makeComponent({ command: 'docker ps -a' });
      comp.ngOnInit();
      expect(comp.previewCommand()).toBe('docker ps -a');
    });

    it('should substitute filled variable values into preview', () => {
      const comp = makeComponent({ command: 'docker exec ${CONTAINER_NAME} bash' });
      comp.ngOnInit();
      comp.updateValue(0, 'my-container');
      expect(comp.previewCommand()).toBe('docker exec my-container bash');
    });

    it('should leave unfilled placeholders in preview', () => {
      const comp = makeComponent({ command: 'docker exec ${CONTAINER_NAME} bash' });
      comp.ngOnInit();
      // value is empty, so the placeholder remains
      expect(comp.previewCommand()).toContain('${CONTAINER_NAME}');
    });
  });

  // ── isValid computed ───────────────────────────────────────────────────────

  describe('isValid', () => {
    it('should be true when there are no variables', () => {
      const comp = makeComponent({ command: 'docker ps' });
      comp.ngOnInit();
      expect(comp.isValid()).toBe(true);
    });

    it('should be false when required variable is empty', () => {
      const comp = makeComponent({ command: 'docker exec ${CONTAINER_NAME} bash' });
      comp.ngOnInit();
      expect(comp.isValid()).toBe(false);
    });

    it('should be true when required variable has value', () => {
      const comp = makeComponent({ command: 'docker exec ${CONTAINER_NAME} bash' });
      comp.ngOnInit();
      comp.updateValue(0, 'my-container');
      expect(comp.isValid()).toBe(true);
    });

    it('should be true when optional variable is empty', () => {
      const template = makeTemplate({
        variables: [{ name: 'FLAGS', description: 'flags', required: false }],
      });
      const comp = makeComponent({ template, command: 'docker ps ${FLAGS}' });
      comp.ngOnInit();
      expect(comp.isValid()).toBe(true);
    });

    it('should return false when required value is only whitespace', () => {
      const comp = makeComponent({ command: 'docker exec ${CONTAINER_NAME} bash' });
      comp.ngOnInit();
      comp.updateValue(0, '   ');
      expect(comp.isValid()).toBe(false);
    });
  });

  // ── updateValue ────────────────────────────────────────────────────────────

  describe('updateValue', () => {
    it('should update the value of the variable at the given index', () => {
      const comp = makeComponent({ command: 'docker exec ${CONTAINER_NAME} bash' });
      comp.ngOnInit();
      comp.updateValue(0, 'my-app');
      expect(comp.variables()[0].value).toBe('my-app');
    });

    it('should not mutate other variable entries', () => {
      const comp = makeComponent({ command: 'docker exec ${CONTAINER_NAME} ${SHELL}' });
      comp.ngOnInit();
      comp.updateValue(0, 'container-a');
      expect(comp.variables()[1].value).toBe('');
    });
  });

  // ── onExecute ─────────────────────────────────────────────────────────────

  describe('onExecute', () => {
    it('should emit execute with substituted command when valid', () => {
      const comp = makeComponent({ command: 'docker exec ${CONTAINER_NAME} bash' });
      comp.ngOnInit();
      comp.updateValue(0, 'my-app');
      const emitSpy = vi.spyOn(comp.execute, 'emit');
      comp.onExecute();
      expect(emitSpy).toHaveBeenCalledWith('docker exec my-app bash');
    });

    it('should not emit when form is invalid', () => {
      const comp = makeComponent({ command: 'docker exec ${CONTAINER_NAME} bash' });
      comp.ngOnInit();
      const emitSpy = vi.spyOn(comp.execute, 'emit');
      comp.onExecute();
      expect(emitSpy).not.toHaveBeenCalled();
    });
  });

  // ── onCancel ───────────────────────────────────────────────────────────────

  describe('onCancel', () => {
    it('should emit cancel event', () => {
      const comp = makeComponent();
      const emitSpy = vi.spyOn(comp.cancel, 'emit');
      comp.onCancel();
      expect(emitSpy).toHaveBeenCalled();
    });
  });

  // ── onKeydown ─────────────────────────────────────────────────────────────

  describe('onKeydown', () => {
    it('should call onExecute when Ctrl+Enter is pressed', () => {
      const comp = makeComponent({ command: 'docker ps' });
      comp.ngOnInit();
      const executeSpy = vi.spyOn(comp, 'onExecute');
      const event = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true });
      const preventSpy = vi.spyOn(event, 'preventDefault');
      comp.onKeydown(event);
      expect(preventSpy).toHaveBeenCalled();
      expect(executeSpy).toHaveBeenCalled();
    });

    it('should call onExecute when Meta+Enter is pressed', () => {
      const comp = makeComponent({ command: 'docker ps' });
      comp.ngOnInit();
      const executeSpy = vi.spyOn(comp, 'onExecute');
      const event = new KeyboardEvent('keydown', { key: 'Enter', metaKey: true });
      comp.onKeydown(event);
      expect(executeSpy).toHaveBeenCalled();
    });

    it('should not call onExecute for regular Enter key', () => {
      const comp = makeComponent({ command: 'docker ps' });
      comp.ngOnInit();
      const executeSpy = vi.spyOn(comp, 'onExecute');
      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      comp.onKeydown(event);
      expect(executeSpy).not.toHaveBeenCalled();
    });
  });

  // ── RUNTIME suggestions ────────────────────────────────────────────────────

  describe('RUNTIME suggestions', () => {
    it('should suggest runtimes from the current system', () => {
      const sys = makeSystem({ availableRuntimes: ['docker', 'podman'] as any });
      const comp = makeComponent({
        command: '${RUNTIME} ps',
        connectedSystems: [sys],
      });
      comp.ngOnInit();
      const runtimeVar = comp.variables().find((v) => v.name === 'RUNTIME');
      expect(runtimeVar?.suggestions).toContain('docker');
      expect(runtimeVar?.suggestions).toContain('podman');
    });

    it('should suggest default docker/podman when no system connected', () => {
      const comp = makeComponent({ command: '${RUNTIME} ps' });
      comp.ngOnInit();
      const runtimeVar = comp.variables().find((v) => v.name === 'RUNTIME');
      expect(runtimeVar?.suggestions).toContain('docker');
      expect(runtimeVar?.suggestions).toContain('podman');
    });
  });
});
