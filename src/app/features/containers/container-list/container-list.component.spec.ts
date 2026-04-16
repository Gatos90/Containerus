import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { ContainerListComponent } from './container-list.component';
import { ContainerState } from '../../../state/container.state';
import { SystemState } from '../../../state/system.state';
import { PortForwardState } from '../../../state/port-forward.state';
import { ToastState } from '../../../state/toast.state';
import { TerminalState } from '../../../state/terminal.state';
import { TerminalService } from '../../../core/services/terminal.service';
import type { Container } from '../../../core/models/container.model';

const makeContainer = (overrides: Partial<Container> = {}): Container =>
  ({
    id: 'c-1',
    name: '/test-container',
    image: 'nginx:latest',
    status: 'running',
    runtime: 'docker',
    systemId: 'sys-1',
    createdAt: '2024-01-01T00:00:00Z',
    ports: [],
    volumes: [],
    networks: [],
    labels: {},
    env: [],
    networkSettings: { networks: {}, portBindings: [] },
    ...overrides,
  } as Container);

function makeComponent(): ContainerListComponent {
  const mockContainerState: any = {
    filteredContainers: vi.fn(() => []),
    loadContainersForSystems: vi.fn().mockResolvedValue(undefined),
    performAction: vi.fn().mockResolvedValue(true),
    setStatusFilter: vi.fn(),
  };

  const mockSystemState: any = {
    connectedSystems: vi.fn(() => []),
    systems: vi.fn(() => []),
  };

  const mockPortForwardState: any = {
    activeForwards: vi.fn(() => []),
  };

  const mockToastState: any = {
    success: vi.fn(),
    error: vi.fn(),
  };

  const mockTerminalState: any = {
    addTerminal: vi.fn(),
    addFileBrowser: vi.fn(),
    generateTerminalId: vi.fn(() => 'term-1'),
    generateFileBrowserId: vi.fn(() => 'fb-1'),
  };

  const mockTerminalService: any = {
    startSession: vi.fn().mockResolvedValue({ id: 'sess-1' }),
  };

  const injector = Injector.create({
    providers: [
      { provide: ContainerState, useValue: mockContainerState },
      { provide: SystemState, useValue: mockSystemState },
      { provide: PortForwardState, useValue: mockPortForwardState },
      { provide: ToastState, useValue: mockToastState },
      { provide: TerminalState, useValue: mockTerminalState },
      { provide: TerminalService, useValue: mockTerminalService },
    ],
  });

  return runInInjectionContext(injector, () => new ContainerListComponent());
}

