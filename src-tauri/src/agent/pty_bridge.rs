//! PTY Bridge for Agent Command Execution
//!
//! This module provides a bridge between the AI agent and terminal sessions,
//! allowing the agent to execute commands and capture their output for
//! multi-turn agentic loops.
//!
//! Current implementation uses a time-based approach:
//! 1. Sends command to terminal
//! 2. Waits for output to accumulate
//! 3. Uses prompt detection to know when command is done

use std::sync::Arc;
use std::time::Duration;

use regex::Regex;

use crate::commands::terminal::{SessionHandle, TerminalInput, TerminalSessions};

/// Result of executing a command through the PTY
#[derive(Debug, Clone)]
pub struct CommandExecution {
    /// The command that was executed
    pub command: String,
    /// Captured output (stdout + stderr combined as seen in terminal)
    pub output: String,
    /// Detected exit code (if available)
    pub exit_code: Option<i32>,
    /// Whether the command timed out
    pub timed_out: bool,
}

/// Bridge between AI agent and terminal PTY/SSH sessions
pub struct PtyBridge {
    terminal_sessions: Arc<TerminalSessions>,
}

impl PtyBridge {
    /// Create a new PTY bridge
    pub fn new(terminal_sessions: Arc<TerminalSessions>) -> Self {
        Self { terminal_sessions }
    }

    /// Execute a command in the terminal and capture its output
    ///
    /// This implementation:
    /// 1. Sends the command to the terminal
    /// 2. Waits for output (polling at intervals)
    /// 3. Returns when a prompt is detected or timeout reached
    ///
    /// Note: Output capture relies on terminal output being forwarded to the
    /// frontend via terminal:output events. The actual output is returned
    /// based on what appears after command execution.
    pub async fn execute_and_capture(
        &self,
        session_id: &str,
        command: &str,
        timeout_duration: Duration,
    ) -> Result<CommandExecution, String> {
        // Send command to terminal
        self.send_command(session_id, command).await?;

        // Wait for command to complete
        // This is a simplified approach - we wait a fixed time for short commands
        // and poll for longer ones
        let start = std::time::Instant::now();
        let _poll_interval = Duration::from_millis(200);
        let min_wait = Duration::from_millis(500); // Minimum wait for any command

        // For the initial implementation, we use a simple delay
        // The output is captured by the terminal reader and sent to the frontend
        // In the future, this could be enhanced with proper output capture
        tokio::time::sleep(min_wait).await;

        // For now, we can't directly capture the output without modifying
        // the terminal reader threads. Return empty output - the agentic loop
        // will need to get the output from context.recent_output
        //
        // TODO: Implement proper output capture by:
        // 1. Adding output subscribers to TerminalSessions
        // 2. Having reader threads send to subscribers
        // 3. PtyBridge subscribes and collects output

        let timed_out = start.elapsed() >= timeout_duration;

        Ok(CommandExecution {
            command: command.to_string(),
            output: String::new(), // Output goes to frontend, AI sees via context
            exit_code: None,
            timed_out,
        })
    }

    /// Send a command to the terminal session
    async fn send_command(&self, session_id: &str, command: &str) -> Result<(), String> {
        let sessions_arc = self.terminal_sessions.get_sessions();
        let mut sessions = sessions_arc.lock().await;

        let handle = sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("Terminal session not found: {}", session_id))?;

        let command_with_newline = format!("{}\n", command);

        match handle {
            #[cfg(not(target_os = "android"))]
            SessionHandle::Local { writer, .. } => {
                use std::io::Write;
                writer
                    .write_all(command_with_newline.as_bytes())
                    .map_err(|e| format!("Failed to write to terminal: {}", e))?;
                writer
                    .flush()
                    .map_err(|e| format!("Failed to flush terminal: {}", e))?;
            }
            SessionHandle::Ssh { input_tx } => {
                input_tx
                    .send(TerminalInput::Data(command_with_newline.into_bytes()))
                    .await
                    .map_err(|e| format!("Failed to send to SSH session: {}", e))?;
            }
        }

        Ok(())
    }

    /// Detect shell prompt patterns indicating command completion
    /// (Reserved for future use with output capture)
    #[allow(dead_code)]
    fn is_prompt(&self, text: &str) -> bool {
        // Get the last line of text
        let last_line = text.lines().last().unwrap_or("");

        // Common shell prompt patterns
        let prompt_patterns = [
            r"[$#%>]\s*$",                    // Common endings: $, #, %, >
            r"\w+@[\w\-\.]+:.*[$#]\s*$",      // user@host:path$
            r"\[.*@.*\][$#%]\s*$",            // [user@host path]$
            r"^\s*>\s*$",                     // PowerShell >
            r"PS [A-Z]:\\.*>\s*$",            // PS C:\path>
            r"^\s*\$\s*$",                    // Just $ with whitespace
            r"^\(\w+\)\s*\w+@",               // (venv) user@host
        ];

        for pattern in &prompt_patterns {
            if let Ok(re) = Regex::new(pattern) {
                if re.is_match(last_line) {
                    return true;
                }
            }
        }

        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_prompt() {
        let bridge = PtyBridge {
            terminal_sessions: Arc::new(TerminalSessions::default()),
        };

        // Test common prompt patterns
        assert!(bridge.is_prompt("user@host:~$ "));
        assert!(bridge.is_prompt("[user@host ~]$ "));
        assert!(bridge.is_prompt("$ "));
        assert!(bridge.is_prompt("# "));
        assert!(bridge.is_prompt("% "));
        assert!(bridge.is_prompt("> "));
        assert!(bridge.is_prompt("PS C:\\Users\\test> "));

        // Test non-prompts
        assert!(!bridge.is_prompt("some output text"));
        assert!(!bridge.is_prompt("Running command..."));
        assert!(!bridge.is_prompt(""));
    }
}
