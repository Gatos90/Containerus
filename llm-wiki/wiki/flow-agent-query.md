# Flow: an agent query, start to finish

**Summary**: Trace of a single user question through the AI agent — from the composer input, through provider call, tool dispatch, safety classification, command execution, output feedback, and final response. Covers the multi-turn loop and all the events that stream back to the UI.

**Sources**: `src-tauri/src/agent/executor.rs`, `src-tauri/src/agent/session.rs`, `src-tauri/src/agent/events.rs`, `src-tauri/src/commands/agent.rs`.

**Last updated**: 2026-04-16

**Parent**: [[ai-agent]]
**Siblings**: [[flow-connect-system]], [[flow-port-forward]]

---

## 0. Precondition

The user already has:
- A terminal session running (local PTY or SSH). See [[terminal-subsystem]].
- An agent session attached to that terminal via `start_agent_session(terminal_session_id, container_id?)`. See [[agent-session-context]].

## 1. User submits

User types into the composer bar and hits ⏎. The frontend calls `submit_agent_query({ session_id, query })`. `commands/agent.rs::submit_agent_query`:

1. Loads current `AiSettings` via `load_ai_settings_with_key` (hydrates the API key from the keyring cache).
2. Generates a `query_id: Uuid`.
3. Spawns `run_agentic_loop(app, session_id, query_id, query, terminal_session_id, settings, terminal_sessions, context, event_tx)` in a tokio task.
4. Returns `query_id` immediately — the rest flows over events.

Meanwhile the frontend marks a new "AI prompt" block in [[concept-block]] state and starts listening for events keyed by this `query_id`.

## 2. Input summarization (if needed)

If the user's input is >100 chars, `summarizer::summarize_user_input` calls the configured summary model (see [[ai-providers]] `get_effective_summary_model`). The returned 1-2 sentence summary lands in `TerminalContext.input_summaries` so subsequent turns have a compressed reference.

## 3. Turn 0 — first model call

`run_agentic_loop` emits `AgentEvent::Thinking` (turn 0).

Builds the request:
- **system prompt** = `providers::get_agent_preamble()` + current `TerminalContext` snapshot (cwd, shell, OS, user, hostname, git branch, last exit code, last 100 output lines, last 50 command history entries, conversation turns, in-container context).
- **messages** = conversation history capped at 50 messages.
- **tools** = `build_tool_definitions()` — `shell_execute`, `state_query`, `history_query`. Serialized for Anthropic tool_use, OpenAI function calling, or Ollama tools depending on provider.
- **user** = the query (or its summary, if the user input was long).

Calls `provider.get_completion(request)`. Streaming text is forwarded turn-by-turn as `AgentEvent::ResponseChunk { chunk_type, content, is_final }`.

## 4. Tool call dispatch

If the response includes tool calls, the loop iterates each one:

### 4a. `shell_execute`

The canonical case. Payload: `{ command, cwd?, timeout_ms? }`.

1. `AgentEvent::ToolInvoked { tool_name: "shell_execute", arguments }`.
2. `DangerClassifier::classify(command)` → `DangerClassification { level, affected_resources, warning, alternatives }`. See [[agent-safety]].
3. Determine if confirmation is needed:
   - `Safe` + `auto_execute_safe_commands=true` + `confirm_all_commands=false` → skip.
   - Otherwise emit `AgentEvent::ConfirmationRequired` with a fresh `confirmation_id` and wait on the session's confirmation oneshot.
4. Frontend renders the confirmation card in the active block. User picks Approve / Deny / timeout.
5. On Approve: continue. On Deny / Timeout: emit a synthetic tool error back into the conversation and move on.
6. `AgentEvent::CommandProposed` + `CommandStarted` (with a new `block_id`).
7. `executor::execute_shell_command(command, cwd)` spawns a subprocess (`/bin/sh -c` or `cmd /C`).
8. Output streams as `AgentEvent::CommandOutput { block_id, payload }`.
9. On exit: `AgentEvent::CommandCompleted { block_id, exit_code, duration_ms }`.
10. The `CommandResult` is appended to the conversation as a tool-result message, and to `TerminalContext.command_history` (bounded queue, cap 50). The session's `recent_output` also absorbs the last N lines.

### 4b. `state_query`

Inspects current process / container / system state without shell-out — reads `TerminalContext` and cached resource lists. Emits `ToolInvoked` + `ToolCompleted` with the result.

### 4c. `history_query`

Searches `command_history` for prior runs. Useful for "remind me what I ran yesterday that touched this file" queries.

## 5. Turn N — feedback loop

After one or more tools complete, the loop continues: build a new request with the tool results appended, call `get_completion` again. `AgentEvent::StepStarted` and `StepCompleted` bracket the turn.

This continues until:
- The model returns a response with no tool calls → emit `QueryCompleted { status: Completed }`.
- `MAX_MULTI_TURN = 10` is reached → emit `QueryCompleted { status: Timeout }`.
- User calls `cancel_agent_query` → emit `QueryCompleted { status: Cancelled }`.
- A provider / tool error is unrecoverable → emit `Error { recoverable: false }` and `QueryCompleted { status: Failed }`.

## 6. Wrap-up

`QueryCompleted` carries:
- `summary?` — the assistant's final textual answer (if the model produced one).
- `blocks_created` — number of blocks generated so the UI can count for display.

The frontend folds the block header into "done" state, enables re-run, and records the query + response in the conversation history so the user can scroll back.

## 7. What's held between queries

The `AgentSession` persists:
- `TerminalContext` — cwd, shell, OS, git branch, last_exit_code, `recent_output` (100 lines), `command_history` (50), `input_summaries` (20).
- `history: Vec<ConversationMessage>` — capped at 50.
- `conversation_turns: Vec<ConversationTurn>` — structured (user input + tool calls + AI response), capped at 10.
- `pending_confirmation`, `active_query_id` — single-flight guards.

See [[agent-session-context]] for the full shape.

## 8. Frontend block lifecycle (parallel track)

The Warp-style block UI ingests each event and updates its own `BlockState`:
- `AI prompt` block for the original query.
- `AI command` block(s) per `ShellExecuteTool` call.
- `AI response` block for the final text.
- Each block tracks `running`, `collapsed`, `focused`.

See [[concept-block]] and [[feature-warp-terminal]].

## Related pages

- [[ai-agent]]
- [[agent-session-context]]
- [[agent-events]]
- [[agent-tools]]
- [[agent-safety]]
- [[ai-providers]]
- [[terminal-subsystem]]
