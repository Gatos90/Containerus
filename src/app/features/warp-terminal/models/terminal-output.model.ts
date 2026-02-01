import { signal } from '@angular/core';
import { parseAnsi } from '../utils/ansi-parser';
import type { OutputSectionType } from './terminal-events';

export type OutputChunkKind = 'text' | 'control' | 'marker';

export interface OutputChunk {
  kind: OutputChunkKind;
  payload: string;
  timestamp: number;
}

export interface LineRef {
  chunkIndex: number;
  start: number;
  end: number;
  /** Section this line belongs to */
  sectionId: string;
}

export interface Span {
  text: string;
  styleToken: string;
}

export interface RenderedLine {
  spans: Span[];
}

/** A section of output within a block (thinking, command, output, response) */
export interface OutputSection {
  id: string;
  type: OutputSectionType;
  startLine: number;
  endLine: number; // exclusive
  isCollapsed: boolean;
  lineCount: number;
}

let sectionIdCounter = 0;
function generateSectionId(): string {
  return `section-${++sectionIdCounter}`;
}

export class OutputBuffer {
  readonly version = signal(0);

  private readonly chunks: OutputChunk[] = [];
  private readonly lineIndex: LineRef[] = [];
  private pendingText = '';
  private pendingSectionType: OutputSectionType = 'output';

  private byteCount = 0;

  /** Sections in order of appearance */
  private readonly sections: OutputSection[] = [];
  private currentSectionId: string | null = null;
  private currentSectionType: OutputSectionType | null = null;

  /**
   * Append text to the buffer with an optional section type.
   * When section type changes, a new section is started.
   */
  appendText(payload: string, sectionType: OutputSectionType = 'output'): void {
    if (!payload) return;

    // Check if we need to start a new section
    if (sectionType !== this.currentSectionType) {
      // Flush any pending text to the OLD section before starting new one
      if (this.pendingText && this.currentSectionId) {
        // Force the pending text as a complete line in the current section
        const chunkIndex = this.chunks.length;
        this.chunks.push({
          kind: 'text',
          payload: this.pendingText,
          timestamp: Date.now(),
        });
        this.lineIndex.push({
          chunkIndex,
          start: 0,
          end: this.pendingText.length,
          sectionId: this.currentSectionId,
        });
        // Update the old section's end line
        const oldSection = this.sections.find((s) => s.id === this.currentSectionId);
        if (oldSection) {
          oldSection.endLine = this.lineIndex.length;
          oldSection.lineCount = oldSection.endLine - oldSection.startLine;
        }
        this.pendingText = '';
      }
      this.startNewSection(sectionType);
    }

    const combined = this.pendingText + payload;
    // Normalize line endings: CRLF -> LF, then REMOVE standalone CR (cursor control chars)
    const normalized = combined.replace(/\r\n/g, '\n').replace(/\r/g, '');
    const parts = normalized.split('\n');
    const hasTrailingNewline = normalized.endsWith('\n');
    const completeLines = hasTrailingNewline ? parts.slice(0, -1) : parts.slice(0, -1);
    const nextPending = hasTrailingNewline ? '' : parts[parts.length - 1];

    if (completeLines.length > 0) {
      const chunkText = completeLines.join('\n');
      const chunkIndex = this.chunks.length;
      this.chunks.push({
        kind: 'text',
        payload: chunkText,
        timestamp: Date.now(),
      });

      let offset = 0;
      for (const line of completeLines) {
        const start = offset;
        const end = offset + line.length;
        this.lineIndex.push({
          chunkIndex,
          start,
          end,
          sectionId: this.currentSectionId!,
        });
        offset = end + 1;

        // Update current section's end line
        if (this.currentSectionId) {
          const section = this.sections.find((s) => s.id === this.currentSectionId);
          if (section) {
            section.endLine = this.lineIndex.length;
            section.lineCount = section.endLine - section.startLine;
          }
        }
      }
    }

    this.pendingText = nextPending;
    this.pendingSectionType = sectionType;
    this.byteCount += payload.length;
    this.version.update((v) => v + 1);
  }

  private startNewSection(sectionType: OutputSectionType): void {
    const newSectionId = generateSectionId();
    const startLine = this.lineIndex.length;

    // Default collapse state: 'output' sections are collapsed by default
    const isCollapsed = sectionType === 'output';

    this.sections.push({
      id: newSectionId,
      type: sectionType,
      startLine,
      endLine: startLine,
      isCollapsed,
      lineCount: 0,
    });

    this.currentSectionId = newSectionId;
    this.currentSectionType = sectionType;
  }

  getLineCount(): number {
    return this.pendingText ? this.lineIndex.length + 1 : this.lineIndex.length;
  }

  getBytes(): number {
    return this.byteCount;
  }

  getLine(index: number): RenderedLine {
    if (index < this.lineIndex.length) {
      const ref = this.lineIndex[index];
      const chunk = this.chunks[ref.chunkIndex];
      const text = chunk.payload.slice(ref.start, ref.end);
      return { spans: parseAnsi(text) };
    }

    if (index === this.lineIndex.length && this.pendingText) {
      return { spans: parseAnsi(this.pendingText) };
    }

    return { spans: [{ text: '', styleToken: 'text' }] };
  }

  getLines(start: number, end: number): RenderedLine[] {
    const lines: RenderedLine[] = [];
    const max = Math.min(end, this.getLineCount());
    for (let i = start; i < max; i += 1) {
      lines.push(this.getLine(i));
    }
    return lines;
  }

  /** Get all sections in order */
  getSections(): OutputSection[] {
    return [...this.sections];
  }

  /** Get lines for a specific section */
  getLinesForSection(sectionId: string): RenderedLine[] {
    const section = this.sections.find((s) => s.id === sectionId);
    if (!section) return [];
    return this.getLines(section.startLine, section.endLine);
  }

  /** Toggle collapse state for a section */
  toggleSectionCollapse(sectionId: string): void {
    const section = this.sections.find((s) => s.id === sectionId);
    if (section) {
      section.isCollapsed = !section.isCollapsed;
      this.version.update((v) => v + 1);
    }
  }

  /** Set collapse state for a section */
  setSectionCollapsed(sectionId: string, collapsed: boolean): void {
    const section = this.sections.find((s) => s.id === sectionId);
    if (section && section.isCollapsed !== collapsed) {
      section.isCollapsed = collapsed;
      this.version.update((v) => v + 1);
    }
  }

  getAllText(): string {
    const lines: string[] = [];
    for (let i = 0; i < this.lineIndex.length; i += 1) {
      const ref = this.lineIndex[i];
      const chunk = this.chunks[ref.chunkIndex];
      lines.push(chunk.payload.slice(ref.start, ref.end));
    }
    if (this.pendingText) {
      lines.push(this.pendingText);
    }
    return lines.join('\n');
  }
}
