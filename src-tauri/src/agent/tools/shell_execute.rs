//! Shell Execute Tool
//!
//! Tool for executing shell commands via the terminal PTY.

use std::sync::Arc;
use std::time::Instant;

use regex::Regex;
use rig::completion::ToolDefinition;
use rig::tool::Tool;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::{mpsc, RwLock};

use crate::agent::events::AgentEvent;
use crate::agent::safety::{DangerClassification, DangerClassifier};
use crate::agent::session::{generate_block_id, CommandHistoryEntry, TerminalContext};
use crate::commands::terminal::{TerminalInput, TerminalSessions};

/// Information about a container exec command
#[derive(Debug, Clone)]
pub struct ContainerExecInfo {
    /// The container ID or name
    pub container_id: String,
    /// The shell being used (bash, sh, etc.)
    pub shell: String,
    /// The container runtime (docker, podman, nerdctl)
    pub runtime: String,
}

/// Detect if a command is a docker/podman/nerdctl exec into a container
fn detect_container_exec(cmd: &str) -> Option<ContainerExecInfo> {
    // Patterns for interactive container exec:
    // docker exec -it <container> <shell>
    // docker exec -ti <container> <shell>
    // docker exec --interactive --tty <container> <shell>
    // podman exec -it <container> <shell>
    // nerdctl exec -it <container> <shell>

    let cmd_trimmed = cmd.trim();

    // Check which runtime is being used
    let runtime = if cmd_trimmed.starts_with("docker ") {
        "docker"
    } else if cmd_trimmed.starts_with("podman ") {
        "podman"
    } else if cmd_trimmed.starts_with("nerdctl ") {
        "nerdctl"
    } else {
        return None;
    };

    // Check if it's an exec command
    if !cmd_trimmed.contains(" exec ") {
        return None;
    }

    // Check for interactive flags (-it, -ti, --interactive, --tty)
    let has_interactive = cmd_trimmed.contains(" -it ")
        || cmd_trimmed.contains(" -ti ")
        || cmd_trimmed.contains(" -i ")
        || cmd_trimmed.contains(" --interactive")
        || cmd_trimmed.contains(" -t ")
        || cmd_trimmed.contains(" --tty");

    if !has_interactive {
        return None;
    }

    // Parse the command to extract container ID and shell
    // Pattern: <runtime> exec [options] <container> <shell> [args...]
    let exec_regex = Regex::new(
        r"(?:docker|podman|nerdctl)\s+exec\s+(?:[^\s]+\s+)*?(-[it]+\s+|--interactive\s+|--tty\s+)*([a-zA-Z0-9_.-]+)\s+(/bin/bash|/bin/sh|bash|sh|/usr/bin/bash|/usr/bin/sh|zsh|/bin/zsh)"
    ).ok()?;

    if let Some(captures) = exec_regex.captures(cmd_trimmed) {
        let container_id = captures.get(2)?.as_str().to_string();
        let shell = captures.get(3)?.as_str().to_string();

        // Normalize shell name
        let normalized_shell = if shell.contains("bash") {
            "bash".to_string()
        } else if shell.contains("zsh") {
            "zsh".to_string()
        } else {
            "sh".to_string()
        };

        return Some(ContainerExecInfo {
            container_id,
            shell: normalized_shell,
            runtime: runtime.to_string(),
        });
    }

    // Fallback: try a simpler pattern for common cases
    // <runtime> exec -it <container> <shell>
    let parts: Vec<&str> = cmd_trimmed.split_whitespace().collect();
    if parts.len() >= 5 && parts[1] == "exec" {
        // Find the position after flags
        let mut i = 2;
        while i < parts.len() && parts[i].starts_with('-') {
            i += 1;
        }

        if i + 1 < parts.len() {
            let container_id = parts[i].to_string();
            let shell_part = parts[i + 1];

            // Check if it looks like a shell
            if shell_part.contains("sh") || shell_part.contains("bash") || shell_part.contains("zsh") {
                let normalized_shell = if shell_part.contains("bash") {
                    "bash".to_string()
                } else if shell_part.contains("zsh") {
                    "zsh".to_string()
                } else {
                    "sh".to_string()
                };

                return Some(ContainerExecInfo {
                    container_id,
                    shell: normalized_shell,
                    runtime: runtime.to_string(),
                });
            }
        }
    }

    None
}

