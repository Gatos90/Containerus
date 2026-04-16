# SSH subsystem

**Summary**: SSH is implemented in `containerus-core/src/ssh/` on top of `russh` 0.57. Supports direct connections, multi-hop ProxyJump, ProxyCommand, `known_hosts` verification, per-hop credentials, and `direct-tcpip` port forwarding.

**Sources**: `crates/containerus-core/src/ssh/*`.

**Last updated**: 2026-04-16

---

## Entry point

`mod.rs` exposes `SSH_POOL: Lazy<Arc<RwLock<SshConnectionPool>>>` and a set of free functions that the rest of the codebase uses exclusively:

```rust
pub async fn connect(system_id, host, port, user, password, passphrase, key, jump_host_credentials) -> Result<()>;
pub async fn disconnect(system_id) -> Result<()>;
pub async fn is_connected(system_id) -> bool;
pub async fn execute_on_system(system_id, command) -> Result<CommandResult>;
pub async fn validate_connection(system_id) -> Result<bool>;
```

All state (pool, config, connections) is hidden behind these helpers. See [[ssh-connection-pooling]] for the pool structure and server-side dual-tier model.

## Client — `client.rs`

`SshClient` wraps a `russh::client::Handle<SshHandler>` plus:

- `_jump_sessions: Vec<Handle<SshHandler>>` — kept alive for the lifetime of the terminal handle so multi-hop sessions don't close prematurely.
- `_proxy_child: Option<tokio::process::Child>` — kept alive when the connection went through a ProxyCommand.
- `system_id`, `created_at: Instant`, `last_used: Instant`.

### Authentication

`authenticate()` and `authenticate_jump_host()` handle:
- **Password** — `authenticate_password`
- **Public key** — `authenticate_publickey` with optional passphrase

Both jump hosts and terminal hosts can supply their own credentials; `SshCredentials::jump_host_credentials` is keyed by `"hostname:port"`.

### Host-key verification — `known_hosts.rs`

`SshHandler::check_server_key` delegates to `check_host_key_against_content` on `~/.ssh/known_hosts`. Possible outcomes (`HostKeyCheckResult`):

- `Matched` — accept
- `Unknown` — not in file; `AcceptNew` policy records it via `add_host_key`
- `Mismatch` — refuse; `HostKeyWatcher` captures the rejection for UI display
- `Revoked` — refuse

SHA-256 fingerprints are shown in the UI when a mismatch occurs. The Tauri command `remove_known_host(hostname, port)` lets users prune offending entries.

### ProxyJump — `connect_via_jump`

Walks the `Vec<JumpHost>` in order. For each hop:

1. If this is the first hop, connect directly to it.
2. Otherwise open a `direct-tcpip` channel on the previous hop's session to reach this hop's address, then hand that `ChannelStream` to russh as the transport.
3. Authenticate with that hop's credentials.
4. Keep the session handle alive in `_jump_sessions`.

After the last hop, one more `direct-tcpip` channel is opened to the final host, authenticated, and returned as the terminal `SshClient`.

### ProxyCommand

Spawned with `tokio::process::Command`. A `ProxyStream` struct (`client.rs:141-182`) wraps the child's stdio to implement `AsyncRead + AsyncWrite`, which russh accepts as a transport. The child process is owned by the `SshClient` so it dies with the connection.

### Execute

`execute(command: &str)` opens a new channel, runs `exec`, accumulates stdout/stderr/exit until the channel closes, returns a `CommandResult`. Uses a pointed-to `MAX_SSH_EXEC_BYTES` limit to avoid OOM on runaway output.

`is_alive()` runs `echo` with a tight timeout, used by `validate_connection`.

## Port forwarding — `port_forward.rs`

See [[port-forwarding]] for the full story. In short: `PortForwardManager::start_forward` binds a local `TcpListener`, then for each inbound TCP connection opens a russh `direct-tcpip` channel toward `remote:port` and relays bytes bidirectionally. A broadcast shutdown channel stops the listener when `stop_forward` is called.

## SSH config parsing — `config.rs`

Supports multi-file SSH config with `Include` directives:

- Public APIs: `list_hosts`, `resolve_host` (single path); `list_hosts_multi`, `resolve_host_multi` (multiple paths).
- Uses a shared `visited: HashSet<PathBuf>` across files to prevent include cycles.
- Parses `Host`, `HostName`, `User`, `Port`, `IdentityFile`, `ProxyJump`, `ProxyCommand`, etc.
- App settings store user's custom SSH config paths (`app_settings.ssh_config_paths`).

## Client-side integration notes

- `ProxyJump` is resolved in the frontend `parseJumpHosts()` and passed as `JumpHost[]` to Tauri.
- Connection routing lives in `pool.rs`: `proxy_jump` → `connect_via_jump`, `proxy_command` → `connect_via_proxy_command`, otherwise direct.
- russh-sftp requires `^0.49` which conflicts with russh `0.46`/`0.57`, so the file browser stays shell-based (`ls -la`, `cat`, `base64`) and wraps container-scoped calls with `docker exec`. See [[file-browser]].

## Related pages

- [[ssh-connection-pooling]]
- [[port-forwarding]]
- [[credentials-and-vault]]
- [[file-browser]]
