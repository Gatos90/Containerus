# BackendService

**Summary**: Multi-connection hub for backend mode. Owns the list of configured servers, auth tokens, project/permission state, per-system ownership mapping, serialized token refresh, and a 30-second health-monitoring loop. Roughly 1,300 lines in `backend.service.ts`.

**Sources**: `src/app/core/services/backend.service.ts`.

**Last updated**: 2026-04-16

**Parent**: [[frontend-overview]]
**Siblings**: [[angular-state]], [[dual-path-routing]], [[frontend-features]]
**See also**: [[concept-connection-id]], [[dual-mode-operation]], [[auth-and-rbac]]

---

## Data model

```ts
interface BackendConnection {
  id: string;                      // UUID
  serverUrl: string;
  label: string;
  tokens?: { accessToken: string; refreshToken: string };
  user?: UserSummary;
  projects?: Project[];
  projectPermissions?: Map<ProjectId, Set<string>>;
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
}
```

State signals:
- `_connections: signal<BackendConnection[]>` — the full list
- `_systemOwnership: Map<systemId, connectionId>` — which connection owns each system
- `connectedBackends(): computed<...>` — `_connections` filtered to `status === 'connected'`

`getBackendForSystem(id) → connectionId | undefined` is the single call every dual-path service uses.

## Connection lifecycle

1. **`addBackend(serverUrl, label)`**
   - Probes `GET /api/health` with a 10-second timeout. Fails fast on unreachable servers.
   - Inserts a connection with `status = 'disconnected'` into the signal.
   - Persists to SQLite via `save_backend_connection` Tauri command (URL + label only — tokens go to the keyring vault).

2. **`loginToBackend(id, email, password)` / `registerOnBackend(...)`**
   - POST `/api/auth/login` or `/api/auth/register`.
   - Stash access + refresh tokens in the connection and in the keyring (via `save_backend_connection`).
   - Calls `loadProjectsFor(id)` and `loadPermissionsFor(id)`.
   - Flips status to `connected`.

3. **`loadPersistedConnections()` + `autoReconnect()`** (boot)
   - `list_backend_connections` returns URLs plus tokens (hydrated from keyring cache).
   - For each one with a refresh token, call `refreshTokenFor`; on success, fetch projects/permissions and mark connected.
   - Users that explicitly logged out are excluded via `_userLoggedOut: Set<connectionId>`.

4. **`logoutFrom(id)`**
   - Adds to `_userLoggedOut`, clears tokens/user/projects, sets `disconnected`.
   - Tells server `/api/auth/logout` so the refresh token JTI is revoked.

## Token refresh — serialized

```ts
private _refreshPromises: Map<string, Promise<boolean>>;
```

On any `requestFor` that returns `401`:

1. Check `_refreshPromises.get(connectionId)` — if a refresh is already in flight, await that one.
2. Otherwise, POST `/api/auth/refresh` with the refresh token (10-second timeout) and store the promise.
3. Success: save new tokens, retry the original request once with the new access token.
4. Failure: clear tokens, mark the connection `disconnected`, surface a friendly error.

This prevents the classic thundering-herd-on-401 problem when many signals fetch simultaneously.

## Health monitor — every 30 s

`monitorConnections()` ticks on a timer:

- Phase 1: for every `connected` connection, hit `GET /api/health` with a 5s timeout. On failure, flip to `disconnected`.
- Phase 2: for every `disconnected` connection that still has a refresh token, try `autoReconnect` again.

The loop is idempotent and skips any connection currently being changed.

## Dual-path request helper

```ts
requestFor<T>(connectionId, method, path, body?) : Promise<T>
```

- Adds `Authorization: Bearer <accessToken>` and a 30-second fetch timeout.
- On 401 → serialize refresh → retry once.
- On network error → mark `disconnected` and surface an error.
- Returns parsed JSON or throws a mapped error.

Every domain method (`listContainersFor`, `listProjectsFor`, `inviteMemberFor`, `applyCustomResourceFor`, …) is a thin wrapper around `requestFor`.

## Persistence

- **Tauri-side SQLite**: `save_backend_connection`, `list_backend_connections`, `delete_backend_connection`, `delete_all_backend_connections`. Stores URL + label + `created_at`. Access/refresh tokens arrive as parameters and are funneled into the in-memory cache + keyring vault (see `backend.rs` and [[credentials-and-vault]]).
- **Web fallback**: in contexts without Tauri, falls back to `sessionStorage`/`localStorage` (migrates legacy entries at load).
- Tokens are never placed in Angular DevTools-visible state — they live in the service's closed-over variables only.

## WebSocket URL builders

| Method | Target |
|---|---|
| `getTerminalWsUrl(connId, systemId)` | `ws(s)://server/api/ws/terminal/{systemId}` |
| `getTunnelWsUrl(connId, systemId)` | `ws(s)://server/api/ws/tunnel/{systemId}` |
| `getK8sExecWsUrl(connId, clusterId, ...)` | `ws(s)://server/api/ws/k8s-exec/{clusterId}` |
| `getK8sWatchWsUrl(connId, clusterId, ...)` | `ws(s)://server/api/ws/k8s-watch/{clusterId}` |

Each returns a `{ url, token }` pair; the caller passes the token either in query params or the `Authorization` header.

## Endpoint group coverage

Auth · Projects · Members · Permissions · Roles · Containers · Images · Volumes · Networks · File ops · Pod file ops · Terminal WS · K8s namespaces / pods / deployments / services · K8s custom resources · K8s watch + exec WS · Port-forward tunnels · Audit · ACLs · Company management.

Every "for" method maps 1:1 to a backend route.

## Related pages

- [[dual-mode-operation]]
- [[dual-path-routing]]
- [[auth-and-rbac]]
- [[credentials-and-vault]]
