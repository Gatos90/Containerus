# Dual-path routing

**Summary**: Every resource service checks whether a given system is owned by a backend connection and picks the right transport. `BackendService.getBackendForSystem(systemId)` returns either a connection id (→ HTTP/WS) or undefined (→ Tauri invoke).

**Sources**: `src/app/core/services/*.service.ts`.

**Last updated**: 2026-04-16

**Parent**: [[frontend-overview]]
**Siblings**: [[angular-state]], [[backend-service]], [[frontend-features]]
**See also**: [[pattern-dual-path]], [[dual-mode-operation]], [[concept-system-id]]

---

## The idiom

```ts
const connId = this.backend.getBackendForSystem(systemId);
if (connId) {
  return this.backend.listContainersFor(connId, systemId);
}
return this.tauri.invoke<Container[]>('list_containers', { systemId });
```

Each service picks the branch per call. Within a single session a system may flip ownership (it just doesn't — but nothing in the routing layer assumes it can't).

## Services that route

| Service | Both paths? | Tauri command(s) | Backend route(s) |
|---|---|---|---|
| `container.service` | yes | `list_containers`, `perform_container_action`, `get_container_logs`, `inspect_container` | `/api/systems/:id/containers/...` |
| `image.service` | yes | `list_images`, `pull_image`, `build_image`, `remove_image` | `/api/systems/:id/images/...` |
| `volume.service` | yes | `list_volumes`, `create_volume`, `remove_volume` | `/api/systems/:id/volumes/...` |
| `network.service` | yes | `list_networks`, `create_network`, `remove_network`, `connect_container_to_network`, `disconnect_container_from_network` | `/api/systems/:id/networks/...` |
| `system.service` | yes | `list_systems`, `add_system`, `connect_system`, `disconnect_system`, `detect_runtimes`, `get_extended_system_info`, `get_live_metrics` | `/api/systems/...` |
| `terminal.service` | yes | `start_terminal_session`, `send_terminal_input`, `resize_terminal`, `close_terminal_session` | `/api/ws/terminal/:id` |
| `file-browser.service` | yes | `list_directory`, `read_file`, `write_file`, `create_directory`, `delete_path`, `rename_path`, `download_file`, `upload_file` | `/api/systems/:id/files/...` + pod variant |
| `system-monitoring.service` | hybrid | Tauri `system:metrics` events | HTTP poll `/api/systems/:id/metrics` |

## Services that do not route

| Service | Why |
|---|---|
| `port-forward.service` | Creates a *local* TCP listener. For backend-owned systems it still opens the local listener but uses `backend_forward.rs` in Tauri to tunnel via WebSocket — from the service's point of view it always calls Tauri. See [[port-forwarding]]. |
| `command-template.service` | Templates are purely local. |
| `compose.service` | Only Tauri-side so far. |
| `keychain.service`, `tauri.service` | Tauri-only by nature. |
| `backend.service`, `backend-auth.service`, `backend-k8s.service`, `backend-audit.service` | Backend-only by nature. |

## Implementation notes

- System ownership is only registered by `BackendService` when the backend returns a system in its project/environment tree. Systems added via local Tauri `add_system` never get an entry in `_systemOwnership`.
- The system list in the UI is the union of `list_systems` (local) and `listSystemsFor(connId)` across every connected backend.
- Error mapping (`ErrorMappingService`) wraps both paths so toasts look the same whether the failure came from an HTTP 500 or a Tauri Err(String).
- `BackendService.isBackendSystem(id)` is the `CLAUDE.md`-documented check, implemented as `getBackendForSystem(id) !== undefined`.

## Related pages

- [[backend-service]]
- [[dual-mode-operation]]
- [[frontend-overview]]
