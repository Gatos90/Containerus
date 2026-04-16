# Dual-mode operation

**Summary**: The Angular frontend can run against a local Tauri backend or a remote Axum server, on a per-system basis. System ownership is tracked in `BackendService._systemOwnership`, and every resource service routes calls accordingly.

**Sources**: `src/app/core/services/backend.service.ts`, `src/app/core/services/container.service.ts`, `src-tauri/src/lib.rs`, `crates/containerus-server/src/api/mod.rs`.

**Last updated**: 2026-04-16

**Parent**: [[architecture]]
**Siblings**: [[tech-stack]], [[crate-src-tauri]], [[crate-containerus-core]], [[crate-containerus-server]]
**See also**: [[dual-path-routing]], [[pattern-dual-path]], [[backend-service]]

---

## The two modes

### Local (Tauri) mode
- The Tauri webview loads the Angular app in-process.
- Frontend calls `@tauri-apps/api` `invoke()` → the Rust command handlers in `src-tauri/src/commands/` run.
- Credentials live in the OS keyring (macOS/Win/Linux). See [[credentials-and-vault]].
- SQLite is the persistence store (`containerus.db`).
- No user accounts; the desktop app is single-user.

### Backend mode
- Frontend talks HTTP/WebSocket to `containerus-server` at a URL the user configured in the backend connections list.
- Multi-user, project/environment scoped, RBAC-enforced.
- Credentials live in PostgreSQL encrypted with AES-256-GCM. See [[auth-and-rbac]], [[credentials-and-vault]].
- WebSockets carry PTY terminal traffic, port-forward tunnels, Kubernetes exec, and Kubernetes resource watches.

Both modes use the same Rust library (`containerus-core`) underneath for SSH, executors, and runtime command handling.

## Ownership per system

`BackendService._systemOwnership: Map<systemId, connectionId>` records which backend owns which system. If `getBackendForSystem(id)` returns a connection id, the system is backend-owned; otherwise it's a local Tauri system.

From `container.service.ts`:

```ts
const connId = this.backend.getBackendForSystem(systemId);
if (connId) {
  return this.backend.listContainersFor(connId, systemId);
}
return this.tauri.invoke<Container[]>('list_containers', { systemId });
```

This same branching appears across every resource service — see [[dual-path-routing]] for the full catalogue.

## What lives where

| Capability | Local mode (Tauri) | Backend mode (server) |
|---|---|---|
| Containers / images / volumes / networks | Tauri commands in `commands/` | REST routes under `/api/systems/{id}/...` |
| Terminal | Local PTY or SSH channel; bridged via Tauri events | `/api/ws/terminal` WebSocket PTY proxy |
| Port forward | SSH `direct-tcpip` via `containerus-core::ssh::PortForwardManager` | Frontend dials `/api/ws/tunnel/{systemId}` which relays via server SSH |
| File browser | Tauri commands (`list_directory`, `read_file`, …) | REST under `/api/systems/{id}/files/*` (or pod variant) |
| Kubernetes | Not supported | `ClusterManager` + `/api/clusters` + `/api/ws/k8s-exec`, `/api/ws/k8s-watch` |
| Monitoring | `MonitoringManager` background task, Tauri `system:metrics` events | Server polling (not event-based) |
| Credentials | OS keyring vault | AES-GCM in `system_credentials` table |
| Audit log | n/a | `audit_log` table, queryable via `/api/projects/{id}/audit` |

## Backend connection lifecycle

`BackendService` treats each configured backend as an independent entity. The list of connections is persisted to SQLite (`backend_connections` table) and re-hydrated at launch. Tokens live in the keyring vault, not in SQLite.

1. `addBackend()` — probes `/api/health` (10s timeout), stores the URL + label.
2. `loginToBackend()` / `registerOnBackend()` — POST to `/api/auth/login|register`, stash access + refresh tokens, load projects and permissions.
3. `loadPersistedConnections()` + `autoReconnect()` — at startup, reuse the stored refresh token to resume.
4. `monitorConnections()` — 30-second health check loop; marks disconnected on failure, auto-reconnects when possible.
5. 401 handling — serialized via `_refreshPromises` Map so concurrent requests don't trigger multiple refresh calls.

See [[backend-service]] for a more detailed walk-through.

## Related pages

- [[architecture]]
- [[backend-service]]
- [[dual-path-routing]]
- [[auth-and-rbac]]
- [[credentials-and-vault]]
