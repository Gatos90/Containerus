# Angular state

**Summary**: All frontend state is organized into ~32 classes under `src/app/state/`, each using Angular signals and computed values. `AppState` orchestrates the per-resource classes; specialized ones cover terminals, file browser, command templates, ports, toasts, changelog, updates.

**Sources**: `src/app/state/*.ts`.

**Last updated**: 2026-04-16

**Parent**: [[frontend-overview]]
**Siblings**: [[backend-service]], [[dual-path-routing]], [[frontend-features]]
**See also**: [[pattern-signals-and-state]], [[concept-block]]

---

## Orchestrator

`AppState` (`app.state.ts`, ~165 lines) coordinates the resource states (systems, containers, images, volumes, networks). It owns global initialization, error aggregation, top-line stats, and `initialize()` which the main layout invokes at boot.

## Resource states

| Class | Signals |
|---|---|
| `SystemState` | `systems`, `connectionStates` (per-system), `extendedInfo`, `monitoring`. Computed: `filteredSystems`, `connectedSystems`, overall stats. |
| `ContainerState` | `containers`, per-system loading, status/runtime/search filters, `selectedContainer`, stats. |
| `ImageState` | `images`, `pullProgress`, `buildJobs`. Filters: runtime, usage (in-use / unused / dangling), search. |
| `VolumeState` | `volumes`, `mountFilter` (mounted/orphaned). Computed: filtered list grouped by mount status. |
| `NetworkState` | `networks`, `connectionFilter` (active/empty), `driverFilter` (bridge / host / overlay / custom). |
| `ComposeState` | Compose *projects* derived from container labels. Aggregates services per project. Computed: `filteredProjects`, stats. |

Container state is the hub everything else cross-references (volumes pull `in-use` flags from it, networks from its networks settings, etc.).

## Terminal and files

| Class | Signals |
|---|---|
| `TerminalState` | `DockedTerminal[]`, `DockedFileBrowser[]`, `TerminalSlot[]`. Layout modes: `single`, `split-h`, `split-v`, `quad`. Tracks `dockHeightPercent` and which slot is active. |
| `FileBrowserState` | `currentPath`, `listing`, `selectedEntry`, `editorContent`, `editorDirty`. Back/forward navigation history. |
| `BlockState` | Tracks terminal blocks (command, AI prompt, AI response, AI command). Supports collapse / expand / focus. Computed: `blockList`, `commandBlocks`, `runningCommands`. |

## Other

| Class | Signals |
|---|---|
| `CommandTemplateState` | `templates`, filters (category, runtime, system), search, sort options. |
| `PortForwardState` | `forwards`, loading, error, computed `forwardsByContainer`, `activeForwards`. |
| `AiSettingsState` | Delegates to `AiService`: settings, `availableModels`, `isConnected`, `isConfigured`. |
| `ChangelogState` | `showModal`, `entries`. Parses markdown changelog, tracks `lastSeenVersion`. |
| `ToastState` | `toasts[]` with `success` / `error` / `warning` / `info` / `dismiss`. |
| `UpdateState` | `updateAvailable`, `updateVersion`, `downloading`. Uses Tauri updater plugin. |

## Conventions

- Every class constructor captures raw signals with `signal<T>(initial)` and exposes them via `asReadonly()`.
- Computed values are derived with `computed()` — used heavily for filtered lists and aggregates.
- Mutations go through typed methods on the class (`addContainer`, `setFilter`, …) — never direct signal writes from components.
- Where state depends on other state (compose on containers, volumes on containers), the dependency is injected and read inside `computed()`.
- No RxJS-style streams in state classes — only when interfacing with WebSockets.

## Related pages

- [[frontend-overview]]
- [[backend-service]]
- [[frontend-features]]
