# Concept: event streams

**Summary**: Containerus uses four distinct event streams — Tauri events (desktop), WebSocket frames (backend streaming), Tokio mpsc channels (internal agent events), and Angular signal updates (frontend state). Each has its own transport and framing; pages and subsystems pick the right one for their latency and fan-out needs.

**Sources**: `src-tauri/src/agent/events.rs`, `src-tauri/src/commands/terminal.rs`, `crates/containerus-server/src/ws/*`, `src/app/state/*`.

**Last updated**: 2026-04-16

**Parent**: [[architecture]]
**Siblings**: [[concept-block]], [[concept-system-id]], [[concept-session]], [[concept-connection-id]]

---

## 1. Tauri events — desktop → frontend

Transport: Tauri's `app.emit(name, payload)` / `listen(name, cb)`.

Used for:

| Event | Producer | Consumer | Payload |
|---|---|---|---|
| `terminal:output` | `commands/terminal.rs` | `TerminalService` | `{ session_id, data }` |
| `terminal:block_created` | `execute_in_terminal` | `BlockState` | `{ session_id, block_id, command }` |
| `terminal:block_ended` | `execute_in_terminal` | `BlockState` | `{ session_id, block_id, exit_code }` |
| `system:metrics` | `MonitoringManager` tick | `SystemMonitoringService` | `LiveSystemMetrics` |
| `agent:event` | agent event dispatcher | `AgentService` | `AgentEvent` |
| `connection:changed` | `connect_system` | `SystemState` | `{ system_id, state }` |

All are fire-and-forget; no ack. Frame format is serde-serialized JSON.

## 2. WebSocket frames — server → frontend

Transport: browser WebSocket.

Used for the four server endpoints listed in [[server-websockets]]:

- Terminal PTY — mostly raw binary stdin/stdout + occasional JSON resize control
- Tunnel — raw binary TCP bytes
- K8s exec — similar to terminal
- K8s watch — JSON event envelopes

Framing:
- Raw binary → bytes pass through.
- JSON control → text frame with type discriminator.

## 3. Tokio mpsc channels — internal streams

Transport: `tokio::sync::mpsc::channel`.

Examples:
- **Agent** — `AgentSessionManager.event_channels: HashMap<session_id, mpsc::Sender<AgentEvent>>`. `run_agentic_loop` sends events; a per-session forwarder task reads them and calls `app.emit("agent:event", ...)`.
- **Confirmation** — `oneshot::Sender<ConfirmationResponse>` per pending command.
- **Port forward shutdown** — `broadcast::Sender<()>` per forward, letting `stop_forward` interrupt the listener task.

These are within-process; they don't cross the Tauri or WS boundary until a dispatcher relays them.

## 4. Angular signals — frontend state propagation

Transport: Angular's reactive primitive.

Updates happen:
- When a service receives a Tauri event → calls a setter on a state class → signal updates → components re-render.
- When a WebSocket message arrives → similar flow.
- When a Tauri command resolves → direct signal update.

The critical property: signals eliminate subscription bookkeeping. A component that reads `containerState.filteredContainers()` in a computed re-runs automatically whenever upstream signals change; no RxJS subscribe/unsubscribe.

## Why four and not one?

- Tauri events are cheap within-process but can't cross to a remote backend.
- WS frames work against a server but not within the desktop app.
- mpsc is for internal async composition — you can't `listen` on a channel from JS.
- Signals are synchronous and local to the render cycle.

Each layer has its own concerns, and the adapters between them (Tauri emit, WS → service, service → state) are explicit crossing points where framing and buffering matter.

## Common pitfalls

- **Dropped events across Tauri restart** — listeners need to be re-registered after reconnect. `TerminalService` handles this; generic services should too.
- **Backpressure on WS** — the terminal WS can be written faster than the peer can read, causing the WS to buffer and eventually disconnect. `ws/terminal.rs` uses bounded writers to avoid OOM.
- **Missing reply to mpsc** — `oneshot::Receiver` dropped before sender → panic on send. The confirmation flow guards this by checking the receiver before calling `send`.
- **Signal recursion** — a computed signal that writes a signal causes infinite recompute. Lint rule enforces read-only computed in the codebase.

## Related pages

- [[architecture]]
- [[agent-events]]
- [[server-websockets]]
- [[angular-state]]
