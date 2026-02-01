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

    /// Get the shared context for a session (for use in agentic loop)
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
