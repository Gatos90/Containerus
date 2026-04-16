# SSH connection pooling

**Summary**: `containerus-core` exposes a single global SSH pool (`DashMap<systemId, Arc<Mutex<SshClient>>>`). The server adds a *dual-tier* model on top: one shared connection per system for read-only API queries, plus per-user connections for interactive traffic.

**Sources**: `crates/containerus-core/src/ssh/pool.rs`, `crates/containerus-server/src/connections/mod.rs`.

**Last updated**: 2026-04-16

---

## Core pool — `containerus-core::ssh::pool`

```rust
pub struct SshConnectionPool {
    connections: DashMap<String, Arc<Mutex<SshClient>>>, // keyed by system_id
    config: PoolConfig,
}

pub struct PoolConfig {
    keep_alive_interval: Duration,   // 30 s
    max_idle_time: Duration,         // 5 min
    connection_timeout: Duration,    // 30 s
}
```

Accessors:
- `connect(...)` — routes to direct, ProxyJump (`connect_via_jump`), or ProxyCommand based on `SshConfig`
- `disconnect(system_id)` — removes entry; russh drops the transport
- `is_connected(system_id)` — map lookup
- `execute(system_id, cmd)` — acquire the Mutex, run `SshClient::execute`
- `validate_connection(system_id)` — calls `SshClient::is_alive`
- `connection_count()`, `connected_systems()` — diagnostics

The pool is stored in a `Lazy<Arc<RwLock<_>>>` singleton (`mod.rs`) so both Tauri commands and core code share a single map.

### One connection per system, not per request

Opening russh sessions is expensive (TCP + SSH handshake + auth). The pool lets many commands reuse a single `SshClient`. Concurrency within a single connection is serialized through the per-entry `Mutex` — russh channels themselves could multiplex, but serializing simplifies correctness. Fan-out across systems is fully parallel.

### Keep-alive + idle eviction

`keep_alive_interval` is the target cadence for russh keep-alives; `max_idle_time` is how long a connection may sit without use before it's a candidate for eviction. In the desktop app nothing proactively prunes, but the server runs a 60-second task that drops anything exceeding `max_idle_time`.

## Server dual-tier — `containerus-server::connections`

The server refines the model:

```rust
pub struct ConnectionManager {
    shared: DashMap<Uuid /* system_id */, ConnectionEntry>,
    per_user: DashMap<(Uuid, Uuid) /* (user_id, system_id) */, ConnectionEntry>,
}
```

### Shared connections

One per system, reused across users. Backing for API queries whose response is the same for everyone:

- Container / image / volume / network listings and details
- System info, runtime detection
- Live metrics

API handlers call `ensure_shared_connected(db, system)` and then `execute_shared(system_id, command)` or `get_shared_executor(system_id)`.

### Per-user connections

One per `(user_id, system_id)` pair. Used where user isolation matters:

- Terminal PTY sessions (each user has their own shell state, env, history)
- Port-forward tunnels (each user's TCP relay is independent)
- File operations (two users may edit different files simultaneously; shared sessions would interleave reads/writes unsafely)

API handlers call `ensure_user_connected(db, user_id, system)`.

### Credential assembly

`create_ssh_client(db, system)` pulls the following out of the `ServerVault`:

- `system_id, "password"` (if auth_method is Password)
- `system_id, "passphrase"`, `system_id, "private_key"` (if PublicKey)
- For each `ProxyJump` hop: `system_id, "password|passphrase|private_key"` with `jump_host_key = "hostname:port"`

Then it routes via direct / ProxyJump / ProxyCommand the same way the desktop does.

## Eviction task

From `main.rs`:

```rust
// every 60 seconds, drop entries idle > 5 min
tokio::spawn(async move {
    loop {
        tokio::time::sleep(Duration::from_secs(60)).await;
        connections.cleanup_idle(Duration::from_secs(300));
    }
});
```

The task walks both maps and disconnects/removes stale entries. Next request on that system re-opens.

## Trade-offs

- **Shared connections save memory**, trade: the first user's SSH key opens the tunnel for everyone's *read* paths. Audit-log actor is still the requesting user, but the SSH actor is whoever owns the connection.
- **Per-user connections provide isolation at the cost of N× SSH sessions**. On very small servers this can hit user `MaxSessions`/`MaxStartups` SSHD limits; the server serializes `ensure_user_connected` with `start_lock` to keep the concurrency bounded.

## Related pages

- [[ssh-subsystem]]
- [[port-forwarding]]
- [[auth-and-rbac]]
- [[crate-containerus-server]]
