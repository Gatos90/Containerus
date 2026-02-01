//! Agent Workflow Executor
//!
//! Orchestrates the AI agent workflow including command parsing and execution.
//! Supports both single-turn JSON-based execution and multi-turn agentic loops
//! with tool use for ALL providers (Anthropic, OpenAI, Ollama).

use std::process::Stdio;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tokio::process::Command;
use tokio::sync::{mpsc, RwLock};

use crate::ai::{create_provider, AiSettings, CompletionRequest};
use crate::commands::terminal::TerminalSessions;

use super::events::{AgentEvent, AgentErrorType, ChunkType, QueryCompletionStatus};
use super::providers::get_agent_preamble;
use super::safety::{DangerClassifier, DangerLevel};
use super::session::TerminalContext;

/// Parsed AI response containing commands to execute
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentResponse {
    pub thought: String,
    #[serde(default)]
    pub commands: Vec<CommandToExecute>,
    pub response: Option<String>,
}

/// A command to execute from the AI response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandToExecute {
    pub command: String,
    pub explanation: String,
}

/// Result of executing a single command
#[derive(Debug, Clone)]
pub struct CommandResult {
    pub command: String,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub success: bool,
}

/// Maximum number of tool-calling turns per query
const MAX_MULTI_TURN: usize = 10;

/// Execute a shell command and return the result
pub async fn execute_shell_command(command: &str, cwd: &str) -> CommandResult {
    tracing::info!("Executing command: {} in {}", command, cwd);

    #[cfg(target_os = "windows")]
    let result = Command::new("cmd")
        .args(["/C", command])
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await;

    #[cfg(not(target_os = "windows"))]
    let result = Command::new("/bin/sh")
        .args(["-c", command])
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await;

    match result {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            let exit_code = output.status.code().unwrap_or(-1);

            CommandResult {
                command: command.to_string(),
                stdout,
                stderr,
                exit_code,
                success: output.status.success(),
            }
        }
        Err(e) => CommandResult {
            command: command.to_string(),
            stdout: String::new(),
            stderr: format!("Failed to execute command: {}", e),
            exit_code: -1,
            success: false,
        },
    }
}

/// Parse the AI response JSON, handling markdown code blocks if present
pub fn parse_agent_response(content: &str) -> Result<AgentResponse, String> {
    // Try to extract JSON from markdown code blocks first
    let json_content = if content.contains("```json") {
        content
            .split("```json")
            .nth(1)
            .and_then(|s| s.split("```").next())
            .map(|s| s.trim())
            .unwrap_or(content.trim())
    } else if content.contains("```") {
        content
            .split("```")
            .nth(1)
            .map(|s| s.trim())
            .unwrap_or(content.trim())
    } else {
        content.trim()
    };

    serde_json::from_str(json_content)
        .map_err(|e| format!("Failed to parse AI response as JSON: {}. Content: {}", e, content))
}

/// Agent executor error types
#[derive(Debug, thiserror::Error)]
pub enum ExecutorError {
    #[error("Provider error: {0}")]
    ProviderError(String),
    #[error("Agent error: {0}")]
    AgentError(String),
    #[error("Tool error: {0}")]
    ToolError(String),
    #[error("Session error: {0}")]
    SessionError(String),
    #[error("Event send error: {0}")]
    EventError(String),
}

/// Result type for executor operations
pub type ExecutorResult<T> = Result<T, ExecutorError>;

/// Configuration for agent execution
pub struct ExecutorConfig {
    pub ai_settings: AiSettings,
    pub auto_execute_safe: bool,
    pub max_turns: usize,
}

impl Default for ExecutorConfig {
    fn default() -> Self {
        Self {
            ai_settings: AiSettings::default(),
            auto_execute_safe: true,
            max_turns: MAX_MULTI_TURN,
        }
    }
}

