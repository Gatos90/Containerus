/**
 * ANSI Escape Sequence Parser for Warp Terminal
 *
 * Parses ANSI escape codes and converts text into styled spans.
 * Handles common SGR (Select Graphic Rendition) codes for styling.
 */

export interface ParsedSpan {
  text: string;
  styleToken: string;
}

export interface AnsiStyle {
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  blink: boolean;
  inverse: boolean;
  hidden: boolean;
  strikethrough: boolean;
  fgColor: number | null; // 0-7 standard, 8-15 bright, or null
  bgColor: number | null;
}

const DEFAULT_STYLE: AnsiStyle = {
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  blink: false,
  inverse: false,
  hidden: false,
  strikethrough: false,
  fgColor: null,
  bgColor: null,
};

/**
 * Convert AnsiStyle to a CSS class token string
 */
function styleToToken(style: AnsiStyle): string {
  const tokens: string[] = [];

  if (style.bold) tokens.push('bold');
  if (style.dim) tokens.push('dim');
  if (style.italic) tokens.push('italic');
  if (style.underline) tokens.push('underline');
  if (style.blink) tokens.push('blink');
  if (style.inverse) tokens.push('inverse');
  if (style.hidden) tokens.push('hidden');
  if (style.strikethrough) tokens.push('strikethrough');

  if (style.fgColor !== null) {
    if (style.fgColor < 8) {
      tokens.push(`fg-${style.fgColor}`);
    } else {
      tokens.push(`fg-bright-${style.fgColor - 8}`);
    }
  }

  if (style.bgColor !== null) {
    if (style.bgColor < 8) {
      tokens.push(`bg-${style.bgColor}`);
    } else {
      tokens.push(`bg-bright-${style.bgColor - 8}`);
    }
  }

  return tokens.length > 0 ? tokens.join(' ') : 'text';
}

/**
 * Apply SGR (Select Graphic Rendition) codes to style
 */
function applySgrCodes(codes: number[], style: AnsiStyle): AnsiStyle {
  const newStyle = { ...style };

  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];

    switch (code) {
      case 0: // Reset
        Object.assign(newStyle, DEFAULT_STYLE);
        break;
      case 1: // Bold
        newStyle.bold = true;
        break;
      case 2: // Dim/Faint
        newStyle.dim = true;
        break;
      case 3: // Italic
        newStyle.italic = true;
        break;
      case 4: // Underline
        newStyle.underline = true;
        break;
      case 5: // Blink
        newStyle.blink = true;
        break;
      case 7: // Inverse
        newStyle.inverse = true;
        break;
      case 8: // Hidden
        newStyle.hidden = true;
        break;
      case 9: // Strikethrough
        newStyle.strikethrough = true;
        break;
      case 21: // Double underline (or bold off on some terminals)
      case 22: // Normal intensity (bold/dim off)
        newStyle.bold = false;
        newStyle.dim = false;
        break;
      case 23: // Italic off
        newStyle.italic = false;
        break;
      case 24: // Underline off
        newStyle.underline = false;
        break;
      case 25: // Blink off
        newStyle.blink = false;
        break;
      case 27: // Inverse off
        newStyle.inverse = false;
        break;
      case 28: // Hidden off
        newStyle.hidden = false;
        break;
      case 29: // Strikethrough off
        newStyle.strikethrough = false;
        break;

      // Standard foreground colors (30-37)
      case 30: case 31: case 32: case 33:
      case 34: case 35: case 36: case 37:
        newStyle.fgColor = code - 30;
        break;

      case 38: // Extended foreground color
        // 38;5;n for 256-color, 38;2;r;g;b for true color
        // For now, skip the parameters
        if (codes[i + 1] === 5) {
          i += 2; // Skip 5;n
        } else if (codes[i + 1] === 2) {
          i += 4; // Skip 2;r;g;b
        }
        break;

      case 39: // Default foreground
        newStyle.fgColor = null;
        break;

      // Standard background colors (40-47)
      case 40: case 41: case 42: case 43:
      case 44: case 45: case 46: case 47:
        newStyle.bgColor = code - 40;
        break;

      case 48: // Extended background color
        if (codes[i + 1] === 5) {
          i += 2;
        } else if (codes[i + 1] === 2) {
          i += 4;
        }
        break;

      case 49: // Default background
        newStyle.bgColor = null;
        break;

      // Bright foreground colors (90-97)
      case 90: case 91: case 92: case 93:
      case 94: case 95: case 96: case 97:
        newStyle.fgColor = (code - 90) + 8;
        break;

      // Bright background colors (100-107)
      case 100: case 101: case 102: case 103:
      case 104: case 105: case 106: case 107:
        newStyle.bgColor = (code - 100) + 8;
        break;
    }
  }

  return newStyle;
}

/**
 * Parse ANSI escape sequences from text and return styled spans
 */
export function parseAnsi(text: string): ParsedSpan[] {
  const spans: ParsedSpan[] = [];
  let currentStyle: AnsiStyle = { ...DEFAULT_STYLE };
  let currentText = '';

  // Regex to match:
  // 1. CSI sequences: ESC [ ... (letter) - includes SGR codes
  // 2. OSC sequences: ESC ] ... (BEL or ST) - operating system commands
  // 3. Other escape sequences we want to strip
  const escapeRegex = /\x1b\[([?0-9;]*)([A-Za-z])|(\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?)|(\x1b[PX^_][^\x1b]*\x1b\\)|(\x1b.)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = escapeRegex.exec(text)) !== null) {
    // Add text before this escape sequence
    if (match.index > lastIndex) {
      currentText += text.slice(lastIndex, match.index);
    }

    if (match[1] !== undefined && match[2] !== undefined) {
      // CSI sequence: ESC [ params command
      const params = match[1];
      const command = match[2];

      if (command === 'm') {
        // SGR (Select Graphic Rendition) - styling codes
        // Flush current text with current style
        if (currentText) {
          spans.push({
            text: currentText,
            styleToken: styleToToken(currentStyle),
          });
          currentText = '';
        }

        // Parse and apply new codes
        const codes = params
          ? params.split(';').map((s) => parseInt(s, 10) || 0)
          : [0];
        currentStyle = applySgrCodes(codes, currentStyle);
      }
      // Other CSI commands (cursor movement, etc.) - strip them
    }
    // OSC, DCS, PM, APC sequences - strip them all

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    currentText += text.slice(lastIndex);
  }

  // Flush final span
  if (currentText) {
    spans.push({
      text: currentText,
      styleToken: styleToToken(currentStyle),
    });
  }

  // If no spans were created, return a single empty span
  if (spans.length === 0) {
    return [{ text: '', styleToken: 'text' }];
  }

  return spans;
}

/**
 * Strip all ANSI escape sequences from text (plain text output)
 */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[?0-9;]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[PX^_][^\x1b]*\x1b\\|\x1b./g, '');
}
