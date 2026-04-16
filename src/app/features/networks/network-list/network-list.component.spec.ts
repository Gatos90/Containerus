import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { NetworkListComponent } from './network-list.component';
import { NetworkState } from '../../../state/network.state';
import { SystemState } from '../../../state/system.state';
import { ContainerState } from '../../../state/container.state';
import type { Network } from '../../../core/models/network.model';
import type { Container } from '../../../core/models/container.model';

const makeNetwork = (overrides: Partial<Network> = {}): Network =>
  ({
    id: 'net-1',
    name: 'bridge',
    driver: 'bridge',
    scope: 'local',
    internal: false,
    ipam: { driver: 'default', config: [] },
    labels: {},
    options: {},
    runtime: 'docker',
    systemId: 'sys-1',
    containers: {},
    ...overrides,
  } as Network);

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

function makeComponent(): NetworkListComponent {
  const mockNetworkState: any = {
    filteredNetworks: vi.fn(() => []),
    loadNetworks: vi.fn().mockResolvedValue(undefined),
    createNetwork: vi.fn().mockResolvedValue(undefined),
    connectContainer: vi.fn().mockResolvedValue(undefined),
    disconnectContainer: vi.fn().mockResolvedValue(undefined),
    setDriverFilter: vi.fn(),
  };

  const mockSystemState: any = {
    connectedSystems: vi.fn(() => []),
  };

  const mockContainerState: any = {
    loadContainers: vi.fn().mockResolvedValue(undefined),
  };

  const injector = Injector.create({
    providers: [
      { provide: NetworkState, useValue: mockNetworkState },
      { provide: SystemState, useValue: mockSystemState },
      { provide: ContainerState, useValue: mockContainerState },
    ],
  });

  return runInInjectionContext(injector, () => new NetworkListComponent());
}

