//! History Query Tool
//!
//! Tool for querying command execution history to avoid re-running commands
//! and to get selective context from previous executions.

use std::sync::Arc;

use rig::completion::ToolDefinition;
use rig::tool::Tool;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::RwLock;

use crate::agent::session::TerminalContext;

/// Error type for history query tool
#[derive(Debug, Error)]
pub enum HistoryQueryError {
    #[error("Unknown query type: {0}")]
    UnknownQueryType(String),
    #[error("Query failed: {0}")]
    QueryFailed(String),
}

/// Arguments for the history query tool
#[derive(Debug, Deserialize, JsonSchema)]
pub struct HistoryQueryArgs {
    /// Query type: "list", "search", or "get_output"
    pub query_type: String,
    /// Search term for "search" query, or exact command for "get_output" query
    #[serde(default)]
    pub value: Option<String>,
    /// Limit number of results (default: 10)
    #[serde(default)]
    pub limit: Option<usize>,
}

/// Result of the history query
#[derive(Debug, Serialize)]
pub struct HistoryQueryResult {
    pub result: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Number of entries found/returned
    pub count: usize,
}

/// Tool for querying command execution history
pub struct HistoryQueryTool {
    context: Arc<RwLock<TerminalContext>>,
}

impl HistoryQueryTool {
    /// Create a new history query tool
    pub fn new(context: Arc<RwLock<TerminalContext>>) -> Self {
        Self { context }
    }

    /// Truncate a string to max length with ellipsis
    fn truncate(s: &str, max_len: usize) -> String {
        if s.len() <= max_len {
            s.to_string()
        } else {
            format!("{}...", &s[..max_len.saturating_sub(3)])
        }
    }
}

impl Tool for HistoryQueryTool {
    const NAME: &'static str = "query_history";