/// Check if a command is an exit command that would leave a container shell
fn is_exit_command(cmd: &str) -> bool {
    let trimmed = cmd.trim();
    trimmed == "exit" || trimmed == "logout" || trimmed.starts_with("exit ")
}

/// Error type for shell execute tool
#[derive(Debug, Error)]
pub enum ShellExecuteError {
    #[error("Terminal session not found")]
    SessionNotFound,
    #[error("Confirmation timeout")]
    ConfirmationTimeout,
    #[error("Confirmation rejected")]
    ConfirmationRejected,
    #[error("Confirmation channel closed")]
    ConfirmationChannelClosed,
    #[error("Execution failed: {0}")]
    ExecutionFailed(String),
    #[error("Event send failed: {0}")]
    EventSendFailed(String),
}

/// Arguments for shell command execution
#[derive(Debug, Deserialize, JsonSchema)]
pub struct ShellExecuteArgs {
    /// The shell command to execute
    pub command: String,
    /// Brief explanation of what this command does (for user display)
    #[serde(default)]
    pub explanation: Option<String>,
}

/// Result of shell command execution
#[derive(Debug, Serialize)]
pub struct ShellExecuteResult {
    /// Combined output (stdout + stderr interleaved as received)
    pub output: String,
    /// Exit code if available
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    /// Whether the command was actually executed
    pub executed: bool,
    /// Reason if command was blocked
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked_reason: Option<String>,
    /// Duration in milliseconds
    pub duration_ms: u64,
    /// Danger classification info
    pub danger_level: String,
}

/// Tool for executing shell commands
pub struct ShellExecuteTool {
    /// Terminal session ID
    terminal_session_id: String,
    /// Reference to terminal sessions manager
    terminal_sessions: Arc<TerminalSessions>,
    /// Channel to send agent events
    event_tx: mpsc::Sender<AgentEvent>,
    /// Channel to receive confirmation responses
    confirmation_rx: Arc<tokio::sync::Mutex<mpsc::Receiver<bool>>>,
    /// Danger classifier
    classifier: DangerClassifier,
    /// Terminal context for output capture
    context: Arc<RwLock<TerminalContext>>,
    /// Agent session ID for events
    agent_session_id: String,
    /// Current query ID
    query_id: Arc<RwLock<String>>,
    /// Whether auto-execute is enabled for safe commands
    auto_execute: bool,
}

impl ShellExecuteTool {
    /// Create a new shell execute tool
    pub fn new(
        terminal_session_id: String,
        agent_session_id: String,
        terminal_sessions: Arc<TerminalSessions>,
        event_tx: mpsc::Sender<AgentEvent>,
        confirmation_rx: mpsc::Receiver<bool>,
        context: Arc<RwLock<TerminalContext>>,
        auto_execute: bool,
    ) -> Self {
        Self {
            terminal_session_id,
            terminal_sessions,
            event_tx,
            confirmation_rx: Arc::new(tokio::sync::Mutex::new(confirmation_rx)),
            classifier: DangerClassifier::new(),
            context,
            agent_session_id,
            query_id: Arc::new(RwLock::new(String::new())),
            auto_execute,
        }
    }

    /// Set the current query ID
    pub async fn set_query_id(&self, query_id: String) {
        *self.query_id.write().await = query_id;
    }

