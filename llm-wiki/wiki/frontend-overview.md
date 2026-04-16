# Frontend overview

**Summary**: Angular 21 single-page app. Signal-based state, 13 feature folders, 32 state classes, 39 core services, lazy-loaded routes. All services use `providedIn: 'root'` — no HttpClient (native fetch), no NgRx, no eager feature bundles.

**Sources**: `src/app/` tree.

**Last updated**: 2026-04-16

---

## Layout

```
src/app/
├── app.component.ts          root standalone component
├── app.config.ts             providers
├── app.routes.ts             all routes, lazy-loaded
├── core/                     services (not UI)
│   └── services/             39 files
├── state/                    signal-based state classes (32 files)
├── shared/                   reusable UI components
├── layout/                   main-layout, sidebar
└── features/                 13 feature folders
```

## `app.config.ts`

```ts
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideZard(),
  ],
};
```

No explicit service providers — every service is `providedIn: 'root'`. `HttpClient` is not registered; `BackendService` uses `fetch` directly. `provideZard()` comes from a project-local UI kit.

## Routes — `app.routes.ts`

All routes are lazy-loaded with dynamic imports. Default redirects to `/containers`.

| Path | Component | Notes |
|---|---|---|
| `/containers` | `ContainerListComponent` | default redirect target |
| `/images` | `ImageListComponent` | |
| `/volumes` | `VolumeListComponent` | |
| `/networks` | `NetworkListComponent` | |
| `/systems` | `SystemListComponent` | |
| `/commands` | `CommandListComponent` | |
| `/files`, `/files/:systemId`, `/files/:systemId/:containerId` | `FileBrowserViewComponent` | |
| `/terminal`, `/terminal/:systemId`, `/terminal/:systemId/:containerId` | `TerminalViewComponent` | |
| `/warp-terminal` | `WarpTerminalViewComponent` | AI-enhanced terminal |
| `/settings` | `SettingsPageComponent` | |
| `/compose` | `ComposeListComponent` | |
| `/backends` | `BackendViewComponent` | connections list |
| `/backends/:connectionId` | `ProjectListComponent` | |
| `/backends/:connectionId/projects/:projectId` | `ProjectDetailComponent` | |
| `/backends/:connectionId/projects/:projectId/environments/:envId` | `EnvironmentDetailComponent` | |
| `/backend-connect` | `BackendConnectComponent` | |
| `/login` | `LoginComponent` | |
| `/k8s` | `K8sDashboardComponent` | |
| `/audit-log` | `AuditLogComponent` | |
| `/audit/project` | `ProjectAuditComponent` | |

No router guards are declared — authentication is enforced at feature level by consulting `BackendService` state.

## `layout/`

- `main-layout/main-layout.component.ts` — composes `SidebarComponent` + `RouterOutlet` + `TerminalWorkspaceComponent` (the dockable terminal at the bottom). Has a resizable vertical split. On init: `appState.initialize()` and `aiSettingsState.init()`, then non-blocking checks for app update and changelog. Listens to `NavigationEnd` to hide the docked workspace on terminal routes.
- `sidebar/` — navigation, system selector, per-connection status badges.

## Features

See [[frontend-features]] for what's inside each. Folder list:

`backend`, `containers`, `images`, `volumes`, `networks`, `systems`, `terminal`, `warp-terminal`, `file-browser`, `commands`, `compose-projects`, `settings`.

## Core services

See [[backend-service]] for the backend hub and [[dual-path-routing]] for the local/HTTP split. Notable services:

- Resource services (dual-path): `container.service`, `image.service`, `volume.service`, `network.service`, `system.service`, `terminal.service`, `file-browser.service`, `system-monitoring.service`.
- Local-only: `port-forward.service`, `command-template.service`, `compose.service`, `keychain.service`, `tauri.service`.
- Backend-only: `backend.service`, `backend-auth.service`, `backend-k8s.service`, `backend-audit.service`, `k8s-watch.service`.
- Utility: `ai.service`, `clipboard.service`, `error-mapping.service`, `markdown.service`.

## Shared components

`command-palette` (Ctrl/Cmd+K global nav), `detail-field`, `detail-section`, `empty-state`, `first-success`, `help-tooltip`, `metric-bar`, `monaco-editor`, `setup-wizard`, `terminal-workspace`, `toast-container`, `variable-input-modal`, `whats-new-modal`. All OnPush, all standalone.

## Patterns

- **`ChangeDetectionStrategy.OnPush` everywhere.** Signals are what re-render.
- **`asReadonly()`** on state class signals — components cannot mutate state directly.
- **Signals > RxJS** for state; RxJS still appears for HTTP retries and event streams.
- **Computed derivations** over explicit subscription graphs (filtered lists, stats, etc.).
- **Error mapping** via `ErrorMappingService` before anything hits a toast.
- **WebSocket URLs** always built through `BackendService` (`getTerminalWsUrl`, `getTunnelWsUrl`, `getK8sWatchWsUrl`, `getK8sExecWsUrl`), never constructed by callers.

## Related pages

- [[angular-state]]
- [[backend-service]]
- [[dual-path-routing]]
- [[frontend-features]]
