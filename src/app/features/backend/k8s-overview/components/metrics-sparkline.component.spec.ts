import '@angular/compiler';
import { describe, it, expect } from 'vitest';
import {
  DestroyRef,
  Injector,
  runInInjectionContext,
  ɵChangeDetectionScheduler,
  ɵEffectScheduler,
} from '@angular/core';
import { vi } from 'vitest';
import { MetricsSparklineComponent } from './metrics-sparkline.component';

function makeSparkline() {
  const injector = Injector.create({
    providers: [
      { provide: DestroyRef, useValue: { onDestroy: vi.fn(() => () => {}) } as Partial<DestroyRef> },
      { provide: ɵChangeDetectionScheduler, useValue: { notify: vi.fn(), runningTick: false } },
      { provide: ɵEffectScheduler, useValue: { add: vi.fn(), remove: vi.fn(), schedule: vi.fn(), flush: vi.fn() } },
    ],
  });
  const cmp = runInInjectionContext(injector, () => new MetricsSparklineComponent());
  (cmp.label as any) = () => 'CPU';
  (cmp.unit as any) = () => '%';
  (cmp.max as any) = () => null;
  (cmp.formatValue as any) = () => (v: number) => v.toFixed(1);
  return cmp;
}

describe('MetricsSparklineComponent', () => {
  it('aria-label reports current value, delta direction, and observed range', () => {
    const cmp = makeSparkline();
    (cmp.points as any) = () => [
      { timestampMs: 0, value: 10 },
      { timestampMs: 1000, value: 30 },
      { timestampMs: 2000, value: 25 },
    ];
    const aria = cmp.ariaLabel();
    expect(aria).toContain('CPU');
    expect(aria).toContain('25.0%');
    expect(aria).toContain('10.0%');
    expect(aria).toContain('30.0%');
    // Delta is last - previous, so 25 - 30 = -5; uses the word "down" so
    // screen readers read the direction unambiguously.
    expect(aria).toContain('down 5.0');
    expect(aria).not.toMatch(/[−+]/);
  });

  it('aria-label uses "up" for positive deltas', () => {
    const cmp = makeSparkline();
    (cmp.points as any) = () => [
      { timestampMs: 0, value: 10 },
      { timestampMs: 1000, value: 12 },
    ];
    expect(cmp.ariaLabel()).toContain('up 2.0');
  });

  it('reports "no data" when the series is empty', () => {
    const cmp = makeSparkline();
    (cmp.points as any) = () => [];
    expect(cmp.hasData()).toBe(false);
    expect(cmp.ariaLabel()).toContain('no data');
  });

  it('polyline is empty when there are no points', () => {
    const cmp = makeSparkline();
    (cmp.points as any) = () => [];
    expect(cmp.polyline()).toBe('');
  });

  it('polyline emits one coordinate per sample when data is present', () => {
    const cmp = makeSparkline();
    (cmp.points as any) = () => [
      { timestampMs: 0, value: 0 },
      { timestampMs: 1, value: 100 },
    ];
    expect(cmp.polyline().split(' ').length).toBe(2);
  });

  it('hover helpers stay cleared until mousemove picks an index', () => {
    const cmp = makeSparkline();
    (cmp.points as any) = () => [{ timestampMs: 1234, value: 10 }];
    expect(cmp.hoverIndex()).toBeNull();
    expect(cmp.hoverValueDisplay()).toBe('');
    cmp.onLeave();
    expect(cmp.hoverIndex()).toBeNull();
  });

  it('exposes a stable summary id for aria-describedby wiring', () => {
    const cmp = makeSparkline();
    expect(cmp.summaryId).toMatch(/^metrics-sparkline-summary-\d+$/);
  });
});
