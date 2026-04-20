/**
 * Connection identity palette — the single source of truth for turning a
 * `connectionId` into a (hue, glyph, text-color) triple shared across every
 * surface that shows backend ownership (ConnectionBadge, chrome, tabs, ACL
 * panes). Keeping this deterministic means refreshing a page never reshuffles
 * connection colors.
 *
 * Contrast contract: every (backgroundHsl, foregroundColor) pair returned here
 * is pre-validated to meet WCAG 2.2 AA (>= 4.5:1 contrast against the dark
 * app chrome). The PALETTE constant is tested for this in the unit spec; if
 * you add entries, the test must still pass.
 */

export interface ConnectionPaletteEntry {
  /** HSL background color used for the badge fill. */
  readonly background: string;
  /** Ring color used for focus / hover outline (higher saturation). */
  readonly ring: string;
  /** Foreground color for the glyph — pre-validated >= 4.5:1 vs background. */
  readonly foreground: string;
  /** Stable single-character glyph chosen so same-letter backends differ. */
  readonly glyphIndex: number;
}

/**
 * Curated palette. Each background is dark enough to sit on the app chrome
 * without a secondary border, and each (background, foreground) pair passes
 * 4.5:1 contrast. Do not remove entries — connection ids are hashed into this
 * array, so removing entries will reshuffle assignments for existing users.
 */
export const PALETTE: ReadonlyArray<Omit<ConnectionPaletteEntry, 'glyphIndex'>> = [
  { background: 'hsl(210 70% 35%)', ring: 'hsl(210 90% 60%)', foreground: '#ffffff' },
  { background: 'hsl(160 55% 30%)', ring: 'hsl(160 80% 55%)', foreground: '#ffffff' },
  { background: 'hsl(280 55% 38%)', ring: 'hsl(280 80% 65%)', foreground: '#ffffff' },
  { background: 'hsl(25 70% 38%)', ring: 'hsl(25 90% 60%)', foreground: '#ffffff' },
  { background: 'hsl(340 60% 40%)', ring: 'hsl(340 85% 65%)', foreground: '#ffffff' },
  { background: 'hsl(200 55% 32%)', ring: 'hsl(200 80% 58%)', foreground: '#ffffff' },
  { background: 'hsl(120 45% 30%)', ring: 'hsl(120 70% 50%)', foreground: '#ffffff' },
  { background: 'hsl(45 70% 35%)', ring: 'hsl(45 95% 60%)', foreground: '#0a0a0a' },
];

/**
 * Stable glyph alphabet. Keep to 1-character entries — the badge is a small
 * circle and multi-character glyphs collapse visually.
 */
export const GLYPHS: readonly string[] = [
  '●', '◆', '▲', '■', '◉', '◈', '★', '✦',
  '◇', '◎', '⬟', '⬢', '⬡', '⯁', '✸', '✺',
];

/**
 * Deterministic 32-bit FNV-1a hash. We use this instead of `String.prototype`
 * char sums so visually similar ids (e.g. `backend-01` / `backend-02`) land
 * on distinct palette slots.
 */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Resolve a connection id to a palette entry. Falls back to the first slot
 * for empty/null ids so the UI never crashes on a missing connection.
 */
export function paletteFor(connectionId: string | null | undefined): ConnectionPaletteEntry {
  if (!connectionId) {
    return { ...PALETTE[0], glyphIndex: 0 };
  }
  const h = hash(connectionId);
  const colorSlot = h % PALETTE.length;
  const glyphSlot = Math.floor(h / PALETTE.length) % GLYPHS.length;
  return { ...PALETTE[colorSlot], glyphIndex: glyphSlot };
}

/** Convenience helper — returns the glyph character instead of the index. */
export function glyphFor(connectionId: string | null | undefined): string {
  return GLYPHS[paletteFor(connectionId).glyphIndex] ?? GLYPHS[0];
}
