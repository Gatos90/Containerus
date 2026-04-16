# Crate: containerus-server

**Summary**: Axum-based HTTP + WebSocket backend providing multi-user Containerus. PostgreSQL via sqlx, JWT access/refresh auth, Argon2id passwords, role-based permissions with an in-memory cache, AES-256-GCM credential vault, Kubernetes support through kube-rs, and dual-tier SSH (shared for queries, per-user for interactive traffic).

**Sources**: `crates/containerus-server/src/`, `crates/containerus-server/migrations/`, `crates/containerus-server/Cargo.toml`.

**Last updated**: 2026-04-16

**Parent**: [[architecture]]
**Siblings**: [[crate-src-tauri]], [[crate-containerus-core]]
**Children**: [[auth-and-rbac]], [[server-vault-internals]], [[server-websockets]], [[ssh-connection-pooling]], [[kubernetes]], [[audit-logging]], [[database-schema]]

---

## Startup — `main.rs`

1. Load `.env` with `dotenvy`, init tracing with `EnvFilter`.
2. `ServerConfig::from_env()` — see below.
3. `db::init_pool(database_url)` — Postgres pool (max 20, 10s acquire timeout). Runs `sqlx::migrate!()` from `./migrations`.
4. `ServerVault::new(encryption_key, salt)` — Argon2-derived AES-256 key.
5. `ConnectionManager::new()` and `ClusterManager::new()`.
6. If `ADMIN_EMAIL` and `ADMIN_PASSWORD` env vars set: seed the bootstrap admin user.
7. `PermissionCache::load_from_db()` — warm cache from `role_permissions`.
8. Assemble `AppState`.
9. Spawn a 60-second background task that evicts idle SSH connections (>5m idle).
10. Build router with CORS, tracing, panic handling, and request-body limits. Serve on `bind_addr`.

## `AppState`

```rust
pub struct AppState {
    pub db: PgPool,
    pub config: ServerConfig,
    pub vault: ServerVault,
    pub connections: ConnectionManager,
    pub k8s: ClusterManager,
    pub permission_cache: PermissionCache,
    pub revocation_cache: TokenRevocationCache,
}
```

## `config.rs`

`ServerConfig` fields (from `from_env()`):
- `bind_addr` (default `0.0.0.0:8080`)
- `database_url` (required)
- `jwt_secret` (min 32 bytes, required)
- `jwt_access_expiry_secs` (default 900 = 15 min)
- `jwt_refresh_expiry_secs` (default 604800 = 7 days)
- `encryption_key` (min 32 bytes, required)
- `encryption_salt` (min 16 bytes, required)
- `cors_origins` (comma-separated, or `*`; default `http://localhost:1420`)

## REST router — `api/mod.rs`

Mounted under `/api`:

| Prefix | Module | Notes |
|---|---|---|
| `/health` | `health` | liveness |
| `/auth` | `auth` | login, register, refresh, logout, me, change-password. **Rate-limited** 10 req/60s per IP (see [[auth-and-rbac]]) |
| `/projects` | `projects` | CRUD |
| `/projects/:pid/environments` | `environments` | scoped |
| `/projects/:pid/environments/:eid/systems` | `systems::environment_router` | scoped |
| `/projects/:pid/environments/:eid/clusters` | `clusters::environment_router` | scoped |
| `/systems` | `systems`, `containers`, `files` | per-system container/image/volume/network listings and file operations |
| `/clusters` | `clusters` | CRUD + discovery + workloads + topology + nodes + logs + files + apply |
| `/projects/:pid/audit` | `audit` | audit log queries |
| `/projects/:pid/acls` | `acls` | project-level ACLs |
| `/roles` / `/permissions` | `roles` | role CRUD + permission catalogue |
| `/company` | `company` | company admin |

## WebSockets — `ws/`

- `/api/ws/terminal` — PTY terminal proxy; binds a per-user SSH session; multiplexes input/output. See [[terminal-subsystem]].
- `/api/ws/tunnel` — port-forward tunnel; relays TCP bytes between frontend and remote container port via per-user SSH. See [[port-forwarding]].
- `/api/ws/k8s-exec` — Kubernetes pod exec (PTY) via `kube-rs` attach channel.
- `/api/ws/k8s-watch` — Kubernetes resource watch stream.

All four take an access-token query parameter or `Authorization` header.

## `auth/`

