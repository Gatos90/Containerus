import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { setupTestBed } from '@analogjs/vitest-angular/setup-testbed';
import { ContainerListComponent, Workload } from './container-list.component';

setupTestBed();
import { ContainerState } from '../../../state/container.state';
import { SystemState } from '../../../state/system.state';
import { PortForwardState } from '../../../state/port-forward.state';
import { ToastState } from '../../../state/toast.state';
import { TerminalState } from '../../../state/terminal.state';
import { TerminalService } from '../../../core/services/terminal.service';
import { BackendService } from '../../../core/services/backend.service';
import { Container } from '../../../core/models/container.model';
import { K8sPod } from '../../../core/models/backend.model';

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'c-1',
    name: 'test-container',
    image: 'nginx:latest',
    status: 'running',
    runtime: 'docker',
    systemId: 'sys-1',
    createdAt: '2024-01-01T00:00:00Z',
    ports: [],
    volumes: [],
    networks: [],
    labels: {},
    networkSettings: { networks: {} },
    ...overrides,
  } as Container;
}

function makePod(overrides: Partial<K8sPod> = {}): K8sPod {
  return {
    name: 'my-pod',
    namespace: 'default',
    status: 'Running',
    containerNames: ['nginx'],
    ...overrides,
  } as K8sPod;
}

