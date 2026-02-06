import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PortForwardState } from './port-forward.state';
import type { PortForward } from '../core/models/port-forward.model';

describe('PortForwardState', () => {
  let state: PortForwardState;
  let mockService: any;

  const mockForward: PortForward = {
    id: 'fwd-1',
    systemId: 'sys-1',
    containerId: 'c-1',
    containerPort: 80,
    localPort: 8080,
    remoteHost: 'localhost',
    remotePort: 80,
    protocol: 'tcp',
    status: 'active',
    createdAt: '2024-01-01T00:00:00Z',
  };

  beforeEach(() => {
    mockService = {
      createForward: vi.fn(),
      stopForward: vi.fn(),
      listForwards: vi.fn(),
      getForward: vi.fn(),
      openInBrowser: vi.fn(),
      isPortForwarded: vi.fn(),
    };
    state = new PortForwardState(mockService);
  });

  it('should start with empty forwards', () => {
    expect(state.forwards()).toEqual([]);
    expect(state.error()).toBeNull();
  });

  it('should load forwards', async () => {
    mockService.listForwards.mockResolvedValue([mockForward]);

    await state.loadForwards('sys-1', 'c-1');
    expect(state.forwards()).toEqual([mockForward]);
  });

  it('should handle load forwards error', async () => {
    mockService.listForwards.mockRejectedValue(new Error('Network error'));

    await state.loadForwards();
    expect(state.error()).toBe('Network error');
  });

  it('should create a forward', async () => {
    mockService.createForward.mockResolvedValue(mockForward);

    const result = await state.createForward({
      systemId: 'sys-1',
      containerId: 'c-1',
      containerPort: 80,
      hostPort: 8080,
    });

    expect(result).toEqual(mockForward);
    expect(state.forwards()).toContainEqual(mockForward);
  });

  it('should handle create forward error', async () => {
    mockService.createForward.mockRejectedValue(new Error('Port in use'));

    const result = await state.createForward({
      systemId: 'sys-1',
      containerId: 'c-1',
      containerPort: 80,
      hostPort: 8080,
    });

    expect(result).toBeNull();
    expect(state.error()).toBe('Port in use');
  });

  it('should stop a forward', async () => {
    mockService.listForwards.mockResolvedValue([mockForward]);
    await state.loadForwards();

    mockService.stopForward.mockResolvedValue(undefined);
    const result = await state.stopForward('fwd-1');

    expect(result).toBe(true);
    expect(state.forwards()).toHaveLength(0);
  });

  it('should handle stop forward error', async () => {
    mockService.stopForward.mockRejectedValue(new Error('Cannot stop'));

    const result = await state.stopForward('fwd-1');
    expect(result).toBe(false);
    expect(state.error()).toBe('Cannot stop');
  });

  it('should check if port is forwarded', async () => {
    mockService.listForwards.mockResolvedValue([mockForward]);
    await state.loadForwards();

    expect(state.isPortForwarded('c-1', 80)).toBe(true);
    expect(state.isPortForwarded('c-1', 443)).toBe(false);
    expect(state.isPortForwarded('c-2', 80)).toBe(false);
  });

  it('should get a specific forward', async () => {
    mockService.listForwards.mockResolvedValue([mockForward]);
    await state.loadForwards();

    const result = state.getForward('c-1', 80);
    expect(result).toEqual(mockForward);
  });

  it('should return null for non-existent forward', () => {
    expect(state.getForward('c-1', 80)).toBeNull();
  });

  it('should compute forwards by container', async () => {
    const forward2: PortForward = { ...mockForward, id: 'fwd-2', containerId: 'c-2', containerPort: 443 };
    mockService.listForwards.mockResolvedValue([mockForward, forward2]);
    await state.loadForwards();

    const grouped = state.forwardsByContainer();
    expect(grouped['c-1']).toHaveLength(1);
    expect(grouped['c-2']).toHaveLength(1);
  });

  it('should compute active forwards', async () => {
    const stoppedForward: PortForward = { ...mockForward, id: 'fwd-2', status: 'stopped' };
    mockService.listForwards.mockResolvedValue([mockForward, stoppedForward]);
    await state.loadForwards();

    const active = state.activeForwards();
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe('fwd-1');
  });

  it('should check loading state', () => {
    expect(state.isLoading('c-1', 80)).toBe(false);
  });

  it('should clear error', () => {
    // Trigger an error first
    mockService.listForwards.mockRejectedValue(new Error('test'));
    state.loadForwards();

    state.clearError();
    expect(state.error()).toBeNull();
  });

  it('should open forward in browser', async () => {
    mockService.openInBrowser.mockResolvedValue(undefined);

    await state.openInBrowser('fwd-1');
    expect(mockService.openInBrowser).toHaveBeenCalledWith('fwd-1');
  });

  it('should handle open in browser error', async () => {
    mockService.openInBrowser.mockRejectedValue(new Error('No browser'));

    await state.openInBrowser('fwd-1');
    expect(state.error()).toBe('No browser');
  });
});