/// Run the agent workflow for a single query
///
/// This function:
/// 1. Gets the AI provider
/// 2. Sends the query with terminal context
/// 3. Parses the JSON response for commands
/// 4. Executes safe commands automatically
/// 5. Emits response events
pub async fn run_agent_query(
    query: String,
    query_id: String,
    agent_session_id: String,
    _terminal_session_id: String,
    config: ExecutorConfig,
    _terminal_sessions: Arc<TerminalSessions>,
    context: Arc<RwLock<TerminalContext>>,
    event_tx: mpsc::Sender<AgentEvent>,
    _confirmation_rx: mpsc::Receiver<bool>,
    _cancel_rx: mpsc::Receiver<()>,
) -> ExecutorResult<()> {
    // Emit thinking event
    let _ = event_tx
        .send(AgentEvent::Thinking {
            session_id: agent_session_id.clone(),
            query_id: query_id.clone(),
        })
        .await;

    // Create provider using existing infrastructure
    let provider = create_provider(&config.ai_settings);

    // Build context summary for the prompt
    let ctx = context.read().await;
    let cwd = ctx.cwd.clone();
    let context_info = format!(
        "Current working directory: {}\nShell: {}\nOS: {}\nUser: {}@{}\n{}{}",
        ctx.cwd,
        ctx.shell,
        ctx.os,
        ctx.username,
        ctx.hostname,
        ctx.git_branch
            .as_ref()
            .map(|b| format!("Git branch: {}\n", b))
            .unwrap_or_default(),
        if !ctx.recent_output.is_empty() {
            format!(
                "Recent terminal output:\n```\n{}\n```\n",
                ctx.get_recent_output(20)
            )
        } else {
            String::new()
        }
    );
    drop(ctx);

    // Build the completion request with agent preamble and context
    let system_prompt = format!(
        "{}\n\n## Current Context\n{}",
        get_agent_preamble(),
        context_info
    );

    let completion_request = CompletionRequest {
        prompt: query.clone(),
        system_prompt: Some(system_prompt),
        context: None,
        temperature: Some(config.ai_settings.temperature),
        max_tokens: Some(2048),
        json_mode: false,
    };

    // Execute the completion
    match provider.get_completion(completion_request).await {
        Ok(response) => {
            // Try to parse the response as JSON with commands
            match parse_agent_response(&response.content) {
                Ok(agent_response) => {
                    let mut output_parts: Vec<String> = Vec::new();
                    let mut all_success = true;
                    let classifier = DangerClassifier::new();

                    // Add the thought/explanation
                    if !agent_response.thought.is_empty() {
                        output_parts.push(format!("💭 {}\n", agent_response.thought));
                    }

                    // Execute commands if present
                    if !agent_response.commands.is_empty() && config.auto_execute_safe {
                        for cmd_info in &agent_response.commands {
                            // Classify the command
                            let classification = classifier.classify(&cmd_info.command);

                            // Only auto-execute safe and moderate commands
                            if classification.level == DangerLevel::Safe
                                || classification.level == DangerLevel::Moderate
                            {
                                // Emit command start info
                                output_parts.push(format!(
                                    "\n📎 {}\n$ {}\n",
                                    cmd_info.explanation, cmd_info.command
                                ));

                                // Send progress chunk
                                let _ = event_tx
                                    .send(AgentEvent::ResponseChunk {
                                        session_id: agent_session_id.clone(),
                                        query_id: query_id.clone(),
                                        chunk_type: ChunkType::Command,
                                        content: format!(
                                            "💭 {}\n📎 {}\n$ {}\n",
                                            agent_response.thought,
                                            cmd_info.explanation,
                                            cmd_info.command
                                        ),
                                        is_final: false,
                                    })
                                    .await;

                                // Execute the command
                                let result = execute_shell_command(&cmd_info.command, &cwd).await;

                                // Add output to response
                                if !result.stdout.is_empty() {
                                    output_parts.push(format!("{}\n", result.stdout));
                                }
                                if !result.stderr.is_empty() {
                                    output_parts.push(format!(
                                        "⚠️ stderr:\n{}\n",
                                        result.stderr
                                    ));
                                }

                                if result.success {
                                    output_parts.push(format!(
                                        "✅ Exit code: {}\n",
                                        result.exit_code
                                    ));
                                } else {
                                    output_parts.push(format!(
                                        "❌ Exit code: {}\n",
                                        result.exit_code
                                    ));
                                    all_success = false;
                                }
                            } else {
                                // Command requires confirmation - don't execute
                                output_parts.push(format!(
                                    "\n⚠️ Command requires confirmation ({}): {}\n📝 {}\n❓ Please run this command manually if you want to proceed.\n",
                                    classification.level,
                                    cmd_info.command,
                                    classification.explanation
                                ));
                            }
                        }
                    } else if !agent_response.commands.is_empty() {
                        // Auto-execute disabled, just show commands
                        for cmd_info in &agent_response.commands {
                            output_parts.push(format!(
                                "\n📎 {}\n$ {}\n",
                                cmd_info.explanation, cmd_info.command
                            ));
                        }
                    }

                    // Add final response if present
                    if let Some(resp) = &agent_response.response {
                        if !resp.is_empty() {
                            output_parts.push(format!("\n{}\n", resp));
                        }
                    }

                    let final_output = output_parts.join("");

                    // Send final response chunk
                    let _ = event_tx
                        .send(AgentEvent::ResponseChunk {
                            session_id: agent_session_id.clone(),
                            query_id: query_id.clone(),
                            chunk_type: ChunkType::Text,
                            content: final_output.clone(),
                            is_final: true,
                        })
                        .await;

                    // Send completion event
                    let _ = event_tx
                        .send(AgentEvent::QueryCompleted {
                            session_id: agent_session_id,
                            query_id,
                            status: if all_success {
                                QueryCompletionStatus::Success
                            } else {
                                QueryCompletionStatus::PartialSuccess
                            },
                            summary: Some(final_output),
                            blocks_created: vec![],
                        })
                        .await;
                }
                Err(parse_error) => {
                    // Failed to parse as JSON, send raw response
                    tracing::warn!("Failed to parse AI response as JSON: {}", parse_error);

                    let _ = event_tx
                        .send(AgentEvent::ResponseChunk {
                            session_id: agent_session_id.clone(),
                            query_id: query_id.clone(),
                            chunk_type: ChunkType::Text,
                            content: response.content.clone(),
                            is_final: true,
                        })
                        .await;

                    let _ = event_tx
                        .send(AgentEvent::QueryCompleted {
                            session_id: agent_session_id,
                            query_id,
                            status: QueryCompletionStatus::Success,
                            summary: Some(response.content),
                            blocks_created: vec![],
                        })
                        .await;
                }
            }

            Ok(())
        }
        Err(e) => {
            let _ = event_tx
                .send(AgentEvent::Error {
                    session_id: agent_session_id.clone(),
                    query_id: Some(query_id.clone()),
                    error_type: AgentErrorType::ProviderUnavailable,
                    message: e.clone(),
                    recoverable: true,
                    suggestion: Some("Check your AI provider settings and try again".to_string()),
                })
                .await;

            let _ = event_tx
                .send(AgentEvent::QueryCompleted {
                    session_id: agent_session_id,
                    query_id,
                    status: QueryCompletionStatus::Failed,
                    summary: Some(format!("Error: {}", e)),
                    blocks_created: vec![],
                })
                .await;

            Err(ExecutorError::ProviderError(e))
        }
    }
}

