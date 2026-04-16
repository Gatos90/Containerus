# Feature: backend connections UI

**Summary**: Multi-connection management for backend mode. Add and manage multiple `containerus-server` connections, log in, browse projects / environments / systems, manage members and roles, audit log. Each backend is an independent account and permission scope.

**Sources**: `src/app/features/backend/*`, `src/app/core/services/backend.service.ts`, `src/app/core/services/backend-auth.service.ts`, `src/app/core/services/backend-audit.service.ts`.

**Last updated**: 2026-04-16

**Parent**: [[frontend-features]]
**Siblings**: [[feature-containers]], [[feature-systems]], [[feature-warp-terminal]]

---

## Routes

- `/backends` — connection list
- `/backends/:connectionId` — project list for one connection
- `/backends/:connectionId/projects/:projectId` — project detail
- `/backends/:connectionId/projects/:projectId/environments/:envId` — environment detail
- `/backend-connect` — add a new backend
- `/login` — per-connection login
- `/audit-log` — organization-wide audit log
- `/audit/project` — project-scoped audit log
- `/k8s` — K8s dashboard (see [[kubernetes]])

## Components

| Component | Purpose |
|---|---|
| `backend-view` | Top-level list of configured backends |
| `connect` | Add + test a new backend URL |
| `login` | Email/password against a specific backend |
| `project-list`, `project-detail` | Project CRUD |
| `project-members` | Invite / remove / change role per user |
| `project-servers` | Systems assigned to a project/environment |
| `project-resources` | Aggregated container/volume/network view |
| `project-audit` | Project-scoped audit log |
| `environment-detail` | Per-environment resource view |
| `audit-log` | Organization-wide audit |
| `org-management` | Roles, permissions, company settings |
| `k8s-dashboard` | Full kube-rs UI |

## Connection lifecycle — UX

1. `backend-view` shows each connection with its status badge (connected / disconnected / connecting / error) and the email of the logged-in user.
2. Click **Add backend** → `backend-connect` component probes `/api/health` and saves the URL.
3. Click **Login** → `login` component authenticates against that specific backend. Tokens are stored per-connection in the keyring vault. See [[backend-service]].
4. Once connected, projects and permissions populate automatically.

## Permission gating

Every destructive action (delete project, invite member, edit role) is wrapped in a permission check:

```ts
const canEdit = backend.hasPermission(connId, projectId, 'projects:edit');
```

Permissions come from `PermissionCache` server-side (see [[auth-and-rbac]]) and are cached in `BackendService._connections[i].projectPermissions`. The UI hides buttons the user can't use.

## Project audit vs org audit

- **Project audit** (`/audit/project`) — filtered to one project, shows member & resource actions.
- **Organization audit** (`/audit-log`) — visible to company admins only, shows everything across every project.

Both use `BackendAuditService.getAuditLogsFor(connId, { project_id?, date_range, user_id?, resource_type? })`.

See [[audit-logging]] for the event catalogue.

## Org management

- List company admins (`listCompanyAdminsFor`)
- Update company info (`updateCompanyFor`)
- Create / edit / delete roles (`listRolesFor`, `createRoleFor`, …)
- Assign permissions to roles

## K8s dashboard shortcut

`/k8s` routes into the K8s dashboard — one of the features gated by `is_company_admin` or `k8s:read` permission. See [[kubernetes]].

## Logout behavior

`logoutFrom(connectionId)`:

1. Hits `/api/auth/logout` server-side to revoke the JTI.
2. Clears tokens in the keyring vault entry for that connection.
3. Marks the connection `_userLoggedOut` so the 30s health monitor does not auto-reconnect it.
4. Keeps the server URL + label so the user can log in again without re-adding.

## Delete connection

Hard-removes from SQLite + keyring vault. Destructive — a confirmation dialog enumerates what's being cleaned up (tokens, URL, label).

## Related pages

- [[backend-service]]
- [[auth-and-rbac]]
- [[audit-logging]]
- [[kubernetes]]
- [[dual-mode-operation]]
