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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_preferences_default() {
        let prefs = AgentPreferences::default();
        assert!(prefs.auto_execute_safe_commands);
        assert!(!prefs.show_thinking_process);
        assert!(!prefs.confirm_all_commands);
        assert_eq!(prefs.max_auto_execute_steps, 5);
        assert_eq!(prefs.confirmation_timeout_secs, 300);
        assert!(prefs.preferred_shell.is_none());
        assert!(prefs.dangerous_command_patterns.is_empty());
    }

    #[test]
    fn test_agent_preferences_serialization() {
        let prefs = AgentPreferences {
            auto_execute_safe_commands: false,
            show_thinking_process: true,
            confirm_all_commands: true,
            max_auto_execute_steps: 10,
            confirmation_timeout_secs: 60,
            preferred_shell: Some("/bin/zsh".to_string()),
            dangerous_command_patterns: vec!["rm -rf".to_string()],
        };

        let json = serde_json::to_string(&prefs).unwrap();
        let deserialized: AgentPreferences = serde_json::from_str(&json).unwrap();
        assert!(!deserialized.auto_execute_safe_commands);
        assert!(deserialized.show_thinking_process);
        assert_eq!(deserialized.max_auto_execute_steps, 10);
        assert_eq!(deserialized.preferred_shell.as_deref(), Some("/bin/zsh"));
        assert_eq!(deserialized.dangerous_command_patterns.len(), 1);
    }

    #[test]
    fn test_agent_error_display() {
        assert_eq!(
            AgentError::SessionNotFound("s1".to_string()).to_string(),
            "Session not found: s1"
        );
        assert_eq!(
            AgentError::QueryCancelled.to_string(),
            "Query cancelled"
        );
        assert_eq!(
            AgentError::RateLimited.to_string(),
            "Rate limited"
        );
        assert_eq!(
            AgentError::ContextTooLarge.to_string(),
            "Context too large"
        );
        assert_eq!(
            AgentError::ConfirmationTimeout.to_string(),
            "Confirmation timeout"
        );
        assert_eq!(
            AgentError::ConfirmationRejected.to_string(),
            "Confirmation rejected"
        );
    }

    #[test]
    fn test_agent_error_to_string_conversion() {
        let err = AgentError::Internal("oops".to_string());
        let s: String = err.into();
        assert_eq!(s, "Internal error: oops");
    }

    #[test]
    fn test_attached_block_serialization() {
        let block = AttachedBlock {
            block_id: 42,
            command: "ls -la".to_string(),
            output_preview: "total 100".to_string(),
            exit_code: Some(0),
        };

        let json = serde_json::to_string(&block).unwrap();
        assert!(json.contains("blockId")); // camelCase
        assert!(json.contains("ls -la"));

        let deserialized: AttachedBlock = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.block_id, 42);
        assert_eq!(deserialized.exit_code, Some(0));
    }

    #[test]
    fn test_context_summary_serialization() {
        let summary = ContextSummary {
            attached_blocks: vec![],
            recent_commands: vec!["ls".to_string(), "pwd".to_string()],
            cwd: "/home/user".to_string(),
            git_branch: Some("main".to_string()),
        };

        let json = serde_json::to_string(&summary).unwrap();
        assert!(json.contains("recentCommands")); // camelCase
        assert!(json.contains("/home/user"));
        assert!(json.contains("main"));
    }
}
