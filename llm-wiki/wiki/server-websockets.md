# Server WebSockets

**Summary**: Four WebSocket endpoints on the server carry interactive, streaming traffic that REST can't model well: terminal PTY, port-forward tunnel, Kubernetes pod exec, and Kubernetes resource watch. Each authenticates via access token, opens a backing resource (SSH or kube channel), and proxies bytes or events.

**Sources**: `crates/containerus-server/src/ws/{terminal,tunnel,k8s_exec,k8s_watch}.rs`, `crates/containerus-server/src/api/mod.rs`.

**Last updated**: 2026-04-16

**Parent**: [[crate-containerus-server]]
**Siblings**: [[auth-and-rbac]], [[audit-logging]], [[kubernetes]]

---

## Common auth

All four endpoints:
1. Extract the access token from `Authorization: Bearer ...` or `?token=...` query param.
2. Validate as a normal `AuthUser` (signature + revocation cache).
3. Run a permission check against the resource (`system:terminal`, `system:tunnel`, `k8s:exec`, `k8s:watch`).
4. Upgrade to WebSocket.

On auth failure: HTTP 401 is returned before the upgrade completes.

## `/api/ws/terminal/:systemId`

File: `ws/terminal.rs`.

1. `ConnectionManager::ensure_user_connected(db, user_id, system)` opens a per-user SSH session. See [[ssh-connection-pooling]].
2. Open a russh channel, call `request_pty` with agreed-upon initial size, then `exec` the default shell (or `docker exec` if the container was specified).
3. Two tasks per WS:
   - **Read loop** — read from the russh channel, frame as binary WS messages.
   - **Write loop** — receive WS messages, branch on type:
     - Binary → write to channel stdin.
     - Text (JSON control) → parse as `{ type: "resize", cols, rows }` and call `window_change`.
4. On close (either side), drop the channel; per-user SSH session remains in the pool for reuse.

Audit: `terminal.open` entry written at connect.

## `/api/ws/tunnel/:systemId`

File: `ws/tunnel.rs`. Used by the desktop's `backend_forward.rs` — see [[flow-port-forward]].

1. Accept the WS, read the initial JSON frame: `{ remote_host, remote_port, protocol }`.
2. Get the per-user SSH session.
3. Open a `direct-tcpip` channel to `remote_host:remote_port`.
4. Bridge WS binary ⇄ channel bytes via `copy_bidirectional`.

Each accepted TCP connection on the desktop side opens a *separate* WebSocket + channel pair. Multiplexing is via multiple WSes, not multiple streams per WS.

## `/api/ws/k8s-exec/:clusterId`

File: `ws/k8s_exec.rs`. Wraps `kube-rs`'s pod exec attach channel.

1. Query params: `namespace`, `pod`, `container?`, `command`.
2. Build `AttachParams` with TTY + stdin + stdout + stderr.
3. Call `pods.exec(pod, command_vec, attach_params)` → `kube::AttachedProcess`.
4. Bridge:
   - WS binary → stdin.
   - stdout/stderr → WS binary (kind prefix in a framing byte if both are muxed).
   - Control JSON → stdin stream close or resize (`{ type: "resize", cols, rows }`).

Audit: `k8s.exec` entry at connect.

## `/api/ws/k8s-watch/:clusterId`

File: `ws/k8s_watch.rs`.

1. Accept WS, wait for initial subscription: `{ group, version, kind, namespace? }`.
2. Use `kube::Api::<DynamicObject>::... (discovery)` to resolve the GVK.
3. `watcher(api, Config::default())` — kube-rs streaming watcher that auto-reconnects on relist.
4. Forward events as JSON: `{ type: "added|modified|deleted", resource: {...} }`.

Supports subscription updates mid-stream (client sends a new subscription JSON; server drops the old watcher).

## Disconnect handling

All four share a common disconnect pattern:

```rust
tokio::select! {
    r = read_loop => { /* WS closed or errored */ },
    r = write_loop => { /* backing resource closed */ },
}
// drop everything, nothing to do
```

No half-open sockets, no leaked tasks. The backing resource — SSH per-user session or kube Client — is NOT torn down on WS close; it stays in the connection manager for reuse.

## Rate limiting

WS endpoints are not rate-limited at the auth layer — they're long-lived, not burst-prone. Instead:
- Max concurrent terminal sessions per user (server-side config).
- Tunnel connections are naturally bounded by the user's local port bindings.

## Related pages

- [[crate-containerus-server]]
- [[ssh-connection-pooling]]
- [[port-forwarding]]
- [[kubernetes]]
- [[auth-and-rbac]]
- [[audit-logging]]