    /// Execute command directly via subprocess (fallback when PTY unavailable)
    async fn execute_direct(&self, command: &str) -> Result<(String, Option<i32>), String> {
        let cwd = {
            let ctx = self.context.read().await;
            ctx.cwd.clone()
        };

        let result = crate::agent::executor::execute_shell_command(command, &cwd).await;

        // Emit command output events so frontend can display results
        let query_id = self.query_id.read().await.clone();
        let block_id = generate_block_id();

        // Combine stdout and stderr for the event payload
        let combined_output = if !result.stdout.is_empty() && !result.stderr.is_empty() {
            format!("{}\n{}", result.stdout, result.stderr)
        } else if !result.stderr.is_empty() {
            result.stderr.clone()
        } else {
            result.stdout.clone()
        };

        if !combined_output.is_empty() {
            let _ = self
                .event_tx
                .send(AgentEvent::CommandOutput {
                    session_id: self.agent_session_id.clone(),
                    query_id: query_id.clone(),
                    block_id,
                    payload: combined_output.clone(),
                })
                .await;
        }

        Ok((combined_output, Some(result.exit_code)))
    }

    /// Execute command via PTY with output capture, or fallback to direct execution
    /// Returns (raw_output_for_ai, cleaned_output_for_frontend, exit_code)
    async fn execute_via_pty(&self, command: &str) -> Result<(String, String, Option<i32>), String> {
        // Register output listener BEFORE sending command to ensure we capture all output
        let mut output_rx = self
            .terminal_sessions
            .register_output_listener(&self.terminal_session_id)
            .await;

        // Send command to PTY
        let send_result = {
            let sessions = self.terminal_sessions.get_sessions();
            let mut sessions_guard = sessions.lock().await;

            match sessions_guard.get_mut(&self.terminal_session_id) {
                Some(handle) => {
                    let cmd_with_newline = format!("{}\n", command);
                    match handle {
                        #[cfg(not(target_os = "android"))]
                        crate::commands::terminal::SessionHandle::Local { writer, .. } => {
                            use std::io::Write;
                            writer
                                .write_all(cmd_with_newline.as_bytes())
                                .and_then(|_| writer.flush())
                                .map_err(|e| e.to_string())
                        }
                        crate::commands::terminal::SessionHandle::Ssh { input_tx } => {
                            input_tx
                                .send(TerminalInput::Data(cmd_with_newline.into_bytes()))
                                .await
                                .map_err(|e| e.to_string())
                        }
                    }
                }
                None => Err("PTY session not found".to_string()),
            }
        }; // Release sessions lock

        // Handle send failure - unregister and fallback
        if let Err(e) = send_result {
            self.terminal_sessions
                .unregister_output_listener(&self.terminal_session_id)
                .await;

            if e.contains("not found") {
                tracing::info!(
                    "PTY session '{}' not found, using direct subprocess execution for: {}",
                    self.terminal_session_id,
                    command
                );
                let (output, exit_code) = self.execute_direct(command).await?;
                // For direct execution, output is already clean (no ANSI codes)
                return Ok((output.clone(), output, exit_code));
            }
            return Err(e);
        }

        // Collect output with timeout and prompt detection
        let mut output = String::new();
        let timeout = std::time::Duration::from_secs(30);
        let start = std::time::Instant::now();
        let mut last_output_time = start;

        while start.elapsed() < timeout {
            match tokio::time::timeout(std::time::Duration::from_millis(100), output_rx.recv()).await
            {
                Ok(Some(chunk)) => {
                    output.push_str(&chunk);
                    last_output_time = std::time::Instant::now();

                    // Check if command appears complete (prompt detected)
                    if self.detect_command_complete(&output) {
                        break;
                    }
                }
                Ok(None) => break, // Channel closed
                Err(_) => {
                    // No output for 100ms - check if we should stop
                    // If we have output and no new output for 2 seconds, assume command done
                    if !output.is_empty()
                        && last_output_time.elapsed() > std::time::Duration::from_secs(2)
                    {
                        break;
                    }
                }
            }
        }

        // Unregister listener
        self.terminal_sessions
            .unregister_output_listener(&self.terminal_session_id)
            .await;

        // For AI: pass raw output directly (no processing, includes ANSI codes)
        // This gives the AI the exact terminal output without any corruption from vt100 processing
        let raw_for_ai = output.clone();

        // For frontend: full vt100 processing for nice display
        let cleaned_for_frontend = self.clean_output(&output, command);

        tracing::info!(
            "PTY command '{}' captured {} bytes of output (raw for AI: {} bytes, cleaned for frontend: {} bytes)",
            command,
            output.len(),
            raw_for_ai.len(),
            cleaned_for_frontend.len()
        );

        // Emit output event for frontend display if we got output
        if !cleaned_for_frontend.is_empty() {
            let query_id = self.query_id.read().await.clone();
            let _ = self
                .event_tx
                .send(AgentEvent::CommandOutput {
                    session_id: self.agent_session_id.clone(),
                    query_id,
                    block_id: generate_block_id(),
                    payload: cleaned_for_frontend.clone(),
                })
                .await;
        }

        // Return raw for AI (accurate data), cleaned for frontend reference
        Ok((raw_for_ai, cleaned_for_frontend, None))
    }

