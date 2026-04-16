# Port forwarding

**Summary**: Two implementations. Local/SSH mode uses russh `direct-tcpip` channels via `containerus-core::ssh::PortForwardManager`. Backend mode uses a local TCP listener that tunnels through a WebSocket to the server, which then opens `direct-tcpip` on its per-user SSH connection.

**Sources**: `crates/containerus-core/src/ssh/port_forward.rs`, `src-tauri/src/backend_forward.rs`, `src-tauri/src/commands/port_forward.rs`, `crates/containerus-server/src/ws/tunnel.rs`.

**Last updated**: 2026-04-16

**Parent**: [[architecture]]
**Children**: [[flow-port-forward]]
**See also**: [[ssh-subsystem]], [[ssh-connection-pooling]], [[server-websockets]], [[feature-containers]]

---

## Model

```rust
pub struct PortForward {
    pub id: String,
    pub system_id: String,
    pub container_id: Option<String>,
    pub container_port: u16,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub protocol: String,    // "tcp" / "http" / "https"
    pub status: PortForwardStatus, // Active | Stopped | Error
    pub created_at: ...,
}
```

`CreatePortForwardRequest` can additionally carry `tunnel_ws_url` and `tunnel_token`. When both are present, `commands/port_forward.rs` routes to the backend (WebSocket) path; otherwise the SSH path.

## Local / SSH mode — `ssh/port_forward.rs`

`PortForwardManager` keeps `DashMap<forward_id, PortForwardEntry>`. An entry holds the `PortForward`, a broadcast shutdown sender, and a cancellation token.

### Start

1. If the system is local, just register the mapping — nothing to tunnel through.
2. Otherwise, bind a `TcpListener` on `local_port`. If the port is taken, retry up to 20 times with incrementing ports and remember the final bind.
3. Spawn an async task that `accept`s connections. For each accepted TCP stream:
   - Acquire the system's `SshClient` from the pool.
   - Open a russh `direct-tcpip` channel to `remote_host:remote_port`.
   - Relay bytes bidirectionally until either side closes. The channel's `ChannelStream` implements `AsyncRead + AsyncWrite`, so `tokio::io::copy_bidirectional` handles it.
4. Return the `PortForward` to the caller.

### Stop

`stop_forward(id)` flips the broadcast channel, aborts the listener task, and removes the entry. Any live connections are dropped.

### Open in browser

`open_forwarded_port(id)` builds `{protocol}://localhost:{local_port}` and shells out via the `open` crate when the protocol is HTTP/HTTPS.

## Backend mode — `backend_forward.rs`

Used when the target system belongs to a backend connection. The frontend calls the same `create_port_forward` Tauri command; `commands/port_forward.rs` routes to `BackendPortForwardManager` when `tunnel_ws_url` and `tunnel_token` are present.

Flow:

1. Take the `start_lock: Mutex<()>` to avoid races on duplicate requests.
2. Bind a local `TcpListener` on `local_port` (same retry logic).
3. Spawn a listener task. Each accepted TCP stream:
   - Opens a WebSocket to `tunnel_ws_url` (`/api/ws/tunnel/{systemId}`) with the access token.
   - Bridges TCP ⇄ WebSocket bytes until one side closes.
4. Return the `PortForward`.

The WebSocket frame format is raw binary — the server's `ws/tunnel.rs` on the other end dials `remote_host:remote_port` through its per-user SSH connection (`ConnectionManager::get_client(user_id, system_id)`) and bridges the same way. So the end-to-end path for one TCP client looks like:

```
[frontend] ─ Tauri command ─> [desktop backend_forward] ─ WS ─> [server ws/tunnel] ─ direct-tcpip SSH channel ─> [remote container port]
```

## Port resolution

Both implementations let the user request a preferred `local_port` (or `0` for auto-assign). On collision, they try the next 20 ports and return the one that actually bound.

## Container vs system ports

`container_port` and `remote_host:remote_port` are independent fields. For a typical container forward, `remote_host = 127.0.0.1` and `remote_port = host_port` from the container's `PortMapping`. For raw system ports (forwarding a service on the host itself), `container_id` is `None` and `container_port` can be zero.

## Related pages

- [[ssh-subsystem]]
- [[ssh-connection-pooling]]
- [[terminal-subsystem]]
- [[dual-mode-operation]]
