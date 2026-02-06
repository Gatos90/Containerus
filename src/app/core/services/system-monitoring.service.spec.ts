import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SystemMonitoringService } from './system-monitoring.service';

// Mock @tauri-apps/api/event
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

describe('SystemMonitoringService', () => {
  let service: SystemMonitoringService;
  let mockTauri: any;

  beforeEach(() => {
    mockTauri = { invoke: vi.fn() };
    service = new SystemMonitoringService(mockTauri);
  });

  it('should start monitoring a system', async () => {
    mockTauri.invoke.mockResolvedValue(true);

    const result = await service.startMonitoring('sys-1', 5000);
    expect(result).toBe(true);
    expect(mockTauri.invoke).toHaveBeenCalledWith('start_system_monitoring', {
      systemId: 'sys-1',
      intervalMs: 5000,
    });
  });

  it('should use default interval', async () => {
    mockTauri.invoke.mockResolvedValue(true);

    await service.startMonitoring('sys-1');
    expect(mockTauri.invoke).toHaveBeenCalledWith('start_system_monitoring', {
      systemId: 'sys-1',
      intervalMs: 3000,
    });
  });

  it('should handle start monitoring failure', async () => {
    mockTauri.invoke.mockRejectedValue(new Error('failed'));

    const result = await service.startMonitoring('sys-1');
    expect(result).toBe(false);
  });

  it('should stop monitoring a system', async () => {
    mockTauri.invoke.mockResolvedValue(true);

    // First start monitoring
    await service.startMonitoring('sys-1');

    // Then stop
    const result = await service.stopMonitoring('sys-1');
    expect(result).toBe(true);
  });

  it('should handle stop monitoring failure', async () => {
    mockTauri.invoke.mockRejectedValue(new Error('failed'));

    const result = await service.stopMonitoring('sys-1');
    expect(result).toBe(false);
  });

  it('should check monitoring status', async () => {
    mockTauri.invoke.mockResolvedValue(true);

    expect(service.isMonitoring('sys-1')).toBe(false);
    await service.startMonitoring('sys-1');
    expect(service.isMonitoring('sys-1')).toBe(true);
  });

  it('should return null for non-existent metrics', () => {
    expect(service.getMetrics('sys-1')).toBeNull();
  });

  it('should return empty history for non-existent system', () => {
    expect(service.getHistory('sys-1')).toEqual([]);
  });

  it('should fetch metrics once', async () => {
    const metrics = { systemId: 'sys-1', cpuUsage: 50, memoryUsage: 70 };
    mockTauri.invoke.mockResolvedValue(metrics);

    const result = await service.fetchMetricsOnce('sys-1');
    expect(result).toEqual(metrics);
    expect(service.getMetrics('sys-1')).toEqual(metrics);
  });

  it('should return null on fetch metrics failure', async () => {
    mockTauri.invoke.mockRejectedValue(new Error('failed'));

    const result = await service.fetchMetricsOnce('sys-1');
    expect(result).toBeNull();
  });

  it('should accumulate metrics history', async () => {
    const metrics1 = { systemId: 'sys-1', cpuUsage: 50 };
    const metrics2 = { systemId: 'sys-1', cpuUsage: 60 };

    mockTauri.invoke.mockResolvedValueOnce(metrics1).mockResolvedValueOnce(metrics2);

    await service.fetchMetricsOnce('sys-1');
    await service.fetchMetricsOnce('sys-1');

    const history = service.getHistory('sys-1');
    expect(history).toHaveLength(2);
    expect(history[0]).toEqual(metrics1);
    expect(history[1]).toEqual(metrics2);
  });

  it('should clear metrics for a system', async () => {
    const metrics = { systemId: 'sys-1', cpuUsage: 50 };
    mockTauri.invoke.mockResolvedValue(metrics);

    await service.fetchMetricsOnce('sys-1');
    expect(service.getMetrics('sys-1')).not.toBeNull();

    service.clearMetrics('sys-1');
    expect(service.getMetrics('sys-1')).toBeNull();
    expect(service.getHistory('sys-1')).toEqual([]);
  });

  it('should return monitored systems as array', async () => {
    mockTauri.invoke.mockResolvedValue(true);

    await service.startMonitoring('sys-1');
    await service.startMonitoring('sys-2');

    const monitored = service.monitoredSystems();
    expect(monitored).toHaveLength(2);
    expect(monitored).toContain('sys-1');
    expect(monitored).toContain('sys-2');
  });
});