describe('ContainerListComponent', () => {
  let component: ContainerListComponent;

  beforeEach(() => {
    component = makeComponent();
  });

  describe('initial state', () => {
    it('should initialize viewMode signal to grid', () => {
      expect(component.viewMode()).toBe('grid');
    });

    it('should initialize expandedContainerId signal to null', () => {
      expect(component.expandedContainerId()).toBeNull();
    });

    it('should initialize modalContainer signal to null', () => {
      expect(component.modalContainer()).toBeNull();
    });

    it('should initialize logsContainer signal to null', () => {
      expect(component.logsContainer()).toBeNull();
    });

    it('should initialize showMobileFilters signal to false', () => {
      expect(component.showMobileFilters()).toBe(false);
    });

    it('should initialize confirmAction signal to null', () => {
      expect(component.confirmAction()).toBeNull();
    });
  });

  describe('isRefreshing', () => {
    it('should return false initially', () => {
      expect(component.isRefreshing()).toBe(false);
    });
  });

  describe('refresh', () => {
    it('should call loadContainersForSystems with connected system ids', async () => {
      component.systemState.connectedSystems = vi.fn(() => [
        { id: 'sys-1' } as any,
        { id: 'sys-2' } as any,
      ]);
      await component.refresh();
      expect(component.containerState.loadContainersForSystems).toHaveBeenCalledWith(['sys-1', 'sys-2']);
    });

    it('should set refreshing to false after completion', async () => {
      await component.refresh();
      expect(component.isRefreshing()).toBe(false);
    });

    it('should set refreshing to false even when loadContainersForSystems throws', async () => {
      component.containerState.loadContainersForSystems = vi.fn().mockRejectedValue(new Error('fail'));
      await expect(component.refresh()).rejects.toThrow('fail');
      expect(component.isRefreshing()).toBe(false);
    });

    it('should call loadContainersForSystems with empty array when no systems connected', async () => {
      await component.refresh();
      expect(component.containerState.loadContainersForSystems).toHaveBeenCalledWith([]);
    });
  });

  describe('setStoppedFilter', () => {
    it('should call setStatusFilter with exited', () => {
      component.setStoppedFilter();
      expect(component.containerState.setStatusFilter).toHaveBeenCalledWith('exited');
    });
  });

  describe('performAction', () => {
    it('should set confirmAction for destructive stop action', async () => {
      const container = makeContainer();
      await component.performAction(container, 'stop');
      expect(component.confirmAction()).toEqual({ container, action: 'stop' });
    });

    it('should set confirmAction for destructive remove action', async () => {
      const container = makeContainer();
      await component.performAction(container, 'remove');
      expect(component.confirmAction()).toEqual({ container, action: 'remove' });
    });

    it('should directly execute non-destructive start action', async () => {
      const container = makeContainer({ status: 'exited' });
      await component.performAction(container, 'start');
      expect(component.containerState.performAction).toHaveBeenCalledWith(container, 'start');
      expect(component.confirmAction()).toBeNull();
    });

    it('should directly execute non-destructive restart action', async () => {
      const container = makeContainer();
      await component.performAction(container, 'restart');
      expect(component.containerState.performAction).toHaveBeenCalledWith(container, 'restart');
    });

    it('should show success toast after successful non-destructive action', async () => {
      const container = makeContainer({ name: '/myapp' });
      component.containerState.performAction = vi.fn().mockResolvedValue(true);
      await component.performAction(container, 'start');
      expect((component as any).toast.success).toHaveBeenCalled();
    });

    it('should show error toast when action fails', async () => {
      const container = makeContainer();
      component.containerState.performAction = vi.fn().mockResolvedValue(false);
      await component.performAction(container, 'restart');
      expect((component as any).toast.error).toHaveBeenCalled();
    });
  });

  describe('confirmAndExecute', () => {
    it('should do nothing when confirmAction is null', async () => {
      await component.confirmAndExecute();
      expect(component.containerState.performAction).not.toHaveBeenCalled();
    });

    it('should execute the pending action and clear confirmAction', async () => {
      const container = makeContainer();
      component.confirmAction.set({ container, action: 'stop' });
      await component.confirmAndExecute();
      expect(component.containerState.performAction).toHaveBeenCalledWith(container, 'stop');
      expect(component.confirmAction()).toBeNull();
    });

    it('should show success toast after confirmed action succeeds', async () => {
      const container = makeContainer();
      component.containerState.performAction = vi.fn().mockResolvedValue(true);
      component.confirmAction.set({ container, action: 'remove' });
      await component.confirmAndExecute();
      expect((component as any).toast.success).toHaveBeenCalled();
    });

    it('should show error toast after confirmed action fails', async () => {
      const container = makeContainer();
      component.containerState.performAction = vi.fn().mockResolvedValue(false);
      component.confirmAction.set({ container, action: 'stop' });
      await component.confirmAndExecute();
      expect((component as any).toast.error).toHaveBeenCalled();
    });
  });

  describe('cancelAction', () => {
    it('should clear confirmAction signal', () => {
      component.confirmAction.set({ container: makeContainer(), action: 'stop' });
      component.cancelAction();
      expect(component.confirmAction()).toBeNull();
    });
  });

  describe('showLogs / closeLogs', () => {
    it('should set logsContainer to given container', () => {
      const container = makeContainer();
      component.showLogs(container);
      expect(component.logsContainer()).toBe(container);
    });

    it('should set logsContainer to null on closeLogs', () => {
      component.logsContainer.set(makeContainer());
      component.closeLogs();
      expect(component.logsContainer()).toBeNull();
    });
  });

  describe('toggleDetails', () => {
    it('should expand container when none is expanded', () => {
      const container = makeContainer({ id: 'c-1' });
      component.toggleDetails(container);
      expect(component.expandedContainerId()).toBe('c-1');
    });

    it('should collapse container when it is already expanded', () => {
      const container = makeContainer({ id: 'c-1' });
      component.expandedContainerId.set('c-1');
      component.toggleDetails(container);
      expect(component.expandedContainerId()).toBeNull();
    });

    it('should switch expanded container when a different container is expanded', () => {
      component.expandedContainerId.set('c-2');
      const container = makeContainer({ id: 'c-1' });
      component.toggleDetails(container);
      expect(component.expandedContainerId()).toBe('c-1');
    });
  });

  describe('openModal / closeModal', () => {
    it('should set modalContainer on openModal', () => {
      const container = makeContainer();
      component.openModal(container);
      expect(component.modalContainer()).toBe(container);
    });

    it('should clear modalContainer on closeModal', () => {
      component.modalContainer.set(makeContainer());
      component.closeModal();
      expect(component.modalContainer()).toBeNull();
    });
  });

  describe('dockTerminal', () => {
    it('should do nothing when system is not found', async () => {
      component.systemState.systems = vi.fn(() => []);
      await component.dockTerminal(makeContainer({ systemId: 'sys-99' }));
      expect((component as any).terminalService.startSession).not.toHaveBeenCalled();
    });

    it('should start session and add terminal for known system', async () => {
      component.systemState.systems = vi.fn(() => [
        { id: 'sys-1', name: 'My Server' } as any,
      ]);
      const container = makeContainer({ id: 'c-1', systemId: 'sys-1' });
      await component.dockTerminal(container);
      expect((component as any).terminalService.startSession).toHaveBeenCalledWith('sys-1', 'c-1');
      expect((component as any).terminalState.addTerminal).toHaveBeenCalled();
    });

    it('should show error toast when terminal start throws', async () => {
      component.systemState.systems = vi.fn(() => [
        { id: 'sys-1', name: 'My Server' } as any,
      ]);
      (component as any).terminalService.startSession = vi
        .fn()
        .mockRejectedValue(new Error('connection refused'));
      await component.dockTerminal(makeContainer({ systemId: 'sys-1' }));
      expect((component as any).toast.error).toHaveBeenCalledWith(
        expect.stringContaining('connection refused')
      );
    });

    it('should include container name in addTerminal call', async () => {
      component.systemState.systems = vi.fn(() => [
        { id: 'sys-1', name: 'Prod Server' } as any,
      ]);
      const container = makeContainer({ id: 'c-1', systemId: 'sys-1', name: '/webapp' });
      await component.dockTerminal(container);
      const call = (component as any).terminalState.addTerminal.mock.calls[0][0];
      expect(call.systemName).toBe('Prod Server');
      expect(call.systemId).toBe('sys-1');
    });
  });

  describe('dockFileBrowser', () => {
    it('should do nothing when system is not found', () => {
      component.systemState.systems = vi.fn(() => []);
      component.dockFileBrowser(makeContainer({ systemId: 'sys-99' }));
      expect((component as any).terminalState.addFileBrowser).not.toHaveBeenCalled();
    });

    it('should call addFileBrowser for known system', () => {
      component.systemState.systems = vi.fn(() => [
        { id: 'sys-1', name: 'My Server' } as any,
      ]);
      const container = makeContainer({ id: 'c-1', systemId: 'sys-1', runtime: 'docker' });
      component.dockFileBrowser(container);
      expect((component as any).terminalState.addFileBrowser).toHaveBeenCalled();
    });

    it('should include correct containerId in file browser config', () => {
      component.systemState.systems = vi.fn(() => [
        { id: 'sys-1', name: 'My Server' } as any,
      ]);
      const container = makeContainer({ id: 'c-42', systemId: 'sys-1', runtime: 'docker' });
      component.dockFileBrowser(container);
      const call = (component as any).terminalState.addFileBrowser.mock.calls[0][0];
      expect(call.containerId).toBe('c-42');
      expect(call.systemName).toBe('My Server');
      expect(call.currentPath).toBe('/');
    });
  });

  describe('containersWithForwards computed', () => {
    it('should return empty array when no active forwards', () => {
      component.portForwardState.activeForwards = vi.fn(() => []);
      expect(component.containersWithForwards()).toEqual([]);
    });

    it('should return containers matching active forward containerIds', () => {
      const container = makeContainer({ id: 'c-1' });
      component.portForwardState.activeForwards = vi.fn(() => [
        { containerId: 'c-1', status: 'active' } as any,
      ]);
      component.containerState.filteredContainers = vi.fn(() => [container]);
      const result = component.containersWithForwards();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('c-1');
    });

    it('should exclude containers without active forwards', () => {
      const c1 = makeContainer({ id: 'c-1' });
      const c2 = makeContainer({ id: 'c-2' });
      component.portForwardState.activeForwards = vi.fn(() => [
        { containerId: 'c-1', status: 'active' } as any,
      ]);
      component.containerState.filteredContainers = vi.fn(() => [c1, c2]);
      const result = component.containersWithForwards();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('c-1');
    });
  });

  describe('ngOnInit', () => {
    it('should call refresh on init', async () => {
      const refreshSpy = vi.spyOn(component, 'refresh').mockResolvedValue(undefined);
      await component.ngOnInit();
      expect(refreshSpy).toHaveBeenCalled();
    });
  });

  describe('toast message formatting', () => {
    it('should format past tense correctly for action ending in e (remove -> removed)', async () => {
      const container = makeContainer();
      component.containerState.performAction = vi.fn().mockResolvedValue(true);
      component.confirmAction.set({ container, action: 'remove' });
      await component.confirmAndExecute();
      const call = (component as any).toast.success.mock.calls[0][0] as string;
      expect(call).toMatch(/removed/i);
    });

    it('should format past tense correctly for action not ending in e (start -> started)', async () => {
      const container = makeContainer();
      component.containerState.performAction = vi.fn().mockResolvedValue(true);
      await component.performAction(container, 'start');
      const call = (component as any).toast.success.mock.calls[0][0] as string;
      expect(call).toMatch(/started/i);
    });
  });
});
