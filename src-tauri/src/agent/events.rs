//! Agent Event Types
//!
//! Events emitted to the frontend during agent execution and
//! commands received from the frontend.

use serde::{Deserialize, Serialize};

/// Events emitted from the agent to the frontend
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AgentEvent {
    /// Agent is processing/thinking
    Thinking {
        session_id: String,
        query_id: String,
    },

    /// Streaming text response chunk from LLM
    ResponseChunk {
        session_id: String,
        query_id: String,
        chunk_type: ChunkType,
        content: String,
        is_final: bool,
    },

    /// Agent proposes a command to execute
    CommandProposed {
        session_id: String,
        query_id: String,
        command: String,
        explanation: String,
        danger_level: String,
        requires_confirmation: bool,
        affected_resources: Vec<String>,
    },

    /// Dangerous command requires user confirmation
    ConfirmationRequired {
        session_id: String,
        query_id: String,
        confirmation_id: String,
        command: String,
        explanation: String,
        risk_level: String,
        affected_resources: Vec<String>,
        warning: Option<String>,
        alternatives: Vec<CommandAlternative>,
    },

    /// Command execution started (emitted alongside terminal:block_created)
    CommandStarted {
        session_id: String,
        query_id: String,
        block_id: i64,
        command: String,
    },

    /// Command output chunk (for agent tracking, terminal:output handles display)
    CommandOutput {
        session_id: String,
        query_id: String,
        block_id: i64,
        payload: String,
    },

    /// Command completed (emitted alongside terminal:block_ended)
    CommandCompleted {
        session_id: String,
        query_id: String,
        block_id: i64,
        exit_code: i32,
        duration_ms: u64,
    },

    /// Tool was invoked by the agent
    ToolInvoked {
        session_id: String,
        query_id: String,
        tool_name: String,
        arguments: serde_json::Value,
    },

    /// Tool execution completed
    ToolCompleted {
        session_id: String,
        query_id: String,
        tool_name: String,
        result: String,
        duration_ms: u64,
    },

    /// Step in a multi-step workflow started
    StepStarted {
        session_id: String,
        query_id: String,
        step_index: usize,
        step_description: String,
    },

    /// Step in a multi-step workflow completed
    StepCompleted {
        session_id: String,
        query_id: String,
        step_index: usize,
        success: bool,
        output: Option<String>,
    },

    /// Agent query/workflow completed
    QueryCompleted {
        session_id: String,
        query_id: String,
        status: QueryCompletionStatus,
        summary: Option<String>,
        blocks_created: Vec<i64>,
    },

    /// Agent encountered an error
    Error {
        session_id: String,
        query_id: Option<String>,
        error_type: AgentErrorType,
        message: String,
        recoverable: bool,
        suggestion: Option<String>,
    },
}

/// Type of streaming response chunk
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChunkType {
    /// Agent reasoning (can be hidden in UI)
    Thinking,
    /// Plain text response
    Text,
    /// Shell command suggestion
    Command,
    /// Explanation of a command
    Explanation,
    /// Safety warning
    Warning,
}

/// Alternative command suggestion
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandAlternative {
    pub command: String,
    pub description: String,
    pub is_safer: bool,
}

/// Status when query completes
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QueryCompletionStatus {
    Success,
    PartialSuccess,
    Cancelled,
    Failed,
    AwaitingConfirmation,
}

/// Types of agent errors
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentErrorType {
    SessionNotFound,
    QueryCancelled,
    ProviderUnavailable,
    RateLimited,
    ContextTooLarge,
    CommandExecutionFailed,
    ConfirmationTimeout,
    ConfirmationRejected,
    ParseError,
    ToolError,
    StreamingFailed,
    Internal,
}

/// Commands sent from the frontend to the agent
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AgentCommand {
    /// User sends a prompt to the agent
    UserPrompt {
        session_id: String,
        text: String,
        attached_blocks: Option<Vec<i64>>,
    },

    /// User confirms a dangerous command
    ConfirmCommand {
        session_id: String,
        confirmation_id: String,
        confirmed: bool,
        use_alternative: Option<usize>,
    },

    /// User cancels current operation
    Cancel { session_id: String },

    /// User wants to inject a command directly
    InjectCommand { session_id: String, command: String },
}

/// Request to submit a query to the agent
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentQueryRequest {
    pub session_id: String,
    pub query: String,
    pub context_block_ids: Option<Vec<i64>>,
    pub auto_execute: bool,
    pub streaming: bool,
    /// Optional query ID - if provided, backend uses it; otherwise generates one
    pub query_id: Option<String>,
}

/// Response to a confirmation request
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmationResponse {
    pub confirmation_id: String,
    pub action: ConfirmationAction,
    pub use_alternative: Option<usize>,
}

/// Action taken on a confirmation request
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConfirmationAction {
    Approve,
    Reject,
    UseAlternative,
}
