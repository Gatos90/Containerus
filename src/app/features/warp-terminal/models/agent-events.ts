/**
 * Agent Event Types
 *
 * TypeScript types matching the Rust agent event types from
 * src-tauri/src/agent/events.rs and src-tauri/src/models/agent.rs
 */

/** Agent session information returned from backend */
export interface AgentSessionInfo {
  id: string;
  terminalSessionId: string;
  createdAt: number;
  lastActivity: number;
  hasPendingConfirmation: boolean;
  activeQueryId: string | null;
}

/** Request to submit a query to the agent */
export interface AgentQueryRequest {
  sessionId: string;
  query: string;
  contextBlockIds?: number[];
  autoExecute: boolean;
  streaming: boolean;
  /** Optional query ID - frontend generates to avoid race condition */
  queryId?: string;
}

/** Chunk types for streaming responses */
export type ChunkType = 'thinking' | 'text' | 'command' | 'explanation' | 'warning';

/** Query completion status */
export type QueryCompletionStatus =
  | 'success'
  | 'partial_success'
  | 'cancelled'
  | 'failed'
  | 'awaiting_confirmation';

/** Agent error types */
export type AgentErrorType =
  | 'session_not_found'
  | 'query_cancelled'
  | 'provider_unavailable'
  | 'rate_limited'
  | 'context_too_large'
  | 'command_execution_failed'
  | 'confirmation_timeout'
  | 'confirmation_rejected'
  | 'parse_error'
  | 'tool_error'
  | 'streaming_failed'
  | 'internal';

/** Base interface for agent events with session_id */
interface AgentEventBase {
  sessionId: string;
}

/** Agent is processing/thinking */
export interface AgentThinkingEvent extends AgentEventBase {
  type: 'thinking';
  queryId: string;
}

/** Streaming response chunk from LLM */
export interface AgentResponseChunkEvent extends AgentEventBase {
  type: 'responseChunk';
  queryId: string;
  chunkType: ChunkType;
  content: string;
  isFinal: boolean;
}

/** Agent proposes a command to execute */
export interface AgentCommandProposedEvent extends AgentEventBase {
  type: 'commandProposed';
  queryId: string;
  command: string;
  explanation: string;
  dangerLevel: string;
  requiresConfirmation: boolean;
  affectedResources: string[];
}

/** Alternative command suggestion */
export interface CommandAlternative {
  command: string;
  description: string;
  isSafer: boolean;
}

/** Dangerous command requires user confirmation */
export interface AgentConfirmationRequiredEvent extends AgentEventBase {
  type: 'confirmationRequired';
  queryId: string;
  confirmationId: string;
  command: string;
  explanation: string;
  riskLevel: string;
  affectedResources: string[];
  warning?: string;
  alternatives: CommandAlternative[];
}

/** Command execution started */
export interface AgentCommandStartedEvent extends AgentEventBase {
  type: 'commandStarted';
  queryId: string;
  blockId: number;
  command: string;
}

/** Command output chunk */
export interface AgentCommandOutputEvent extends AgentEventBase {
  type: 'commandOutput';
  queryId: string;
  blockId: number;
  payload: string;
}

/** Command execution completed */
export interface AgentCommandCompletedEvent extends AgentEventBase {
  type: 'commandCompleted';
  queryId: string;
  blockId: number;
  exitCode: number;
  durationMs: number;
}

/** Tool was invoked by the agent */
export interface AgentToolInvokedEvent extends AgentEventBase {
  type: 'toolInvoked';
  queryId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

/** Tool execution completed */
export interface AgentToolCompletedEvent extends AgentEventBase {
  type: 'toolCompleted';
  queryId: string;
  toolName: string;
  result: string;
  durationMs: number;
}

/** Step in multi-step workflow started */
export interface AgentStepStartedEvent extends AgentEventBase {
  type: 'stepStarted';
  queryId: string;
  stepIndex: number;
  stepDescription: string;
}

/** Step in multi-step workflow completed */
export interface AgentStepCompletedEvent extends AgentEventBase {
  type: 'stepCompleted';
  queryId: string;
  stepIndex: number;
  success: boolean;
  output?: string;
}

/** Agent query/workflow completed */
export interface AgentQueryCompletedEvent extends AgentEventBase {
  type: 'queryCompleted';
  queryId: string;
  status: QueryCompletionStatus;
  summary?: string;
  blocksCreated: number[];
}

/** Agent encountered an error */
export interface AgentErrorEvent extends AgentEventBase {
  type: 'error';
  queryId?: string;
  errorType: AgentErrorType;
  message: string;
  recoverable: boolean;
  suggestion?: string;
}

/** Union type of all agent events */
export type AgentEvent =
  | AgentThinkingEvent
  | AgentResponseChunkEvent
  | AgentCommandProposedEvent
  | AgentConfirmationRequiredEvent
  | AgentCommandStartedEvent
  | AgentCommandOutputEvent
  | AgentCommandCompletedEvent
  | AgentToolInvokedEvent
  | AgentToolCompletedEvent
  | AgentStepStartedEvent
  | AgentStepCompletedEvent
  | AgentQueryCompletedEvent
  | AgentErrorEvent;

/** Confirmation action types */
export type ConfirmationAction = 'approve' | 'reject' | 'use_alternative';

/** Response to a confirmation request */
export interface ConfirmationResponse {
  confirmationId: string;
  action: ConfirmationAction;
  useAlternative?: number;
}

/** Context summary for display */
export interface ContextSummary {
  attachedBlocks: number[];
  recentCommands: string[];
  cwd: string;
  gitBranch?: string;
}

/** Agent preferences */
export interface AgentPreferences {
  autoExecuteSafeCommands: boolean;
  confirmAllCommands: boolean;
  maxAutoExecuteSteps: number;
  confirmationTimeoutSecs: number;
}
