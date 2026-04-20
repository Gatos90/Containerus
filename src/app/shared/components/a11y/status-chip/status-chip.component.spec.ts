import { describe, it, expect } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { CHIP_VARIANTS, StatusChipComponent } from './status-chip.component';

function makeComponent(): StatusChipComponent {
  const injector = Injector.create({ providers: [] });
  return runInInjectionContext(injector, () => new StatusChipComponent());
}

describe('StatusChipComponent', () => {
  describe('variants', () => {
    it('exposes exactly four statuses', () => {
      expect(Object.keys(CHIP_VARIANTS).sort()).toEqual(['degraded', 'failing', 'healthy', 'unknown']);
    });

    it('assigns a distinct glyph per variant (shape, not color)', () => {
      const glyphs = Object.values(CHIP_VARIANTS).map((v) => v.glyph);
      expect(new Set(glyphs).size).toBe(glyphs.length);
    });

    it('assigns a distinct chipClass per variant', () => {
      const classes = Object.values(CHIP_VARIANTS).map((v) => v.chipClass);
      expect(new Set(classes).size).toBe(classes.length);
    });
  });

  describe('label resolution', () => {
    it('falls back to the variant default when label is not set', () => {
      const c = makeComponent();
      (c.status as any) = () => 'failing';
      (c.label as any) = () => null;
      expect(c.resolvedLabel()).toBe('Failing');
    });

    it('uses the provided label when passed', () => {
      const c = makeComponent();
      (c.status as any) = () => 'failing';
      (c.label as any) = () => '4 pods down';
      expect(c.resolvedLabel()).toBe('4 pods down');
    });
  });

  describe('sr-only text', () => {
    it('emits "<count> <label>" when count is set so SRs read deltas correctly', () => {
      const c = makeComponent();
      (c.status as any) = () => 'failing';
      (c.label as any) = () => null;
      (c.count as any) = () => 3;
      expect(c.srText()).toBe('3 Failing');
    });

    it('emits bare label when count is null', () => {
      const c = makeComponent();
      (c.status as any) = () => 'healthy';
      (c.label as any) = () => null;
      (c.count as any) = () => null;
      expect(c.srText()).toBe('Healthy');
    });
  });

  describe('fallback', () => {
    it('falls back to unknown variant when given a garbage status', () => {
      const c = makeComponent();
      (c.status as any) = () => 'garbage' as any;
      expect(c.variant().status).toBe('unknown');
    });
  });
});