- `jwt.rs` — HS256 tokens. `AccessClaims` include `sub`, `iss` (`"containerus"`), `aud` (`"containerus-client"`), `jti`, `email`, `memberships: Vec<ProjectMembership>`, `is_company_admin`, `iat`, `exp`. `RefreshClaims` is minimal (sub/iss/aud/jti/iat/exp). `role_for_project(pid)` helper resolves role from memberships.
- `password.rs` — `hash_password` with random-salt Argon2id; `verify_password` parses and checks.
- `middleware.rs`:
  - `TokenRevocationCache` — `DashMap<Uuid, i64>` of revoked `jti` → expiry; `prune_expired()` trims.
  - `PermissionCache` — `DashMap<Uuid, HashSet<String>>` of role id → permission keys; `invalidate_role` / `reload_all`.
  - `AuthUser` extractor — validates signature, checks revocation.
  - `AuthUserWithPermission` — composes `AuthUser` and returns the resolved permission set for handlers.

See [[auth-and-rbac]].

## `db/`

- `mod.rs` — `init_pool()`; runs embedded migrations.
- `models.rs` — row structs mirroring migration tables (users, roles, permissions, projects, environments, systems, clusters, etc.).
- sqlx `query!` / `query_as!` — compile-time checked against a live DB (requires `DATABASE_URL` at compile time unless `SQLX_OFFLINE`).

## `vault/mod.rs` — encrypted credential storage

`ServerVault` wraps `aes_gcm::Aes256Gcm`. `new(encryption_key, salt)` derives the AES key with Argon2 over the provided inputs. Secrets are written to the `system_credentials` table keyed by `(system_id, credential_type, jump_host_key)`:
- `credential_type` ∈ `"password"`, `"passphrase"`, `"private_key"`
- `jump_host_key` optional, `"hostname:port"` for per-hop ProxyJump secrets
- each row stores `(ciphertext, nonce)`

See [[credentials-and-vault]].

## `connections/mod.rs` — dual-tier SSH

Maintains two concurrent maps:

- **Shared connections**: `DashMap<Uuid, ConnectionEntry>`, one per system. Used for API queries whose results are identical for all users (container / image / volume / network lists, system info, metrics). Methods: `ensure_shared_connected`, `execute_shared`.
- **Per-user connections**: `DashMap<(Uuid, Uuid), ConnectionEntry>` keyed by `(user_id, system_id)`. Used for terminal PTYs, port-forward tunnels, and file operations — anything where different users must not interfere. Methods: `ensure_user_connected`, `get_executor`, `get_client`.

`create_ssh_client(db, system)` reads credentials out of the vault (password / passphrase / private key) and, for each ProxyJump hop, looks up per-hop credentials too, then routes via direct, ProxyJump, or ProxyCommand. See [[ssh-connection-pooling]].

Background task in `main.rs` ticks every 60 s, evicting connections idle >5 min.

## `k8s/mod.rs` + `api/clusters/*`

`ClusterManager` wraps `kube::Client` instances per registered cluster. Submodules:

- `crud.rs` — cluster CRUD
- `discovery.rs` — discover clusters from a user's kubeconfig
- `workloads.rs` — deployments / statefulsets / daemonsets / cronjobs
- `resources.rs` — CPU/memory queries
- `topology.rs` — topology graph
- `nodes.rs` — node listing, status, taints
- `logs.rs` — pod log streaming
- `files.rs` — read files inside pod containers (via exec)
- `apply.rs` — `kubectl apply`-style manifest apply/patch

See [[kubernetes]].

## `audit.rs` + `rate_limit.rs`

- `audit::log_action(db, project_id, user_id, action, resource_type, resource_id, details, ip_address, environment_id)` inserts into `audit_log`. Convenience helpers: `log_system_action`, `log_container_action`, `log_member_action`.
- `RateLimiter` — sliding-window, per-IP. `DashMap<IpAddr, VecDeque<Instant>>`, purges on each check. Wired to `/api/auth` at 10 req/60s. `client_ip()` prefers `X-Forwarded-For` first address.

## Migrations — `migrations/`

1. `0001_initial_schema.sql` — users, roles, permissions, role_permissions, projects, project_members, systems, system_credentials, containers (cache), images, volumes, networks, clusters, kubernetes_resources, audit_log, api_keys, refresh_tokens
2. `0002_audit_view_ip_permission.sql` — audit enhancements and IP-scoped permissions
3. `0003_k8s_permissions.sql` — Kubernetes permission setup
4. `0004_fix_constraints.sql` — constraint fixes
5. `0005_acl_cleanup_triggers.sql` — cascading ACL cleanup triggers

See [[database-schema]].

## Key dependencies

`axum 0.8` (ws, macros), `tower 0.5`, `tower-http 0.6`, `sqlx 0.8`, `jsonwebtoken 9`, `argon2 0.5`, `aes-gcm 0.10`, `kube 0.98`, `k8s-openapi 0.24` (v1_31), `dashmap 6`, `serde_yaml 0.9`, `validator 0.18`, `dotenvy 0.15`.

## Related pages

- [[auth-and-rbac]]
- [[credentials-and-vault]]
- [[ssh-connection-pooling]]
- [[kubernetes]]
- [[database-schema]]
- [[port-forwarding]]
