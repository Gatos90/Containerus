//! Agent Session Management
//!
//! Manages agent sessions, conversation history, and terminal context.

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, RwLock};
use uuid::Uuid;

use super::events::{AgentEvent, CommandAlternative};
use super::safety::DangerLevel;
use super::summarizer::InputSummary;

/// Maximum number of messages to retain in conversation history
const MAX_HISTORY_SIZE: usize = 50;

/// Maximum recent output lines to keep in context
const MAX_RECENT_OUTPUT_LINES: usize = 100;

/// Maximum command history entries to retain
const MAX_COMMAND_HISTORY: usize = 50;

/// Maximum input summaries to retain for conversation memory
const MAX_INPUT_SUMMARIES: usize = 20;

/// Maximum conversation turns to retain
const MAX_CONVERSATION_TURNS: usize = 10;

/// A tool call within a conversation turn
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnToolCall {
    pub tool_name: String,
    /// Summary of arguments (e.g., "docker logs --tail 50 sentinel")
    pub arguments_summary: String,
    /// Summary of result (e.g., "Error: no such container" or "Success: 50 lines")
    pub result_summary: String,
    pub success: bool,
}

/// A complete conversation turn (user input + AI actions + response)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationTurn {
    pub user_input: String,
    pub tool_calls: Vec<TurnToolCall>,
    pub ai_response: Option<String>,
    pub timestamp: i64,
}

/// Record of a command execution and its output
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandHistoryEntry {
    /// Unique identifier for this history entry
    pub id: String,
    /// The command that was executed
    pub command: String,
    /// The output produced by the command
    pub output: String,
    /// Exit code if available
    pub exit_code: Option<i32>,
    /// Timestamp when the command was executed (millis since epoch)
    pub timestamp: i64,
    /// Duration of command execution in milliseconds
    pub duration_ms: u64,
}

/// Global block ID counter for agent-created blocks
static BLOCK_ID_COUNTER: AtomicI64 = AtomicI64::new(1_000_000);

/// Generate a unique block ID for agent-created blocks
pub fn generate_block_id() -> i64 {
    BLOCK_ID_COUNTER.fetch_add(1, Ordering::SeqCst)
}

/// Represents a single message in the conversation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessage {
    pub id: String,
    pub role: MessageRole,
    pub content: String,
    pub timestamp: i64,
    pub tool_calls: Option<Vec<ToolCallRecord>>,
}

/// Role of a message in the conversation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageRole {
    User,
    Assistant,
    Tool,
    System,
}

/// Record of a tool call made by the agent
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallRecord {
    pub tool_name: String,
    pub arguments: serde_json::Value,
    pub result: Option<String>,
    pub duration_ms: u64,
}

/// Saved host context when entering a container
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostContext {
    pub os: String,
    pub shell: String,
    pub cwd: String,
    pub username: String,
    pub hostname: String,
}

/// Terminal context captured for agent awareness
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalContext {
    pub cwd: String,
    pub shell: String,
    pub os: String,
    pub username: String,
    pub hostname: String,
    pub recent_output: VecDeque<String>,
    pub env_vars: HashMap<String, String>,
    pub git_branch: Option<String>,
    pub git_status: Option<String>,
    pub last_exit_code: Option<i32>,
    /// History of executed commands and their outputs
    pub command_history: VecDeque<CommandHistoryEntry>,
    /// Summaries of previous user inputs for conversation memory
    pub input_summaries: VecDeque<InputSummary>,
    /// Whether currently inside a container shell
    pub in_container: bool,
    /// Container ID if inside a container
    pub container_id: Option<String>,
    /// Container runtime (docker, podman, nerdctl)
    pub container_runtime: Option<String>,
    /// Original host context (to restore on exit)
    pub host_context: Option<Box<HostContext>>,
    /// Complete conversation turns for context memory
    pub conversation_turns: VecDeque<ConversationTurn>,
}

impl TerminalContext {
    /// Create a new terminal context with OS defaults
    pub fn new() -> Self {
        Self {
            cwd: std::env::current_dir()
                .map(|p| p.display().to_string())
                .unwrap_or_default(),
            shell: std::env::var("SHELL")
                .or_else(|_| std::env::var("COMSPEC"))
                .unwrap_or_else(|_| "unknown".to_string()),
            os: std::env::consts::OS.to_string(),
            username: whoami::username().unwrap_or_else(|_| "user".to_string()),
            hostname: whoami::hostname().unwrap_or_else(|_| "localhost".to_string()),
            recent_output: VecDeque::with_capacity(MAX_RECENT_OUTPUT_LINES),
            env_vars: HashMap::new(),
            git_branch: None,
            git_status: None,
            last_exit_code: None,
            command_history: VecDeque::with_capacity(MAX_COMMAND_HISTORY),
            input_summaries: VecDeque::with_capacity(MAX_INPUT_SUMMARIES),
            in_container: false,
            container_id: None,
            container_runtime: None,
            host_context: None,
            conversation_turns: VecDeque::with_capacity(MAX_CONVERSATION_TURNS),
        }
    }

    /// Append output line to recent output buffer
    pub fn append_output(&mut self, line: &str) {
        if self.recent_output.len() >= MAX_RECENT_OUTPUT_LINES {
            self.recent_output.pop_front();
        }
        self.recent_output.push_back(line.to_string());
    }

