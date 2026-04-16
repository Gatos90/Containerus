# Pattern: the three storage tiers

**Summary**: Containerus has three persistence tiers that serve different purposes and must not be confused: SQLite (desktop state), OS keyring vault (desktop secrets), and PostgreSQL (server state + AES-GCM-encrypted secrets). Data belongs to exactly one tier; crossing tiers happens only through well-defined migration and API boundaries.

**Sources**: `src-tauri/src/database.rs`, `src-tauri/src/keyring_store.rs`, `crates/containerus-server/migrations/`, `crates/containerus-server/src/vault/mod.rs`.

**Last updated**: 2026-04-16

**Parent**: [[architecture]]
**Siblings**: [[pattern-signals-and-state]], [[pattern-dual-path]]

---

## The three tiers

| Tier | Location | What it holds | Lifecycle |
|---|---|---|---|
| Desktop SQLite | `{app_data}/containerus.db` | Systems, templates, settings (non-secret), `vault_migration_done` flag | Created on first launch; migrated idempotently on upgrade |
| Desktop keyring vault | OS keyring entry `containerus.vault`/`default` | SSH creds, AI keys, backend tokens | Written once per mutation, read at boot |
| Server PostgreSQL | Postgres cluster | Users, roles, projects, systems, encrypted credentials, audit | Created via `sqlx::migrate!()` |

## Who owns what

### Systems (hosts)

- **Local-mode systems** → desktop SQLite only. Server doesn't know they exist.
- **Backend-mode systems** → server PostgreSQL only. Desktop stores no metadata — it queries via `/api/systems/:id` when needed.

`BackendService._systemOwnership` is the routing key (see [[concept-system-id]]).

### Credentials

- **Desktop SSH creds, AI keys, backend tokens** → keyring vault. SQLite columns exist for legacy and migration reasons but are NULL post-migration.
- **Server SSH creds** → `system_credentials` table, AES-GCM + random nonce, key derived via Argon2. See [[server-vault-internals]].

Credentials **never** cross tiers. Backend-mode SSH creds never appear in the desktop vault; desktop-mode creds never appear in Postgres.

### Settings

- **Desktop app settings, AI config, agent prefs, SSH config paths** → desktop SQLite (singleton tables with `id = 1`).
- **Server config** → env vars, never persisted.
- **Per-project settings** (e.g., ACLs, role assignments) → server PostgreSQL.

### Audit

- Server-only. Desktop actions are invisible. See [[audit-logging]].

## Migration boundaries

1. **SQLite → keyring**: `credential_migration.rs` runs once on desktop. Ordered carefully — see [[credentials-and-vault]].
2. **Schema bumps (SQLite)**: idempotent `ALTER TABLE ... ADD COLUMN`. No version table.
3. **Schema bumps (Postgres)**: numbered SQL files in `migrations/`, applied at startup via `sqlx::migrate!()`.

There is no migration from desktop SQLite to server Postgres — a user who moves from local to backend mode re-creates their systems via the server UI.

## Backup and recovery

- **SQLite** — just copy `containerus.db`. Secrets aren't there (they're in the keyring), so losing it is less painful than it used to be.
- **Keyring** — OS-specific. On macOS, export via Keychain Access. On Linux, `secret-tool`. On Windows, Credential Manager. Users who want a portable backup can `flush_vault` then copy `~/Library/Application Support/containerus/backup.vault.json` if that feature exists (it's a backlog item).
- **Postgres** — standard `pg_dump`. Covers audit + creds + everything.

## Anti-patterns (please don't)

- Storing SSH creds in SQLite after first launch — they're supposed to be in the keyring. The columns exist for migration only.
- Reading `ENCRYPTION_KEY` on the desktop side — it doesn't exist there. That's a server concept.
- Letting the frontend touch SQLite directly — everything goes through Tauri commands. There's no `better-sqlite3` in the Angular bundle.
- Crossing the server/desktop boundary with credentials. A local system cannot be "promoted" to a backend system by copying a SQLite row into Postgres; the user must re-add it.

## Why keep them separate

The trust model differs:

- Desktop SQLite is readable by anyone with the user's filesystem access. Non-secret.
- Desktop keyring is protected by OS login. Secrets only.
- Server Postgres is protected by DB credentials + app encryption key. Multi-tenant — each row is scoped by user/project.

Mixing them would collapse the trust boundary. A server dump should reveal nothing about individual desktop users; a stolen laptop should reveal nothing about server-managed systems.

## Related pages

- [[architecture]]
- [[credentials-and-vault]]
- [[database-schema]]
- [[server-vault-internals]]
- [[auth-and-rbac]]
