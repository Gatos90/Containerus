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

#[cfg(test)]
mod tests {
    use super::*;

    // === AgentEvent serialization ===

    #[test]
    fn test_agent_event_thinking_serialization() {
        let event = AgentEvent::Thinking {
            session_id: "sess-1".to_string(),
            query_id: "q-1".to_string(),
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["type"], "thinking");
        // rename_all on enum only renames variants, not struct fields
        assert_eq!(json["session_id"], "sess-1");
        assert_eq!(json["query_id"], "q-1");
    }

    #[test]
    fn test_agent_event_response_chunk_serialization() {
        let event = AgentEvent::ResponseChunk {
            session_id: "s1".to_string(),
            query_id: "q1".to_string(),
            chunk_type: ChunkType::Text,
            content: "hello".to_string(),
            is_final: false,
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["type"], "responseChunk");
        assert_eq!(json["chunk_type"], "text");
        assert_eq!(json["is_final"], false);
    }

    #[test]
    fn test_agent_event_command_proposed_serialization() {
        let event = AgentEvent::CommandProposed {
            session_id: "s1".to_string(),
            query_id: "q1".to_string(),
            command: "docker ps".to_string(),
            explanation: "List containers".to_string(),
            danger_level: "safe".to_string(),
            requires_confirmation: false,
            affected_resources: vec![],
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["type"], "commandProposed");
        assert_eq!(json["command"], "docker ps");
        assert_eq!(json["requires_confirmation"], false);
    }

    #[test]
    fn test_agent_event_confirmation_required_serialization() {
        let event = AgentEvent::ConfirmationRequired {
            session_id: "s1".to_string(),
            query_id: "q1".to_string(),
            confirmation_id: "conf-1".to_string(),
            command: "rm -rf /tmp".to_string(),
            explanation: "Delete tmp".to_string(),
            risk_level: "dangerous".to_string(),
            affected_resources: vec!["/tmp".to_string()],
            warning: Some("Data loss possible".to_string()),
            alternatives: vec![CommandAlternative {
                command: "rm -ri /tmp".to_string(),
                description: "Interactive mode".to_string(),
                is_safer: true,
            }],
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["type"], "confirmationRequired");
        assert_eq!(json["confirmation_id"], "conf-1");
        assert_eq!(json["alternatives"].as_array().unwrap().len(), 1);
        // CommandAlternative has its own rename_all = "camelCase"
        assert_eq!(json["alternatives"][0]["isSafer"], true);
    }

    #[test]
    fn test_agent_event_command_completed_serialization() {
        let event = AgentEvent::CommandCompleted {
            session_id: "s1".to_string(),
            query_id: "q1".to_string(),
            block_id: 42,
            exit_code: 0,
            duration_ms: 1500,
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["type"], "commandCompleted");
        assert_eq!(json["block_id"], 42);
        assert_eq!(json["exit_code"], 0);
        assert_eq!(json["duration_ms"], 1500);
    }

    #[test]
    fn test_agent_event_error_serialization() {
        let event = AgentEvent::Error {
            session_id: "s1".to_string(),
            query_id: Some("q1".to_string()),
            error_type: AgentErrorType::ProviderUnavailable,
            message: "Cannot connect".to_string(),
            recoverable: true,
            suggestion: Some("Check API key".to_string()),
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["type"], "error");
        assert_eq!(json["error_type"], "provider_unavailable");
        assert_eq!(json["recoverable"], true);
    }

    #[test]
    fn test_agent_event_query_completed_serialization() {
        let event = AgentEvent::QueryCompleted {
            session_id: "s1".to_string(),
            query_id: "q1".to_string(),
            status: QueryCompletionStatus::Success,
            summary: Some("Done".to_string()),
            blocks_created: vec![1, 2, 3],
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["type"], "queryCompleted");
        assert_eq!(json["status"], "success");
        assert_eq!(json["blocks_created"].as_array().unwrap().len(), 3);
    }

    // === ChunkType serialization ===

