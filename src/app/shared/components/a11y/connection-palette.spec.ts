import { describe, it, expect } from 'vitest';
import { glyphFor, PALETTE, paletteFor } from './connection-palette';

/**
 * Parse an `hsl(H S% L%)` string into [H, S, L]. Returns null if unparseable.
 */
function parseHsl(hsl: string): [number, number, number] | null {
  const match = hsl.match(/^hsl\(\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s*\)$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Convert HSL (0-360, 0-100, 0-100) to sRGB in 0-1 range. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sN = s / 100;
  const lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp >= 0 && hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = lN - c / 2;
  return [r + m, g + m, b + m];
}

/** WCAG 2.1 relative luminance for sRGB 0-1 channels. */
function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

/** WCAG contrast ratio between two sRGB triples. */
function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

describe('connection-palette', () => {
  describe('contrast contract', () => {
    it.each(PALETTE.map((entry, idx) => [idx, entry] as const))(
      'palette[%i] foreground meets WCAG AA (>= 4.5:1) against its background',
      (_idx, entry) => {
        const hsl = parseHsl(entry.background);
        expect(hsl).not.toBeNull();
        const bgRgb = hslToRgb(...hsl!);
        const fgRgb = hexToRgb(entry.foreground);
        expect(contrastRatio(bgRgb, fgRgb)).toBeGreaterThanOrEqual(4.5);
      },
    );
  });

  describe('paletteFor()', () => {
    it('returns a stable assignment for the same id', () => {
      const a = paletteFor('backend-prod');
      const b = paletteFor('backend-prod');
      expect(a).toEqual(b);
    });

    it('distinguishes visually similar ids via FNV-1a hashing', () => {
      const a = paletteFor('backend-01');
      const b = paletteFor('backend-02');
      // Either color slot OR glyph index must differ.
      expect(a.background !== b.background || a.glyphIndex !== b.glyphIndex).toBe(true);
    });

    it('falls back to slot 0 for null/empty ids', () => {
      expect(paletteFor(null).background).toBe(PALETTE[0].background);
      expect(paletteFor('').background).toBe(PALETTE[0].background);
      expect(paletteFor(undefined).background).toBe(PALETTE[0].background);
    });

    it('glyphIndex is always within bounds', () => {
      for (const id of ['a', 'longer-id', 'prod', 'staging-east-2']) {
        const entry = paletteFor(id);
        expect(entry.glyphIndex).toBeGreaterThanOrEqual(0);
        expect(entry.glyphIndex).toBeLessThan(16);
      }
    });
  });

  describe('glyphFor()', () => {
    it('returns a single character', () => {
      const g = glyphFor('connection-x');
      // Glyphs are single unicode codepoints; String.from(...[...g]) === g.
      expect([...g]).toHaveLength(1);
    });

    it('is deterministic', () => {
      expect(glyphFor('anything')).toBe(glyphFor('anything'));
    });
  });
});
