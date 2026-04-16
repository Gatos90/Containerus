import { describe, it, expect, vi } from 'vitest';
import { Injector, runInInjectionContext, ɵChangeDetectionScheduler, ɵEffectScheduler } from '@angular/core';
import { UnassignedPoolComponent } from './unassigned-pool.component';
import { NetworkState } from '../../../../state/network.state';
import { ContainerSystem } from '../../../../core/models/system.model';
import { Container } from '../../../../core/models/container.model';

function makeSystem(id: string, name = 'System'): ContainerSystem {
  return {
    id,
    name,
    hostname: 'localhost',
    connectionType: 'local',
    primaryRuntime: 'docker',
    availableRuntimes: ['docker'],
    autoConnect: false,
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
    networkSettings: { networks: { bridge: { ipAddress: '172.17.0.2', gateway: '172.17.0.1', macAddress: '' } }, portBindings: [] },
    resourceLimits: {},
    labels: {},
    restartPolicy: { name: 'no', maximumRetryCount: 0 },
    healthCheck: null,
    state: { pid: 1, exitCode: 0, error: null, startedAt: null, finishedAt: null, healthStatus: null },
    config: { cmd: null, entrypoint: null, workingDir: null, user: null, hostname: null, domainname: null, tty: false, stopSignal: null },
    hostConfig: { networkMode: null, privileged: false, capAdd: [], capDrop: [], devices: [], shmSize: null, logConfig: null, securityOpt: [], ulimits: [] },
    ...overrides,
  };
}

function makeComponent(getContainersForSystem: (id: string) => Container[] = () => []) {
  const mockNetworkState: any = {
    getContainersForSystem: vi.fn(getContainersForSystem),
  };
  const injector = Injector.create({
    providers: [
      { provide: NetworkState, useValue: mockNetworkState },
      { provide: ɵChangeDetectionScheduler, useValue: { notify: vi.fn(), runningTick: false } },
      { provide: ɵEffectScheduler, useValue: { add: vi.fn(), remove: vi.fn(), schedule: vi.fn(), flush: vi.fn() } },
    ],
  });
  return {
    component: runInInjectionContext(injector, () => new UnassignedPoolComponent()),
    mockNetworkState,
  };
}

describe('UnassignedPoolComponent', () => {
  describe('systemContainers', () => {
    it('returns empty array when no systems', () => {
      const { component } = makeComponent();
      (component.systems as any) = () => [];
      expect(component.systemContainers()).toEqual([]);
    });

    it('excludes systems with no containers', () => {
      const { component } = makeComponent(() => []);
      (component.systems as any) = () => [makeSystem('sys-1')];
      expect(component.systemContainers()).toEqual([]);
    });

    it('includes systems that have containers', () => {
      const container = makeContainer({ systemId: 'sys-1' });
      const { component } = makeComponent((id) => id === 'sys-1' ? [container] : []);
      (component.systems as any) = () => [makeSystem('sys-1')];
      const result = component.systemContainers();
      expect(result).toHaveLength(1);
      expect(result[0].containers).toHaveLength(1);
    });

    it('includes multiple systems with containers', () => {
      const c1 = makeContainer({ systemId: 'sys-1', id: 'c1' });
      const c2 = makeContainer({ systemId: 'sys-2', id: 'c2' });
      const { component } = makeComponent((id) => {
        if (id === 'sys-1') return [c1];
        if (id === 'sys-2') return [c2];
        return [];
      });
      (component.systems as any) = () => [makeSystem('sys-1'), makeSystem('sys-2')];
      expect(component.systemContainers()).toHaveLength(2);
    });
  });

  describe('hasContainers', () => {
    it('returns false when no systems have containers', () => {
      const { component } = makeComponent(() => []);
      (component.systems as any) = () => [makeSystem('sys-1')];
      expect(component.hasContainers()).toBe(false);
    });

    it('returns true when at least one system has containers', () => {
      const container = makeContainer();
      const { component } = makeComponent(() => [container]);
      (component.systems as any) = () => [makeSystem('sys-1')];
      expect(component.hasContainers()).toBe(true);
    });
  });

  describe('getDropListId()', () => {
    it('returns prefixed drop list id', () => {
      const { component } = makeComponent();
      expect(component.getDropListId('sys-1')).toBe('unassigned-sys-1');
    });

    it('returns different ids for different system ids', () => {
      const { component } = makeComponent();
      expect(component.getDropListId('sys-a')).not.toBe(component.getDropListId('sys-b'));
    });
  });

  describe('getNetworkCount()', () => {
    it('returns 0 for container with no networks', () => {
      const { component } = makeComponent();
      const container = makeContainer({ networkSettings: { networks: {}, portBindings: [] } });
      expect(component.getNetworkCount(container)).toBe(0);
    });

    it('returns 1 for container with one network', () => {
      const { component } = makeComponent();
      const container = makeContainer({
        networkSettings: {
          networks: { bridge: { ipAddress: '172.17.0.2', gateway: '172.17.0.1', macAddress: '' } },
          portBindings: [],
        },
      });
      expect(component.getNetworkCount(container)).toBe(1);
    });

    it('returns 2 for container with two networks', () => {
      const { component } = makeComponent();
      const container = makeContainer({
        networkSettings: {
          networks: {
            bridge: { ipAddress: '172.17.0.2', gateway: '172.17.0.1', macAddress: '' },
            custom: { ipAddress: '10.0.0.2', gateway: '10.0.0.1', macAddress: '' },
          },
          portBindings: [],
        },
      });
      expect(component.getNetworkCount(container)).toBe(2);
    });
  });

  describe('static properties', () => {
    it('exposes Box icon', () => {
      const { component } = makeComponent();
      expect(component.Box).toBeDefined();
    });
  });
});
