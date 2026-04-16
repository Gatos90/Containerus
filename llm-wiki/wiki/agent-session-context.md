# Agent session and context

**Summary**: An `AgentSession` pins an AI conversation to a terminal session, accumulating the `TerminalContext` (cwd, shell, git branch, recent output, command history, summarized user inputs, conversation turns) that every LLM call uses. Capped queues keep token use bounded.

**Sources**: `src-tauri/src/agent/session.rs`, `crates/containerus-core/src/models/agent.rs`.

**Last updated**: 2026-04-16

**Parent**: [[ai-agent]]
**Siblings**: [[agent-events]], [[agent-tools]], [[agent-safety]]

---

## `AgentSession`

```rust
pub struct AgentSession {
    pub id: String,
    pub terminal_session_id: String,
    pub created_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,

    pub pending_confirmation: Option<PendingConfirmation>,
    pub active_query_id: Option<String>,

    pub terminal_context: TerminalContext,
    pub history: VecDeque<ConversationMessage>,       // cap 50
    pub command_history: VecDeque<CommandHistoryEntry>, // cap 50
}
```

- `pending_confirmation` — set while waiting for the user to Approve/Deny a dangerous command. Cleared by `respond_to_confirmation`.
- `active_query_id` — single-flight guard; prevents a second `submit_agent_query` from racing.

## `TerminalContext`

```rust
pub struct TerminalContext {
    pub cwd: String,
    pub shell: String,
    pub os: String,
    pub username: String,
    pub hostname: String,

    pub recent_output: VecDeque<String>,                  // cap 100 lines
    pub env_vars: HashMap<String, String>,
    pub git_branch: Option<String>,
    pub git_status: Option<String>,
    pub last_exit_code: Option<i32>,

    pub command_history: VecDeque<CommandHistoryEntry>,   // cap 50
    pub input_summaries: VecDeque<InputSummary>,          // cap 20
    pub conversation_turns: VecDeque<ConversationTurn>,   // cap 10

    pub in_container: bool,
    pub container_id: Option<String>,
    pub container_runtime: Option<ContainerRuntime>,
    pub host_context: Option<HostContext>,
}
```

Intent: every turn's LLM request should include "enough state" to make the model's tool choice informed, without blowing the context window.

### Output capture

`append_agent_output(session_id, output)` is the entry point. `TerminalContext.recent_output` is a bounded queue trimmed on each append. The agent's PTY bridge ([[terminal-subsystem]]) hooks into `TerminalSessions`' output listener to forward every line.

### Command history

`CommandHistoryEntry { id, command, output, exit_code, timestamp, duration_ms }`. Created after each `CommandCompleted` event, capped at 50 per session. Older entries drop off the queue; `history_query` tool can search what's retained.

### Input summaries

When the user pastes a long message, `summarize_user_input` (see [[ai-agent]]) produces `InputSummary { summary, timestamp, original_length }`. These live separately so the agent can say "earlier you pasted this log with N lines, summary: ...".

### Conversation turns

`ConversationTurn { user_input, tool_calls: Vec<TurnToolCall>, ai_response, timestamp }`. A structured form of the back-and-forth — easier to re-serialize than raw message arrays. `TurnToolCall` captures `tool_name`, short `arguments_summary`, short `result_summary`, success flag.

### In-container context

When the agent session is attached to a container (via `container_id`), `in_container: true` and the agent's prompts tell it "you're inside a container — /host/... is not accessible". `host_context: Option<HostContext>` preserves the outer cwd/shell/os so `exit` from the container can restore sensible context.

## Limits (from `session.rs`)

```rust
const MAX_HISTORY_SIZE: usize = 50;
const MAX_RECENT_OUTPUT_LINES: usize = 100;
const MAX_COMMAND_HISTORY: usize = 50;
const MAX_INPUT_SUMMARIES: usize = 20;
const MAX_CONVERSATION_TURNS: usize = 10;
```

Trimming is eager (on insert), not lazy. Keeps memory predictable and bounds token cost of any single request.

## `AgentSessionManager`

Owns `HashMap<session_id, AgentSession>` plus event channels:

```rust
pub struct AgentSessionManager {
    sessions: Mutex<HashMap<String, AgentSession>>,
    event_channels: Mutex<HashMap<String, mpsc::Sender<AgentEvent>>>,
    confirmation_channels: Mutex<HashMap<String, oneshot::Sender<ConfirmationResponse>>>,
}
```

Key methods:
- `create_session(terminal_session_id, container_id?) -> AgentSession`
- `get_session(id)`, `get_session_by_terminal(terminal_session_id)`
- `set_pending_confirmation` / `send_confirmation` (oneshot wake-up)
- `cancel_session(id)` — marks cancellation token
- `append_output(session_id, line)`
- `close(id)`

## Lifecycle transitions

```
Created ──────► Active ──────► Completed
                │ │ │
                │ │ └─► Cancelled
                │ └──► Waiting-for-confirmation ──► Active
                └───► Failed / Timeout
```

`last_activity` updates on every event flow; the UI can display staleness and offer to close idle sessions.

## Related pages

- [[ai-agent]]
- [[agent-events]]
- [[agent-tools]]
- [[flow-agent-query]]
- [[terminal-subsystem]]
