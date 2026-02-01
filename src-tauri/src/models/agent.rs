//! Agent Data Models
//!
//! Data models for the AI agent system.

use serde::{Deserialize, Serialize};

/// User preferences for agent behavior
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPreferences {
    /// Auto-execute safe commands without confirmation
    pub auto_execute_safe_commands: bool,
    /// Show the agent's thinking/reasoning process
    pub show_thinking_process: bool,
    /// Require confirmation for all commands (even safe ones)
    pub confirm_all_commands: bool,
    /// Maximum number of commands to auto-execute in sequence
    pub max_auto_execute_steps: i32,
    /// Timeout for confirmation dialogs (seconds)
    pub confirmation_timeout_secs: i32,
    /// Preferred shell (optional, uses system default if None)
    pub preferred_shell: Option<String>,
    /// Additional regex patterns to flag as dangerous
    pub dangerous_command_patterns: Vec<String>,
}

impl Default for AgentPreferences {
    fn default() -> Self {
        Self {
            auto_execute_safe_commands: true,
            show_thinking_process: false,
            confirm_all_commands: false,
            max_auto_execute_steps: 5,
            confirmation_timeout_secs: 300,
            preferred_shell: None,
            dangerous_command_patterns: vec![],
        }
    }
}

/// Session info returned to frontend
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionInfo {
    pub id: String,
    pub terminal_session_id: String,
    pub created_at: i64,
    pub last_activity: i64,
    pub has_pending_confirmation: bool,
    pub active_query_id: Option<String>,
}

/// Context block attached to agent query
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachedBlock {
    pub block_id: i64,
    pub command: String,
    pub output_preview: String,
    pub exit_code: Option<i32>,
}

/// Summary of current context for display
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextSummary {
    pub attached_blocks: Vec<AttachedBlock>,
    pub recent_commands: Vec<String>,
    pub cwd: String,
    pub git_branch: Option<String>,
}

/// Agent error type for Tauri commands
#[derive(Debug, Clone, Serialize, thiserror::Error)]
pub enum AgentError {
    #[error("Session not found: {0}")]
    SessionNotFound(String),

    #[error("Terminal session not found: {0}")]
    TerminalSessionNotFound(String),

    #[error("Query cancelled")]
    QueryCancelled,

    #[error("Provider unavailable: {0}")]
    ProviderUnavailable(String),

    #[error("Rate limited")]
    RateLimited,

    #[error("Context too large")]
    ContextTooLarge,

    #[error("Command execution failed: {0}")]
    CommandExecutionFailed(String),

    #[error("Confirmation timeout")]
    ConfirmationTimeout,

    #[error("Confirmation rejected")]
    ConfirmationRejected,

    #[error("Parse error: {0}")]
    ParseError(String),

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("Database error: {0}")]
    DatabaseError(String),
}

// Implement conversion from AgentError to String for Tauri
impl From<AgentError> for String {
    fn from(err: AgentError) -> Self {
        err.to_string()
    }
}
