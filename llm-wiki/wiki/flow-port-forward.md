# Flow: a port forward, start to finish

**Summary**: Complete trace of a port forward from a container port to the user's localhost. Covers both implementations: the SSH `direct-tcpip` path for Tauri-owned systems and the WebSocket-tunneled path for backend-owned systems.

**Sources**: `src/app/features/containers/port-forward-section/*`, `src-tauri/src/commands/port_forward.rs`, `src-tauri/src/backend_forward.rs`, `crates/containerus-core/src/ssh/port_forward.rs`, `crates/containerus-server/src/ws/tunnel.rs`.

**Last updated**: 2026-04-16

**Parent**: [[port-forwarding]]
**Siblings**: [[flow-connect-system]], [[flow-agent-query]]

---

## 1. UI request

User opens a container detail panel, clicks **Forward** on a port entry. The UI captures:
- `container_id` (from the current container)
- `container_port` (from the `PortMapping`)
- `remote_host` (defaults to `127.0.0.1`)
- `remote_port` (defaults to the container's mapped host port)
- `local_port` (0 = auto-assign, or a user-chosen value)
- `protocol` (`tcp` / `http` / `https`)

`PortForwardService.create(request)` delegates to the Tauri command `create_port_forward` regardless of system ownership — dual-path routing is handled inside Rust, not the frontend.

## 2. Command entry — `create_port_forward`

File: `src-tauri/src/commands/port_forward.rs`.

Inspects the incoming `CreatePortForwardRequest`:

```rust
if request.tunnel_ws_url.is_some() && request.tunnel_token.is_some() {
    backend_forward.start(request).await
} else {
    ssh_forward.start(app_state, request).await
}
```

The frontend pre-populates `tunnel_ws_url` + `tunnel_token` when `BackendService.getBackendForSystem(systemId)` returns a connection id, by calling `BackendService.getTunnelWsUrl(connId, systemId)` first.

## 3a. SSH path — `PortForwardManager::start_forward`

File: `crates/containerus-core/src/ssh/port_forward.rs`.

1. Check the system is in the SSH pool and connected. If local, just register a logical mapping — nothing to tunnel.
2. Bind `TcpListener::bind(("127.0.0.1", local_port))`. On `AddrInUse`, increment and retry up to 20 times.
3. Generate `forward_id: Uuid`.
4. Wrap the listener in an async task with a broadcast-shutdown and a `CancellationToken`.
5. Register the entry in the manager's `DashMap`.
6. Return the `PortForward { id, system_id, container_id, container_port, local_port, remote_host, remote_port, protocol, status: Active, ... }` to the frontend.

The spawned task loop:

```rust
loop {
    select! {
        Ok((tcp, _)) = listener.accept() => {
            let client = pool.get(&system_id).await?;
            let mut session = client.lock().await;
            let channel = session.open_direct_tcpip(remote_host, remote_port).await?;
            tokio::spawn(async move {
                let _ = tokio::io::copy_bidirectional(&mut tcp, &mut channel.into_stream()).await;
            });
        }
        _ = shutdown_rx.changed() => break,
    }
}
```

Each accepted TCP connection gets its own russh `direct-tcpip` channel — multiple concurrent browser tabs can share the forward.

## 3b. WebSocket path — `BackendPortForwardManager::start_forward`

File: `src-tauri/src/backend_forward.rs`.

1. Acquire `start_lock: Mutex<()>` to serialize concurrent requests (prevents two racing forwards both binding the same port).
2. Bind `TcpListener` with the same retry loop.
3. Spawn the listener task. Per accepted TCP connection:
   - Open a WebSocket to `tunnel_ws_url` = `ws(s)://server/api/ws/tunnel/{systemId}`.
   - Pass the access token (`Authorization` header or query param).
   - Send an initial JSON frame: `{ remote_host, remote_port, protocol }`.
   - Bridge TCP ⇄ WS: `tokio::io::copy_bidirectional` with a `WebSocketStream` adapter.
4. Register the entry, return the `PortForward`.

## 4. Server side — `/api/ws/tunnel/:systemId`

File: `crates/containerus-server/src/ws/tunnel.rs`.

1. Authenticate the WebSocket with the access token.
2. Permission check: user must have `system:tunnel` on the owning project.
3. Read the initial JSON frame → `{ remote_host, remote_port }`.
4. Acquire a per-user SSH client: `ConnectionManager::get_client(user_id, system_id)` — lazily creates the session if needed. See [[ssh-connection-pooling]].
5. Open a `direct-tcpip` channel toward `remote_host:remote_port`.
6. Bridge WS ⇄ channel with `copy_bidirectional`.
7. On either side's close, drop both halves.

Audit: a `port_forward.open` entry is written to `audit_log` with `{ system_id, remote_host, remote_port }`.

## 5. End-to-end path summary

For backend mode, one accepted client TCP connection traverses:

```
 browser ──TCP──▶ [desktop local listener]
              ──WS──▶ [server /api/ws/tunnel]
                     ──direct-tcpip──▶ [remote sshd]
                                     ──TCP──▶ [container:port]
```

For Tauri mode:

```
 browser ──TCP──▶ [desktop local listener]
              ──direct-tcpip──▶ [remote sshd]
                              ──TCP──▶ [container:port]
```

## 6. Open in browser

`open_forwarded_port(forward_id)` reads the entry, builds `{protocol}://localhost:{local_port}`, and shells to the `open` crate. Only HTTP / HTTPS forwards get a browser; TCP forwards return the URL for the user to copy.

## 7. Stop

`stop_port_forward(forward_id)`:

1. Flip the broadcast shutdown channel.
2. Cancel the `CancellationToken` so any in-flight copies abort.
3. Remove the `DashMap` entry.
4. For WS forwards, the server-side WebSocket closes when the client drops — the `direct-tcpip` channel is torn down on that event.

Existing TCP connections are dropped; browser requests in flight fail with connection reset.

## 8. `is_port_forwarded` helper

The UI calls `is_port_forwarded(container_id, container_port)` to render the "Forwarding" badge on the port row. Both managers expose it; the `commands/port_forward.rs` router returns `ssh.is_forwarded OR backend.is_forwarded`.

## Differences at a glance

| Concern | SSH path | WebSocket path |
|---|---|---|
| Binding | `containerus-core` pool | per-user server SSH |
| Per-user isolation | n/a (single-user desktop) | yes (user_id scoped) |
| Audit | no | yes |
| Authorization | Tauri-local only | JWT + RBAC |
| Latency | 1 TCP + 1 SSH hop | 1 TCP + 1 WS + 1 SSH hop |
| NAT traversal | requires SSH reachable | only server needs reachability |

## Related pages

- [[port-forwarding]]
- [[ssh-subsystem]]
- [[ssh-connection-pooling]]
- [[auth-and-rbac]]
- [[audit-logging]]