    /// Verifies that each `ChunkType` variant serializes to the expected snake_case JSON string.
    ///
    /// # Examples
    ///
    /// ```
    /// assert_eq!(serde_json::to_value(ChunkType::Thinking).unwrap(), "thinking");
    /// assert_eq!(serde_json::to_value(ChunkType::Text).unwrap(), "text");
    /// assert_eq!(serde_json::to_value(ChunkType::Command).unwrap(), "command");
    /// assert_eq!(serde_json::to_value(ChunkType::Explanation).unwrap(), "explanation");
    /// assert_eq!(serde_json::to_value(ChunkType::Warning).unwrap(), "warning");
    /// ```
    #[test]
    fn test_chunk_type_serialization() {
        assert_eq!(serde_json::to_value(ChunkType::Thinking).unwrap(), "thinking");
        assert_eq!(serde_json::to_value(ChunkType::Text).unwrap(), "text");
        assert_eq!(serde_json::to_value(ChunkType::Command).unwrap(), "command");
        assert_eq!(serde_json::to_value(ChunkType::Explanation).unwrap(), "explanation");
        assert_eq!(serde_json::to_value(ChunkType::Warning).unwrap(), "warning");
    }

    #[test]
    fn test_chunk_type_deserialization() {
        let thinking: ChunkType = serde_json::from_str("\"thinking\"").unwrap();
        assert!(matches!(thinking, ChunkType::Thinking));
    }

    // === QueryCompletionStatus serialization ===

    #[test]
    fn test_query_completion_status_serialization() {
        assert_eq!(serde_json::to_value(QueryCompletionStatus::Success).unwrap(), "success");
        assert_eq!(serde_json::to_value(QueryCompletionStatus::PartialSuccess).unwrap(), "partial_success");
        assert_eq!(serde_json::to_value(QueryCompletionStatus::Cancelled).unwrap(), "cancelled");
        assert_eq!(serde_json::to_value(QueryCompletionStatus::Failed).unwrap(), "failed");
        assert_eq!(serde_json::to_value(QueryCompletionStatus::AwaitingConfirmation).unwrap(), "awaiting_confirmation");
    }

    // === AgentErrorType serialization ===

    #[test]
    fn test_agent_error_type_serialization() {
        assert_eq!(serde_json::to_value(AgentErrorType::SessionNotFound).unwrap(), "session_not_found");
        assert_eq!(serde_json::to_value(AgentErrorType::RateLimited).unwrap(), "rate_limited");
        assert_eq!(serde_json::to_value(AgentErrorType::ContextTooLarge).unwrap(), "context_too_large");
        assert_eq!(serde_json::to_value(AgentErrorType::Internal).unwrap(), "internal");
    }

    // === AgentCommand deserialization ===

    /// Verifies that a `userPrompt` JSON payload deserializes into `AgentCommand::UserPrompt` with the correct fields.
    ///
    /// # Examples
    ///
    /// ```
    /// use serde_json::from_str;
    /// let json = r#"{"type":"userPrompt","session_id":"s1","text":"help me"}"#;
    /// let cmd: crate::AgentCommand = from_str(json).unwrap();
    /// match cmd {
    ///     crate::AgentCommand::UserPrompt { session_id, text, attached_blocks } => {
    ///         assert_eq!(session_id, "s1");
    ///         assert_eq!(text, "help me");
    ///         assert!(attached_blocks.is_none());
    ///     }
    ///     _ => panic!("Expected UserPrompt"),
    /// }
    /// ```
    #[test]
    fn test_agent_command_user_prompt_deserialization() {
        let json = r#"{"type":"userPrompt","session_id":"s1","text":"help me"}"#;
        let cmd: AgentCommand = serde_json::from_str(json).unwrap();
        match cmd {
            AgentCommand::UserPrompt { session_id, text, attached_blocks } => {
                assert_eq!(session_id, "s1");
                assert_eq!(text, "help me");
                assert!(attached_blocks.is_none());
            }
            _ => panic!("Expected UserPrompt"),
        }
    }

