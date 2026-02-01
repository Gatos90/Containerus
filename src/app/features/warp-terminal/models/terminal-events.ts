import type { BlockSource, BlockId } from './terminal-block.model';

/** Output section types for collapsible sections within a block */
export type OutputSectionType =
  | 'thinking'   // AI reasoning (always visible)
  | 'command'    // Command header like "$ docker ps" (always visible)
  | 'output'     // Terminal output (collapsible, collapsed by default)
  | 'response';  // AI text response (always visible)

export type TerminalEvent =
  | UserSubmittedCommand
  | BlockCreated
  | BlockStarted
  | BlockOutputChunk
  | BlockEnded
  | BlockCancelled
  | UserScrolled
  | UserSelectedBlock
  | UserToggledFollowMode
  | UserToggledSearch
  | AiThinkingStarted
  | AiThinkingEnded
  | AiErrorOccurred;

export interface UserSubmittedCommand {
  type: 'UserSubmittedCommand';
  text: string;
  source: BlockSource;
  /** Block IDs to attach as context for AI queries */
  contextBlockIds?: BlockId[];
}

export interface BlockCreated {
  type: 'BlockCreated';
  blockId: BlockId;
  commandText: string;
  source: BlockSource;
}

export interface BlockStarted {
  type: 'BlockStarted';
  blockId: BlockId;
  startedAt: number;
}

export interface BlockOutputChunk {
  type: 'BlockOutputChunk';
  blockId: BlockId;
  payload: string;
  /** Section type for collapsible output sections (defaults to 'output') */
  sectionType?: OutputSectionType;
}

export interface BlockEnded {
  type: 'BlockEnded';
  blockId: BlockId;
  exitCode: number;
  endedAt: number;
}

export interface BlockCancelled {
  type: 'BlockCancelled';
  blockId: BlockId;
  reason: string;
  endedAt: number;
}

export interface UserScrolled {
  type: 'UserScrolled';
}

export interface UserSelectedBlock {
  type: 'UserSelectedBlock';
  blockId: BlockId | null;
}

export interface UserToggledFollowMode {
  type: 'UserToggledFollowMode';
  on: boolean;
}

export interface UserToggledSearch {
  type: 'UserToggledSearch';
  open: boolean;
}

/** AI agent started thinking/processing */
export interface AiThinkingStarted {
  type: 'AiThinkingStarted';
  queryId: string;
}

/** AI agent finished thinking/processing */
export interface AiThinkingEnded {
  type: 'AiThinkingEnded';
  queryId: string;
}

/** AI agent encountered an error */
export interface AiErrorOccurred {
  type: 'AiErrorOccurred';
  queryId?: string;
  message: string;
  recoverable: boolean;
  suggestion?: string;
}
