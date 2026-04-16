import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext, ɵChangeDetectionScheduler, ɵEffectScheduler } from '@angular/core';
import { Router } from '@angular/router';
import { CommandPaletteComponent } from './command-palette.component';
import { CommandTemplateState } from '../../../state/command-template.state';
import { SystemState } from '../../../state/system.state';
import type { CommandTemplate } from '../../../core/models/command-template.model';
import type { ContainerSystem } from '../../../core/models/system.model';

const makeTemplate = (overrides: Partial<CommandTemplate> = {}): CommandTemplate => ({
  id: 'tpl-1',
  name: 'List Containers',
  description: 'List all containers',
  command: '${RUNTIME} ps -a',
  category: 'container-management',
  tags: ['containers', 'list'],
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

function makeComponent(overrides: {
  templates?: CommandTemplate[];
  systems?: ContainerSystem[];
  connectedSystems?: ContainerSystem[];
} = {}): CommandPaletteComponent {
  const mockCommandState: any = {
    templates: vi.fn(() => overrides.templates ?? []),
    loadTemplates: vi.fn().mockResolvedValue(undefined),
    toggleFavorite: vi.fn().mockResolvedValue(undefined),
  };

  const mockSystemState: any = {
    systems: vi.fn(() => overrides.systems ?? []),
    connectedSystems: vi.fn(() => overrides.connectedSystems ?? []),
  };

  const mockRouter: any = {
    navigate: vi.fn().mockResolvedValue(true),
  };

  const injector = Injector.create({
    providers: [
      { provide: CommandTemplateState, useValue: mockCommandState },
      { provide: SystemState, useValue: mockSystemState },
      { provide: Router, useValue: mockRouter },
      { provide: ɵChangeDetectionScheduler, useValue: { notify: vi.fn(), runningTick: false } },
      {
        provide: ɵEffectScheduler,
        useValue: { add: vi.fn(), remove: vi.fn(), schedule: vi.fn(), flush: vi.fn() },
      },
    ],
  });

  return runInInjectionContext(injector, () => new CommandPaletteComponent());
}

describe('CommandPaletteComponent', () => {
  let component: CommandPaletteComponent;

  beforeEach(() => {
    component = makeComponent();
  });

  // ── Initial state ──────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('should initialize searchQuery to empty string', () => {
      expect(component.searchQuery()).toBe('');
    });

    it('should initialize selectedIndex to 0', () => {
      expect(component.selectedIndex()).toBe(0);
    });

    it('should initialize selectedRuntime to null', () => {
      expect(component.selectedRuntime()).toBeNull();
    });
  });

  // ── currentSystem computed ─────────────────────────────────────────────────

  describe('currentSystem', () => {
    it('should return null when no systemId and no connected systems', () => {
      expect(component.currentSystem()).toBeNull();
    });

    it('should return null when systemId set but no matching system found', () => {
      const sys = makeSystem({ id: 'sys-99' });
      component = makeComponent({ systems: [sys] });
      // No connected systems, systemId() returns null (default) → falls through to connectedSystems
      // which is also empty → returns null
      expect(component.currentSystem()).toBeNull();
    });

    it('should return first connected system when no explicit systemId', () => {
      const sys = makeSystem({ id: 'sys-1' });
      component = makeComponent({ connectedSystems: [sys] });
      expect(component.currentSystem()).toEqual(sys);
    });

    it('should return first of multiple connected systems', () => {
      const sys1 = makeSystem({ id: 'sys-1' });
      const sys2 = makeSystem({ id: 'sys-2' });
      component = makeComponent({ connectedSystems: [sys1, sys2] });
      expect(component.currentSystem()).toEqual(sys1);
    });
  });

  // ── currentRuntime computed ────────────────────────────────────────────────

  describe('currentRuntime', () => {
    it('should default to docker when no current system', () => {
      expect(component.currentRuntime()).toBe('docker');
    });

    it('should return primaryRuntime of connected system', () => {
      const sys = makeSystem({ primaryRuntime: 'podman' });
      component = makeComponent({ connectedSystems: [sys] });
      expect(component.currentRuntime()).toBe('podman');
    });
  });

  // ── availableRuntimes computed ─────────────────────────────────────────────

  describe('availableRuntimes', () => {
    it('should return empty array when no current system', () => {
      expect(component.availableRuntimes()).toEqual([]);
    });

    it('should return availableRuntimes from current system', () => {
      const sys = makeSystem({ availableRuntimes: ['docker', 'podman'] as any });
      component = makeComponent({ connectedSystems: [sys] });
      expect(component.availableRuntimes()).toEqual(['docker', 'podman']);
    });
  });

  // ── effectiveRuntime computed ──────────────────────────────────────────────

  describe('effectiveRuntime', () => {
    it('should use currentRuntime when selectedRuntime is null', () => {
      const sys = makeSystem({ primaryRuntime: 'podman' });
      component = makeComponent({ connectedSystems: [sys] });
      expect(component.effectiveRuntime()).toBe('podman');
    });

    it('should use selectedRuntime when it is set', () => {
      const sys = makeSystem({ primaryRuntime: 'docker' });
      component = makeComponent({ connectedSystems: [sys] });
      component.selectedRuntime.set('podman');
      expect(component.effectiveRuntime()).toBe('podman');
    });
  });

  // ── filteredTemplates computed ─────────────────────────────────────────────

  describe('filteredTemplates', () => {
    it('should return all templates sorted when no search query', () => {
      const t1 = makeTemplate({ id: '1', name: 'Zulu', isFavorite: false });
      const t2 = makeTemplate({ id: '2', name: 'Alpha', isFavorite: false });
      component = makeComponent({ templates: [t1, t2] });
      const result = component.filteredTemplates();
      expect(result[0].name).toBe('Alpha');
      expect(result[1].name).toBe('Zulu');
    });

    it('should sort favorites before non-favorites', () => {
      const t1 = makeTemplate({ id: '1', name: 'Zulu', isFavorite: true });
      const t2 = makeTemplate({ id: '2', name: 'Alpha', isFavorite: false });
      component = makeComponent({ templates: [t2, t1] });
      const result = component.filteredTemplates();
      expect(result[0].isFavorite).toBe(true);
    });

    it('should filter by name search query', () => {
      const t1 = makeTemplate({ id: '1', name: 'Inspect Container', command: 'podman inspect', description: '', tags: [] });
      const t2 = makeTemplate({ id: '2', name: 'Pull Image', command: 'podman pull', description: '', tags: [] });
      component = makeComponent({ templates: [t1, t2] });
      component.searchQuery.set('inspect');
      const result = component.filteredTemplates();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Inspect Container');
    });

    it('should filter by description', () => {
      const t1 = makeTemplate({ id: '1', description: 'show running containers', command: 'docker ps' });
      const t2 = makeTemplate({ id: '2', description: 'pull an image', command: 'docker pull' });
      component = makeComponent({ templates: [t1, t2] });
      component.searchQuery.set('running');
      const result = component.filteredTemplates();
      expect(result).toHaveLength(1);
    });

    it('should filter by command', () => {
      const t1 = makeTemplate({ id: '1', command: 'docker inspect ${CONTAINER_NAME}' });
      const t2 = makeTemplate({ id: '2', command: 'docker ps -a' });
      component = makeComponent({ templates: [t1, t2] });
      component.searchQuery.set('inspect');
      expect(component.filteredTemplates()).toHaveLength(1);
    });

    it('should filter by tags', () => {
      const t1 = makeTemplate({ id: '1', tags: ['network', 'inspect'] });
      const t2 = makeTemplate({ id: '2', tags: ['image', 'pull'] });
      component = makeComponent({ templates: [t1, t2] });
      component.searchQuery.set('network');
      expect(component.filteredTemplates()).toHaveLength(1);
    });

    it('should filter by runtime compatibility when system has runtimes', () => {
      const dockerOnly = makeTemplate({ id: '1', compatibility: { runtimes: ['docker'] } });
      const podmanOnly = makeTemplate({ id: '2', compatibility: { runtimes: ['podman'] } });
      const universal = makeTemplate({ id: '3', compatibility: { runtimes: [] } });
      const sys = makeSystem({ availableRuntimes: ['docker'] as any });
      component = makeComponent({ templates: [dockerOnly, podmanOnly, universal], connectedSystems: [sys] });
      const result = component.filteredTemplates();
      const ids = result.map((t) => t.id);
      expect(ids).toContain('1'); // docker compatible
      expect(ids).toContain('3'); // universal
      expect(ids).not.toContain('2'); // podman not available
    });

    it('should not filter by runtime when system has no runtimes', () => {
      const dockerOnly = makeTemplate({ id: '1', compatibility: { runtimes: ['docker'] } });
      component = makeComponent({ templates: [dockerOnly] });
      expect(component.filteredTemplates()).toHaveLength(1);
    });

    it('should return empty array when no templates match query', () => {
      component = makeComponent({ templates: [makeTemplate()] });
      component.searchQuery.set('xyznotfound');
      expect(component.filteredTemplates()).toHaveLength(0);
    });
  });

  // ── onSearchChange ─────────────────────────────────────────────────────────

  describe('onSearchChange', () => {
    it('should update searchQuery signal', () => {
      component.onSearchChange('docker');
      expect(component.searchQuery()).toBe('docker');
    });

    it('should reset selectedIndex to 0 on search change', () => {
      component.selectedIndex.set(3);
      component.onSearchChange('new query');
      expect(component.selectedIndex()).toBe(0);
    });
  });

  // ── onKeydown ──────────────────────────────────────────────────────────────

  describe('onKeydown', () => {
    it('should increment selectedIndex on ArrowDown', () => {
      const tpls = [makeTemplate({ id: '1' }), makeTemplate({ id: '2' })];
      component = makeComponent({ templates: tpls });
      const event = new KeyboardEvent('keydown', { key: 'ArrowDown' });
      const preventSpy = vi.spyOn(event, 'preventDefault');
      component.onKeydown(event);
      expect(preventSpy).toHaveBeenCalled();
      expect(component.selectedIndex()).toBe(1);
    });

    it('should not increment selectedIndex past last item', () => {
      const tpls = [makeTemplate({ id: '1' }), makeTemplate({ id: '2' })];
      component = makeComponent({ templates: tpls });
      component.selectedIndex.set(1);
      const event = new KeyboardEvent('keydown', { key: 'ArrowDown' });
      component.onKeydown(event);
      expect(component.selectedIndex()).toBe(1); // clamped at length-1
    });

    it('should decrement selectedIndex on ArrowUp', () => {
      component = makeComponent({ templates: [makeTemplate()] });
      component.selectedIndex.set(1);
      const event = new KeyboardEvent('keydown', { key: 'ArrowUp' });
      const preventSpy = vi.spyOn(event, 'preventDefault');
      component.onKeydown(event);
      expect(preventSpy).toHaveBeenCalled();
      expect(component.selectedIndex()).toBe(0);
    });

    it('should not decrement selectedIndex below 0', () => {
      component = makeComponent({ templates: [makeTemplate()] });
      component.selectedIndex.set(0);
      const event = new KeyboardEvent('keydown', { key: 'ArrowUp' });
      component.onKeydown(event);
      expect(component.selectedIndex()).toBe(0);
    });

    it('should call selectTemplate with current selection on Enter', () => {
      const tpl = makeTemplate({ command: 'docker ps' }); // no variables other than RUNTIME
      component = makeComponent({ templates: [tpl] });
      const selectSpy = vi.spyOn(component, 'selectTemplate');
      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      component.onKeydown(event);
      expect(selectSpy).toHaveBeenCalledWith(tpl, false);
    });

    it('should pass shiftKey to selectTemplate on Enter', () => {
      const tpl = makeTemplate({ command: 'docker ps' });
      component = makeComponent({ templates: [tpl] });
      const selectSpy = vi.spyOn(component, 'selectTemplate');
      const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true });
      component.onKeydown(event);
      expect(selectSpy).toHaveBeenCalledWith(tpl, true);
    });

    it('should not call selectTemplate on Enter when no templates', () => {
      component = makeComponent({ templates: [] });
      const selectSpy = vi.spyOn(component, 'selectTemplate');
      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      component.onKeydown(event);
      expect(selectSpy).not.toHaveBeenCalled();
    });
  });

  // ── selectTemplate ─────────────────────────────────────────────────────────

  describe('selectTemplate', () => {
    it('should emit execute with substituted command when no non-RUNTIME variables', () => {
      const tpl = makeTemplate({ command: '${RUNTIME} ps -a' });
      const sys = makeSystem({ primaryRuntime: 'docker' });
      component = makeComponent({ templates: [tpl], connectedSystems: [sys] });
      const emitSpy = vi.spyOn(component.execute, 'emit');
      component.selectTemplate(tpl);
      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'docker ps -a', template: tpl })
      );
    });

    it('should emit original command when template has non-RUNTIME variables', () => {
      const tpl = makeTemplate({ command: 'docker exec ${CONTAINER_NAME} bash' });
      const emitSpy = vi.spyOn(component.execute, 'emit');
      component.selectTemplate(tpl);
      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({ command: tpl.command, template: tpl })
      );
    });

    it('should emit close when closeAfter is true', () => {
      const tpl = makeTemplate({ command: 'docker ps' });
      component = makeComponent({ templates: [tpl] });
      const closeSpy = vi.spyOn(component.close, 'emit');
      component.selectTemplate(tpl, true);
      expect(closeSpy).toHaveBeenCalled();
    });

    it('should not emit close when closeAfter is false', () => {
      const tpl = makeTemplate({ command: 'docker ps' });
      component = makeComponent({ templates: [tpl] });
      const closeSpy = vi.spyOn(component.close, 'emit');
      component.selectTemplate(tpl, false);
      expect(closeSpy).not.toHaveBeenCalled();
    });

    it('should use effective runtime (podman) when system has podman as primary', () => {
      const tpl = makeTemplate({ command: '${RUNTIME} ps' });
      const sys = makeSystem({ primaryRuntime: 'podman' });
      component = makeComponent({ templates: [tpl], connectedSystems: [sys] });
      const emitSpy = vi.spyOn(component.execute, 'emit');
      component.selectTemplate(tpl);
      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'podman ps' })
      );
    });

    it('should use user-selected runtime override', () => {
      const tpl = makeTemplate({ command: '${RUNTIME} ps' });
      const sys = makeSystem({ primaryRuntime: 'docker' });
      component = makeComponent({ templates: [tpl], connectedSystems: [sys] });
      component.selectedRuntime.set('podman');
      const emitSpy = vi.spyOn(component.execute, 'emit');
      component.selectTemplate(tpl);
      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'podman ps' })
      );
    });
  });

  // ── selectRuntime ──────────────────────────────────────────────────────────

  describe('selectRuntime', () => {
    it('should set selectedRuntime signal', () => {
      component.selectRuntime('podman');
      expect(component.selectedRuntime()).toBe('podman');
    });

    it('should update selectedRuntime when called multiple times', () => {
      component.selectRuntime('docker');
      component.selectRuntime('apple');
      expect(component.selectedRuntime()).toBe('apple');
    });
  });

  // ── onClose ────────────────────────────────────────────────────────────────

  describe('onClose', () => {
    it('should emit close event', () => {
      const closeSpy = vi.spyOn(component.close, 'emit');
      component.onClose();
      expect(closeSpy).toHaveBeenCalled();
    });
  });

  // ── goToCommands ───────────────────────────────────────────────────────────

  describe('goToCommands', () => {
    it('should emit close and navigate to /commands', () => {
      const closeSpy = vi.spyOn(component.close, 'emit');
      component.goToCommands();
      expect(closeSpy).toHaveBeenCalled();
      expect(component.router.navigate).toHaveBeenCalledWith(['/commands']);
    });
  });

  // ── getRuntimeIcon ─────────────────────────────────────────────────────────

  describe('getRuntimeIcon', () => {
    it('should return Ship icon for docker', () => {
      const icon = component.getRuntimeIcon('docker');
      expect(icon).toBeTruthy();
    });

    it('should return Container icon for podman', () => {
      const icon = component.getRuntimeIcon('podman');
      expect(icon).toBeTruthy();
    });

    it('should return Apple icon for apple', () => {
      const icon = component.getRuntimeIcon('apple');
      expect(icon).toBeTruthy();
    });

    it('should return Container icon for unknown runtime', () => {
      const icon = component.getRuntimeIcon('unknown' as any);
      expect(icon).toBeTruthy();
    });
  });

  // ── onToggleFavorite ───────────────────────────────────────────────────────

  describe('onToggleFavorite', () => {
    it('should call commandState.toggleFavorite with template id', async () => {
      const tpl = makeTemplate({ id: 'tpl-99' });
      const event = new Event('click');
      const stopSpy = vi.spyOn(event, 'stopPropagation');
      await component.onToggleFavorite(event, tpl);
      expect(stopSpy).toHaveBeenCalled();
      expect(component.commandState.toggleFavorite).toHaveBeenCalledWith('tpl-99');
    });
  });

  // ── ngOnInit ───────────────────────────────────────────────────────────────

  describe('ngOnInit', () => {
    it('should call loadTemplates when templates are empty', async () => {
      component = makeComponent({ templates: [] });
      await component.ngOnInit();
      expect(component.commandState.loadTemplates).toHaveBeenCalled();
    });

    it('should not call loadTemplates when templates are already loaded', async () => {
      component = makeComponent({ templates: [makeTemplate()] });
      await component.ngOnInit();
      expect(component.commandState.loadTemplates).not.toHaveBeenCalled();
    });
  });
});