    /// Get recent output as a single string
    pub fn get_recent_output(&self, max_lines: usize) -> String {
        self.recent_output
            .iter()
            .rev()
            .take(max_lines)
            .rev()
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// Add a command execution result to the history
    pub fn add_command_result(&mut self, entry: CommandHistoryEntry) {
        if self.command_history.len() >= MAX_COMMAND_HISTORY {
            self.command_history.pop_front();
        }
        self.command_history.push_back(entry);
    }

    /// Get command history entries (most recent last)
    pub fn get_command_history(&self) -> Vec<&CommandHistoryEntry> {
        self.command_history.iter().collect()
    }

    /// Find the most recent output for a specific command
    pub fn find_command_output(&self, command: &str) -> Option<&CommandHistoryEntry> {
        self.command_history
            .iter()
            .rev()
            .find(|e| e.command == command)
    }

    /// Search command history for commands containing the search term
    pub fn search_command_history(&self, search: &str) -> Vec<&CommandHistoryEntry> {
        self.command_history
            .iter()
            .filter(|e| e.command.contains(search) || e.output.contains(search))
            .collect()
    }

    /// Add an input summary to the conversation memory
    pub fn add_input_summary(&mut self, summary: InputSummary) {
        if self.input_summaries.len() >= MAX_INPUT_SUMMARIES {
            self.input_summaries.pop_front();
        }
        self.input_summaries.push_back(summary);
    }

    /// Format input summaries for inclusion in agent preamble
    pub fn format_summaries_for_preamble(&self) -> String {
        if self.input_summaries.is_empty() {
            return String::new();
        }

        let now = chrono::Utc::now().timestamp_millis();
        let summaries: Vec<String> = self
            .input_summaries
            .iter()
            .rev()
            .take(10) // Only include last 10 summaries
            .enumerate()
            .map(|(i, s)| {
                let age_mins = (now - s.timestamp) / 60000;
                let age_str = if age_mins < 1 {
                    "just now".to_string()
                } else if age_mins < 60 {
                    format!("{} min ago", age_mins)
                } else {
                    format!("{} hr ago", age_mins / 60)
                };
                format!("{}. [{}] {}", i + 1, age_str, s.summary)
            })
            .collect();

        format!(
            "\n## Conversation History\nPrevious user requests (use query_history to recall command outputs):\n{}\n\nWhen the user refers to something from earlier, use query_history to find the relevant command output.\n",
            summaries.join("\n")
        )
    }

    /// Add a conversation turn to memory
    pub fn add_conversation_turn(&mut self, turn: ConversationTurn) {
        if self.conversation_turns.len() >= MAX_CONVERSATION_TURNS {
            self.conversation_turns.pop_front();
        }
        self.conversation_turns.push_back(turn);
    }

    /// Format conversation turns for inclusion in agent preamble
    /// Shows what the AI already tried (including failed commands) so it doesn't repeat mistakes
    pub fn format_conversation_for_preamble(&self) -> String {
        if self.conversation_turns.is_empty() {
            return String::new();
        }

        let now = chrono::Utc::now().timestamp_millis();
        let mut lines = Vec::new();

        for (i, turn) in self.conversation_turns.iter().rev().take(5).enumerate() {
            let age_mins = (now - turn.timestamp) / 60000;
            let age_str = if age_mins < 1 {
                "just now".to_string()
            } else if age_mins < 60 {
                format!("{} min ago", age_mins)
            } else {
                format!("{} hr ago", age_mins / 60)
            };

            // User input
            let user_summary = if turn.user_input.len() > 100 {
                format!("{}...", &turn.user_input[..100])
            } else {
                turn.user_input.clone()
            };
            lines.push(format!("{}. [{}] User: {}", i + 1, age_str, user_summary));

            // Tool calls with results
            for tc in &turn.tool_calls {
                let status = if tc.success { "[OK]" } else { "[FAILED]" };
                lines.push(format!("   {} {} {}", status, tc.tool_name, tc.arguments_summary));
                if !tc.success && !tc.result_summary.is_empty() {
                    // Show error output for failed commands (truncated)
                    let error_preview = if tc.result_summary.len() > 150 {
                        format!("{}...", &tc.result_summary[..150])
                    } else {
                        tc.result_summary.clone()
                    };
                    lines.push(format!("      Error: {}", error_preview));
                }
            }

            // AI response summary
            if let Some(ref response) = turn.ai_response {
                let response_summary = if response.len() > 80 {
                    format!("{}...", &response[..80])
                } else {
                    response.clone()
                };
                lines.push(format!("   AI: {}", response_summary));
            }
        }

        format!(
            r#"
## Recent Conversation (with tool results)
CRITICAL: Review this section BEFORE taking any action!
If a command failed here, DO NOT repeat it - try a different approach.

{}

IMPORTANT: If you see a [FAILED] command above, you already tried that and it didn't work.
Analyze the error and try something different.
"#,
            lines.join("\n")
        )
    }

    /// Enter container context - saves host context and switches to container environment
    pub fn enter_container(&mut self, container_id: String, runtime: String, shell: String) {
        // Save current host context before switching
        let host = HostContext {
            os: self.os.clone(),
            shell: self.shell.clone(),
            cwd: self.cwd.clone(),
            username: self.username.clone(),
            hostname: self.hostname.clone(),
        };

        self.host_context = Some(Box::new(host));
        self.in_container = true;
        self.container_id = Some(container_id.clone());
        self.container_runtime = Some(runtime);

        // Update context to reflect container environment
        self.os = "linux".to_string(); // Containers are almost always Linux
        self.shell = shell;
        self.cwd = "/".to_string(); // Default container working directory
        self.hostname = container_id; // Use container ID as hostname

        tracing::info!(
            "[Context] Entered container: {} (shell: {})",
            self.container_id.as_deref().unwrap_or("unknown"),
            self.shell
        );
    }

    /// Exit container context - restores host context
    pub fn exit_container(&mut self) {
        if let Some(host) = self.host_context.take() {
            self.os = host.os;
            self.shell = host.shell;
            self.cwd = host.cwd;
            self.username = host.username;
            self.hostname = host.hostname;

            tracing::info!(
                "[Context] Exited container, restored host context (os: {}, shell: {})",
                self.os,
                self.shell
            );
        }

        self.in_container = false;
        self.container_id = None;
        self.container_runtime = None;
    }

    /// Check if currently inside a container
    pub fn is_in_container(&self) -> bool {
        self.in_container
    }
}

/// Command awaiting user confirmation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingConfirmation {
    pub id: String,
    pub query_id: String,
    pub command: String,
    pub explanation: String,
    pub danger_level: DangerLevel,
    pub affected_resources: Vec<String>,
    pub warning: Option<String>,
    pub alternatives: Vec<CommandAlternative>,
    pub created_at: i64,
    pub expires_at: i64,
}

