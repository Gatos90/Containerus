//! Tool Definitions for AI Agent
//!
//! Defines the tools available to the AI agent for Anthropic's tool_use API.

use serde::{Deserialize, Serialize};
use serde_json::json;

/// Tool definition for Anthropic API
#[derive(Debug, Clone, Serialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

/// Input for execute_shell tool
#[derive(Debug, Clone, Deserialize)]
pub struct ExecuteShellInput {
    /// The shell command to execute
    pub command: String,
    /// Brief explanation of why this command is being run (optional)
    #[serde(default)]
    pub explanation: Option<String>,
}

/// Input for query_state tool
#[derive(Debug, Clone, Deserialize)]
pub struct QueryStateInput {
    /// What state to query: "cwd", "env", "git_branch", "recent_output"
    #[serde(rename = "type")]
    pub query_type: String,
}

/// Input for query_history tool
#[derive(Debug, Clone, Deserialize)]
pub struct QueryHistoryInput {
    /// Query type: "list", "search", or "get_output"
    pub query_type: String,
    /// Search term for "search" query, or exact command for "get_output" query
    #[serde(default)]
    pub value: Option<String>,
    /// Limit number of results (default: 10)
    #[serde(default)]
    pub limit: Option<usize>,
}

/// Build the tool definitions for the AI agent
pub fn build_tool_definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "execute_shell".to_string(),
            description: concat!(
                "Execute a shell command in the user's terminal and return its output. ",
                "Use this to run commands like 'ls', 'docker ps', 'git status', etc. ",
                "IMPORTANT: Wait for and analyze the output before deciding next steps. ",
                "For multi-step tasks, execute commands ONE AT A TIME and analyze each result. ",
                "Never guess what a command will output - run it first."
            ).to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The shell command to execute"
                    },
                    "explanation": {
                        "type": "string",
                        "description": "Brief explanation of why this command is being run"
                    }
                },
                "required": ["command"]
            }),
        },
        ToolDefinition {
            name: "query_state".to_string(),
            description: concat!(
                "Query the current terminal state without running a command. ",
                "Use this to get context like current directory, git status, or recent output."
            ).to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": ["cwd", "env", "git_branch", "git_status", "recent_output"],
                        "description": "What state to query"
                    }
                },
                "required": ["type"]
            }),
        },
        ToolDefinition {
            name: "query_history".to_string(),
            description: concat!(
                "Query the history of previously executed commands and their outputs. ",
                "Use this to recall what commands were run and their results without re-executing them. ",
                "Query types: 'list' (recent commands), 'search' (find commands), 'get_output' (full output)."
            ).to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query_type": {
                        "type": "string",
                        "enum": ["list", "search", "get_output"],
                        "description": "Type of history query: 'list' for recent commands, 'search' to find commands, 'get_output' for full output"
                    },
                    "value": {
                        "type": "string",
                        "description": "For 'search': the term to search for. For 'get_output': the exact command string."
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of results to return (default: 10)"
                    }
                },
                "required": ["query_type"]
            }),
        },
    ]
}

/// Serialize tool definitions for Anthropic API request
pub fn serialize_for_anthropic(tools: &[ToolDefinition]) -> serde_json::Value {
    serde_json::to_value(tools).unwrap_or(json!([]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_tool_definitions() {
        let tools = build_tool_definitions();
        assert_eq!(tools.len(), 3);
        assert_eq!(tools[0].name, "execute_shell");
        assert_eq!(tools[1].name, "query_state");
        assert_eq!(tools[2].name, "query_history");
    }

    #[test]
    fn test_execute_shell_input_parsing() {
        let json = r#"{"command": "ls -la", "explanation": "List files"}"#;
        let input: ExecuteShellInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.command, "ls -la");
        assert_eq!(input.explanation, Some("List files".to_string()));
    }

    #[test]
    fn test_query_state_input_parsing() {
        let json = r#"{"type": "cwd"}"#;
        let input: QueryStateInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.query_type, "cwd");
    }

    #[test]
    fn test_query_history_input_parsing() {
        let json = r#"{"query_type": "search", "value": "docker", "limit": 5}"#;
        let input: QueryHistoryInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.query_type, "search");
        assert_eq!(input.value, Some("docker".to_string()));
        assert_eq!(input.limit, Some(5));
    }

    #[test]
    fn test_query_history_input_minimal() {
        let json = r#"{"query_type": "list"}"#;
        let input: QueryHistoryInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.query_type, "list");
        assert_eq!(input.value, None);
        assert_eq!(input.limit, None);
    }
}
