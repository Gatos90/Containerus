import { Injectable } from '@angular/core';
import { marked, type MarkedOptions } from 'marked';

/**
 * Service for parsing markdown content to HTML.
 * Uses the `marked` library with GitHub Flavored Markdown support.
 */
@Injectable({ providedIn: 'root' })
export class MarkdownService {
  constructor() {
    // Configure marked options
    const options: MarkedOptions = {
      breaks: false, // Don't convert \n to <br> - this breaks table parsing
      gfm: true, // GitHub Flavored Markdown
    };
    marked.setOptions(options);
  }

  /**
   * Parse markdown string to HTML.
   * @param markdown The markdown content to parse
   * @returns HTML string
   */
  parse(markdown: string): string {
    return marked.parse(markdown, { async: false }) as string;
  }

  /**
   * Parse markdown incrementally during streaming.
   * Detects incomplete structures (tables, code blocks) and renders them as raw text
   * while parsing complete sections as markdown.
   *
   * @param markdown The markdown content (potentially incomplete)
   * @returns HTML string with complete parts rendered, incomplete parts as preformatted text
   */
  parseIncremental(markdown: string): string {
    const { complete, incomplete } = this.splitAtIncompleteStructure(markdown);

    let html = '';
    if (complete) {
      html += this.parse(complete);
    }
    if (incomplete) {
      html += `<pre class="streaming-text">${this.escapeHtml(incomplete)}</pre>`;
    }
    return html;
  }

  /**
   * Split markdown content at incomplete structures.
   * Returns complete content that can be safely parsed and incomplete content to show as-is.
   */
  private splitAtIncompleteStructure(text: string): {
    complete: string;
    incomplete: string;
  } {
    const lines = text.split('\n');

    // Check for incomplete code block (odd number of ``` markers)
    const codeBlockMarkers = (text.match(/^```/gm) || []).length;
    if (codeBlockMarkers % 2 !== 0) {
      // Find the last opening ``` and split there
      const lastOpening = text.lastIndexOf('```');
      if (lastOpening > 0) {
        return {
          complete: text.slice(0, lastOpening).trimEnd(),
          incomplete: text.slice(lastOpening),
        };
      }
      // Entire content is an incomplete code block
      return { complete: '', incomplete: text };
    }

    // Check for incomplete table (ends with a table row)
    // A table row starts with | and we need at least header + separator + 1 row
    const tablePattern = /^\|.*\|$/;
    let tableStartIndex = -1;
    let inTable = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const isTableRow = tablePattern.test(line);
      const isSeparator = /^\|[-:\s|]+\|$/.test(line);

      if (isTableRow && !inTable) {
        tableStartIndex = i;
        inTable = true;
      } else if (inTable && !isTableRow && !isSeparator && line !== '') {
        // Table ended, reset
        inTable = false;
        tableStartIndex = -1;
      }
    }

    // If we're still in a table at the end, check if it's complete
    if (inTable && tableStartIndex >= 0) {
      const tableLines = lines.slice(tableStartIndex);
      // A complete table needs: header row, separator row, at least one data row
      // and should end with a complete row (not mid-line)
      const hasHeader = tableLines.length >= 1;
      const hasSeparator = tableLines.length >= 2 && /^\|[-:\s|]+\|$/.test(tableLines[1].trim());

      // Check if the last line looks incomplete (doesn't end with |)
      const lastLine = lines[lines.length - 1];
      const lastLineIncomplete =
        lastLine.includes('|') && !lastLine.trim().endsWith('|');

      if (!hasHeader || !hasSeparator || lastLineIncomplete) {
        // Table is incomplete
        if (tableStartIndex > 0) {
          return {
            complete: lines.slice(0, tableStartIndex).join('\n').trimEnd(),
            incomplete: lines.slice(tableStartIndex).join('\n'),
          };
        }
        return { complete: '', incomplete: text };
      }
    }

    // No incomplete structures found
    return { complete: text, incomplete: '' };
  }

  /**
   * Escape HTML special characters for safe display.
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
