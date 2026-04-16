# Terminal subsystem

**Summary**: Unified terminal abstraction with a local PTY path and an SSH-channel path, plus a WebSocket variant on the backend server. The frontend renders through xterm.js in dockable slots (single / split-h / split-v / quad) and optionally bridges to the AI agent for a Warp-style "command block" experience.

**Sources**: `src-tauri/src/commands/terminal.rs`, `src/app/features/terminal/*`, `src/app/features/warp-terminal/*`, `crates/containerus-server/src/ws/terminal.rs`.

**Last updated**: 2026-04-16

**Parent**: [[architecture]]
**See also**: [[ai-agent]], [[feature-warp-terminal]], [[concept-session]], [[concept-block]], [[ssh-subsystem]], [[server-websockets]]

---

## Local-mode path

### Session types

`TerminalSessions` (in `commands/terminal.rs`) keeps a `HashMap<session_id, SessionHandle>`. A `SessionHandle` is one of:

- **Local PTY** — macOS/Linux use a real PTY (portable-pty). Windows uses `conpty`-backed PTY. Output is read in a background task and emitted via the Tauri `terminal:output` event.
- **SSH channel** — a russh `exec` channel through the pooled `SshClient`. Input/output passed through the same channel with PTY allocation.

### Container wrapping

For a container session, the shell is wrapped:

```
docker exec -it <container_id> <shell>
```

with `<shell>` picked by probing the container (`bash` → `sh` → `ash` fallback).

### Commands

| Command | Purpose |
|---|---|
| `start_terminal_session(system_id, container_id?)` | Create PTY/channel, return `TerminalSession { id, system_id, container_id, shell }` |
| `send_terminal_input(session_id, input)` | Write bytes |
| `resize_terminal(session_id, cols, rows)` | Resize PTY |
| `close_terminal_session(session_id)` | Kill session |
| `execute_in_terminal(session_id, command, timeout_ms?)` | Send a command and capture output; emits `terminal:block_created` and `terminal:block_ended` events |
| `list_terminal_sessions()` | Enumerate |
| `fetch_shell_history(session_id)` | Read shell history (bash_history equivalent) |

### Output listener registry

`TerminalSessions` can register output listeners (used by the AI agent's PtyBridge so it can observe command output passively, without injecting input). See [[ai-agent]] for how that hooks into `append_agent_output`.

## Backend-mode path — `/api/ws/terminal`

The server's `ws/terminal.rs` accepts a WebSocket authenticated with the access token, opens a per-user SSH session (via `ConnectionManager::ensure_user_connected`), allocates a PTY on the remote, and proxies bytes bidirectionally. Resize events are framed as JSON control messages; all other traffic is raw bytes.

The frontend's `TerminalService` chooses between this WebSocket path and the Tauri path based on system ownership (see [[dual-path-routing]]).

## Frontend rendering

`src/app/features/terminal/` renders sessions in xterm.js instances. The `TerminalState` tracks:

- `DockedTerminal[]` — every open session
- `DockedFileBrowser[]` — file browsers can share the dock
- `TerminalSlot[]` with modes `single` / `split-h` / `split-v` / `quad`
- `dockHeightPercent` — resizable vertical split against the rest of the UI (controlled from `MainLayoutComponent`)

## Warp-style blocks

`src/app/features/warp-terminal/` presents a block-per-command UI rather than a raw stream. Each issued command becomes a `CommandBlock` with its own output viewport; a composer bar lets the user compose the next command with history navigation; `search-overlay` searches across block output. Blocks cooperate with the AI agent — when the agent proposes a command, the block renders an `ai-prompt` / `ai-response` / `ai-command` header with accept/reject buttons.

`BlockState` powers the block list; it supports collapse/expand, focus, and has computed helpers for `runningCommands`.

## Integration with the AI agent

- Every agent session is linked to a terminal session id. Agent events like `CommandStarted`, `CommandOutput`, `CommandCompleted` stream alongside normal terminal output.
- Terminal output is mirrored into the agent's `TerminalContext.recent_output` (capped at 100 lines) via `append_agent_output` so the next LLM turn has current context.
- Context updates (`update_agent_context`) push `cwd`, `git_branch`, and `last_exit_code` from the shell (parsed from prompt hints) into the context.

See [[ai-agent]] for the tool-use loop.

## Related pages

- [[ai-agent]]
- [[port-forwarding]]
- [[ssh-subsystem]]
- [[frontend-features]]
