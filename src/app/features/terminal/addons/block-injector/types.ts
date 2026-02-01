import type { IMarker, IDecoration } from '@xterm/xterm';
import type { ShellCommandResponse } from '../../../../core/models/ai-settings.model';

/**
 * Types of blocks that can be injected into the terminal
 */
export type BlockType =
  | 'command'
  | 'ai-prompt'
  | 'ai-response'
  | 'ai-command'
  | 'directory'
  | 'status'
  | 'session-divider';

/**
 * Handle to a block managed by the BlockInjectorAddon
 */
export interface BlockHandle {
  /** Unique identifier for this block */
  id: string;
  /** Type of block */
  type: BlockType;
  /** xterm marker tracking the buffer line */
  marker: IMarker;
  /** xterm decoration for positioning */
  decoration: IDecoration;
  /** DOM container element for Angular component mounting */
  container: HTMLElement | null;
}

/**
 * Data associated with a block
 */
export interface BlockData {
  /** Unique identifier */
  id: string;
  /** Type of block */
  type: BlockType;
  /** Timestamp when block was created */
  timestamp: Date;
  /** Whether the block is collapsed */
  isCollapsed: boolean;
}

/**
 * Command block specific data
 */
export interface CommandBlockData extends BlockData {
  type: 'command';
  /** The command that was executed */
  command: string;
  /** Exit code (null while running) */
  exitCode: number | null;
  /** Current status */
  status: 'running' | 'completed' | 'failed';
  /** Working directory when command was run */
  workingDirectory?: string;
  /** Duration in milliseconds */
  duration?: number;
}

/**
 * AI prompt block specific data
 */
export interface AIPromptBlockData extends BlockData {
  type: 'ai-prompt';
  /** The user's query */
  query: string;
  /** Number of context lines included */
  contextLines?: number;
  /** The actual terminal context content (for hover display) */
  contextContent?: string;
  /** Whether we're waiting for AI response */
  isLoading?: boolean;
}

/**
 * AI response block specific data
 */
export interface AIResponseBlockData extends BlockData {
  type: 'ai-response';
  /** The AI's text response */
  content: string;
  /** Whether response is still streaming */
  isStreaming: boolean;
}

/**
 * AI command block specific data
 */
export interface AICommandBlockData extends BlockData {
  type: 'ai-command';
  /** The user's AI query */
  query: string;
  /** Number of context lines included */
  contextLines?: number;
  /** Whether we're still waiting for AI response */
  isLoading: boolean;
  /** The suggested command */
  command: string;
  /** Explanation of what the command does */
  explanation: string;
  /** Whether the command is potentially dangerous */
  isDangerous: boolean;
  /** Whether the command requires sudo */
  requiresSudo: boolean;
  /** Files that will be affected */
  affectsFiles: string[];
  /** Alternative commands */
  alternatives: Array<{ command: string; description: string }>;
  /** Warning message if any */
  warning?: string;
  /** Status of this command suggestion */
  status: 'pending' | 'inserted' | 'executed' | 'rejected';
}

/**
 * Directory header block data
 */
export interface DirectoryBlockData extends BlockData {
  type: 'directory';
  /** Current path */
  path: string;
  /** Git branch if in a git repo */
  gitBranch?: string;
  /** Git status */
  gitStatus?: 'clean' | 'modified' | 'ahead' | 'behind';
}

/**
 * Status block data
 */
export interface StatusBlockData extends BlockData {
  type: 'status';
  /** Status type */
  statusType: 'stopped' | 'running' | 'error' | 'warning' | 'info';
  /** Status message */
  message: string;
  /** Additional details */
  details?: string;
}

/**
 * Session divider block data
 */
export interface SessionDividerBlockData extends BlockData {
  type: 'session-divider';
  /** Session timestamp */
  sessionTimestamp: Date;
}

/**
 * Union type for all block data types
 */
export type AnyBlockData =
  | CommandBlockData
  | AIPromptBlockData
  | AIResponseBlockData
  | AICommandBlockData
  | DirectoryBlockData
  | StatusBlockData
  | SessionDividerBlockData;

/**
 * Events emitted by the CommandDetector
 */
export type CommandEvent =
  | { type: 'command-start'; line: number; command: string }
  | { type: 'command-end'; line: number; exitCode?: number }
  | { type: 'prompt-detected'; line: number };

/**
 * Options for creating a block
 */
export interface CreateBlockOptions {
  /** Type of block to create */
  type: BlockType;
  /** Height in terminal rows (default varies by type) */
  heightInRows?: number;
  /** Initial data for the block */
  data?: Partial<AnyBlockData>;
  /** Cursor Y offset for marker placement (default: 0 = current line) */
  cursorYOffset?: number;
}

/**
 * Callback type for container ready event
 */
export type OnContainerReadyCallback = (handle: BlockHandle, data: AnyBlockData) => void;

/**
 * Callback type for block update event
 */
export type OnBlockUpdateCallback = (id: string, data: AnyBlockData) => void;

/**
 * Callback type for block removal event
 */
export type OnBlockRemoveCallback = (id: string) => void;

/**
 * Helper to create AI command block data from ShellCommandResponse
 * Note: query and contextLines should be provided separately when creating the block
 */
export function createAICommandBlockDataFromResponse(
  response: ShellCommandResponse
): Omit<AICommandBlockData, 'id' | 'timestamp' | 'isCollapsed' | 'type' | 'query' | 'contextLines'> {
  return {
    isLoading: false,
    command: response.command,
    explanation: response.explanation,
    isDangerous: response.is_dangerous,
    requiresSudo: response.requires_sudo,
    affectsFiles: response.affects_files,
    alternatives: response.alternatives.map((alt) => ({
      command: alt.command,
      description: alt.description,
    })),
    warning: response.warning ?? undefined,
    status: 'pending',
  };
}
