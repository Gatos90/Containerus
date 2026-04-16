import { describe, it, expect } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { MetricBarComponent } from './metric-bar.component';

function makeComponent() {
  const injector = Injector.create({ providers: [] });
  return runInInjectionContext(injector, () => new MetricBarComponent());
}

describe('MetricBarComponent', () => {
  describe('clampedValue', () => {
    it('returns the value as-is when within 0-100', () => {
      const c = makeComponent();
      (c.value as any) = () => 50;
      expect(c.clampedValue()).toBe(50);
    });

    it('clamps to 0 when value is negative', () => {
      const c = makeComponent();
      (c.value as any) = () => -10;
      expect(c.clampedValue()).toBe(0);
    });

    it('clamps to 100 when value exceeds 100', () => {
      const c = makeComponent();
      (c.value as any) = () => 150;
      expect(c.clampedValue()).toBe(100);
    });

    it('returns 0 when value is 0', () => {
      const c = makeComponent();
      (c.value as any) = () => 0;
      expect(c.clampedValue()).toBe(0);
    });

    it('returns 100 when value is exactly 100', () => {
      const c = makeComponent();
      (c.value as any) = () => 100;
      expect(c.clampedValue()).toBe(100);
    });

    it('returns 0 when value is null/undefined (via ?? 0)', () => {
      const c = makeComponent();
      (c.value as any) = () => null;
      expect(c.clampedValue()).toBe(0);
    });
  });

  describe('colorLevel', () => {
    it('returns "normal" when value is below warning threshold', () => {
      const c = makeComponent();
      (c.value as any) = () => 50;
      (c.thresholds as any) = () => [70, 85] as [number, number];
      expect(c.colorLevel()).toBe('normal');
    });

    it('returns "warning" when value is at warning threshold', () => {
      const c = makeComponent();
      (c.value as any) = () => 70;
      (c.thresholds as any) = () => [70, 85] as [number, number];
      expect(c.colorLevel()).toBe('warning');
    });

    it('returns "warning" when value is between warning and danger thresholds', () => {
      const c = makeComponent();
      (c.value as any) = () => 80;
      (c.thresholds as any) = () => [70, 85] as [number, number];
      expect(c.colorLevel()).toBe('warning');
    });

    it('returns "danger" when value is at danger threshold', () => {
      const c = makeComponent();
      (c.value as any) = () => 85;
      (c.thresholds as any) = () => [70, 85] as [number, number];
      expect(c.colorLevel()).toBe('danger');
    });

    it('returns "danger" when value exceeds danger threshold', () => {
      const c = makeComponent();
      (c.value as any) = () => 95;
      (c.thresholds as any) = () => [70, 85] as [number, number];
      expect(c.colorLevel()).toBe('danger');
    });

    it('returns "normal" for custom lower thresholds', () => {
      const c = makeComponent();
      (c.value as any) = () => 30;
      (c.thresholds as any) = () => [50, 75] as [number, number];
      expect(c.colorLevel()).toBe('normal');
    });
  });

  describe('barClass', () => {
    it('returns blue class for normal level', () => {
      const c = makeComponent();
      (c.value as any) = () => 50;
      (c.thresholds as any) = () => [70, 85] as [number, number];
      expect(c.barClass()).toBe('bg-blue-500');
    });

    it('returns amber class for warning level', () => {
      const c = makeComponent();
      (c.value as any) = () => 75;
      (c.thresholds as any) = () => [70, 85] as [number, number];
      expect(c.barClass()).toBe('bg-amber-500');
    });

    it('returns red class for danger level', () => {
      const c = makeComponent();
      (c.value as any) = () => 90;
      (c.thresholds as any) = () => [70, 85] as [number, number];
      expect(c.barClass()).toBe('bg-red-500');
    });
  });

  describe('percentClass', () => {
    it('returns zinc class for normal level', () => {
      const c = makeComponent();
      (c.value as any) = () => 50;
      (c.thresholds as any) = () => [70, 85] as [number, number];
      expect(c.percentClass()).toBe('text-zinc-300');
    });

    it('returns amber class for warning level', () => {
      const c = makeComponent();
      (c.value as any) = () => 75;
      (c.thresholds as any) = () => [70, 85] as [number, number];
      expect(c.percentClass()).toBe('text-amber-500');
    });

    it('returns red class for danger level', () => {
      const c = makeComponent();
      (c.value as any) = () => 90;
      (c.thresholds as any) = () => [70, 85] as [number, number];
      expect(c.percentClass()).toBe('text-red-500');
    });
  });

  describe('containerClass', () => {
    it('returns empty string for sm size', () => {
      const c = makeComponent();
      (c.size as any) = () => 'sm';
      expect(c.containerClass()).toBe('');
    });

    it('returns empty string for md size', () => {
      const c = makeComponent();
      (c.size as any) = () => 'md';
      expect(c.containerClass()).toBe('');
    });

    it('returns gap-3 for lg size', () => {
      const c = makeComponent();
      (c.size as any) = () => 'lg';
      expect(c.containerClass()).toBe('gap-3');
    });
  });

  describe('default input values', () => {
    it('has showLabel default true', () => {
      const c = makeComponent();
      expect(c.showLabel()).toBe(true);
    });

    it('has showPercent default true', () => {
      const c = makeComponent();
      expect(c.showPercent()).toBe(true);
    });

    it('has animated default true', () => {
      const c = makeComponent();
      expect(c.animated()).toBe(true);
    });

    it('has size default md', () => {
      const c = makeComponent();
      expect(c.size()).toBe('md');
    });

    it('has default thresholds [70, 85]', () => {
      const c = makeComponent();
      expect(c.thresholds()).toEqual([70, 85]);
    });
  });
});
