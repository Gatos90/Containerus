# AI agent

**Summary**: The agent is a multi-turn tool-using LLM loop attached to a terminal session. It takes a natural-language query, proposes shell commands (gated by [[agent-safety]]), executes them, feeds output back, and repeats until the model produces a final response — up to `MAX_MULTI_TURN = 10` turns. Lives in `src-tauri/src/agent/`.

**Sources**: `src-tauri/src/agent/*`, `crates/containerus-core/src/models/agent.rs`.

**Last updated**: 2026-04-16

---

## Pieces

| File | Role |
|---|---|
| `mod.rs` | re-exports |
| `session.rs` | `AgentSession`, `AgentSessionManager`, `TerminalContext`, history caps |
| `events.rs` | `AgentEvent` enum streamed to the frontend |
| `executor.rs` | `run_agentic_loop`, `AgentResponse`, JSON parsing, `execute_shell_command` |
| `pty_bridge.rs` | bridge between `TerminalSessions` and the agent |
| `summarizer.rs` | cheap-model compression of long user inputs |
| `providers/mod.rs` | agent preamble, provider selection |
| `tools/definitions.rs` | tool JSON Schemas for Anthropic tool_use / OpenAI functions |
| `tools/shell_execute.rs` | `ShellExecuteTool` — the main tool the model calls |
| `tools/state_query.rs` | `StateQueryTool` — inspect containers / processes |
| `tools/history_query.rs` | `HistoryQueryTool` — query command history |
| `safety/classifier.rs` | `DangerClassifier`, `DangerLevel`, `DangerClassification` |
| `rig_executor.rs` | legacy Rig.rs path, superseded by native tool_use |

## Session lifecycle

1. **`start_agent_session(terminal_session_id, container_id?)`** creates an `AgentSession`, wiring:
   - `id`, `terminal_session_id`, timestamps
   - a `TerminalContext` (cwd, shell, OS, username, hostname, env vars, `recent_output`, `command_history`, `conversation_turns`, `input_summaries`, `in_container` + `container_runtime`, saved `HostContext` for container-exit restore)
   - an event channel whose consumer emits to the Tauri frontend
2. The frontend issues `submit_agent_query(request)`:
   - Loads current `AiSettings` from DB + keyring (`load_ai_settings_with_key`)
   - Spawns `run_agentic_loop` in a tokio task
3. Model interaction proceeds turn-by-turn (see below) until completion, cancellation, or the 10-turn budget is exhausted.
4. Frontend can call `respond_to_confirmation`, `cancel_agent_query`, `update_agent_context`, `append_agent_output`, `get_agent_context_summary`.
5. `close_agent_session` tears it down.

Context caps (all in `session.rs`):

- `MAX_HISTORY_SIZE = 50` conversation messages
- `MAX_RECENT_OUTPUT_LINES = 100` terminal lines retained
- `MAX_COMMAND_HISTORY = 50` entries
- `MAX_INPUT_SUMMARIES = 20`
- `MAX_CONVERSATION_TURNS = 10`

## Agentic loop — `run_agentic_loop`

Pseudocode:

```
for turn in 0..MAX_MULTI_TURN {
    emit Thinking
    response = provider.get_completion(request)
    emit ResponseChunk*  (streaming text)

    if response has tool_calls:                       // Anthropic tool_use / OpenAI function / Ollama tools
        for each tool_call:
            emit ToolInvoked
            if tool is shell_execute:
                classification = DangerClassifier::classify(command)
                if classification.level ∈ [Dangerous, Critical] && !auto_execute_safe:
                    emit ConfirmationRequired
                    wait for respond_to_confirmation
                    if denied: continue
                emit CommandProposed
                emit CommandStarted
                result = execute_shell_command(command, cwd)
                emit CommandOutput / CommandCompleted
                append result into request messages
                append result into TerminalContext
            else:
                call tool; emit ToolCompleted
        continue  // next turn
    else:
        emit QueryCompleted(Completed, summary)
        break
}

if turn == MAX_MULTI_TURN:
    emit QueryCompleted(Timeout)
```

All outputs flow through `AgentEvent::*`:

`Thinking`, `ResponseChunk`, `CommandProposed`, `ConfirmationRequired`, `CommandStarted`, `CommandOutput`, `CommandCompleted`, `ToolInvoked`, `ToolCompleted`, `StepStarted`, `StepCompleted`, `QueryCompleted`, `Error`.

## Tools — `tools/`

- **`shell_execute`** — `{ command: string, cwd?: string, timeout_ms?: number }`. Runs via `execute_shell_command`, which spawns `/bin/sh -c` (Unix) or `cmd /C` (Windows).
- **`state_query`** — query resource state (running containers, processes, file stats). The handler reads `TerminalContext` and current `list_containers` etc.
- **`history_query`** — search `command_history`.

Tool schemas are built in `tools/definitions.rs` and serialized into each provider's tool format. Anthropic's native `tool_use`, OpenAI's function calling, and Ollama's tools API are supported; providers that don't expose tools fall back to the prompt-embedded JSON protocol described next.

## Prompt protocol (fallback)

`providers::get_agent_preamble()` defines a strict JSON response format used when tool APIs aren't available:

```json
{
  "thought": "...",
  "commands": [{"command": "ls -la", "explanation": "list files"}],
  "response": "optional final text"
}
```

`executor::parse_agent_response(content)` strips markdown code fences and parses the object. The loop then treats each command entry identically to a `shell_execute` tool call.

## Summarizer — `summarizer.rs`

When the user pastes a long block (>100 chars), `summarize_user_input` calls the configured summary model (typically a smaller/cheaper one — see `get_effective_summary_model`) with the prompt *"Summarize in 1-2 sentences max, focus on intent and key entities"*. The resulting summary goes into `TerminalContext.input_summaries` so later turns can reference the gist without resending the whole blob. On failure, it truncates to 200 chars.

## Context that the LLM sees

Each turn's request includes:

- The system prompt from `get_agent_preamble`
- The latest `TerminalContext`: cwd, shell, OS, user, hostname, git branch, last exit code, last 100 lines of output, last 50 commands with exit codes, compressed `input_summaries`, container context if in-container
- The conversation history (last 50 messages, last 10 turns fully structured)
- The current tool result if returning from a tool call

## Preferences — `AgentPreferences`

Stored in the singleton `agent_preferences` row:

- `auto_execute_safe_commands` — skip confirmation on `Safe` classifications
- `show_thinking_process` — emit `Thinking` events
- `confirm_all_commands` — override and prompt even for `Safe`
- `max_auto_execute_steps` — cap the auto-exec chain
- `confirmation_timeout_secs` — rejection after timeout
- `preferred_shell`
- `dangerous_command_patterns: Vec<String>` — user-custom regexes added to the classifier

## Related pages

- [[agent-safety]]
- [[ai-providers]]
- [[terminal-subsystem]]
- [[crate-src-tauri]]