/// Simple agent execution for context-aware queries
pub async fn run_agent_simple(
    query: String,
    config: ExecutorConfig,
    context: Arc<RwLock<TerminalContext>>,
) -> ExecutorResult<String> {
    // Create provider
    let provider = create_provider(&config.ai_settings);

    // Build context summary
    let ctx = context.read().await;
    let context_info = format!(
        "Current working directory: {}\nShell: {}\nOS: {}",
        ctx.cwd, ctx.shell, ctx.os
    );
    drop(ctx);

    let system_prompt = format!(
        "{}\n\n## Current Context\n{}",
        get_agent_preamble(),
        context_info
    );

    let completion_request = CompletionRequest {
        prompt: query,
        system_prompt: Some(system_prompt),
        context: None,
        temperature: Some(config.ai_settings.temperature),
        max_tokens: Some(2048),
        json_mode: false,
    };

    provider
        .get_completion(completion_request)
        .await
        .map(|r| r.content)
        .map_err(ExecutorError::ProviderError)
}

/// Run a multi-turn agentic loop with tool use
///
/// This function uses the Rig framework to handle multi-turn tool execution
/// for ALL providers (Anthropic, OpenAI, Ollama). Rig automatically:
/// - Converts tool definitions to provider-specific formats
/// - Parses LLM outputs into tool calls
/// - Routes tool calls to appropriate implementations
/// - Returns tool results to the LLM
///
/// The actual tool implementations (ShellExecuteTool, StateQueryTool) are
/// defined in agent/tools/ and already implement rig::tool::Tool.
pub async fn run_agentic_loop(
    _app: &AppHandle,
    agent_session_id: &str,
    query_id: &str,
    query: &str,
    terminal_session_id: &str,
    settings: &AiSettings,
    terminal_sessions: Arc<TerminalSessions>,
    context: Arc<RwLock<TerminalContext>>,
    event_tx: mpsc::Sender<AgentEvent>,
) -> ExecutorResult<()> {
    tracing::info!(
        "Starting Rig-based agentic loop with provider: {:?}, model: {}",
        settings.provider,
        settings.model_name
    );

    // Create a confirmation channel for this query
    // Note: The session manager should provide this, but for now we create a dummy one
    let (_confirm_tx, confirm_rx) = mpsc::channel(1);

    // Use the Rig-based executor
    let result = super::rig_executor::run_rig_agent(
        settings,
        query,
        terminal_session_id,
        agent_session_id,
        query_id,
        terminal_sessions,
        context,
        event_tx,
        confirm_rx,
    )
    .await;

    match result {
        Ok(_response) => {
            tracing::info!("Rig agentic loop completed successfully");
            Ok(())
        }
        Err(e) => {
            tracing::error!("Rig agentic loop failed: {}", e);
            Err(ExecutorError::ProviderError(e))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_executor_config_default() {
        let config = ExecutorConfig::default();
        assert!(config.auto_execute_safe);
        assert_eq!(config.max_turns, MAX_MULTI_TURN);
    }
}
