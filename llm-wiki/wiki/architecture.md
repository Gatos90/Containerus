# Architecture

**Summary**: Containerus is an Angular frontend that can either talk to an in-process Tauri backend (local mode) or to a remote Axum server (backend mode). Shared Rust code lives in `containerus-core`, used by both the Tauri app and the server.

**Sources**: `Cargo.toml`, `CLAUDE.md`, `src/app/`, `src-tauri/src/`, `crates/`.

**Last updated**: 2026-04-16

**Parent**: [[containerus]]
**Children**: [[dual-mode-operation]], [[tech-stack]], [[crate-src-tauri]], [[crate-containerus-core]], [[crate-containerus-server]], [[pattern-three-database-pattern]], [[concept-event-streams]], [[flow-connect-system]], [[flow-agent-query]], [[flow-port-forward]]

---

## The two Cargo crates plus the shell

There are three Rust crates in the workspace (`Cargo.toml`):

1. **`src-tauri`** — the desktop app. Ships a Tauri binary that hosts the Angular webview and exposes ~94 Tauri commands for the frontend to invoke. See [[crate-src-tauri]].
2. **`crates/containerus-core`** — shared library. Models, SSH pool, executor trait, runtime command builder/parser, and the multi-provider AI abstraction. Used by both `src-tauri` and `containerus-server`. See [[crate-containerus-core]].
3. **`crates/containerus-server`** — Axum backend. REST + WebSocket, PostgreSQL via sqlx, JWT auth, RBAC, encrypted vault, Kubernetes. See [[crate-containerus-server]].

## Operating modes

The Angular frontend is mode-aware per system: each `ContainerSystem` is either owned by the local Tauri app or by a specific backend connection. See [[dual-mode-operation]] and [[dual-path-routing]].

```
                 ┌──────────────────────────────┐
                 │  Angular frontend (src/app)  │
                 │   signals + dual routing     │
                 └───────┬─────────────┬────────┘
                         │             │
          Tauri invoke   │             │   fetch / WebSocket
                         ▼             ▼
            ┌──────────────────┐   ┌───────────────────────┐
            │  src-tauri       │   │  containerus-server   │
            │  (local mode)    │   │  (backend mode)       │
            │  SQLite + OS     │   │  Axum + PostgreSQL    │
            │  keyring         │   │  + AES-GCM vault      │
            └─────┬────────────┘   └──────────┬────────────┘
                  │                           │
                  └─────── containerus-core ──┘
                     (SSH, executor, runtime,
                       AI providers, models)
```

## Layering

```
┌───────────────────────────────────────────────────────────┐
│                    Angular (src/app/)                     │
│  features/  state/  core/services/  shared/  layout/      │
├───────────────────────────────────────────────────────────┤
│                     Tauri shell                           │
│  commands/  agent/  state.rs  database.rs  keyring_store  │
├──────────────────── containerus-core ─────────────────────┤
│  models  ssh  executor  runtime  ai                       │
├──────────────────── containerus-server ───────────────────┤
│  api  auth  db  vault  connections  k8s  ws  audit        │
└───────────────────────────────────────────────────────────┘
```

## Key patterns

- **Dual-path service routing** — each Angular service checks `BackendService.getBackendForSystem(systemId)`. If a connection owns the system it routes over HTTP; otherwise it calls Tauri. The pattern runs through container, image, volume, network, file-browser, terminal, system-monitoring, and port-forward services. See [[dual-path-routing]].
- **Credential isolation** — desktop keeps secrets in the OS keyring in a single "vault" entry (`containerus.vault`/`default`) to minimize prompts. Server keeps them AES-GCM encrypted in PostgreSQL, key-derived with Argon2. See [[credentials-and-vault]].
- **SSH connection pooling** — `containerus-core::ssh::SSH_POOL` is a global `DashMap` of long-lived connections, reused across commands. The server adds a *shared vs per-user* tier on top. See [[ssh-connection-pooling]].
- **Signal-based state** — Angular state is pure `signal()`/`computed()`, no NgRx. Every resource type (containers, images, volumes, networks, terminals, etc.) has its own state class. See [[angular-state]].
- **Event-driven agent** — the AI agent streams `AgentEvent` values (Thinking, CommandProposed, CommandStarted, ConfirmationRequired, QueryCompleted, …) to the frontend through a Tokio mpsc channel bridged to Tauri emit. See [[ai-agent]].

## Related pages

- [[containerus]]
- [[dual-mode-operation]]
- [[tech-stack]]
- [[crate-src-tauri]]
- [[crate-containerus-core]]
- [[crate-containerus-server]]