    /// Detect if command execution appears complete by looking for shell prompt
    fn detect_command_complete(&self, output: &str) -> bool {
        // Look for common shell prompt patterns at end of output
        let lines: Vec<&str> = output.lines().collect();
        if let Some(last_line) = lines.last() {
            let trimmed = last_line.trim();
            // Skip empty lines
            if trimmed.is_empty() {
                return false;
            }
            // Common prompt endings (bash, zsh, sh, fish)
            if trimmed.ends_with('$')
                || trimmed.ends_with('#')
                || trimmed.ends_with('>')
                || trimmed.ends_with('%')
            {
                return true;
            }
            // user@host:path$ or user@host:path# pattern
            if trimmed.contains('@') && (trimmed.ends_with('$') || trimmed.ends_with('#')) {
                return true;
            }
        }
        false
    }

    /// Clean terminal output using vt100 terminal emulation
    ///
    /// This properly processes terminal escape sequences including cursor positioning,
    /// which is critical for tabular output like `docker ps` where terminals use
    /// carriage returns for column alignment.
    fn clean_output(&self, output: &str, command: &str) -> String {
        // Debug: log raw input size
        tracing::debug!(
            "[clean_output] Processing {} bytes of raw output for command: {}",
            output.len(),
            command
        );

        // Use vt100 with a very large visible area to ensure content doesn't scroll off.
        // 1000 rows visible, 500 columns wide, 0 scrollback (we make visible area large enough)
        // This ensures all typical command output fits in the visible screen.
        let mut parser = vt100::Parser::new(1000, 500, 0);
        parser.process(output.as_bytes());

        let screen = parser.screen();
        let contents = screen.contents();

        tracing::debug!(
            "[clean_output] vt100 produced {} bytes from {} bytes input",
            contents.len(),
            output.len()
        );

        // Split into lines and clean up
        let lines: Vec<&str> = contents.lines().collect();
        if lines.is_empty() {
            return String::new();
        }

        // Skip command echo (first line if it contains the command)
        let start_idx = if lines
            .first()
            .map(|l| l.trim().contains(command.trim()))
            .unwrap_or(false)
        {
            1
        } else {
            0
        };

        // Remove trailing prompt line
        let end_idx = if let Some(last) = lines.last() {
            let trimmed = last.trim();
            if trimmed.ends_with('$')
                || trimmed.ends_with('#')
                || trimmed.ends_with('>')
                || trimmed.ends_with('%')
            {
                lines.len().saturating_sub(1)
            } else {
                lines.len()
            }
        } else {
            lines.len()
        };

        if start_idx >= end_idx {
            return String::new();
        }

        let result = lines[start_idx..end_idx].join("\n").trim().to_string();

        tracing::debug!(
            "[clean_output] Final output: {} bytes, {} lines",
            result.len(),
            result.lines().count()
        );

        result
    }

