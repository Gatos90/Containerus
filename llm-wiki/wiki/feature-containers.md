# Feature: containers

**Summary**: The main tab. Browse, inspect, and act on containers across every connected system, local or backend. Supports filters, search, logs, inspect, actions (start / stop / restart / pause / remove / kill), and inline port forwarding.

**Sources**: `src/app/features/containers/*`, `src/app/state/container.state.ts`, `src/app/core/services/container.service.ts`.

**Last updated**: 2026-04-16

**Parent**: [[frontend-features]]
**Siblings**: [[feature-warp-terminal]], [[feature-systems]], [[feature-backend]]

---

## Where it lives

- Route: `/containers` (default after login)
- Folder: `src/app/features/containers/`

## Components

| Component | Purpose |
|---|---|
| `container-list` | Top-level list with search, filters, grouping |
| `container-card` | One row/tile with status dot, runtime, ports, quick actions |
| `container-detail-modal` | Inspect panel — details / env / volumes / networks / logs |
| `container-action-menu` | Dropdown: start / stop / restart / pause / unpause / remove / kill |
| `port-forward-section` | Per-container port-forward cards with open-in-browser |

## State

`ContainerState` holds:
- `containers: Container[]` — global list
- `loadingBySystem: Map<systemId, boolean>`
- `errorBySystem: Map<systemId, string>`
- `statusFilter`, `runtimeFilter`, `searchQuery`
- `selectedContainer`

Computed derivations: `filteredContainers`, `runningCount`, `stoppedCount`, etc. The compose view derives *from* `containers` (no separate fetch).

## Data flow

1. Component mounts → calls `containerState.load(systemId)` for each connected system.
2. `ContainerService.listContainers(systemId)` branches via [[dual-path-routing]]:
   - Tauri: `invoke('list_containers', { systemId })` → `commands/container.rs::list_containers` → runtime builder + parser in `containerus-core::runtime`.
   - Backend: `GET /api/systems/:id/containers`.
3. Results merged into state; UI re-renders via signal subscription.
4. Actions call `perform_container_action` / `POST /api/systems/:id/containers/:cid/action` with `{ Start | Stop | Restart | Pause | Unpause | Remove | Kill }`.
5. After an action, state reloads the list for that system.

## Inspect panel

The detail modal calls `inspect_container` / `GET /api/systems/:id/containers/:cid` for the full `ContainerDetails`:
- **Summary** — status, created, image, command
- **Environment** — env vars
- **Volumes** — volume mounts with source/destination/mode
- **Networks** — network settings per network
- **Ports** — PortMappings with "forward" buttons
- **Resource limits** — memory / cpu quotas
- **Health check** — last status and recent results
- **Labels** — as key/value table
- **Logs** — tail N lines, optional follow, search within

Logs fetch via `get_container_logs` or `GET /api/systems/:id/containers/:cid/logs`. Tail default 100.

## Filters

- Status: running / stopped / paused / all
- Runtime: Docker / Podman / Apple / all (when a system exposes multiple)
- Search: matches across name, image, id prefix, labels
- Group-by: system / compose project / none

## Port forwarding hook-in

The port-forward section on each detail panel uses [[port-forwarding]]. Clicking "Forward" opens a dialog pre-populated with the container's published ports; the resulting forward shows status + local URL inline.

## Compose awareness

If the container has `com.docker.compose.project` / `com.docker.compose.service` labels, the card shows a "Compose: project/service" badge and the group-by compose view is available. See [[frontend-features]] `compose-projects`.

## Bulk operations

Select mode enables checkbox selection, then Bulk actions apply to all selected. Uses one-shot per-container invocations (no backend batch endpoint yet); progress toast shows N/M progress.

## Related pages

- [[frontend-features]]
- [[container-runtimes]]
- [[port-forwarding]]
- [[dual-path-routing]]
- [[angular-state]]
