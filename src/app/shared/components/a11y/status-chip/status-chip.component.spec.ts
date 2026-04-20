import { describe, it, expect } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { CHIP_VARIANTS, StatusChipComponent } from './status-chip.component';

/**
 * Tailwind v4 palette hexes (sRGB sample of the theme.css oklch values). We
 * pin these inline so the contrast check does not drift silently if a future
 * Tailwind upgrade retargets a token. If the upgrade moves these values, bump
 * both the constant and re-verify contrast.
 */
const TAILWIND_HEX: Record<string, string> = {
  'bg-emerald-700': '#047857',
  'bg-amber-600': '#d97706',
  'bg-red-700': '#b91c1c',
  'bg-zinc-700': '#3f3f46',
  'text-white': '#ffffff',
  'text-zinc-100': '#f4f4f5',
  'text-zinc-950': '#09090b',
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function splitChipClass(chipClass: string): { bg: string; fg: string } {
  const parts = chipClass.split(/\s+/);
  const bg = parts.find((c) => c.startsWith('bg-'));
  const fg = parts.find((c) => c.startsWith('text-'));
  if (!bg || !fg) {
    throw new Error(`Chip class must include a bg- and text- token: "${chipClass}"`);
  }
  return { bg, fg };
}

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

  describe('contrast contract', () => {
    it.each(Object.values(CHIP_VARIANTS).map((v) => [v.status, v.chipClass] as const))(
      '%s variant meets WCAG AA (>= 4.5:1) for its bg + text tokens',
      (_status, chipClass) => {
        const { bg, fg } = splitChipClass(chipClass);
        const bgHex = TAILWIND_HEX[bg];
        const fgHex = TAILWIND_HEX[fg];
        expect(bgHex, `missing tailwind sample for ${bg}`).toBeDefined();
        expect(fgHex, `missing tailwind sample for ${fg}`).toBeDefined();
        const ratio = contrastRatio(hexToRgb(bgHex!), hexToRgb(fgHex!));
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      },
    );
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
