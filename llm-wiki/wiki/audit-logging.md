# Audit logging

**Summary**: Every mutating action on the server writes an immutable row to `audit_log`. Rows carry `(project_id, user_id, action, resource_type, resource_id, details, ip_address, environment_id, timestamp)`. Queries are scoped by project (project audit) or org-wide (company admin only).

**Sources**: `crates/containerus-server/src/audit.rs`, `crates/containerus-server/src/api/audit.rs`, `crates/containerus-server/migrations/0001_initial_schema.sql`, `crates/containerus-server/migrations/0002_audit_view_ip_permission.sql`.

**Last updated**: 2026-04-16

**Parent**: [[crate-containerus-server]]
**Siblings**: [[auth-and-rbac]], [[kubernetes]], [[database-schema]]

---

## Writer — `audit.rs`

```rust
pub async fn log_action(
    db: &PgPool,
    project_id: Uuid,
    user_id: Uuid,
    action: &str,
    resource_type: &str,
    resource_id: Option<String>,
    details: serde_json::Value,
    ip_address: Option<IpAddr>,
    environment_id: Option<Uuid>,
);
```

Convenience wrappers:
- `log_system_action(db, ..., action, system_id, details)` — for system CRUD / connect / disconnect.
- `log_container_action(db, ..., action, system_id, container_id, details)` — for container actions.
- `log_member_action(db, ..., action, project_id, target_user_id, details)` — for RBAC changes.

`details` is `jsonb` so event-specific payloads go there without schema churn.

## Event catalogue (examples)

| Resource type | Action examples |
|---|---|
| `system` | `create`, `update`, `delete`, `connect`, `disconnect`, `store_credentials` |
| `container` | `start`, `stop`, `restart`, `remove`, `exec`, `logs_viewed` |
| `image` | `pull`, `build`, `remove` |
| `port_forward` | `open`, `close` |
| `project` | `create`, `update`, `delete` |
| `member` | `invite`, `remove`, `role_change` |
| `role` | `create`, `update`, `delete`, `permission_granted`, `permission_revoked` |
| `auth` | `login`, `logout`, `refresh`, `password_change` |
| `k8s` | `apply`, `exec`, `logs_viewed`, `delete_resource` |
| `file` | `read`, `write`, `delete` |

Not every action is logged — *queries* (listing containers etc.) intentionally aren't, to keep the table size manageable. Reads on sensitive resources (credentials, audit itself) are.

## Reader — `/api/projects/:pid/audit`

- Requires permission `audit:read` on the project.
- Supports filters: `from`, `to`, `user_id`, `action`, `resource_type`, `resource_id`, `limit`, `offset`.
- Returns paginated rows with joined user email + resolved resource name where possible.

## Org-wide audit — `/api/audit`

- Visible to `is_company_admin` only.
- Spans every project.
- Used by the `audit-log` frontend page.

## Retention

No TTL implemented. Rows accumulate indefinitely. Ops can prune via SQL manually; a scheduled vacuum or partition strategy is on the roadmap.

## `0002_audit_view_ip_permission.sql`

Adds:
- `ip_address INET NULL` — resolved from `X-Forwarded-For` first address or socket peer.
- IP-scoped permission variants (certain permissions gated by source IP).
- A view joining `audit_log` with `users` and `projects` for easier querying.

## Frontend wiring

- `BackendAuditService.getAuditLogsFor(connId, filters)` issues the HTTP request.
- `audit-log` and `project-audit` components render paginated tables.
- `BackendService.hasPermission(connId, projectId, 'audit:read')` guards the menu item.

## What's *not* in audit

- Agent interactions on the desktop side (no server involvement) — the Tauri app has no audit log. Users' local activity is invisible to the server.
- Metrics polling.
- Frontend route changes.
- Compose operations issued over SSH directly (not through a backend endpoint).

## Related pages

- [[crate-containerus-server]]
- [[auth-and-rbac]]
- [[feature-backend]]
- [[database-schema]]