    type Args = HistoryQueryArgs;
    type Output = HistoryQueryResult;
    type Error = HistoryQueryError;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: concat!(
                "Query the history of previously executed commands and their outputs. ",
                "Use this to recall what commands were run and their results without re-executing them. ",
                "Query types: 'list' (list recent commands), 'search' (find commands containing a term), ",
                "'get_output' (get the full output of a specific command)."
            ).to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "query_type": {
                        "type": "string",
                        "enum": ["list", "search", "get_output"],
                        "description": "Type of history query: 'list' for recent commands, 'search' to find commands, 'get_output' for full output of a command"
                    },
                    "value": {
                        "type": "string",
                        "description": "For 'search': the term to search for. For 'get_output': the exact command string to look up."
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of results to return (default: 10)"
                    }
                },
                "required": ["query_type"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let ctx = self.context.read().await;

        match args.query_type.as_str() {
            "list" => {
                // Return list of recent commands (without full output, just summary)
                let limit = args.limit.unwrap_or(10);
                let commands: Vec<String> = ctx
                    .command_history
                    .iter()
                    .rev()
                    .take(limit)
                    .map(|e| {
                        let status = match e.exit_code {
                            Some(0) => "✓",
                            Some(_) => "✗",
                            None => "?",
                        };
                        let output_preview = Self::truncate(&e.output.lines().next().unwrap_or(""), 50);
                        format!(
                            "[{}] {} (exit: {:?}, {}ms)\n   → {}",
                            status, e.command, e.exit_code, e.duration_ms, output_preview
                        )
                    })
                    .collect();

                let count = commands.len();
                let result = if commands.is_empty() {
                    "No commands in history.".to_string()
                } else {
                    commands.join("\n\n")
                };

                Ok(HistoryQueryResult {
                    result,
                    success: true,
                    error: None,
                    count,
                })
            }
            "search" => {
                // Search commands containing the value in command or output
                let search = args.value.as_deref().unwrap_or("");
                if search.is_empty() {
                    return Ok(HistoryQueryResult {
                        result: "Search value is required for 'search' query type.".to_string(),
                        success: false,
                        error: Some("Missing 'value' parameter".to_string()),
                        count: 0,
                    });
                }

                let limit = args.limit.unwrap_or(10);
                let matches: Vec<String> = ctx
                    .search_command_history(search)
                    .into_iter()
                    .take(limit)
                    .map(|e| {
                        let output_preview = Self::truncate(&e.output, 200);
                        format!(
                            "Command: {}\nExit: {:?} | Duration: {}ms\nOutput:\n{}",
                            e.command, e.exit_code, e.duration_ms, output_preview
                        )
                    })
                    .collect();

                let count = matches.len();
                let result = if matches.is_empty() {
                    format!("No commands found matching '{}'.", search)
                } else {
                    matches.join("\n---\n")
                };

                Ok(HistoryQueryResult {
                    result,
                    success: true,
                    error: None,
                    count,
                })
            }
            "get_output" => {
                // Get full output of a specific command
                let cmd = args.value.as_deref().unwrap_or("");
                if cmd.is_empty() {
                    return Ok(HistoryQueryResult {
                        result: "Command value is required for 'get_output' query type.".to_string(),
                        success: false,
                        error: Some("Missing 'value' parameter".to_string()),
                        count: 0,
                    });
                }

                if let Some(entry) = ctx.find_command_output(cmd) {
                    Ok(HistoryQueryResult {
                        result: format!(
                            "Command: {}\nExit code: {:?}\nDuration: {}ms\n\nOutput:\n{}",
                            entry.command, entry.exit_code, entry.duration_ms, entry.output
                        ),
                        success: true,
                        error: None,
                        count: 1,
                    })
                } else {
                    // Try partial match if exact match not found
                    let partial_matches: Vec<_> = ctx
                        .command_history
                        .iter()
                        .filter(|e| e.command.contains(cmd))
                        .collect();

                    if partial_matches.is_empty() {
                        Ok(HistoryQueryResult {
                            result: format!("No history found for command: '{}'", cmd),
                            success: true,
                            error: None,
                            count: 0,
                        })
                    } else if partial_matches.len() == 1 {
                        let entry = partial_matches[0];
                        Ok(HistoryQueryResult {
                            result: format!(
                                "Command: {}\nExit code: {:?}\nDuration: {}ms\n\nOutput:\n{}",
                                entry.command, entry.exit_code, entry.duration_ms, entry.output
                            ),
                            success: true,
                            error: None,
                            count: 1,
                        })
                    } else {
                        // Multiple matches - list them
                        let matches: Vec<String> = partial_matches
                            .iter()
                            .take(5)
                            .map(|e| format!("  - {}", e.command))
                            .collect();
                        Ok(HistoryQueryResult {
                            result: format!(
                                "Multiple commands match '{}'. Please be more specific:\n{}",
                                cmd,
                                matches.join("\n")
                            ),
                            success: true,
                            error: None,
                            count: partial_matches.len(),
                        })
                    }
                }
            }
            _ => Ok(HistoryQueryResult {
                result: format!(
                    "Unknown query type: '{}'. Use: list, search, get_output",
                    args.query_type
                ),
                success: false,
                error: Some(format!("Unknown query type: {}", args.query_type)),
                count: 0,
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::session::CommandHistoryEntry;

    #[tokio::test]
    async fn test_list_empty_history() {
        let context = Arc::new(RwLock::new(TerminalContext::default()));
        let tool = HistoryQueryTool::new(context);

        let result = tool
            .call(HistoryQueryArgs {
                query_type: "list".to_string(),
                value: None,
                limit: None,
            })
            .await
            .unwrap();

        assert!(result.success);
        assert_eq!(result.count, 0);
        assert!(result.result.contains("No commands"));
    }

    #[tokio::test]
    async fn test_list_with_history() {
        let mut ctx = TerminalContext::default();
        ctx.add_command_result(CommandHistoryEntry {
            id: "1".to_string(),
            command: "ls -la".to_string(),
            output: "total 0\ndrwxr-xr-x".to_string(),
            exit_code: Some(0),
            timestamp: 1234567890,
            duration_ms: 50,
        });
        let context = Arc::new(RwLock::new(ctx));
        let tool = HistoryQueryTool::new(context);

        let result = tool
            .call(HistoryQueryArgs {
                query_type: "list".to_string(),
                value: None,
                limit: None,
            })
            .await
            .unwrap();

        assert!(result.success);
        assert_eq!(result.count, 1);
        assert!(result.result.contains("ls -la"));
    }

    #[tokio::test]
    async fn test_search_command() {
        let mut ctx = TerminalContext::default();
        ctx.add_command_result(CommandHistoryEntry {
            id: "1".to_string(),
            command: "docker ps".to_string(),
            output: "CONTAINER ID   IMAGE".to_string(),
            exit_code: Some(0),
            timestamp: 1234567890,
            duration_ms: 100,
        });
        ctx.add_command_result(CommandHistoryEntry {
            id: "2".to_string(),
            command: "ls -la".to_string(),
            output: "total 0".to_string(),
            exit_code: Some(0),
            timestamp: 1234567891,
            duration_ms: 50,
        });
        let context = Arc::new(RwLock::new(ctx));
        let tool = HistoryQueryTool::new(context);

        let result = tool
            .call(HistoryQueryArgs {
                query_type: "search".to_string(),
                value: Some("docker".to_string()),
                limit: None,
            })
            .await
            .unwrap();

        assert!(result.success);
        assert_eq!(result.count, 1);
        assert!(result.result.contains("docker ps"));
    }

    #[tokio::test]
    async fn test_get_output() {
        let mut ctx = TerminalContext::default();
        ctx.add_command_result(CommandHistoryEntry {
            id: "1".to_string(),
            command: "docker ps".to_string(),
            output: "CONTAINER ID   IMAGE   STATUS".to_string(),
            exit_code: Some(0),
            timestamp: 1234567890,
            duration_ms: 100,
        });
        let context = Arc::new(RwLock::new(ctx));
        let tool = HistoryQueryTool::new(context);

        let result = tool
            .call(HistoryQueryArgs {
                query_type: "get_output".to_string(),
                value: Some("docker ps".to_string()),
                limit: None,
            })
            .await
            .unwrap();

        assert!(result.success);
        assert_eq!(result.count, 1);
        assert!(result.result.contains("CONTAINER ID   IMAGE   STATUS"));
    }

    #[tokio::test]
    async fn test_get_output_not_found() {
        let context = Arc::new(RwLock::new(TerminalContext::default()));
        let tool = HistoryQueryTool::new(context);

        let result = tool
            .call(HistoryQueryArgs {
                query_type: "get_output".to_string(),
                value: Some("nonexistent".to_string()),
                limit: None,
            })
            .await
            .unwrap();

        assert!(result.success);
        assert_eq!(result.count, 0);
        assert!(result.result.contains("No history found"));
    }
}