    #[test]
    fn test_agent_command_confirm_deserialization() {
        let json = r#"{"type":"confirmCommand","session_id":"s1","confirmation_id":"c1","confirmed":true}"#;
        let cmd: AgentCommand = serde_json::from_str(json).unwrap();
        match cmd {
            AgentCommand::ConfirmCommand { session_id, confirmation_id, confirmed, .. } => {
                assert_eq!(session_id, "s1");
                assert_eq!(confirmation_id, "c1");
                assert!(confirmed);
            }
            _ => panic!("Expected ConfirmCommand"),
        }
    }

    #[test]
    fn test_agent_command_cancel_deserialization() {
        let json = r#"{"type":"cancel","session_id":"s1"}"#;
        let cmd: AgentCommand = serde_json::from_str(json).unwrap();
        assert!(matches!(cmd, AgentCommand::Cancel { .. }));
    }

    #[test]
    fn test_agent_command_inject_deserialization() {
        let json = r#"{"type":"injectCommand","session_id":"s1","command":"docker ps"}"#;
        let cmd: AgentCommand = serde_json::from_str(json).unwrap();
        match cmd {
            AgentCommand::InjectCommand { command, .. } => {
                assert_eq!(command, "docker ps");
            }
            _ => panic!("Expected InjectCommand"),
        }
    }

    // === AgentQueryRequest deserialization ===

    #[test]
    fn test_agent_query_request_deserialization() {
        // AgentQueryRequest is a struct with rename_all = "camelCase", so fields use camelCase
        let json = r#"{
            "sessionId": "s1",
            "query": "list containers",
            "autoExecute": true,
            "streaming": true
        }"#;
        let req: AgentQueryRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.session_id, "s1");
        assert_eq!(req.query, "list containers");
        assert!(req.auto_execute);
        assert!(req.streaming);
        assert!(req.context_block_ids.is_none());
        assert!(req.query_id.is_none());
    }

    // === ConfirmationResponse deserialization ===

    /// Verifies that a `ConfirmationResponse` is deserialized correctly from camelCase JSON.
    ///
    /// # Examples
    ///
    /// ```
    /// let json = r#"{"confirmationId":"c1","action":"approve"}"#;
    /// let resp: crate::ConfirmationResponse = serde_json::from_str(json).unwrap();
    /// assert_eq!(resp.confirmation_id, "c1");
    /// assert!(matches!(resp.action, crate::ConfirmationAction::Approve));
    /// assert!(resp.use_alternative.is_none());
    /// ```
    #[test]
    fn test_confirmation_response_deserialization() {
        // ConfirmationResponse is a struct with rename_all = "camelCase"
        let json = r#"{"confirmationId":"c1","action":"approve"}"#;
        let resp: ConfirmationResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.confirmation_id, "c1");
        assert!(matches!(resp.action, ConfirmationAction::Approve));
        assert!(resp.use_alternative.is_none());
    }

    #[test]
    fn test_confirmation_action_variants() {
        let approve: ConfirmationAction = serde_json::from_str("\"approve\"").unwrap();
        assert!(matches!(approve, ConfirmationAction::Approve));

        let reject: ConfirmationAction = serde_json::from_str("\"reject\"").unwrap();
        assert!(matches!(reject, ConfirmationAction::Reject));

        let alt: ConfirmationAction = serde_json::from_str("\"use_alternative\"").unwrap();
        assert!(matches!(alt, ConfirmationAction::UseAlternative));
    }

    // === CommandAlternative serialization ===

    #[test]
    fn test_command_alternative_roundtrip() {
        let alt = CommandAlternative {
            command: "docker container ls".to_string(),
            description: "List containers".to_string(),
            is_safer: true,
        };
        let json = serde_json::to_string(&alt).unwrap();
        let deserialized: CommandAlternative = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.command, "docker container ls");
        assert!(deserialized.is_safer);
    }
}