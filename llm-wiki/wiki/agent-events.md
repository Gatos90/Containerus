# Agent events

**Summary**: `AgentEvent` is the single streaming type the agent emits. Thirteen variants cover every visible moment of an agent query — thinking, response chunks, tool invocations, command proposals, confirmations, execution, completion, and errors.

**Sources**: `src-tauri/src/agent/events.rs`.

**Last updated**: 2026-04-16

**Parent**: [[ai-agent]]
**Siblings**: [[agent-session-context]], [[agent-tools]], [[agent-safety]]

---

## Transport

Events flow from `run_agentic_loop` through a Tokio `mpsc::Sender<AgentEvent>` into a dispatcher task that calls `app.emit("agent:event", event)`. The frontend listens via `@tauri-apps/api/event::listen("agent:event", ...)`. Each event carries the session and query ids so multiple queries can run independently.

## Variants

### Model-phase events

| Variant | Meaning | Fields |
|---|---|---|
| `Thinking` | Loop turn started; LLM about to be called | `session_id`, `query_id` |
| `ResponseChunk` | Streaming token or tool-use delta | `session_id`, `query_id`, `chunk_type`, `content`, `is_final` |

`ChunkType ∈ { Thinking, Text, Command, Explanation, Warning }` — frontend uses this to render different colors / sections of a block.

### Tool-phase events

| Variant | Meaning |
|---|---|
| `ToolInvoked` | A tool is about to run — `tool_name`, `arguments` |
| `ToolCompleted` | Tool finished — `result`, `duration_ms` |
| `CommandProposed` | Shell command specifically — includes `command`, `explanation`, `danger_level`, `requires_confirmation`, `affected_resources` |
| `ConfirmationRequired` | User must approve — `confirmation_id`, `command`, `risk_level`, `warning?`, `alternatives: Vec<CommandAlternative>` |

### Execution-phase events

| Variant | Meaning |
|---|---|
| `CommandStarted` | Block opened — `block_id`, `command` |
| `CommandOutput` | stdout/stderr chunk — `block_id`, `payload` |
| `CommandCompleted` | Block closed — `block_id`, `exit_code`, `duration_ms` |

### Plan-phase events

| Variant | Meaning |
|---|---|
| `StepStarted` | Multi-step plan, step N begins |
| `StepCompleted` | Step finished, success/failure |

### Terminal events

| Variant | Meaning |
|---|---|
| `QueryCompleted` | Query done — `status ∈ { Completed, Cancelled, Failed, Timeout }`, `summary?`, `blocks_created` |
| `Error` | Something went wrong — `error_type`, `message`, `recoverable`, `suggestion?` |

`AgentErrorType` includes: `SessionNotFound`, `ProviderUnavailable`, `RateLimited`, `ContextTooLarge`, `ConfirmationTimeout`, `ToolFailure`, `Internal`.

## Supporting types

```rust
pub struct CommandAlternative { pub command: String, pub description: String }

pub enum ConfirmationAction { Approve, Deny }
pub struct ConfirmationResponse {
    pub action: ConfirmationAction,
    pub notes: Option<String>,
}

pub enum QueryCompletionStatus { Completed, Cancelled, Failed, Timeout }
```

## Emission order invariants

- `Thinking` → zero or more `ResponseChunk` → possible `ToolInvoked`/`CommandProposed` → possible `ConfirmationRequired` → `CommandStarted` → `CommandOutput*` → `CommandCompleted` → `ToolCompleted` → (next turn: `Thinking` again) → … → `QueryCompleted`.
- At most one pending `ConfirmationRequired` per session (tracked in `AgentSession.pending_confirmation`).
- `Error { recoverable: false }` is always followed by a `QueryCompleted { status: Failed }`.

## Frontend hookup

`AgentService` subscribes once per session:

```ts
listen<AgentEvent>('agent:event', ({ payload }) => {
  if (payload.session_id !== this.sessionId) return;
  switch (payload.type) {
    case 'Thinking':            blockState.startThinking(payload.query_id); break;
    case 'ResponseChunk':       blockState.appendChunk(payload); break;
    case 'CommandProposed':     blockState.proposeCommand(payload); break;
    case 'ConfirmationRequired':blockState.askConfirm(payload); break;
    case 'CommandStarted':      blockState.openCommandBlock(payload); break;
    case 'CommandOutput':       blockState.appendOutput(payload); break;
    case 'CommandCompleted':    blockState.closeCommandBlock(payload); break;
    case 'QueryCompleted':      blockState.finishQuery(payload); break;
    case 'Error':               toast.error(payload.message, payload.suggestion); break;
  }
});
```

## Related pages

- [[ai-agent]]
- [[agent-session-context]]
- [[agent-tools]]
- [[agent-safety]]
- [[flow-agent-query]]
- [[concept-block]]
