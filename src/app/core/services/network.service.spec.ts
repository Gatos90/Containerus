import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NetworkService } from './network.service';
import { TauriService } from './tauri.service';

describe('NetworkService', () => {
  let service: NetworkService;
  let tauriMock: { invoke: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    tauriMock = { invoke: vi.fn() };
    service = new NetworkService(tauriMock as unknown as TauriService);
  });

  describe('listNetworks', () => {
    it('should call with systemId', async () => {
      tauriMock.invoke.mockResolvedValue([]);
      await service.listNetworks('sys-1');
      expect(tauriMock.invoke).toHaveBeenCalledWith('list_networks', { systemId: 'sys-1' });
    });
  });

  describe('createNetwork', () => {
    it('should call with required parameters', async () => {
      tauriMock.invoke.mockResolvedValue(undefined);
      await service.createNetwork('sys-1', 'my-net', 'docker');
      expect(tauriMock.invoke).toHaveBeenCalledWith('create_network', {
        systemId: 'sys-1',
        name: 'my-net',
        runtime: 'docker',
        driver: undefined,
        subnet: undefined,
      });
    });

    it('should pass optional driver and subnet', async () => {
      tauriMock.invoke.mockResolvedValue(undefined);
      await service.createNetwork('sys-1', 'my-net', 'docker', 'bridge', '172.18.0.0/16');
      expect(tauriMock.invoke).toHaveBeenCalledWith('create_network', {
        systemId: 'sys-1',
        name: 'my-net',
        runtime: 'docker',
        driver: 'bridge',
        subnet: '172.18.0.0/16',
      });
    });
  });

  describe('removeNetwork', () => {
    it('should call with correct parameters', async () => {
      tauriMock.invoke.mockResolvedValue(undefined);
      await service.removeNetwork('sys-1', 'my-net', 'docker');
      expect(tauriMock.invoke).toHaveBeenCalledWith('remove_network', {
        systemId: 'sys-1',
        name: 'my-net',
        runtime: 'docker',
      });
    });
  });

  describe('connectContainerToNetwork', () => {
    it('should call with correct parameters', async () => {
      tauriMock.invoke.mockResolvedValue(undefined);
      await service.connectContainerToNetwork('sys-1', 'c1', 'my-net', 'docker');
      expect(tauriMock.invoke).toHaveBeenCalledWith('connect_container_to_network', {
        systemId: 'sys-1',
        containerId: 'c1',
        networkName: 'my-net',
        runtime: 'docker',
      });
    });
  });

  describe('disconnectContainerFromNetwork', () => {
    it('should call with correct parameters', async () => {
      tauriMock.invoke.mockResolvedValue(undefined);
      await service.disconnectContainerFromNetwork('sys-1', 'c1', 'my-net', 'docker');
      expect(tauriMock.invoke).toHaveBeenCalledWith('disconnect_container_from_network', {
        systemId: 'sys-1',
        containerId: 'c1',
        networkName: 'my-net',
        runtime: 'docker',
      });
    });
  });
});
