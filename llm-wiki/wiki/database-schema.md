# Database schema

**Summary**: Two databases. Desktop uses SQLite for local state, singleton-table pattern for settings (`id INTEGER PRIMARY KEY CHECK (id = 1)`). Server uses PostgreSQL with sqlx migrations in `crates/containerus-server/migrations/`.

**Sources**: `src-tauri/src/database.rs`, `crates/containerus-server/migrations/`.

**Last updated**: 2026-04-16

---

## SQLite — desktop

File: `{app_data_dir}/containerus.db`. Migrations are idempotent `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... ADD COLUMN` (ignored if already exists) — no version table.

### `systems`
Container systems (local or remote hosts).
- `id TEXT PRIMARY KEY` (UUID)
- `name TEXT`
- `hostname TEXT`
- `connection_type TEXT` (`"local"` / `"remote"`)
- `primary_runtime TEXT` (`"docker"` / `"podman"` / `"apple"`)
- `available_runtimes TEXT` — JSON array of runtime strings
- `ssh_config TEXT` — JSON of `SshConfig` (includes `proxy_jump`, `proxy_command`)
- `auto_connect INTEGER`

### `ssh_credentials`
Legacy credential storage (XOR-obfuscated). After migration, all columns are NULL — the real store is the OS keyring vault.
- `system_id TEXT PRIMARY KEY`
- `password_enc TEXT NULL`
- `passphrase_enc TEXT NULL`
- `private_key_enc TEXT NULL`

### `command_templates`
- `id TEXT PRIMARY KEY`
- `name TEXT`, `description TEXT`, `command TEXT`
- `category TEXT` — one of `CommandCategory` enum
- `tags TEXT` — JSON array
- `variables TEXT` — JSON array of `TemplateVariable`
- `compatibility TEXT` — JSON of `CommandCompatibility`
- `is_favorite INTEGER`, `is_built_in INTEGER`
- `created_at TEXT`, `updated_at TEXT`

Built-ins are re-seeded on each launch; user deletes of built-ins are refused. Legacy templates with random UUIDs are purged during seeding.

### `ai_settings`
Singleton row (`id = 1`).
- `provider TEXT`, `api_key TEXT NULL` (NULL post-migration), `model_name TEXT`, `endpoint_url TEXT`
- `temperature REAL`, `max_tokens INTEGER`
- `memory_enabled INTEGER`, `summary_model TEXT NULL`, `summary_max_tokens INTEGER`
- `api_version TEXT NULL` (Azure only)
- `created_at TEXT`, `updated_at TEXT`

### `agent_preferences`
Singleton row (`id = 1`).
- `auto_execute_safe_commands INTEGER`
- `show_thinking_process INTEGER`
- `confirm_all_commands INTEGER`
- `max_auto_execute_steps INTEGER`
- `confirmation_timeout_secs INTEGER`
- `preferred_shell TEXT`
- `dangerous_command_patterns TEXT` — JSON array of regex strings

### `backend_connections`
- `id TEXT PRIMARY KEY` (UUID)
- `server_url TEXT`, `label TEXT`
- `created_at TEXT`

Tokens live in the keyring vault, not here.

### `app_settings`
Singleton row (`id = 1`).
- `ssh_config_paths TEXT` — JSON array of paths
- `last_seen_version TEXT`
- `vault_migration_done INTEGER`
- `created_at TEXT`, `updated_at TEXT`

## PostgreSQL — server

Migrations are numbered SQL files, applied by `sqlx::migrate!()` on startup.

### `0001_initial_schema.sql`

Core tables:
- `users` — id, email, password_hash, is_company_admin, created_at
- `roles` — id, name, description, is_built_in
- `permissions` — permission key + description
- `role_permissions` — role_id × permission_key
- `projects` — id, name, description, owner_id, created_at
- `project_members` — user_id × project_id × role_id
- `environments` — project-scoped
- `systems` — id, project/environment refs, hostname, SSH config JSON, runtime enums
- `system_credentials` — AES-GCM encrypted secrets (`(system_id, credential_type, jump_host_key)` composite key, `encrypted_data`, `nonce`)
- `containers`, `images`, `volumes`, `networks` — cached snapshots
- `clusters` — Kubernetes clusters with encrypted kubeconfig
- `kubernetes_resources` — cached watched resources
- `audit_log` — see [[auth-and-rbac]]; append-only
- `api_keys` — long-lived tokens
- `refresh_tokens` — (jti, user_id, exp, revoked_at)

### `0002_audit_view_ip_permission.sql`
- Adds `ip_address` to audit log
- Adds IP-scoped permission variants

### `0003_k8s_permissions.sql`
- Inserts `k8s:*` permissions (`k8s:read`, `k8s:exec`, `k8s:apply`, `k8s:logs`, …)

### `0004_fix_constraints.sql`
- FK and unique constraint adjustments

### `0005_acl_cleanup_triggers.sql`
- Triggers that cascade-delete ACL rows when the referenced resource is removed

## Conventions

- Both DBs use UUIDs as primary keys (TEXT in SQLite, `uuid` in Postgres).
- Both use JSON columns for arrays/maps — SQLite stores them as TEXT, Postgres as `jsonb`.
- Timestamps are `DateTime<Utc>` in Rust; `TEXT` in SQLite (ISO 8601), `timestamptz` in Postgres.
- No cross-DB replication or sync — local and server databases are independent. Backend-owned systems live only in PostgreSQL; local-mode systems live only in SQLite.

## Related pages

- [[crate-src-tauri]]
- [[crate-containerus-server]]
- [[credentials-and-vault]]
- [[auth-and-rbac]]