/// Agent session state
#[derive(Debug, Clone)]
pub struct AgentSession {
    pub id: String,
    pub terminal_session_id: String,
    pub history: VecDeque<ConversationMessage>,
    pub terminal_context: TerminalContext,
    pub pending_confirmation: Option<PendingConfirmation>,
    pub created_at: i64,
    pub last_activity: i64,
    pub active_query_id: Option<String>,
    /// Summaries of previous user inputs for conversation memory
    pub input_summaries: VecDeque<InputSummary>,
}

impl AgentSession {
    /// Create a new agent session linked to a terminal session
    pub fn new(terminal_session_id: String) -> Self {
        let now = chrono::Utc::now().timestamp_millis();
        Self {
            id: Uuid::new_v4().to_string(),
            terminal_session_id,
            history: VecDeque::with_capacity(MAX_HISTORY_SIZE),
            terminal_context: TerminalContext::new(),
            pending_confirmation: None,
            created_at: now,
            last_activity: now,
            active_query_id: None,
            input_summaries: VecDeque::with_capacity(MAX_INPUT_SUMMARIES),
        }
    }

    /// Add a message to the conversation history
    pub fn add_message(&mut self, message: ConversationMessage) {
        if self.history.len() >= MAX_HISTORY_SIZE {
            self.history.pop_front();
        }
        self.history.push_back(message);
        self.last_activity = chrono::Utc::now().timestamp_millis();
    }

    /// Get conversation history for context
    pub fn get_history(&self) -> Vec<&ConversationMessage> {
        self.history.iter().collect()
    }

    /// Create a new user message
    pub fn create_user_message(&mut self, content: String) -> ConversationMessage {
        let msg = ConversationMessage {
            id: Uuid::new_v4().to_string(),
            role: MessageRole::User,
            content,
            timestamp: chrono::Utc::now().timestamp_millis(),
            tool_calls: None,
        };
        self.add_message(msg.clone());
        msg
    }

    /// Create a new assistant message
    pub fn create_assistant_message(
        &mut self,
        content: String,
        tool_calls: Option<Vec<ToolCallRecord>>,
    ) -> ConversationMessage {
        let msg = ConversationMessage {
            id: Uuid::new_v4().to_string(),
            role: MessageRole::Assistant,
            content,
            timestamp: chrono::Utc::now().timestamp_millis(),
            tool_calls,
        };
        self.add_message(msg.clone());
        msg
    }

    /// Set a pending confirmation
    pub fn set_pending_confirmation(&mut self, confirmation: PendingConfirmation) {
        self.pending_confirmation = Some(confirmation);
    }

    /// Clear pending confirmation
    pub fn clear_pending_confirmation(&mut self) {
        self.pending_confirmation = None;
    }

    /// Generate a new query ID
    pub fn new_query_id(&mut self) -> String {
        let id = Uuid::new_v4().to_string();
        self.active_query_id = Some(id.clone());
        id
    }

    /// Add an input summary to the conversation memory
    pub fn add_input_summary(&mut self, summary: InputSummary) {
        if self.input_summaries.len() >= MAX_INPUT_SUMMARIES {
            self.input_summaries.pop_front();
        }
        self.input_summaries.push_back(summary);
        self.last_activity = chrono::Utc::now().timestamp_millis();
    }

    /// Get recent input summaries for context
    /// Returns summaries from most recent to oldest
    pub fn get_recent_summaries(&self, count: usize) -> Vec<&InputSummary> {
        self.input_summaries.iter().rev().take(count).collect()
    }

    /// Format input summaries for inclusion in agent preamble
    pub fn format_summaries_for_preamble(&self) -> String {
        if self.input_summaries.is_empty() {
            return String::new();
        }

        let now = chrono::Utc::now().timestamp_millis();
        let summaries: Vec<String> = self
            .input_summaries
            .iter()
            .rev()
            .take(10) // Only include last 10 summaries
            .enumerate()
            .map(|(i, s)| {
                let age_mins = (now - s.timestamp) / 60000;
                let age_str = if age_mins < 1 {
                    "just now".to_string()
                } else if age_mins < 60 {
                    format!("{} min ago", age_mins)
                } else {
                    format!("{} hr ago", age_mins / 60)
                };
                format!("{}. [{}] {}", i + 1, age_str, s.summary)
            })
            .collect();

        format!(
            "\n## Conversation History\nPrevious user requests (use query_history to recall command outputs):\n{}\n\nWhen the user refers to something from earlier, use query_history to find the relevant command output.\n",
            summaries.join("\n")
        )
    }
}

/// Internal state for a session including channels
struct SessionState {
    session: AgentSession,
    context: Arc<RwLock<TerminalContext>>,
    event_tx: mpsc::Sender<AgentEvent>,
    confirmation_tx: mpsc::Sender<bool>,
    cancel_tx: mpsc::Sender<()>,
}

/// Manages all active agent sessions
pub struct AgentSessionManager {
    sessions: RwLock<HashMap<String, SessionState>>,
    /// Maps terminal session IDs to agent session IDs
    terminal_to_agent: RwLock<HashMap<String, String>>,
}

