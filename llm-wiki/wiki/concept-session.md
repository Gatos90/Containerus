# Concept: sessions

**Summary**: Two session kinds exist and are linked: a **terminal session** (PTY or SSH exec channel) and an **agent session** (AI conversation attached to a terminal). Both have UUIDs, both live in manager maps, and an agent session's existence depends on its terminal session.

**Sources**: `src-tauri/src/commands/terminal.rs`, `src-tauri/src/agent/session.rs`.

**Last updated**: 2026-04-16

**Parent**: [[frontend-overview]]
**Siblings**: [[concept-block]], [[concept-system-id]], [[concept-connection-id]]

---

## Terminal session

Created by `start_terminal_session(system_id, container_id?)`. Stored in `TerminalSessions: HashMap<session_id, SessionHandle>`.

- `SessionHandle::LocalPty` — portable-pty PTY for macOS/Linux/Windows.
- `SessionHandle::SshChannel` — russh channel with `request_pty` and `exec`.

Each session has:
- `id: String` (UUID)
- `system_id`
- `container_id?: Option<String>` — if set, the shell was wrapped with `docker/podman exec -it <cid>`
- `shell` (detected from image or user preference)

## Agent session

Created by `start_agent_session(terminal_session_id, container_id?)`. Stored in `AgentSessionManager: HashMap<session_id, AgentSession>`.

- Holds a `TerminalContext` (cwd, env, recent output, command history, conversation turns) — see [[agent-session-context]].
- `terminal_session_id` is the authoritative link: if the terminal session closes, the agent session is closed too.
- `active_query_id` enforces single-flight per session.

## Linking rules

- One terminal session can have at most one agent session attached.
- An agent session cannot exist without a terminal session.
- Closing a terminal session cascades: `close_terminal_session(id)` also closes the agent session via `AgentSessionManager::close_for_terminal`.

## Lifetimes

Both types live in memory only (no DB persistence). Restarting Containerus loses all sessions. Reopening the terminal page creates new ones; saved block history (future) could re-hydrate the UI, but the server-side session is fresh.

## Server-side terminals (backend mode)

`/api/ws/terminal/:systemId` is request-scoped — one WebSocket carries one PTY session. The server opens a per-user SSH session (see [[ssh-connection-pooling]]), allocates a remote PTY, and proxies bytes. The session ends when the WebSocket closes.

Server sessions are **not** given the same UUID as desktop `session_id`s — they're transient per-connection and identified only by the WebSocket handle.

## Concurrency

- Multiple terminal sessions per system — yes (each one gets its own russh channel or local PTY).
- Multiple agent sessions per terminal — no.
- Multiple queries per agent session — no (blocked by `active_query_id`).

## Ids in URLs

Terminal sessions don't appear in URLs (they're per-tab state). The URL carries `systemId` and optional `containerId`; the terminal workspace decides which session to show from `TerminalState.dockedTerminals`.

## Related pages

- [[terminal-subsystem]]
- [[ai-agent]]
- [[agent-session-context]]
- [[concept-system-id]]
