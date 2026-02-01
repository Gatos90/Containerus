import type { BlockId } from '../models/terminal-block.model';
import type { OutputBuffer } from '../models/terminal-output.model';
import type { OutputSectionType } from '../models/terminal-events';

type FlushCallback = (blockId: BlockId, buffer: OutputBuffer, appended: string) => void;

interface ChunkEntry {
  payload: string;
  sectionType: OutputSectionType;
}

export class OutputAppendPipeline {
  private readonly queue = new Map<BlockId, { buffer: OutputBuffer; chunks: ChunkEntry[] }>();
  private rafId: number | null = null;

  constructor(private readonly onFlush: FlushCallback) {}

  enqueue(
    blockId: BlockId,
    buffer: OutputBuffer,
    payload: string,
    sectionType: OutputSectionType = 'output'
  ): void {
    if (!payload) return;
    const entry = this.queue.get(blockId);
    if (entry) {
      entry.chunks.push({ payload, sectionType });
    } else {
      this.queue.set(blockId, { buffer, chunks: [{ payload, sectionType }] });
    }
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => this.flush());
  }

  clear(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.queue.clear();
  }

  private flush(): void {
    this.rafId = null;
    for (const [blockId, entry] of this.queue.entries()) {
      // Group consecutive chunks by section type for efficiency
      let currentType: OutputSectionType | null = null;
      let currentPayloads: string[] = [];

      for (const chunk of entry.chunks) {
        if (chunk.sectionType !== currentType) {
          // Flush previous group
          if (currentPayloads.length > 0 && currentType !== null) {
            const combined = currentPayloads.join('');
            entry.buffer.appendText(combined, currentType);
          }
          // Start new group
          currentType = chunk.sectionType;
          currentPayloads = [chunk.payload];
        } else {
          currentPayloads.push(chunk.payload);
        }
      }

      // Flush final group
      if (currentPayloads.length > 0 && currentType !== null) {
        const combined = currentPayloads.join('');
        entry.buffer.appendText(combined, currentType);
      }

      // Callback with total appended text
      const totalAppended = entry.chunks.map((c) => c.payload).join('');
      this.onFlush(blockId, entry.buffer, totalAppended);
    }
    this.queue.clear();
  }
}