    /// Request confirmation for a dangerous command
    async fn request_confirmation(
        &self,
        command: &str,
        classification: &DangerClassification,
    ) -> Result<bool, String> {
        let query_id = self.query_id.read().await.clone();
        let confirmation_id = uuid::Uuid::new_v4().to_string();

        // Emit confirmation required event
        self.event_tx
            .send(AgentEvent::ConfirmationRequired {
                session_id: self.agent_session_id.clone(),
                query_id: query_id.clone(),
                confirmation_id: confirmation_id.clone(),
                command: command.to_string(),
                explanation: classification.explanation.clone(),
                risk_level: classification.level.to_string(),
                affected_resources: classification.affected_resources.clone(),
                warning: Some(format!(
                    "This command is classified as {}. {}",
                    classification.level,
                    classification.level.description()
                )),
                alternatives: vec![], // Could add safer alternatives here
            })
            .await
            .map_err(|e| e.to_string())?;

        // Wait for confirmation with timeout
        let timeout = tokio::time::Duration::from_secs(300); // 5 minutes
        let mut rx = self.confirmation_rx.lock().await;

        match tokio::time::timeout(timeout, rx.recv()).await {
            Ok(Some(confirmed)) => Ok(confirmed),
            Ok(None) => Err("Confirmation channel closed".to_string()),
            Err(_) => Err("Confirmation timeout".to_string()),
        }
    }
}

impl Tool for ShellExecuteTool {
    const NAME: &'static str = "execute_shell";

