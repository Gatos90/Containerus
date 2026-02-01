//! State Query Tool
//!
//! Tool for querying terminal state (cwd, env, git info, etc.)

use std::sync::Arc;

use rig::completion::ToolDefinition;
use rig::tool::Tool;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::RwLock;

use crate::agent::session::TerminalContext;

/// Error type for state query tool
#[derive(Debug, Error)]
pub enum StateQueryError {
    #[error("Unknown query type: {0}")]
    UnknownQueryType(String),
    #[error("Query failed: {0}")]
    QueryFailed(String),
}

/// Arguments for the state query tool
#[derive(Debug, Deserialize, JsonSchema)]
pub struct StateQueryArgs {
    /// What to query: "cwd", "env", "git_branch", "git_status", "shell", "os", "recent_output", "hostname", "username"
    pub query_type: String,
    /// For env queries, specific variable name (optional)
    #[serde(default)]
    pub env_var: Option<String>,
    /// For recent_output, max lines to return (default: 20)
    #[serde(default)]
    pub max_lines: Option<usize>,
}

/// Result of the state query
#[derive(Debug, Serialize)]
pub struct StateQueryResult {
    pub value: serde_json::Value,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Tool for querying terminal/session state
pub struct StateQueryTool {
    context: Arc<RwLock<TerminalContext>>,
}

impl StateQueryTool {
    /// Create a new state query tool
    pub fn new(context: Arc<RwLock<TerminalContext>>) -> Self {
        Self { context }
    }
}

impl Tool for StateQueryTool {
    const NAME: &'static str = "query_state";

    type Args = StateQueryArgs;
    type Output = StateQueryResult;
    type Error = StateQueryError;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "Query the current terminal state including working directory, environment variables, git information, shell type, and recent command output. Use this to understand the context before executing commands.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "query_type": {
                        "type": "string",
                        "enum": ["cwd", "env", "git_branch", "git_status", "shell", "os", "recent_output", "hostname", "username", "last_exit_code"],
                        "description": "Type of state information to query"
                    },
                    "env_var": {
                        "type": "string",
                        "description": "Specific environment variable name (only for query_type='env')"
                    },
                    "max_lines": {
                        "type": "integer",
                        "description": "Maximum lines to return for recent_output (default: 20)"
                    }
                },
                "required": ["query_type"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let ctx = self.context.read().await;

        let value = match args.query_type.as_str() {
            "cwd" => serde_json::json!(ctx.cwd),
            "shell" => serde_json::json!(ctx.shell),
            "os" => serde_json::json!(ctx.os),
            "hostname" => serde_json::json!(ctx.hostname),
            "username" => serde_json::json!(ctx.username),
            "git_branch" => serde_json::json!(ctx.git_branch),
            "git_status" => serde_json::json!(ctx.git_status),
            "last_exit_code" => serde_json::json!(ctx.last_exit_code),
            "recent_output" => {
                let max_lines = args.max_lines.unwrap_or(20);
                serde_json::json!(ctx.get_recent_output(max_lines))
            }
            "env" => {
                if let Some(var_name) = args.env_var {
                    let val = ctx.env_vars.get(&var_name).cloned();
                    serde_json::json!(val)
                } else {
                    // Return all environment variables
                    serde_json::json!(ctx.env_vars)
                }
            }
            _ => {
                return Ok(StateQueryResult {
                    value: serde_json::Value::Null,
                    success: false,
                    error: Some(format!("Unknown query type: {}", args.query_type)),
                });
            }
        };

        Ok(StateQueryResult {
            value,
            success: true,
            error: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_query_cwd() {
        let context = Arc::new(RwLock::new(TerminalContext {
            cwd: "/home/user".to_string(),
            ..Default::default()
        }));

        let tool = StateQueryTool::new(context);
        let result = tool
            .call(StateQueryArgs {
                query_type: "cwd".to_string(),
                env_var: None,
                max_lines: None,
            })
            .await
            .unwrap();

        assert!(result.success);
        assert_eq!(result.value, serde_json::json!("/home/user"));
    }

    #[tokio::test]
    async fn test_query_env_var() {
        let mut context = TerminalContext::default();
        context.env_vars.insert("PATH".to_string(), "/usr/bin".to_string());
        let context = Arc::new(RwLock::new(context));

        let tool = StateQueryTool::new(context);
        let result = tool
            .call(StateQueryArgs {
                query_type: "env".to_string(),
                env_var: Some("PATH".to_string()),
                max_lines: None,
            })
            .await
            .unwrap();

        assert!(result.success);
        assert_eq!(result.value, serde_json::json!("/usr/bin"));
    }

    #[tokio::test]
    async fn test_query_unknown_type() {
        let context = Arc::new(RwLock::new(TerminalContext::default()));
        let tool = StateQueryTool::new(context);

        let result = tool
            .call(StateQueryArgs {
                query_type: "invalid".to_string(),
                env_var: None,
                max_lines: None,
            })
            .await
            .unwrap();

        assert!(!result.success);
        assert!(result.error.is_some());
    }
}
