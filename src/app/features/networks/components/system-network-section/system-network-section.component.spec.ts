import { describe, it, expect, vi } from 'vitest';
import { Injector, runInInjectionContext, ɵChangeDetectionScheduler, ɵEffectScheduler } from '@angular/core';
import { SystemNetworkSectionComponent } from './system-network-section.component';
import { NetworkState } from '../../../../state/network.state';
import { ContainerSystem } from '../../../../core/models/system.model';
import { Network } from '../../../../core/models/network.model';
import { Container } from '../../../../core/models/container.model';

function makeSystem(overrides: Partial<ContainerSystem> = {}): ContainerSystem {
  return {
    id: 'sys-1',
    name: 'My System',
    hostname: 'localhost',
    connectionType: 'local',
    primaryRuntime: 'docker',
    availableRuntimes: ['docker'],
    autoConnect: false,
    ...overrides,
  };
}

function makeNetwork(overrides: Partial<Network> = {}): Network {
  return {
    id: 'net-1',
    name: 'bridge',
    driver: 'bridge',
    scope: 'local',
    internal: false,
    attachable: false,
    labels: {},
    runtime: 'docker',
    systemId: 'sys-1',
    ...overrides,
  };
}

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'container-1',
    name: 'my-container',
    image: 'nginx:latest',
    status: 'running',
    runtime: 'docker',
    systemId: 'sys-1',
    createdAt: '2024-01-01T00:00:00Z',
    ports: [],
    environmentVariables: {},
    volumes: [],
    networkSettings: { networks: {}, portBindings: [] },
    resourceLimits: {},
    labels: {},
    restartPolicy: { name: 'no', maximumRetryCount: 0 },
    healthCheck: null,
    state: { pid: 0, exitCode: 0, error: null, startedAt: null, finishedAt: null, healthStatus: null },
    config: { cmd: null, entrypoint: null, workingDir: null, user: null, hostname: null, domainname: null, tty: false, stopSignal: null },
    hostConfig: { networkMode: null, privileged: false, capAdd: [], capDrop: [], devices: [], shmSize: null, logConfig: null, securityOpt: [], ulimits: [] },
    ...overrides,
  };
}

function makeComponent(mockOverrides: Partial<{
  getContainersForSystem: (systemId: string) => Container[];
  getContainersInNetwork: (network: Network) => Container[];
  isContainerInNetwork: (container: Container, network: Network) => boolean;
}> = {}) {
  const mockNetworkState: any = {
    getContainersForSystem: vi.fn(mockOverrides.getContainersForSystem ?? (() => [])),
    getContainersInNetwork: vi.fn(mockOverrides.getContainersInNetwork ?? (() => [])),
    isContainerInNetwork: vi.fn(mockOverrides.isContainerInNetwork ?? (() => false)),
  };
  const injector = Injector.create({
    providers: [
      { provide: NetworkState, useValue: mockNetworkState },
      { provide: ɵChangeDetectionScheduler, useValue: { notify: vi.fn(), runningTick: false } },
      { provide: ɵEffectScheduler, useValue: { add: vi.fn(), remove: vi.fn(), schedule: vi.fn(), flush: vi.fn() } },
    ],
  });
  return {
    component: runInInjectionContext(injector, () => new SystemNetworkSectionComponent()),
    mockNetworkState,
  };
}