    type Args = ShellExecuteArgs;
    type Output = ShellExecuteResult;
    type Error = ShellExecuteError;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "Execute a shell command in the user's terminal. Use this to run commands that help accomplish the user's task. For dangerous commands (rm -rf, sudo, etc.), the user will be prompted for confirmation before execution.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The shell command to execute"
                    },
                    "explanation": {
                        "type": "string",
                        "description": "Brief explanation of what this command does (shown to user)"
                    }
                },
                "required": ["command"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let start = Instant::now();
        let query_id = self.query_id.read().await.clone();

        // Classify the command's danger level
        let classification = self.classifier.classify(&args.command);
        let danger_level = classification.level.to_string();

        // Emit tool invoked event
        let _ = self
            .event_tx
            .send(AgentEvent::ToolInvoked {
                session_id: self.agent_session_id.clone(),
                query_id: query_id.clone(),
                tool_name: Self::NAME.to_string(),
                arguments: serde_json::json!({
                    "command": args.command,
                    "explanation": args.explanation,
                    "danger_level": danger_level,
                }),
            })
            .await;

        // Check if confirmation is required
        if classification.requires_confirmation() {
            // Emit command proposed event
            let _ = self
                .event_tx
                .send(AgentEvent::CommandProposed {
                    session_id: self.agent_session_id.clone(),
                    query_id: query_id.clone(),
                    command: args.command.clone(),
                    explanation: args.explanation.clone().unwrap_or_else(|| classification.explanation.clone()),
                    danger_level: danger_level.clone(),
                    requires_confirmation: true,
                    affected_resources: classification.affected_resources.clone(),
                })
                .await;

            // Request confirmation
            match self.request_confirmation(&args.command, &classification).await {
                Ok(true) => {
                    // User confirmed, proceed
                }
                Ok(false) => {
                    return Ok(ShellExecuteResult {
                        output: String::new(),
                        exit_code: None,
                        executed: false,
                        blocked_reason: Some("User rejected the command".to_string()),
                        duration_ms: start.elapsed().as_millis() as u64,
                        danger_level,
                    });
                }
                Err(e) => {
                    return Ok(ShellExecuteResult {
                        output: String::new(),
                        exit_code: None,
                        executed: false,
                        blocked_reason: Some(format!("Confirmation failed: {}", e)),
                        duration_ms: start.elapsed().as_millis() as u64,
                        danger_level,
                    });
                }
            }
        } else if !self.auto_execute {
            // Even for safe commands, if auto_execute is off, we need confirmation
            // This is a more restrictive mode
            match self.request_confirmation(&args.command, &classification).await {
                Ok(true) => {}
                Ok(false) => {
                    return Ok(ShellExecuteResult {
                        output: String::new(),
                        exit_code: None,
                        executed: false,
                        blocked_reason: Some("User rejected the command".to_string()),
                        duration_ms: start.elapsed().as_millis() as u64,
                        danger_level,
                    });
                }
                Err(e) => {
                    return Ok(ShellExecuteResult {
                        output: String::new(),
                        exit_code: None,
                        executed: false,
                        blocked_reason: Some(format!("Confirmation failed: {}", e)),
                        duration_ms: start.elapsed().as_millis() as u64,
                        danger_level,
                    });
                }
            }
        }

        // Generate block ID for this command
        let block_id = generate_block_id();

        // Emit command started event
        let _ = self
            .event_tx
            .send(AgentEvent::CommandStarted {
                session_id: self.agent_session_id.clone(),
                query_id: query_id.clone(),
                block_id,
                command: args.command.clone(),
            })
            .await;

        // Execute the command
        let result = self.execute_via_pty(&args.command).await;

        let duration_ms = start.elapsed().as_millis() as u64;

        match result {
            Ok((raw_output, _cleaned_output, exit_code)) => {
                // Emit command completed event
                let _ = self
                    .event_tx
                    .send(AgentEvent::CommandCompleted {
                        session_id: self.agent_session_id.clone(),
                        query_id: query_id.clone(),
                        block_id,
                        exit_code: exit_code.unwrap_or(0),
                        duration_ms,
                    })
                    .await;

                // Update context with last exit code and save to command history
                {
                    let mut ctx = self.context.write().await;
                    ctx.last_exit_code = exit_code;

                    // Save command execution to history (use raw output for AI context)
                    ctx.add_command_result(CommandHistoryEntry {
                        id: uuid::Uuid::new_v4().to_string(),
                        command: args.command.clone(),
                        output: raw_output.clone(),
                        exit_code,
                        timestamp: chrono::Utc::now().timestamp_millis(),
                        duration_ms,
                    });

                    // Detect container context changes
                    // Check if we're entering a container via docker/podman/nerdctl exec
                    if let Some(container_info) = detect_container_exec(&args.command) {
                        ctx.enter_container(
                            container_info.container_id,
                            container_info.runtime,
                            container_info.shell,
                        );
                    }
                    // Check if we're exiting a container
                    else if ctx.is_in_container() && is_exit_command(&args.command) {
                        ctx.exit_container();
                    }
                }

                // Return RAW output to AI - this preserves accurate data
                // (e.g., version numbers like "0.0.18" stay intact)
                Ok(ShellExecuteResult {
                    output: raw_output,
                    exit_code,
                    executed: true,
                    blocked_reason: None,
                    duration_ms,
                    danger_level,
                })
            }
            Err(e) => {
                // Emit error event
                let _ = self
                    .event_tx
                    .send(AgentEvent::Error {
                        session_id: self.agent_session_id.clone(),
                        query_id: Some(query_id),
                        error_type: crate::agent::events::AgentErrorType::CommandExecutionFailed,
                        message: e.clone(),
                        recoverable: true,
                        suggestion: Some("Check if the terminal session is still active".to_string()),
                    })
                    .await;

                Ok(ShellExecuteResult {
                    output: String::new(),
                    exit_code: None,
                    executed: false,
                    blocked_reason: Some(format!("Execution failed: {}", e)),
                    duration_ms,
                    danger_level,
                })
            }
        }
    }
}
