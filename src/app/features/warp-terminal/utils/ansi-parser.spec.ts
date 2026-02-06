import { describe, it, expect } from 'vitest';
import { parseAnsi, stripAnsi } from './ansi-parser';

describe('AnsiParser', () => {
  describe('parseAnsi', () => {
    it('should parse plain text without ANSI codes', () => {
      const spans = parseAnsi('hello world');
      expect(spans).toHaveLength(1);
      expect(spans[0].text).toBe('hello world');
      expect(spans[0].styleToken).toBe('text');
    });

    it('should return empty span for empty string', () => {
      const spans = parseAnsi('');
      expect(spans).toHaveLength(1);
      expect(spans[0].text).toBe('');
      expect(spans[0].styleToken).toBe('text');
    });

    it('should parse bold text', () => {
      const spans = parseAnsi('\x1b[1mhello\x1b[0m');
      expect(spans.length).toBeGreaterThanOrEqual(1);
      const boldSpan = spans.find((s) => s.text === 'hello');
      expect(boldSpan).toBeTruthy();
      expect(boldSpan!.styleToken).toContain('bold');
    });

    it('should parse foreground colors (30-37)', () => {
      // Red foreground (31)
      const spans = parseAnsi('\x1b[31mred text\x1b[0m');
      const redSpan = spans.find((s) => s.text === 'red text');
      expect(redSpan).toBeTruthy();
      expect(redSpan!.styleToken).toContain('fg-1');
    });

    it('should parse green foreground', () => {
      const spans = parseAnsi('\x1b[32mgreen\x1b[0m');
      const span = spans.find((s) => s.text === 'green');
      expect(span!.styleToken).toContain('fg-2');
    });

    it('should parse background colors (40-47)', () => {
      // Blue background (44)
      const spans = parseAnsi('\x1b[44mblue bg\x1b[0m');
      const span = spans.find((s) => s.text === 'blue bg');
      expect(span).toBeTruthy();
      expect(span!.styleToken).toContain('bg-4');
    });

    it('should parse bright foreground colors (90-97)', () => {
      const spans = parseAnsi('\x1b[91mbright red\x1b[0m');
      const span = spans.find((s) => s.text === 'bright red');
      expect(span!.styleToken).toContain('fg-bright-1');
    });

    it('should parse bright background colors (100-107)', () => {
      const spans = parseAnsi('\x1b[104mbright blue bg\x1b[0m');
      const span = spans.find((s) => s.text === 'bright blue bg');
      expect(span!.styleToken).toContain('bg-bright-4');
    });

    it('should parse combined styles', () => {
      // Bold + Red + Underline
      const spans = parseAnsi('\x1b[1;31;4mstyled\x1b[0m');
      const span = spans.find((s) => s.text === 'styled');
      expect(span).toBeTruthy();
      expect(span!.styleToken).toContain('bold');
      expect(span!.styleToken).toContain('fg-1');
      expect(span!.styleToken).toContain('underline');
    });

    it('should handle reset code (0)', () => {
      const spans = parseAnsi('\x1b[1mbold\x1b[0mnormal');
      expect(spans.length).toBeGreaterThanOrEqual(2);
      const normalSpan = spans.find((s) => s.text === 'normal');
      expect(normalSpan!.styleToken).toBe('text');
    });

    it('should parse dim text', () => {
      const spans = parseAnsi('\x1b[2mdim\x1b[0m');
      const span = spans.find((s) => s.text === 'dim');
      expect(span!.styleToken).toContain('dim');
    });

    it('should parse italic text', () => {
      const spans = parseAnsi('\x1b[3mitalic\x1b[0m');
      const span = spans.find((s) => s.text === 'italic');
      expect(span!.styleToken).toContain('italic');
    });

    it('should parse strikethrough text', () => {
      const spans = parseAnsi('\x1b[9mstrike\x1b[0m');
      const span = spans.find((s) => s.text === 'strike');
      expect(span!.styleToken).toContain('strikethrough');
    });

    it('should handle style disable codes', () => {
      // Bold on, then bold off (22)
      const spans = parseAnsi('\x1b[1mbold\x1b[22mnot bold');
      const normalSpan = spans.find((s) => s.text === 'not bold');
      expect(normalSpan!.styleToken).not.toContain('bold');
    });

    it('should handle default foreground reset (39)', () => {
      const spans = parseAnsi('\x1b[31mred\x1b[39mdefault');
      const defaultSpan = spans.find((s) => s.text === 'default');
      expect(defaultSpan!.styleToken).not.toContain('fg-');
    });

    it('should handle default background reset (49)', () => {
      const spans = parseAnsi('\x1b[41mred bg\x1b[49mdefault bg');
      const defaultSpan = spans.find((s) => s.text === 'default bg');
      expect(defaultSpan!.styleToken).not.toContain('bg-');
    });

    it('should strip cursor movement sequences', () => {
      // Cursor up: ESC[1A
      const spans = parseAnsi('before\x1b[1Aafter');
      const allText = spans.map((s) => s.text).join('');
      expect(allText).toBe('beforeafter');
    });

    it('should strip OSC sequences', () => {
      // OSC title sequence: ESC ] 0;title BEL
      const spans = parseAnsi('hello\x1b]0;window title\x07world');
      const allText = spans.map((s) => s.text).join('');
      expect(allText).toBe('helloworld');
    });

    it('should handle multiple color changes', () => {
      const input = '\x1b[31mred\x1b[32mgreen\x1b[34mblue\x1b[0m';
      const spans = parseAnsi(input);
      expect(spans.length).toBeGreaterThanOrEqual(3);

      const red = spans.find((s) => s.text === 'red');
      const green = spans.find((s) => s.text === 'green');
      const blue = spans.find((s) => s.text === 'blue');

      expect(red!.styleToken).toContain('fg-1');
      expect(green!.styleToken).toContain('fg-2');
      expect(blue!.styleToken).toContain('fg-4');
    });

    it('should handle SGR with no parameters as reset', () => {
      const spans = parseAnsi('\x1b[1mbold\x1b[mreset');
      const resetSpan = spans.find((s) => s.text === 'reset');
      expect(resetSpan!.styleToken).toBe('text');
    });

    it('should handle inverse style', () => {
      const spans = parseAnsi('\x1b[7minverse\x1b[0m');
      const span = spans.find((s) => s.text === 'inverse');
      expect(span!.styleToken).toContain('inverse');
    });

    it('should handle hidden style', () => {
      const spans = parseAnsi('\x1b[8mhidden\x1b[0m');
      const span = spans.find((s) => s.text === 'hidden');
      expect(span!.styleToken).toContain('hidden');
    });
  });

  describe('stripAnsi', () => {
    it('should return plain text unchanged', () => {
      expect(stripAnsi('hello world')).toBe('hello world');
    });

    it('should strip color codes', () => {
      expect(stripAnsi('\x1b[31mhello\x1b[0m')).toBe('hello');
    });

    it('should strip bold codes', () => {
      expect(stripAnsi('\x1b[1mbold\x1b[0m text')).toBe('bold text');
    });

    it('should strip combined codes', () => {
      expect(stripAnsi('\x1b[1;31;4mstyled\x1b[0m')).toBe('styled');
    });

    it('should strip cursor movement', () => {
      expect(stripAnsi('line1\x1b[Aline2')).toBe('line1line2');
    });

    it('should strip OSC sequences', () => {
      expect(stripAnsi('\x1b]0;title\x07text')).toBe('text');
    });

    it('should handle empty string', () => {
      expect(stripAnsi('')).toBe('');
    });

    it('should handle string with only ANSI codes', () => {
      expect(stripAnsi('\x1b[31m\x1b[0m')).toBe('');
    });

    it('should handle multiple ANSI sequences', () => {
      const input = '\x1b[1mbold\x1b[0m \x1b[31mred\x1b[0m \x1b[4munderline\x1b[0m';
      expect(stripAnsi(input)).toBe('bold red underline');
    });
  });
});
