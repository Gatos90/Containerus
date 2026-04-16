# Feature: systems

**Summary**: Managing the hosts Containerus talks to. Add a system (local or remote), configure SSH (password / key / ProxyJump / ProxyCommand), detect runtimes, connect / disconnect, monitor live metrics, edit settings.

**Sources**: `src/app/features/systems/*`, `src/app/state/system.state.ts`, `src/app/core/services/system.service.ts`.

**Last updated**: 2026-04-16

**Parent**: [[frontend-features]]
**Siblings**: [[feature-containers]], [[feature-warp-terminal]], [[feature-backend]]

---

## Where it lives

- Route: `/systems`
- Folder: `src/app/features/systems/`

## Responsibilities

1. List all known systems — local, remote, and backend-owned — with connection status.
2. Walk the user through adding a new one.
3. Drive the [[flow-connect-system]] UI (credentials, host-key acceptance, jump-host prompts).
4. Run runtime detection after connect (Docker / Podman / Apple Container).
5. Surface live metrics in the list and detail.
6. Offer settings edit for an existing system.

## Components

| Component | Purpose |
|---|---|
| `system-list` | Grid/list of systems, with status pills and metric bars |
| `system-card` | Per-system tile |
| `system-detail` | Full view — config, metrics, attached containers |
| `add-system-dialog` | Wizard for creating a new system |
| `ssh-config-picker` | Reads parsed SSH config via `list_ssh_config_hosts`, lets the user pick a `Host` block |
| `jump-host-credentials-form` | Per-hop password/key/passphrase entry |
| `host-key-mismatch-dialog` | Shown when [[ssh-known-hosts]] verification fails |

## State — `SystemState`

- `systems: ContainerSystem[]` — union of local and backend
- `connectionStates: Map<systemId, ConnectionState>`
- `extendedInfo: Map<systemId, ExtendedSystemInfo>` — OS, architecture, runtime version, kernel
- `monitoring: Map<systemId, MonitoringState>` — rolling metrics window

Computed: `connectedSystems`, `filteredSystems`, `stats { total, connected, disconnected }`.

## Add-system flow

1. **Choose type** — Local or Remote.
2. **Fill in** — hostname, user, port, auth method. Optional: pick from parsed SSH config (auto-populates everything including ProxyJump).
3. **Jump hosts** — if ProxyJump is set, gather credentials per hop.
4. **Test connect** — the wizard runs a live connect attempt so the user sees host-key prompts and auth failures before saving.
5. **Save** — persists via `add_system` Tauri command + optional `store_ssh_credentials` (which then gets migrated to the keyring on next boot). See [[credentials-and-vault]].
6. **Detect runtimes** — runs `detect_runtimes` to populate `available_runtimes` + `primary_runtime`.

## Connect and monitor

- Clicking Connect triggers [[flow-connect-system]]. UI shows Connecting spinner → Connected / Error.
- If the user has auto-monitor enabled, `start_system_monitoring(system_id, interval_ms)` begins. See [[monitoring]].
- Metric bars (`shared/metric-bar`) animate as new samples arrive.

## Edit

Existing system edit supports:
- Rename
- Change hostname / port / user
- Update auth method and credentials (re-stores to keyring)
- Toggle auto-connect
- Change primary runtime

Edits flow through `update_system` and `store_ssh_credentials` Tauri commands.

## Delete

`remove_system` removes from DB + vault entry via `flush_vault`. Active connections are disconnected first (server-side for backend-owned systems, SSH pool disconnect for Tauri-owned).

## Known-hosts UX

- When `connect_system` returns `HostKeyVerificationFailed`, the dialog shows both SHA-256 fingerprints.
- "Remove from known_hosts" calls `remove_known_host(hostname, port)`.
- "Retry" re-issues `connect_system`.

See [[ssh-known-hosts]].

## Backend-owned systems

Systems belonging to a backend connection appear with a badge indicating which backend owns them. Edit / delete are disabled for backend systems on the desktop side — they're managed through the backend's project detail view (see [[feature-backend]]).

## Related pages

- [[frontend-features]]
- [[flow-connect-system]]
- [[ssh-subsystem]]
- [[ssh-config-parsing]]
- [[credentials-and-vault]]
- [[monitoring]]
