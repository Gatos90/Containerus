# Flow: connect a system

**Summary**: End-to-end trace of what happens when the user clicks "Connect" on an SSH system, from the Angular component all the way down to the russh session handshake. Covers credential resolution, host-key verification, ProxyJump walking, and the round-trip back to the UI.

**Sources**: `src/app/features/systems/*`, `src-tauri/src/commands/system.rs`, `crates/containerus-core/src/ssh/*`.

**Last updated**: 2026-04-16

**Parent**: [[architecture]]
**Siblings**: [[flow-agent-query]], [[flow-port-forward]]

---

## 1. UI event

`SystemListComponent` or `SystemDetailComponent` calls `SystemService.connect(systemId, credentials)`. Credentials come from either:
- the keyring (auto-load of saved creds), or
- a prompt dialog when the keyring has nothing for this system.

Jump-host creds are gathered in the frontend by `parseJumpHosts()` — for each hop, the UI asks the user whether they have a password or key and whether a passphrase is needed.

## 2. Service layer — dual-path branch

`SystemService.connect`:

```ts
const connId = this.backend.getBackendForSystem(systemId);
if (connId) {
  // backend-owned: server already manages the connection
  return this.backend.connectSystemFor(connId, systemId);
}
return this.tauri.invoke<ConnectionState>('connect_system', {
  systemId, password, passphrase, privateKey, jumpHostCredentials,
});
```

See [[dual-path-routing]]. For the rest of this page we follow the Tauri path.

## 3. Tauri command — `connect_system`

File: `src-tauri/src/commands/system.rs`.

1. Load the `ContainerSystem` out of `AppState.systems` (RwLock read).
2. `set_connection_state(systemId, Connecting)` — emits an update that the UI renders as a spinner.
3. Branch on `connection_type`:
   - **Local** — run `echo ok` through `LocalExecutor::execute` to prove the shell works. On success, transition to `Connected`.
   - **Remote** — call `containerus_core::ssh::connect(system_id, host, port, user, password, passphrase, key, jump_host_credentials)`.
4. On success: `set_connection_state(Connected)`, emit `connection:changed` to the frontend.
5. On failure: `set_connection_state(Error { message })`. `HostKeyVerificationFailed` is a distinct variant (see step 7) and triggers the host-key modal in the UI.

## 4. Pool routing — `SshConnectionPool::connect`

File: `crates/containerus-core/src/ssh/pool.rs`.

Examines `SshConfig`:
- If `proxy_jump` is set and non-empty → `SshClient::connect_via_jump(...)`.
- Else if `proxy_command` is set → build a `ProxyStream` over a spawned child process, then pass it to `SshClient::connect_via_proxy_command`.
- Else → `SshClient::connect(host, port, ...)` — direct TCP.

On success, the pool inserts `Arc<Mutex<SshClient>>` into the `DashMap<systemId, _>`.

## 5. Direct connect path — `SshClient::connect`

1. Open a TCP socket with `connection_timeout` (default 30 s).
2. Start russh handshake. The `SshHandler` is the trait impl that gets `check_server_key` callbacks.
3. `check_server_key` delegates to [[ssh-known-hosts]]:
   - `Matched` → accept.
   - `Unknown` → `AcceptNew` policy: record the key, accept.
   - `Mismatch` or `Revoked` → stash a `HostKeyRejection` in the `HostKeyWatcher`, refuse.
4. After key check, `authenticate` runs:
   - If `private_key` set → `authenticate_publickey` (with passphrase if needed).
   - Else if `password` set → `authenticate_password`.
   - Else error `SshAuthenticationFailed`.
5. Wrap the session handle in an `SshClient` with `system_id`, `created_at`, `last_used`.

## 6. ProxyJump path — `SshClient::connect_via_jump`

See [[ssh-proxies]] for the full walkthrough. In brief:

1. Connect to the first jump hop with its own credentials.
2. For each subsequent hop: open a `direct-tcpip` channel on the previous session toward this hop's `host:port`, feed that channel to russh as the transport, authenticate.
3. Keep each hop's `Handle<SshHandler>` in the terminal client's `_jump_sessions` so they stay alive.
4. After the last hop, open a final `direct-tcpip` to the real target and authenticate with the terminal host's credentials.

`JumpHostCredentials` come from `SshCredentials.jump_host_credentials`, keyed by `"hostname:port"` — see [[credentials-and-vault]].

## 7. Host-key rejection handling

If `HostKeyCheckResult::Mismatch` fires, the `ContainerError::HostKeyVerificationFailed { hostname, reason }` bubbles up. In the UI, `ErrorMappingService` renders the rejection with:
- Both fingerprints shown.
- A "Remove from known_hosts" button calling `remove_known_host(hostname, port)`.
- A "Retry" button.

Key material is only ever read from disk — Containerus never rewrites `known_hosts` except to `add_host_key` on first-time acceptance.

## 8. State update round-trip

Back in the frontend:

1. The resolved promise updates `SystemState.connectionStates.set(systemId, Connected)`.
2. `AppState` observes the transition and triggers `ContainerState.load(systemId)` — that fetches the first container list through whichever path applies.
3. If the user has auto-start monitoring enabled, `SystemMonitoringService.start(systemId)` kicks off the 5-second metrics loop. See [[monitoring]].

## 9. Next command on the same connection

Every subsequent Tauri command (`list_containers`, `list_images`, …) calls `ssh::execute_on_system(system_id, cmd)` which:
1. Locks the `Arc<Mutex<SshClient>>` from the pool.
2. Runs `SshClient::execute`, which opens a channel, runs `exec`, streams output back.
3. Returns a `CommandResult`.

No re-handshake. The first connection pays the cost; every following request reuses the session. See [[ssh-connection-pooling]].

## Common failure modes

| Error | Typical cause | Recovery |
|---|---|---|
| `ConnectionFailed { reason: "refused" }` | sshd not running / firewall | Check host reachability |
| `ConnectionFailed { reason: "timeout" }` | Host unreachable, slow link | Retry; check network |
| `SshAuthenticationFailed` | Bad password / key / wrong user | Re-enter credentials |
| `HostKeyVerificationFailed` | Key rotated or MITM | Review fingerprint, remove known_hosts entry if expected |
| `CredentialError` | Decrypt / read from vault failed | Re-enter credentials |

## Related pages

- [[ssh-subsystem]]
- [[ssh-connection-pooling]]
- [[ssh-known-hosts]]
- [[ssh-proxies]]
- [[credentials-and-vault]]
- [[error-model]]
