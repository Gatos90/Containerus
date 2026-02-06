import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PortForwardService } from './port-forward.service';

// Mock @tauri-apps/api/core
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
const mockInvoke = vi.mocked(invoke);

describe('PortForwardService', () => {
  let service: PortForwardService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PortForwardService();
  });

  it('should create a port forward', async () => {
    const request = { systemId: 'sys-1', containerId: 'c-1', containerPort: 80, hostPort: 8080 };
    const forward = { id: 'fwd-1', ...request, localPort: 8080, status: 'active' };
    mockInvoke.mockResolvedValue(forward as any);

    const result = await service.createForward(request);
    expect(result).toEqual(forward);
    expect(mockInvoke).toHaveBeenCalledWith('create_port_forward', { request });
  });

  it('should stop a port forward', async () => {
    mockInvoke.mockResolvedValue(undefined as any);

    await service.stopForward('fwd-1');
    expect(mockInvoke).toHaveBeenCalledWith('stop_port_forward', { forwardId: 'fwd-1' });
  });

  it('should list forwards', async () => {
    const forwards = [{ id: 'fwd-1' }, { id: 'fwd-2' }];
    mockInvoke.mockResolvedValue(forwards as any);

    const result = await service.listForwards('sys-1', 'c-1');
    expect(result).toEqual(forwards);
    expect(mockInvoke).toHaveBeenCalledWith('list_port_forwards', {
      systemId: 'sys-1',
      containerId: 'c-1',
    });
  });

  it('should list forwards without filters', async () => {
    mockInvoke.mockResolvedValue([] as any);

    await service.listForwards();
    expect(mockInvoke).toHaveBeenCalledWith('list_port_forwards', {
      systemId: undefined,
      containerId: undefined,
    });
  });

  it('should get a specific forward', async () => {
    const forward = { id: 'fwd-1', status: 'active' };
    mockInvoke.mockResolvedValue(forward as any);

    const result = await service.getForward('fwd-1');
    expect(result).toEqual(forward);
    expect(mockInvoke).toHaveBeenCalledWith('get_port_forward', { forwardId: 'fwd-1' });
  });

  it('should open in browser', async () => {
    mockInvoke.mockResolvedValue(undefined as any);

    await service.openInBrowser('fwd-1');
    expect(mockInvoke).toHaveBeenCalledWith('open_forwarded_port', { forwardId: 'fwd-1' });
  });

  it('should check if port is forwarded', async () => {
    mockInvoke.mockResolvedValue(true as any);

    const result = await service.isPortForwarded('c-1', 80);
    expect(result).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith('is_port_forwarded', {
      containerId: 'c-1',
      containerPort: 80,
    });
  });
});