describe('ContainerListComponent', () => {
  let component: ContainerListComponent;

  const mockContainerState = {
    containers: signal<Container[]>([]),
    filteredContainers: signal<Container[]>([]),
    stats: signal({ total: 0, running: 0, stopped: 0, paused: 0 }),
    searchQuery: signal(''),
    statusFilter: signal(null),
    runtimeFilter: signal(null),
    systemFilter: signal(null),
    sortOption: signal('name'),
    loadContainersForSystems: vi.fn().mockResolvedValue(undefined),
    setRuntimeFilter: vi.fn(),
    setSystemFilter: vi.fn(),
    setStatusFilter: vi.fn(),
    performAction: vi.fn().mockResolvedValue(true),
  };

  const mockSystemState = {
    systems: signal([]),
    connectedSystems: signal([]),
  };

  const mockPortForwardState = {
    activeForwards: signal([]),
    isPortForwarded: vi.fn().mockReturnValue(false),
    getForward: vi.fn().mockReturnValue(null),
  };

  const mockToastState = {
    success: vi.fn(),
    error: vi.fn(),
  };

  const mockTerminalState = {
    addTerminal: vi.fn(),
    generateTerminalId: vi.fn().mockReturnValue('term-1'),
    addFileBrowser: vi.fn(),
    generateFileBrowserId: vi.fn().mockReturnValue('fb-1'),
  };

  const mockTerminalService = {
    startSession: vi.fn().mockResolvedValue({ id: 'session-1', systemId: 'sys-1' }),
    startK8sExecSession: vi.fn().mockResolvedValue({ id: 'session-1', systemId: '' }),
  };

  const mockBackendService = {
    connectedBackends: signal([]),
    waitForReady: vi.fn().mockResolvedValue(undefined),
    listAllClustersFor: vi.fn().mockResolvedValue([]),
    listNamespacesFor: vi.fn().mockResolvedValue([]),
    listPodsFor: vi.fn().mockResolvedValue([]),
    getK8sResourceFor: vi.fn().mockResolvedValue({}),
    deleteK8sResourceFor: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      imports: [ContainerListComponent],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        { provide: ContainerState, useValue: mockContainerState },
        { provide: SystemState, useValue: mockSystemState },
        { provide: PortForwardState, useValue: mockPortForwardState },
        { provide: ToastState, useValue: mockToastState },
        { provide: TerminalState, useValue: mockTerminalState },
        { provide: TerminalService, useValue: mockTerminalService },
        { provide: BackendService, useValue: mockBackendService },
      ],
    });
    const fixture = TestBed.createComponent(ContainerListComponent);
    component = fixture.componentInstance;
  });

  describe('getRuntimeIcon', () => {
    it('returns Ship icon for docker', () => {
      const icon = component.getRuntimeIcon('docker');
      expect(icon).toBeDefined();
    });

    it('returns Box icon for podman', () => {
      const icon = component.getRuntimeIcon('podman');
      expect(icon).toBeDefined();
    });

    it('returns Apple icon for apple runtime', () => {
      const icon = component.getRuntimeIcon('apple');
      expect(icon).toBeDefined();
    });

    it('returns Cloud icon for kubernetes', () => {
      const icon = component.getRuntimeIcon('kubernetes');
      expect(icon).toBeDefined();
    });

    it('returns Box icon for unknown runtime', () => {
      const icon = component.getRuntimeIcon('unknown');
      expect(icon).toBeDefined();
    });
  });

  describe('getRuntimeColor', () => {
    it('returns blue for docker', () => {
      expect(component.getRuntimeColor('docker')).toContain('blue');
    });

    it('returns indigo for podman', () => {
      expect(component.getRuntimeColor('podman')).toContain('indigo');
    });

    it('returns zinc for apple', () => {
      expect(component.getRuntimeColor('apple')).toContain('zinc');
    });

    it('returns purple for kubernetes', () => {
      expect(component.getRuntimeColor('kubernetes')).toContain('purple');
    });

    it('returns zinc-500 for unknown runtime', () => {
      expect(component.getRuntimeColor('unknown')).toBe('text-zinc-500');
    });
  });

  describe('runtimeLabel', () => {
    it('returns human-readable label for known runtimes', () => {
      expect(component.runtimeLabel('docker')).toBe('Docker');
      expect(component.runtimeLabel('podman')).toBe('Podman');
      expect(component.runtimeLabel('apple')).toBe('Apple');
      expect(component.runtimeLabel('kubernetes')).toBe('Kubernetes');
    });

    it('returns the raw value for unknown runtimes', () => {
      expect(component.runtimeLabel('custom')).toBe('custom');
    });
  });

  describe('trackWorkload', () => {
    it('returns container id for container workloads', () => {
      const workload: Workload = { kind: 'container', container: makeContainer({ id: 'c-42' }) };
      expect(component.trackWorkload(0, workload)).toBe('c-42');
    });

    it('returns pod key for pod workloads', () => {
      const workload: Workload = {
        kind: 'pod',
        pod: makePod({ name: 'my-pod', namespace: 'production' }),
        clusterName: 'prod-cluster',
        clusterId: 'cluster-1',
        connectionId: 'conn-1',
      };
      const key = component.trackWorkload(0, workload);
      expect(key).toContain('pod:');
      expect(key).toContain('my-pod');
      expect(key).toContain('production');
    });
  });

  describe('getPodKey', () => {
    it('returns a unique key from connection/cluster/namespace/pod', () => {
      const workload: Workload & { kind: 'pod' } = {
        kind: 'pod',
        pod: makePod({ name: 'my-pod', namespace: 'default' }),
        clusterName: 'cluster-1',
        clusterId: 'cl-1',
        connectionId: 'conn-1',
      };
      expect(component.getPodKey(workload)).toBe('conn-1/cl-1/default/my-pod');
    });
  });

  describe('getPodStatusClass', () => {
    it('returns green class for Running', () => {
      expect(component.getPodStatusClass('Running')).toContain('green');
    });

    it('returns yellow class for Pending', () => {
      expect(component.getPodStatusClass('Pending')).toContain('yellow');
    });

    it('returns red class for Failed', () => {
      expect(component.getPodStatusClass('Failed')).toContain('red');
    });

    it('returns blue class for Succeeded', () => {
      expect(component.getPodStatusClass('Succeeded')).toContain('blue');
    });

    it('returns zinc class for unknown status', () => {
      expect(component.getPodStatusClass('Unknown')).toContain('zinc');
    });
  });

  describe('getPodStatusDot', () => {
    it('returns green dot for Running', () => {
      expect(component.getPodStatusDot('Running')).toContain('green');
    });

    it('returns yellow dot for Pending', () => {
      expect(component.getPodStatusDot('Pending')).toContain('yellow');
    });

    it('returns red dot for Failed', () => {
      expect(component.getPodStatusDot('Failed')).toContain('red');
    });

    it('returns blue dot for Succeeded', () => {
      expect(component.getPodStatusDot('Succeeded')).toContain('blue');
    });
  });

  describe('getPodStatusTextClass', () => {
    it('returns green text for Running', () => {
      expect(component.getPodStatusTextClass('Running')).toContain('green');
    });

    it('returns yellow text for Pending', () => {
      expect(component.getPodStatusTextClass('Pending')).toContain('yellow');
    });

    it('returns red text for Failed', () => {
      expect(component.getPodStatusTextClass('Failed')).toContain('red');
    });

    it('returns blue text for Succeeded', () => {
      expect(component.getPodStatusTextClass('Succeeded')).toContain('blue');
    });
  });

  describe('toggleRuntimeDropdown', () => {
    it('toggles the dropdown from false to true', () => {
      expect(component.showRuntimeDropdown()).toBe(false);
      component.toggleRuntimeDropdown();
      expect(component.showRuntimeDropdown()).toBe(true);
    });

    it('toggles the dropdown from true to false', () => {
      component.toggleRuntimeDropdown();
      component.toggleRuntimeDropdown();
      expect(component.showRuntimeDropdown()).toBe(false);
    });
  });

  describe('selectRuntimeFilter', () => {
    it('sets the runtime filter and closes the dropdown', () => {
      component.toggleRuntimeDropdown(); // open it
      component.selectRuntimeFilter('docker');
      expect(mockContainerState.setRuntimeFilter).toHaveBeenCalledWith('docker');
      expect(component.showRuntimeDropdown()).toBe(false);
    });
  });

  describe('toggleSystemDropdown', () => {
    it('toggles the system dropdown', () => {
      expect(component.showSystemDropdown()).toBe(false);
      component.toggleSystemDropdown();
      expect(component.showSystemDropdown()).toBe(true);
    });
  });

  describe('selectSystemFilter', () => {
    it('sets the system filter and closes the dropdown', () => {
      component.toggleSystemDropdown();
      component.selectSystemFilter('sys-1');
      expect(mockContainerState.setSystemFilter).toHaveBeenCalledWith('sys-1');
      expect(component.showSystemDropdown()).toBe(false);
    });
  });

  describe('cancelAction', () => {
    it('clears the pending confirmation', () => {
      const container = makeContainer();
      component.confirmAction.set({ container, action: 'stop' });
      component.cancelAction();
      expect(component.confirmAction()).toBeNull();
    });
  });

  describe('showLogs / closeLogs', () => {
    it('sets and clears logsContainer', () => {
      const container = makeContainer();
      component.showLogs(container);
      expect(component.logsContainer()).toBe(container);
      component.closeLogs();
      expect(component.logsContainer()).toBeNull();
    });
  });

  describe('openModal / closeModal', () => {
    it('sets and clears modalContainer', () => {
      const container = makeContainer();
      component.openModal(container);
      expect(component.modalContainer()).toBe(container);
      component.closeModal();
      expect(component.modalContainer()).toBeNull();
    });
  });

  describe('toggleDetails', () => {
    it('expands a container', () => {
      const container = makeContainer({ id: 'c-1' });
      component.toggleDetails(container);
      expect(component.expandedContainerId()).toBe('c-1');
    });

    it('collapses an already-expanded container', () => {
      const container = makeContainer({ id: 'c-1' });
      component.toggleDetails(container);
      component.toggleDetails(container);
      expect(component.expandedContainerId()).toBeNull();
    });

    it('switches from one container to another', () => {
      const c1 = makeContainer({ id: 'c-1' });
      const c2 = makeContainer({ id: 'c-2' });
      component.toggleDetails(c1);
      component.toggleDetails(c2);
      expect(component.expandedContainerId()).toBe('c-2');
    });
  });

  describe('viewMode', () => {
    it('defaults to grid', () => {
      expect(component.viewMode()).toBe('grid');
    });
  });

  describe('isPodActionLoading', () => {
    it('returns false when no pod action is loading', () => {
      const workload: Workload & { kind: 'pod' } = {
        kind: 'pod',
        pod: makePod({ name: 'my-pod', namespace: 'default' }),
        clusterName: 'cluster-1',
        clusterId: 'cl-1',
        connectionId: 'conn-1',
      };
      expect(component.isPodActionLoading(workload)).toBe(false);
    });
  });
});