describe('SystemNetworkSectionComponent', () => {
  describe('networkCount', () => {
    it('returns 0 when no networks', () => {
      const { component } = makeComponent();
      (component.networks as any) = () => [];
      expect(component.networkCount()).toBe(0);
    });

    it('returns correct network count', () => {
      const { component } = makeComponent();
      (component.networks as any) = () => [makeNetwork(), makeNetwork({ id: 'net-2', name: 'custom' })];
      expect(component.networkCount()).toBe(2);
    });
  });

  describe('containerCount', () => {
    it('returns 0 when no containers', () => {
      const { component } = makeComponent({ getContainersForSystem: () => [] });
      (component.system as any) = () => makeSystem();
      expect(component.containerCount()).toBe(0);
    });

    it('returns container count for system', () => {
      const { component } = makeComponent({
        getContainersForSystem: () => [makeContainer(), makeContainer({ id: 'c2' })],
      });
      (component.system as any) = () => makeSystem();
      expect(component.containerCount()).toBe(2);
    });
  });

  describe('runtimeIcon', () => {
    it.each([
      ['docker', 'Docker'],
      ['podman', 'Podman'],
      ['apple', 'Apple'],
    ] as const)('returns %s for %s runtime', (runtime, expected) => {
      const { component } = makeComponent();
      (component.system as any) = () => makeSystem({ primaryRuntime: runtime });
      expect(component.runtimeIcon()).toBe(expected);
    });

    it('returns Container for unknown runtime', () => {
      const { component } = makeComponent();
      (component.system as any) = () => makeSystem({ primaryRuntime: 'unknown' as any });
      expect(component.runtimeIcon()).toBe('Container');
    });
  });

  describe('dropListIds', () => {
    it('returns empty array when no networks', () => {
      const { component } = makeComponent();
      (component.networks as any) = () => [];
      expect(component.dropListIds()).toEqual([]);
    });

    it('returns network-prefixed ids for each network', () => {
      const { component } = makeComponent();
      (component.networks as any) = () => [
        makeNetwork({ id: 'net-1' }),
        makeNetwork({ id: 'net-2' }),
      ];
      expect(component.dropListIds()).toEqual(['network-net-1', 'network-net-2']);
    });
  });

  describe('unassignedDropListId', () => {
    it('returns unassigned-prefixed system id', () => {
      const { component } = makeComponent();
      (component.system as any) = () => makeSystem({ id: 'sys-abc' });
      expect(component.unassignedDropListId()).toBe('unassigned-sys-abc');
    });
  });

  describe('toggleExpanded()', () => {
    it('starts collapsed (false)', () => {
      const { component } = makeComponent();
      expect(component.expanded()).toBe(false);
    });

    it('toggles to true on first call', () => {
      const { component } = makeComponent();
      component.toggleExpanded();
      expect(component.expanded()).toBe(true);
    });

    it('toggles back to false on second call', () => {
      const { component } = makeComponent();
      component.toggleExpanded();
      component.toggleExpanded();
      expect(component.expanded()).toBe(false);
    });
  });

  describe('getDropListId()', () => {
    it('returns network-prefixed id', () => {
      const { component } = makeComponent();
      const net = makeNetwork({ id: 'net-xyz' });
      expect(component.getDropListId(net)).toBe('network-net-xyz');
    });
  });

  describe('getConnectedDropLists()', () => {
    it('includes all other networks and the unassigned pool', () => {
      const { component } = makeComponent();
      (component.system as any) = () => makeSystem({ id: 'sys-1' });
      (component.networks as any) = () => [
        makeNetwork({ id: 'net-1' }),
        makeNetwork({ id: 'net-2' }),
        makeNetwork({ id: 'net-3' }),
      ];
      const result = component.getConnectedDropLists(makeNetwork({ id: 'net-1' }));
      expect(result).toContain('network-net-2');
      expect(result).toContain('network-net-3');
      expect(result).toContain('unassigned-sys-1');
      expect(result).not.toContain('network-net-1');
    });
  });

  describe('isDefaultNetwork()', () => {
    it.each(['bridge', 'host', 'none', 'podman'] as const)(
      'returns true for default network name "%s"',
      (name) => {
        const { component } = makeComponent();
        expect(component.isDefaultNetwork(makeNetwork({ name }))).toBe(true);
      }
    );

    it('returns false for custom network name', () => {
      const { component } = makeComponent();
      expect(component.isDefaultNetwork(makeNetwork({ name: 'my-custom-net' }))).toBe(false);
    });

    it('is case-insensitive for default names', () => {
      const { component } = makeComponent();
      expect(component.isDefaultNetwork(makeNetwork({ name: 'Bridge' }))).toBe(true);
    });
  });

  describe('onContainerRemoved()', () => {
    it('emits containerDisconnected with container and network', () => {
      const { component } = makeComponent();
      const emitted: any[] = [];
      component.containerDisconnected.subscribe((e) => emitted.push(e));
      const container = makeContainer();
      const network = makeNetwork();
      component.onContainerRemoved(container, network);
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toEqual({ container, network });
    });
  });

  describe('getNetworkCount()', () => {
    it('returns 0 for container with no networks', () => {
      const { component } = makeComponent();
      const container = makeContainer({ networkSettings: { networks: {}, portBindings: [] } });
      expect(component.getNetworkCount(container)).toBe(0);
    });

    it('returns correct count for container with networks', () => {
      const { component } = makeComponent();
      const container = makeContainer({
        networkSettings: {
          networks: {
            bridge: { ipAddress: '', gateway: '', macAddress: '' },
            custom: { ipAddress: '', gateway: '', macAddress: '' },
          },
          portBindings: [],
        },
      });
      expect(component.getNetworkCount(container)).toBe(2);
    });
  });
});
