# Frontend features

**Summary**: Thirteen feature folders under `src/app/features/`. Each pairs components with a state class and, where applicable, a service that dual-path-routes.

**Sources**: `src/app/features/*`.

**Last updated**: 2026-04-16

**Parent**: [[frontend-overview]]
**Siblings**: [[angular-state]], [[backend-service]], [[dual-path-routing]]
**Children**: [[feature-containers]], [[feature-systems]], [[feature-warp-terminal]], [[feature-backend]], [[command-templates]], [[compose-projects]], [[settings-and-preferences]], [[file-browser]]

---

## `backend/`

Multi-connection management UI. Components: `backend-view` (list connections), `connect` (probe a new server), `login`, `project-list`, `project-detail`, `project-members`, `project-servers`, `project-resources`, `project-audit`, `environment-detail`, `audit-log`, `org-management`, `k8s-dashboard`.

State is held by `BackendService`. See [[backend-service]].

## `containers/`

The main tab. Components: `container-list` with filters and search; `container-card` summary tile; `container-detail-modal` with inspect + logs + actions; `container-action-menu`; `port-forward-section`.

State: `ContainerState`. Service: `ContainerService` (dual-path).

## `images/`

Components: `image-list` with in-use / unused / dangling filters; `image-card`; `system-image-section` grouping by system. Build jobs track progress with streamed logs.

State: `ImageState`. Service: `ImageService`.

## `volumes/`

Components: `volume-list`, `volume-card`. Filter by mounted / orphaned.

State: `VolumeState`. Service: `VolumeService`.

## `networks/`

Components: `network-list`, `network-card`. Filter by driver (bridge / host / overlay / custom) and by active / empty.

State: `NetworkState`. Service: `NetworkService`.

## `systems/`

Components: `system-list` with SSH connection status, metrics bar, jump-host credential collection, host-key verification prompts, auto-connect toggle.

State: `SystemState`. Service: `SystemService`.

## `terminal/`

Shell terminal experience with dockable slots. Components: `terminal-view`, `blocks/` (command, AI prompt, AI response, AI command), `ai-input-bar`, `command-preview-card`.

State: `TerminalState` (layouts: single / split-h / split-v / quad; tracks `dockHeightPercent` and active slot). Service: `TerminalService` (WebSocket for backend, Tauri events for local).

## `warp-terminal/`

Warp.dev-style rich terminal. Components: `warp-terminal-view`, `block-list`, `output-viewport`, `command-block-card`, `composer-bar`, `search-overlay`. Has its own local state under `warp-terminal/state/`.

## `file-browser/`

Components: `file-browser-view`, `breadcrumb`, `file-list`, `editor`. Monaco for file editing; supports container and K8s pod contexts.

State: `FileBrowserState`. Service: `FileBrowserService`. See [[file-browser]].

## `commands/`

Command template manager. Components: `command-list`, `command-card`. Supports category / runtime / system filters, search, favorites, copy-to-clipboard, variable-prompt before run.

State: `CommandTemplateState`. Service: `CommandTemplateService`.

## `compose-projects/`

Compose project view derived from container labels (`com.docker.compose.project`). Components: `compose-list`, `compose-service-card`. Supports up / down / restart / logs.

State: `ComposeState` (derived from `ContainerState`). Service: `ComposeApiService`.

## `settings/`

Components: `settings-page` (tabbed: AI settings, SSH config paths, changelog view, theme, backend connections).

## `shared/`

Not a feature, but worth noting: `command-palette` (Ctrl/Cmd+K), `setup-wizard` (first-run guidance), `terminal-workspace` (dockable terminal host), `whats-new-modal`, `toast-container`, `metric-bar`, `monaco-editor`, `variable-input-modal`.

## Related pages

- [[frontend-overview]]
- [[angular-state]]
- [[backend-service]]
- [[dual-path-routing]]
- [[terminal-subsystem]]
- [[file-browser]]