impl Default for AgentSessionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentSessionManager {
    /// Create a new session manager
    pub fn new() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            terminal_to_agent: RwLock::new(HashMap::new()),
        }
    }

    /// Create a new agent session
    pub async fn create_session(
        &self,
        terminal_session_id: String,
    ) -> (
        AgentSession,
        mpsc::Receiver<AgentEvent>,
        mpsc::Receiver<bool>,
        mpsc::Receiver<()>,
    ) {
        let session = AgentSession::new(terminal_session_id.clone());
        let session_id = session.id.clone();

        let (event_tx, event_rx) = mpsc::channel(256);
        let (confirmation_tx, confirmation_rx) = mpsc::channel(1);
        let (cancel_tx, cancel_rx) = mpsc::channel(1);

        // Create shared context for the agentic loop
        let context = Arc::new(RwLock::new(session.terminal_context.clone()));

        let state = SessionState {
            session: session.clone(),
            context,
            event_tx,
            confirmation_tx,
            cancel_tx,
        };

        self.sessions.write().await.insert(session_id.clone(), state);
        self.terminal_to_agent
            .write()
            .await
            .insert(terminal_session_id, session_id);

        (session, event_rx, confirmation_rx, cancel_rx)
    }

    /// Get a session by ID
    pub async fn get_session(&self, session_id: &str) -> Option<AgentSession> {
        self.sessions
            .read()
            .await
            .get(session_id)
            .map(|s| s.session.clone())
    }

    /// Get session by terminal session ID
    pub async fn get_session_by_terminal(&self, terminal_session_id: &str) -> Option<AgentSession> {
        let agent_id = self
            .terminal_to_agent
            .read()
            .await
            .get(terminal_session_id)
            .cloned();

        if let Some(id) = agent_id {
            self.get_session(&id).await
        } else {
            None
        }
    }

    /// Update a session
    pub async fn update_session(&self, session: AgentSession) -> Result<(), String> {
        let mut sessions = self.sessions.write().await;
        if let Some(state) = sessions.get_mut(&session.id) {
            state.session = session;
            Ok(())
        } else {
            Err("Session not found".to_string())
        }
    }

    /// Send an event to a session
    pub async fn send_event(&self, session_id: &str, event: AgentEvent) -> Result<(), String> {
        let sessions = self.sessions.read().await;
        if let Some(state) = sessions.get(session_id) {
            state
                .event_tx
                .send(event)
                .await
                .map_err(|e| e.to_string())
        } else {
            Err("Session not found".to_string())
        }
    }

    /// Send a confirmation response
    pub async fn send_confirmation(&self, session_id: &str, confirmed: bool) -> Result<(), String> {
        let sessions = self.sessions.read().await;
        if let Some(state) = sessions.get(session_id) {
            state
                .confirmation_tx
                .send(confirmed)
                .await
                .map_err(|e| e.to_string())
        } else {
            Err("Session not found".to_string())
        }
    }

    /// Send a cancel signal
    pub async fn cancel_session(&self, session_id: &str) -> Result<(), String> {
        let sessions = self.sessions.read().await;
        if let Some(state) = sessions.get(session_id) {
            state.cancel_tx.send(()).await.map_err(|e| e.to_string())
        } else {
            Err("Session not found".to_string())
        }
    }

    /// Remove a session
    pub async fn remove_session(&self, session_id: &str) {
        let mut sessions = self.sessions.write().await;
        if let Some(state) = sessions.remove(session_id) {
            let mut terminal_map = self.terminal_to_agent.write().await;
            terminal_map.remove(&state.session.terminal_session_id);
        }
    }

    /// Update terminal context for a session
    pub async fn update_context(
        &self,
        session_id: &str,
        context: TerminalContext,
    ) -> Result<(), String> {
        let sessions = self.sessions.read().await;
        if let Some(state) = sessions.get(session_id) {
            // Update the shared context Arc
            let mut ctx = state.context.write().await;
            *ctx = context;
            Ok(())
        } else {
            Err("Session not found".to_string())
        }
    }

    /// Append output to a session's context
    pub async fn append_output(&self, session_id: &str, output: &str) -> Result<(), String> {
        let sessions = self.sessions.read().await;
        if let Some(state) = sessions.get(session_id) {
            // Update the shared context Arc
            let mut ctx = state.context.write().await;
            for line in output.lines() {
                ctx.append_output(line);
            }
            Ok(())
        } else {
            Err("Session not found".to_string())
        }
    }

    /// Get event sender for a session (for use in tools)
    pub async fn get_event_sender(
        &self,
        session_id: &str,
    ) -> Option<mpsc::Sender<AgentEvent>> {
        self.sessions
            .read()
            .await
            .get(session_id)
            .map(|s| s.event_tx.clone())
    }

    /// Retrieve the shared TerminalContext for the given agent session ID.
    ///
    /// Returns `Some(Arc<RwLock<TerminalContext>>)` if the session exists, or `None` if no session
    /// with the provided ID is present.
    ///
    /// # Examples
    ///
    /// ```no_run
    /// # use std::sync::Arc;
    /// # use tokio::sync::RwLock;
    /// # // `manager` is an instance of `AgentSessionManager` with a session "sess" created.
    /// # async fn example(manager: &crate::agent::session::AgentSessionManager) {
    /// let ctx = manager.get_context("sess").await;
    /// if let Some(ctx_arc) = ctx {
    ///     let ctx = ctx_arc.read().await;
    ///     // use `ctx` (TerminalContext) here
    ///     let _cwd = &ctx.cwd;
    /// }
    /// # }
    /// ```
    pub async fn get_context(
        &self,
        session_id: &str,
    ) -> Option<Arc<RwLock<TerminalContext>>> {
        self.sessions
            .read()
            .await
            .get(session_id)
            .map(|s| s.context.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Creates a CommandHistoryEntry recording a command, its output, and exit code.
    ///
    /// The returned entry is populated with a new UUID `id`, the provided `command` and `output`,
    /// the given `exit_code` wrapped in `Some(...)`, the current UTC timestamp in milliseconds,
    /// and a default `duration_ms` of `100`.
    ///
    /// # Examples
    ///
    /// ```
    /// let entry = make_command_entry("echo hello", "hello\n", 0);
    /// assert_eq!(entry.command, "echo hello");
    /// assert_eq!(entry.output, "hello\n");
    /// assert_eq!(entry.exit_code, Some(0));
    /// ```
    fn make_command_entry(command: &str, output: &str, exit_code: i32) -> CommandHistoryEntry {
        CommandHistoryEntry {
            id: Uuid::new_v4().to_string(),
            command: command.to_string(),
            output: output.to_string(),
            exit_code: Some(exit_code),
            timestamp: chrono::Utc::now().timestamp_millis(),
            duration_ms: 100,
        }
    }

    /// Create an InputSummary from a text snippet, recording its content, creation time, and original length.
    ///
    /// The `timestamp` is the number of milliseconds since the Unix epoch (UTC). `original_length` is the
    /// length of the provided `summary` in bytes (UTF-8 encoded).
    ///
    /// # Examples
    ///
    /// ```
    /// let s = "hello";
    /// let summary = make_input_summary(s);
    /// assert_eq!(summary.summary, "hello");
    /// assert!(summary.timestamp > 0);
    /// assert_eq!(summary.original_length, s.len());
    /// ```
    fn make_input_summary(summary: &str) -> InputSummary {
        InputSummary {
            summary: summary.to_string(),
            timestamp: chrono::Utc::now().timestamp_millis(),
            original_length: summary.len(),
        }
    }

    /// Create a ConversationTurn representing a user turn with the given input.
    ///
    /// The returned turn contains the provided `input` as `user_input`, an empty `tool_calls`
    /// list, `ai_response` set to `None`, and a `timestamp` set to the current UTC time in milliseconds.
    ///
    /// # Examples
    ///
    /// ```
    /// let turn = make_conversation_turn("list files");
    /// assert_eq!(turn.user_input, "list files");
    /// assert!(turn.tool_calls.is_empty());
    /// assert!(turn.ai_response.is_none());
    /// // timestamp is set to a recent UTC milliseconds value
    /// assert!(turn.timestamp > 0);
    /// ```
    fn make_conversation_turn(input: &str) -> ConversationTurn {
        ConversationTurn {
            user_input: input.to_string(),
            tool_calls: vec![],
            ai_response: None,
            timestamp: chrono::Utc::now().timestamp_millis(),
        }
    }

    // === generate_block_id tests ===

    #[test]
    fn test_generate_block_id_increments() {
        let id1 = generate_block_id();
        let id2 = generate_block_id();
        // Global atomic counter shared across parallel tests, so just verify ordering
        assert!(id2 > id1);
    }

    #[test]
    fn test_generate_block_id_is_unique() {
        let ids: Vec<i64> = (0..100).map(|_| generate_block_id()).collect();
        let unique: std::collections::HashSet<i64> = ids.iter().copied().collect();
        assert_eq!(ids.len(), unique.len());
    }

    // === TerminalContext tests ===

    #[test]
    fn test_terminal_context_default() {
        let ctx = TerminalContext::default();
        assert!(ctx.recent_output.is_empty());
        assert!(ctx.command_history.is_empty());
        assert!(!ctx.in_container);
        assert!(ctx.container_id.is_none());
    }

    #[test]
    fn test_append_output() {
        let mut ctx = TerminalContext::default();
        ctx.append_output("line 1");
        ctx.append_output("line 2");

        assert_eq!(ctx.recent_output.len(), 2);
        assert_eq!(ctx.recent_output[0], "line 1");
        assert_eq!(ctx.recent_output[1], "line 2");
    }

    #[test]
    fn test_append_output_respects_max_lines() {
        let mut ctx = TerminalContext::default();
        for i in 0..MAX_RECENT_OUTPUT_LINES + 10 {
            ctx.append_output(&format!("line {}", i));
        }

        assert_eq!(ctx.recent_output.len(), MAX_RECENT_OUTPUT_LINES);
        // First lines should have been evicted
        assert!(ctx.recent_output[0].contains("10"));
    }

    #[test]
    fn test_get_recent_output() {
        let mut ctx = TerminalContext::default();
        ctx.append_output("line 1");
        ctx.append_output("line 2");
        ctx.append_output("line 3");

        let output = ctx.get_recent_output(2);
        assert_eq!(output, "line 2\nline 3");
    }

    #[test]
    fn test_get_recent_output_all() {
        let mut ctx = TerminalContext::default();
        ctx.append_output("a");
        ctx.append_output("b");

        let output = ctx.get_recent_output(10);
        assert_eq!(output, "a\nb");
    }

    #[test]
    fn test_add_command_result() {
        let mut ctx = TerminalContext::default();
        ctx.add_command_result(make_command_entry("ls", "file.txt", 0));
        ctx.add_command_result(make_command_entry("pwd", "/home", 0));

        assert_eq!(ctx.command_history.len(), 2);
    }

    #[test]
    fn test_add_command_result_respects_max() {
        let mut ctx = TerminalContext::default();
        for i in 0..MAX_COMMAND_HISTORY + 5 {
            ctx.add_command_result(make_command_entry(&format!("cmd-{}", i), "out", 0));
        }

        assert_eq!(ctx.command_history.len(), MAX_COMMAND_HISTORY);
    }

    #[test]
    fn test_get_command_history() {
        let mut ctx = TerminalContext::default();
        ctx.add_command_result(make_command_entry("ls", "file.txt", 0));
        ctx.add_command_result(make_command_entry("pwd", "/home", 0));

        let history = ctx.get_command_history();
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].command, "ls");
        assert_eq!(history[1].command, "pwd");
    }

    #[test]
    fn test_find_command_output() {
        let mut ctx = TerminalContext::default();
        ctx.add_command_result(make_command_entry("ls", "file.txt", 0));
        ctx.add_command_result(make_command_entry("pwd", "/home", 0));
        ctx.add_command_result(make_command_entry("ls", "dir/", 0));

        // Should find most recent 'ls'
        let found = ctx.find_command_output("ls").unwrap();
        assert_eq!(found.output, "dir/");

        assert!(ctx.find_command_output("nonexistent").is_none());
    }

    #[test]
    fn test_search_command_history() {
        let mut ctx = TerminalContext::default();
        ctx.add_command_result(make_command_entry("git status", "modified file", 0));
        ctx.add_command_result(make_command_entry("ls", "file.txt", 0));
        ctx.add_command_result(make_command_entry("git log", "commit abc", 0));

        let results = ctx.search_command_history("git");
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].command, "git status");
        assert_eq!(results[1].command, "git log");
    }

    #[test]
    fn test_search_command_history_by_output() {
        let mut ctx = TerminalContext::default();
        ctx.add_command_result(make_command_entry("ls", "config.json", 0));
        ctx.add_command_result(make_command_entry("pwd", "/home", 0));

        let results = ctx.search_command_history("config");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].command, "ls");
    }

    #[test]
    fn test_add_input_summary() {
        let mut ctx = TerminalContext::default();
        ctx.add_input_summary(make_input_summary("check docker containers"));
        ctx.add_input_summary(make_input_summary("restart nginx"));

        assert_eq!(ctx.input_summaries.len(), 2);
    }

    #[test]
    fn test_add_input_summary_respects_max() {
        let mut ctx = TerminalContext::default();
        for i in 0..MAX_INPUT_SUMMARIES + 5 {
            ctx.add_input_summary(make_input_summary(&format!("summary {}", i)));
        }

        assert_eq!(ctx.input_summaries.len(), MAX_INPUT_SUMMARIES);
    }

    #[test]
    fn test_format_summaries_empty() {
        let ctx = TerminalContext::default();
        assert!(ctx.format_summaries_for_preamble().is_empty());
    }

    #[test]
    fn test_format_summaries_for_preamble() {
        let mut ctx = TerminalContext::default();
        ctx.add_input_summary(make_input_summary("check docker containers"));

        let formatted = ctx.format_summaries_for_preamble();
        assert!(formatted.contains("Conversation History"));
        assert!(formatted.contains("check docker containers"));
        assert!(formatted.contains("just now"));
    }

    #[test]
    fn test_add_conversation_turn() {
        let mut ctx = TerminalContext::default();
        ctx.add_conversation_turn(make_conversation_turn("list containers"));

        assert_eq!(ctx.conversation_turns.len(), 1);
    }

    #[test]
    fn test_add_conversation_turn_respects_max() {
        let mut ctx = TerminalContext::default();
        for i in 0..MAX_CONVERSATION_TURNS + 5 {
            ctx.add_conversation_turn(make_conversation_turn(&format!("turn {}", i)));
        }

        assert_eq!(ctx.conversation_turns.len(), MAX_CONVERSATION_TURNS);
    }

    #[test]
    fn test_format_conversation_empty() {
        let ctx = TerminalContext::default();
        assert!(ctx.format_conversation_for_preamble().is_empty());
    }

    #[test]
    fn test_format_conversation_for_preamble() {
        let mut ctx = TerminalContext::default();
        let mut turn = make_conversation_turn("list running containers");
        turn.tool_calls.push(TurnToolCall {
            tool_name: "execute_command".to_string(),
            arguments_summary: "docker ps".to_string(),
            result_summary: "CONTAINER ID  IMAGE".to_string(),
            success: true,
        });
        turn.ai_response = Some("Here are your running containers.".to_string());
        ctx.add_conversation_turn(turn);

        let formatted = ctx.format_conversation_for_preamble();
        assert!(formatted.contains("Recent Conversation"));
        assert!(formatted.contains("list running containers"));
        assert!(formatted.contains("[OK]"));
        assert!(formatted.contains("execute_command"));
        assert!(formatted.contains("AI:"));
    }

    #[test]
    fn test_format_conversation_shows_failed_commands() {
        let mut ctx = TerminalContext::default();
        let mut turn = make_conversation_turn("remove all containers");
        turn.tool_calls.push(TurnToolCall {
            tool_name: "execute_command".to_string(),
            arguments_summary: "docker rm -f $(docker ps -aq)".to_string(),
            result_summary: "Error: permission denied".to_string(),
            success: false,
        });
        ctx.add_conversation_turn(turn);

        let formatted = ctx.format_conversation_for_preamble();
        assert!(formatted.contains("[FAILED]"));
        assert!(formatted.contains("Error: permission denied"));
    }

    #[test]
    fn test_format_conversation_truncates_long_input() {
        let mut ctx = TerminalContext::default();
        let long_input = "a".repeat(200);
        ctx.add_conversation_turn(make_conversation_turn(&long_input));

        let formatted = ctx.format_conversation_for_preamble();
        assert!(formatted.contains("..."));
    }

    // === Container context tests ===

    #[test]
    fn test_enter_container() {
        let mut ctx = TerminalContext::default();
        ctx.os = "macos".to_string();
        ctx.shell = "/bin/zsh".to_string();
        ctx.cwd = "/home/user".to_string();
        ctx.username = "kevin".to_string();
        ctx.hostname = "macbook".to_string();

        ctx.enter_container("abc123".to_string(), "docker".to_string(), "/bin/bash".to_string());

        assert!(ctx.is_in_container());
        assert_eq!(ctx.container_id.as_deref(), Some("abc123"));
        assert_eq!(ctx.container_runtime.as_deref(), Some("docker"));
        assert_eq!(ctx.os, "linux");
        assert_eq!(ctx.shell, "/bin/bash");
        assert_eq!(ctx.cwd, "/");
        assert_eq!(ctx.hostname, "abc123");

        // Host context should be saved
        let host = ctx.host_context.as_ref().unwrap();
        assert_eq!(host.os, "macos");
        assert_eq!(host.shell, "/bin/zsh");
        assert_eq!(host.cwd, "/home/user");
        assert_eq!(host.username, "kevin");
        assert_eq!(host.hostname, "macbook");
    }

    #[test]
    fn test_exit_container() {
        let mut ctx = TerminalContext::default();
        ctx.os = "macos".to_string();
        ctx.shell = "/bin/zsh".to_string();
        ctx.cwd = "/home/user".to_string();
        ctx.username = "kevin".to_string();
        ctx.hostname = "macbook".to_string();

        ctx.enter_container("abc123".to_string(), "docker".to_string(), "/bin/sh".to_string());
        ctx.exit_container();

        assert!(!ctx.is_in_container());
        assert!(ctx.container_id.is_none());
        assert!(ctx.container_runtime.is_none());
        assert!(ctx.host_context.is_none());

        // Host context should be restored
        assert_eq!(ctx.os, "macos");
        assert_eq!(ctx.shell, "/bin/zsh");
        assert_eq!(ctx.cwd, "/home/user");
        assert_eq!(ctx.username, "kevin");
        assert_eq!(ctx.hostname, "macbook");
    }

    #[test]
    fn test_exit_container_without_entering() {
        let mut ctx = TerminalContext::default();
        ctx.exit_container();
        assert!(!ctx.is_in_container());
    }

    // === AgentSession tests ===

    #[test]
    fn test_agent_session_new() {
        let session = AgentSession::new("term-1".to_string());
        assert_eq!(session.terminal_session_id, "term-1");
        assert!(!session.id.is_empty());
        assert!(session.history.is_empty());
        assert!(session.pending_confirmation.is_none());
        assert!(session.active_query_id.is_none());
    }

    #[test]
    fn test_agent_session_add_message() {
        let mut session = AgentSession::new("term-1".to_string());
        let msg = ConversationMessage {
            id: "msg-1".to_string(),
            role: MessageRole::User,
            content: "hello".to_string(),
            timestamp: chrono::Utc::now().timestamp_millis(),
            tool_calls: None,
        };
        session.add_message(msg);

        assert_eq!(session.history.len(), 1);
        assert_eq!(session.history[0].content, "hello");
    }

    #[test]
    fn test_agent_session_history_limit() {
        let mut session = AgentSession::new("term-1".to_string());
        for i in 0..MAX_HISTORY_SIZE + 10 {
            session.add_message(ConversationMessage {
                id: format!("msg-{}", i),
                role: MessageRole::User,
                content: format!("message {}", i),
                timestamp: chrono::Utc::now().timestamp_millis(),
                tool_calls: None,
            });
        }

        assert_eq!(session.history.len(), MAX_HISTORY_SIZE);
    }

    #[test]
    fn test_create_user_message() {
        let mut session = AgentSession::new("term-1".to_string());
        let msg = session.create_user_message("hello".to_string());

        assert!(!msg.id.is_empty());
        assert_eq!(msg.content, "hello");
        assert!(session.history.len() == 1);
    }

    #[test]
    fn test_create_assistant_message() {
        let mut session = AgentSession::new("term-1".to_string());
        let msg = session.create_assistant_message("response".to_string(), None);

        assert_eq!(msg.content, "response");
        assert!(msg.tool_calls.is_none());
        assert_eq!(session.history.len(), 1);
    }

    #[test]
    fn test_create_assistant_message_with_tool_calls() {
        let mut session = AgentSession::new("term-1".to_string());
        let tool_calls = vec![ToolCallRecord {
            tool_name: "execute_command".to_string(),
            arguments: serde_json::json!({"command": "ls"}),
            result: Some("file.txt".to_string()),
            duration_ms: 50,
        }];
        let msg = session.create_assistant_message("done".to_string(), Some(tool_calls));

        assert!(msg.tool_calls.is_some());
        assert_eq!(msg.tool_calls.unwrap().len(), 1);
    }

    #[test]
    fn test_pending_confirmation() {
        let mut session = AgentSession::new("term-1".to_string());
        assert!(session.pending_confirmation.is_none());

        let confirmation = PendingConfirmation {
            id: "conf-1".to_string(),
            query_id: "q-1".to_string(),
            command: "rm -rf /tmp/test".to_string(),
            explanation: "Delete temp directory".to_string(),
            danger_level: DangerLevel::Safe,
            affected_resources: vec!["/tmp/test".to_string()],
            warning: None,
            alternatives: vec![],
            created_at: chrono::Utc::now().timestamp_millis(),
            expires_at: chrono::Utc::now().timestamp_millis() + 60000,
        };
        session.set_pending_confirmation(confirmation);
        assert!(session.pending_confirmation.is_some());

        session.clear_pending_confirmation();
        assert!(session.pending_confirmation.is_none());
    }

    #[test]
    fn test_new_query_id() {
        let mut session = AgentSession::new("term-1".to_string());
        let id1 = session.new_query_id();
        let id2 = session.new_query_id();

        assert!(!id1.is_empty());
        assert!(!id2.is_empty());
        assert_ne!(id1, id2);
        assert_eq!(session.active_query_id.as_deref(), Some(id2.as_str()));
    }

    #[test]
    fn test_agent_session_input_summaries() {
        let mut session = AgentSession::new("term-1".to_string());
        session.add_input_summary(make_input_summary("check containers"));
        session.add_input_summary(make_input_summary("restart service"));

        assert_eq!(session.input_summaries.len(), 2);

        let recent = session.get_recent_summaries(1);
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].summary, "restart service");
    }

    #[test]
    fn test_agent_session_input_summaries_limit() {
        let mut session = AgentSession::new("term-1".to_string());
        for i in 0..MAX_INPUT_SUMMARIES + 5 {
            session.add_input_summary(make_input_summary(&format!("summary {}", i)));
        }

        assert_eq!(session.input_summaries.len(), MAX_INPUT_SUMMARIES);
    }

    #[test]
    fn test_agent_session_format_summaries_empty() {
        let session = AgentSession::new("term-1".to_string());
        assert!(session.format_summaries_for_preamble().is_empty());
    }

    #[test]
    fn test_agent_session_format_summaries() {
        let mut session = AgentSession::new("term-1".to_string());
        session.add_input_summary(make_input_summary("check docker containers"));

        let formatted = session.format_summaries_for_preamble();
        assert!(formatted.contains("Conversation History"));
        assert!(formatted.contains("check docker containers"));
    }

    // === AgentSessionManager tests ===

    #[tokio::test]
    async fn test_session_manager_create_session() {
        let manager = AgentSessionManager::new();
        let (session, _events_rx, _confirm_rx, _cancel_rx) =
            manager.create_session("term-1".to_string()).await;

        assert_eq!(session.terminal_session_id, "term-1");
        assert!(!session.id.is_empty());

        let retrieved = manager.get_session(&session.id).await;
        assert!(retrieved.is_some());
    }

    #[tokio::test]
    async fn test_session_manager_get_by_terminal() {
        let manager = AgentSessionManager::new();
        let (session, _events_rx, _confirm_rx, _cancel_rx) =
            manager.create_session("term-1".to_string()).await;

        let by_terminal = manager.get_session_by_terminal("term-1").await;
        assert!(by_terminal.is_some());
        assert_eq!(by_terminal.unwrap().id, session.id);
    }

    #[tokio::test]
    async fn test_session_manager_remove_session() {
        let manager = AgentSessionManager::new();
        let (session, _events_rx, _confirm_rx, _cancel_rx) =
            manager.create_session("term-1".to_string()).await;

        manager.remove_session(&session.id).await;

        assert!(manager.get_session(&session.id).await.is_none());
        assert!(manager.get_session_by_terminal("term-1").await.is_none());
    }

    #[tokio::test]
    async fn test_session_manager_update_session() {
        let manager = AgentSessionManager::new();
        let (mut session, _events_rx, _confirm_rx, _cancel_rx) =
            manager.create_session("term-1".to_string()).await;

        session.create_user_message("hello".to_string());
        manager.update_session(session.clone()).await.unwrap();

        let updated = manager.get_session(&session.id).await.unwrap();
        assert_eq!(updated.history.len(), 1);
    }

    #[tokio::test]
    async fn test_session_manager_append_output() {
        let manager = AgentSessionManager::new();
        let (session, _events_rx, _confirm_rx, _cancel_rx) =
            manager.create_session("term-1".to_string()).await;

        manager
            .append_output(&session.id, "hello world")
            .await
            .unwrap();

        let ctx = manager.get_context(&session.id).await.unwrap();
        let ctx_read = ctx.read().await;
        assert!(ctx_read.recent_output.contains(&"hello world".to_string()));
    }

    // === Serialization tests ===

    #[test]
    fn test_message_role_serialization() {
        let role = MessageRole::User;
        let json = serde_json::to_string(&role).unwrap();
        assert_eq!(json, "\"user\"");

        let role = MessageRole::Assistant;
        let json = serde_json::to_string(&role).unwrap();
        assert_eq!(json, "\"assistant\"");
    }

    #[test]
    fn test_conversation_message_serialization() {
        let msg = ConversationMessage {
            id: "msg-1".to_string(),
            role: MessageRole::User,
            content: "hello".to_string(),
            timestamp: 1704067200000,
            tool_calls: None,
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"role\":\"user\""));
        assert!(json.contains("\"toolCalls\""));

        let deserialized: ConversationMessage = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.content, "hello");
    }

    /// Verifies that a `CommandHistoryEntry` serializes to JSON with expected field names and round-trips correctly.
    ///
    /// # Examples
    ///
    /// ```
    /// let entry = make_command_entry("ls -la", "total 42", 0);
    /// let json = serde_json::to_string(&entry).unwrap();
    /// assert!(json.contains("\"exitCode\""));
    /// assert!(json.contains("\"durationMs\""));
    ///
    /// let deserialized: CommandHistoryEntry = serde_json::from_str(&json).unwrap();
    /// assert_eq!(deserialized.command, "ls -la");
    /// ```
    #[test]
    fn test_command_history_entry_serialization() {
        let entry = make_command_entry("ls -la", "total 42", 0);
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("\"exitCode\""));
        assert!(json.contains("\"durationMs\""));

        let deserialized: CommandHistoryEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.command, "ls -la");
    }

    #[test]
    fn test_turn_tool_call_serialization() {
        let tc = TurnToolCall {
            tool_name: "execute_command".to_string(),
            arguments_summary: "docker ps".to_string(),
            result_summary: "container list".to_string(),
            success: true,
        };
        let json = serde_json::to_string(&tc).unwrap();
        assert!(json.contains("\"toolName\""));
        assert!(json.contains("\"argumentsSummary\""));
    }
}