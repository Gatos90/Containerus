import type { OutputBuffer } from './terminal-output.model';

export type BlockId = number;

export type BlockSource = 'user' | 'aiSuggested' | 'aiExecuted';

export type BlockStatus =
  | { state: 'queued' }
  | { state: 'running'; startedAt: number }
  | { state: 'finished'; exitCode: number; endedAt: number }
  | { state: 'cancelled'; reason: string; endedAt: number };

export interface BlockMetrics {
  bytesReceived: number;
  lineCount: number;
  durationMs?: number;
}

export interface CommandBlock {
  id: BlockId;
  commandText: string;
  source: BlockSource;
  status: BlockStatus;
  cwdLabel: string;
  hostLabel: string;
  renderState: OutputBuffer;
  metrics: BlockMetrics;
  isCollapsed: boolean;
}

export type SelectionState =
  | { kind: 'none' }
  | { kind: 'block'; blockId: BlockId }
  | { kind: 'text'; blockId: BlockId };

export interface SearchResult {
  blockId: BlockId;
  kind: 'command' | 'output';
  lineIndex?: number;
  preview: string;
}
