import '@angular/compiler';
import { describe, it, expect, vi } from 'vitest';
import {
  DestroyRef,
  Injector,
  runInInjectionContext,
  ɵChangeDetectionScheduler,
  ɵEffectScheduler,
} from '@angular/core';
import { PodMetricsPanelComponent, METRICS_REASONS } from './pod-metrics-panel.component';
import { BackendK8sService } from '../../../../core/services/backend-k8s.service';
import { ContainerStatsSample } from '../../../../core/models/backend.model';

function sample(partial: Partial<ContainerStatsSample>): ContainerStatsSample {
  return {
    timestampMs: 0,
    cpuPercent: 0,
    memoryBytes: 0,
    memoryLimitBytes: 1024,
    memoryPercent: 0,
    netRxBytes: 0,
    netTxBytes: 0,
    blockReadBytes: 0,
    blockWriteBytes: 0,
    ...partial,
  };
}

function makePanel() {
  const k8s = {
    getContainerMetricsFor: vi.fn().mockResolvedValue({
      systemId: 'sys',
      containerId: 'c',
      window: '1h',
      maxPoints: 200,
      samples: [],
    }),
  };
  const destroyRef: Partial<DestroyRef> = { onDestroy: vi.fn(() => () => {}) };
  const injector = Injector.create({
    providers: [
      { provide: BackendK8sService, useValue: k8s as unknown as BackendK8sService },
      { provide: DestroyRef, useValue: destroyRef },
      { provide: ɵChangeDetectionScheduler, useValue: { notify: vi.fn(), runningTick: false } },
      { provide: ɵEffectScheduler, useValue: { add: vi.fn(), remove: vi.fn(), schedule: vi.fn(), flush: vi.fn() } },
    ],
  });
  const panel = runInInjectionContext(injector, () => new PodMetricsPanelComponent());
  (panel.connectionId as any) = () => 'conn-1';
  return { panel, k8s };
}

describe('PodMetricsPanelComponent', () => {
  it('descriptor map covers every unavailable reason with a non-empty label', () => {
    for (const key of Object.keys(METRICS_REASONS)) {
      const d = METRICS_REASONS[key as keyof typeof METRICS_REASONS];
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.description.length).toBeGreaterThan(0);
      expect(['degraded', 'failing', 'unknown']).toContain(d.chipStatus);
    }
  });

  it('cpuPoints maps samples 1:1 with cpuPercent values', () => {
    const { panel } = makePanel();
    const series = {
      containerId: 'c',
      samples: [sample({ timestampMs: 1, cpuPercent: 12 }), sample({ timestampMs: 2, cpuPercent: 30 })],
    };
    const pts = panel.cpuPoints(series);
    expect(pts).toEqual([
      { timestampMs: 1, value: 12 },
      { timestampMs: 2, value: 30 },
    ]);
  });

  it('memAbsolutePoints converts bytes to megabytes', () => {
    const { panel } = makePanel();
    const series = {
      containerId: 'c',
      samples: [sample({ timestampMs: 1, memoryBytes: 2 * 1024 * 1024 })],
    };
    expect(panel.memAbsolutePoints(series)).toEqual([{ timestampMs: 1, value: 2 }]);
  });

  it('netRxRatePoints computes per-second KB deltas and clamps counter resets to 0', () => {
    const { panel } = makePanel();
    const series = {
      containerId: 'c',
      samples: [
        sample({ timestampMs: 0, netRxBytes: 1024 }),
        sample({ timestampMs: 1000, netRxBytes: 3 * 1024 }),
        // counter reset (container restart) — delta goes negative, clamp to 0
        sample({ timestampMs: 2000, netRxBytes: 512 }),
      ],
    };
    const pts = panel.netRxRatePoints(series);
    expect(pts).toEqual([
      { timestampMs: 1000, value: 2 },
      { timestampMs: 2000, value: 0 },
    ]);
  });

  it('netRxRatePoints skips samples that share a timestamp to avoid divide-by-zero', () => {
    const { panel } = makePanel();
    const series = {
      containerId: 'c',
      samples: [
        sample({ timestampMs: 0, netRxBytes: 1024 }),
        sample({ timestampMs: 0, netRxBytes: 2048 }),
        sample({ timestampMs: 1000, netRxBytes: 3 * 1024 }),
      ],
    };
    const pts = panel.netRxRatePoints(series);
    // The zero-dt pair is skipped; the remaining pair is sample[2] vs
    // sample[1] (1024 bytes over 1 s → 1 KB/s).
    expect(pts).toEqual([{ timestampMs: 1000, value: 1 }]);
  });

  it('diskRatePoints sums read + write KB/s deltas', () => {
    const { panel } = makePanel();
    const series = {
      containerId: 'c',
      samples: [
        sample({ timestampMs: 0, blockReadBytes: 0, blockWriteBytes: 0 }),
        sample({ timestampMs: 2000, blockReadBytes: 2048, blockWriteBytes: 2048 }),
      ],
    };
    // 4096 bytes over 2 s → 2048 B/s → 2 KB/s.
    expect(panel.diskRatePoints(series)).toEqual([{ timestampMs: 2000, value: 2 }]);
  });

  it('cadenceAnnouncement switches between paused and polling-with-interval', () => {
    const { panel } = makePanel();
    expect(panel.cadenceAnnouncement()).toContain('every');
    panel.togglePause();
    expect(panel.cadenceAnnouncement()).toContain('paused');
  });

  it('cadenceAnnouncement includes the active range so window changes announce', () => {
    const { panel } = makePanel();
    expect(panel.cadenceAnnouncement()).toContain('1h');
    panel.setWindow('24h');
    expect(panel.cadenceAnnouncement()).toContain('24h');
  });

  it('does not expose a per-poll value live announcement', () => {
    // Per-poll value announcements (~every 10s) bury other SR speech and
    // are redundant with the on-screen sparkline + text summary.
    const { panel } = makePanel();
    expect((panel as unknown as Record<string, unknown>).liveAnnouncement).toBeUndefined();
  });

  it('setWindow changes the polling cadence second count', () => {
    const { panel } = makePanel();
    expect(panel.cadenceSeconds()).toBe(10);
    panel.setWindow('24h');
    expect(panel.cadenceSeconds()).toBe(60);
  });

  it('canQuery is false when systemId is unset', () => {
    const { panel } = makePanel();
    (panel.systemId as any) = () => null;
    (panel.containerIds as any) = () => ['c1'];
    expect(panel.canQuery()).toBe(false);
  });

  it('canQuery is true when both systemId and at least one container are set', () => {
    const { panel } = makePanel();
    (panel.systemId as any) = () => 'sys-1';
    (panel.containerIds as any) = () => ['c1'];
    expect(panel.canQuery()).toBe(true);
  });

  it('reasonDescriptor returns the full descriptor for a known reason', () => {
    const { panel } = makePanel();
    expect(panel.reasonDescriptor('unauthorized').chipStatus).toBe('failing');
    expect(panel.reasonDescriptor('not_found').label.toLowerCase()).toContain('no data');
  });

  it('unauthorized description explains the remediation instead of naming the raw permission first', () => {
    const desc = METRICS_REASONS.unauthorized.description;
    expect(desc.toLowerCase()).toContain("don't have permission");
    expect(desc).toContain('containers.metrics.view');
  });
});