describe('NetworkListComponent', () => {
  let component: NetworkListComponent;

  beforeEach(() => {
    component = makeComponent();
  });

  describe('initial state', () => {
    it('should initialize refreshing to false', () => {
      expect(component.refreshing).toBe(false);
    });

    it('should initialize showCreateDialog to false', () => {
      expect(component.showCreateDialog).toBe(false);
    });

    it('should initialize showMobileFilters signal to false', () => {
      expect(component.showMobileFilters()).toBe(false);
    });

    it('should initialize createForm with default values', () => {
      expect(component.createForm.name).toBe('');
      expect(component.createForm.systemId).toBe('');
      expect(component.createForm.runtime).toBe('docker');
      expect(component.createForm.driver).toBe('');
      expect(component.createForm.subnet).toBe('');
    });
  });

  describe('refresh', () => {
    it('should call loadNetworks and loadContainers for each connected system', async () => {
      component.systemState.connectedSystems = vi.fn(() => [
        { id: 'sys-1' } as any,
        { id: 'sys-2' } as any,
      ]);
      await component.refresh();
      expect(component.networkState.loadNetworks).toHaveBeenCalledWith('sys-1');
      expect(component.networkState.loadNetworks).toHaveBeenCalledWith('sys-2');
      expect(component.containerState.loadContainers).toHaveBeenCalledWith('sys-1');
      expect(component.containerState.loadContainers).toHaveBeenCalledWith('sys-2');
    });

    it('should set refreshing to false after successful refresh', async () => {
      await component.refresh();
      expect(component.refreshing).toBe(false);
    });

    it('should set refreshing to false even when a call throws', async () => {
      component.systemState.connectedSystems = vi.fn(() => [{ id: 'sys-1' } as any]);
      component.networkState.loadNetworks = vi.fn().mockRejectedValue(new Error('fail'));
      await expect(component.refresh()).rejects.toThrow();
      expect(component.refreshing).toBe(false);
    });

    it('should not call loadNetworks when no systems connected', async () => {
      await component.refresh();
      expect(component.networkState.loadNetworks).not.toHaveBeenCalled();
    });
  });

  describe('ngOnInit', () => {
    it('should call refresh on init', async () => {
      const refreshSpy = vi.spyOn(component, 'refresh').mockResolvedValue(undefined);
      await component.ngOnInit();
      expect(refreshSpy).toHaveBeenCalled();
    });

    it('should set createForm.systemId to first connected system', async () => {
      component.systemState.connectedSystems = vi.fn(() => [
        { id: 'sys-55' } as any,
        { id: 'sys-66' } as any,
      ]);
      vi.spyOn(component, 'refresh').mockResolvedValue(undefined);
      await component.ngOnInit();
      expect(component.createForm.systemId).toBe('sys-55');
    });

    it('should not set createForm.systemId when no systems connected', async () => {
      vi.spyOn(component, 'refresh').mockResolvedValue(undefined);
      await component.ngOnInit();
      expect(component.createForm.systemId).toBe('');
    });
  });

  describe('createNetwork', () => {
    it('should do nothing when createForm name is empty', async () => {
      component.createForm.name = '';
      component.createForm.systemId = 'sys-1';
      await component.createNetwork();
      expect(component.networkState.createNetwork).not.toHaveBeenCalled();
    });

    it('should do nothing when createForm systemId is empty', async () => {
      component.createForm.name = 'my-net';
      component.createForm.systemId = '';
      await component.createNetwork();
      expect(component.networkState.createNetwork).not.toHaveBeenCalled();
    });

    it('should call networkState.createNetwork with correct arguments', async () => {
      component.createForm.name = 'my-net';
      component.createForm.systemId = 'sys-1';
      component.createForm.runtime = 'docker';
      component.createForm.driver = 'bridge';
      component.createForm.subnet = '172.20.0.0/16';
      await component.createNetwork();
      expect(component.networkState.createNetwork).toHaveBeenCalledWith(
        'sys-1',
        'my-net',
        'docker',
        'bridge',
        '172.20.0.0/16'
      );
    });

    it('should pass undefined for driver when driver is empty string', async () => {
      component.createForm.name = 'my-net';
      component.createForm.systemId = 'sys-1';
      component.createForm.driver = '';
      component.createForm.subnet = '10.0.0.0/8';
      await component.createNetwork();
      expect(component.networkState.createNetwork).toHaveBeenCalledWith(
        'sys-1',
        'my-net',
        'docker',
        undefined,
        '10.0.0.0/8'
      );
    });

    it('should pass undefined for subnet when subnet is empty string', async () => {
      component.createForm.name = 'my-net';
      component.createForm.systemId = 'sys-1';
      component.createForm.driver = 'bridge';
      component.createForm.subnet = '';
      await component.createNetwork();
      expect(component.networkState.createNetwork).toHaveBeenCalledWith(
        'sys-1',
        'my-net',
        'docker',
        'bridge',
        undefined
      );
    });

    it('should close create dialog after successful creation', async () => {
      component.showCreateDialog = true;
      component.createForm.name = 'my-net';
      component.createForm.systemId = 'sys-1';
      await component.createNetwork();
      expect(component.showCreateDialog).toBe(false);
    });

    it('should reset form name, driver, and subnet after creation', async () => {
      component.createForm.name = 'my-net';
      component.createForm.driver = 'overlay';
      component.createForm.subnet = '10.0.0.0/8';
      component.createForm.systemId = 'sys-1';
      await component.createNetwork();
      expect(component.createForm.name).toBe('');
      expect(component.createForm.driver).toBe('');
      expect(component.createForm.subnet).toBe('');
    });

    it('should preserve systemId in createForm after creation', async () => {
      component.createForm.name = 'my-net';
      component.createForm.systemId = 'sys-1';
      await component.createNetwork();
      expect(component.createForm.systemId).toBe('sys-1');
    });

    it('should reset runtime to docker after creation', async () => {
      component.createForm.name = 'my-net';
      component.createForm.systemId = 'sys-1';
      await component.createNetwork();
      expect(component.createForm.runtime).toBe('docker');
    });
  });

  describe('onContainerConnected', () => {
    it('should call networkState.connectContainer with event data', async () => {
      const container = makeContainer();
      const network = makeNetwork();
      await component.onContainerConnected({ container, network });
      expect(component.networkState.connectContainer).toHaveBeenCalledWith(container, network);
    });
  });

  describe('onContainerDisconnected', () => {
    it('should call networkState.disconnectContainer with event data', async () => {
      const container = makeContainer();
      const network = makeNetwork();
      await component.onContainerDisconnected({ container, network });
      expect(component.networkState.disconnectContainer).toHaveBeenCalledWith(container, network);
    });
  });

  describe('setDriverFilter', () => {
    it('should delegate to networkState.setDriverFilter with bridge', () => {
      component.setDriverFilter('bridge');
      expect(component.networkState.setDriverFilter).toHaveBeenCalledWith('bridge');
    });

    it('should delegate to networkState.setDriverFilter with all', () => {
      component.setDriverFilter('all');
      expect(component.networkState.setDriverFilter).toHaveBeenCalledWith('all');
    });

    it('should delegate to networkState.setDriverFilter with host', () => {
      component.setDriverFilter('host');
      expect(component.networkState.setDriverFilter).toHaveBeenCalledWith('host');
    });

    it('should delegate to networkState.setDriverFilter with overlay', () => {
      component.setDriverFilter('overlay');
      expect(component.networkState.setDriverFilter).toHaveBeenCalledWith('overlay');
    });

    it('should delegate to networkState.setDriverFilter with custom', () => {
      component.setDriverFilter('custom');
      expect(component.networkState.setDriverFilter).toHaveBeenCalledWith('custom');
    });
  });

  describe('filteredNetworksBySystem computed', () => {
    it('should return empty object when no networks', () => {
      component.networkState.filteredNetworks = vi.fn(() => []);
      expect(component.filteredNetworksBySystem()).toEqual({});
    });

    it('should group networks by systemId', () => {
      component.networkState.filteredNetworks = vi.fn(() => [
        makeNetwork({ id: 'net-1', systemId: 'sys-1' }),
        makeNetwork({ id: 'net-2', systemId: 'sys-2' }),
        makeNetwork({ id: 'net-3', systemId: 'sys-1' }),
      ]);
      const grouped = component.filteredNetworksBySystem();
      expect(Object.keys(grouped)).toHaveLength(2);
      expect(grouped['sys-1']).toHaveLength(2);
      expect(grouped['sys-2']).toHaveLength(1);
    });

    it('should put all networks under same key when all share one systemId', () => {
      component.networkState.filteredNetworks = vi.fn(() => [
        makeNetwork({ id: 'net-1', systemId: 'sys-1' }),
        makeNetwork({ id: 'net-2', systemId: 'sys-1' }),
      ]);
      const grouped = component.filteredNetworksBySystem();
      expect(Object.keys(grouped)).toHaveLength(1);
      expect(grouped['sys-1']).toHaveLength(2);
    });

    it('should return separate entries for each system', () => {
      component.networkState.filteredNetworks = vi.fn(() => [
        makeNetwork({ id: 'net-1', systemId: 'sys-1' }),
        makeNetwork({ id: 'net-2', systemId: 'sys-2' }),
        makeNetwork({ id: 'net-3', systemId: 'sys-3' }),
      ]);
      const grouped = component.filteredNetworksBySystem();
      expect(Object.keys(grouped)).toHaveLength(3);
    });
  });
});
