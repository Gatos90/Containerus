# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

### Frontend (Angular)
- `pnpm install` — install dependencies
- `pnpm start` — dev server on port 1420
- `pnpm build` — production build
- `pnpm test` — run tests once (Vitest)
- `pnpm test:watch` — tests in watch mode
- `pnpm test:coverage` — tests with coverage

### Desktop App (Tauri)
- `pnpm tauri dev` — run Angular dev server + Tauri desktop wrapper
- `pnpm tauri build` — production desktop build

### Backend Server
- `cargo run -p containerus-server` — run server (requires .env, see `crates/containerus-server/.env.example`)
- `docker-compose -f crates/containerus-server/docker-compose.yml up` — run with PostgreSQL

### Rust
- `cargo build -p containerus` — build desktop app
- `cargo build -p containerus-core` — build shared library
- `cargo build -p containerus-server` — build server
- `cargo test` — run all Rust tests
- `cargo test -p <crate>` — run tests for a specific crate

## Architecture

Containerus is a container management app (Docker, Podman, Apple Container Runtime) with an AI assistant. It operates in two modes:

1. **Local mode**: Angular frontend → Tauri commands → local shell or SSH to remote hosts
2. **Backend mode**: Angular frontend → HTTP/WebSocket to containerus-server → SSH to remote hosts

### Workspace Layout (Cargo)

| Crate | Purpose |
|---|---|
| `src-tauri` | Tauri desktop app — command handlers, state, database, keyring, PTY terminals |
| `crates/containerus-core` | Shared library — models, SSH pool, executor, runtime parser, AI providers |
| `crates/containerus-server` | Backend server (Axum) — REST API, JWT auth, RBAC, PostgreSQL, K8s, WebSocket terminals |

### Frontend (`src/app/`)

- **State management**: Angular signals + computed values in `src/app/state/`. Each resource type (containers, images, volumes, networks, terminals) has its own state class with signals for data, loading, and error states.
- **Services** (`src/app/core/services/`): Each service uses dual-path routing — checks `BackendService.isBackendSystem(systemId)` to decide between Tauri invoke (local) or HTTP request (backend).
- **BackendService** (`src/app/core/services/backend.service.ts`): Manages multiple simultaneous backend connections, token refresh, system ownership mapping, and session persistence.
- **Path alias**: `@/*` maps to `src/app/*`

### Tauri Backend (`src-tauri/src/`)

- `lib.rs` — app initialization: SQLite DB, keyring credential loading, command registration
- `state.rs` — `AppState` struct with Mutex-wrapped fields for DB, systems, connections, credential caches
- `commands/` — Tauri command handlers (system, container, terminal, port_forward, ai, agent)
- `database.rs` — SQLite persistence for systems and templates
- `keyring_store.rs` — OS keyring for secrets (SSH keys, AI API keys)

### Shared Core (`crates/containerus-core/src/`)

- `models/` — domain types shared across desktop and server
- `ssh/` — global `SshConnectionPool` with jump host support, known_hosts verification, port forwarding
- `executor/` — `CommandExecutor` trait with local (subprocess) and remote (SSH) implementations
- `runtime/` — Docker/Podman command builder and output parser
- `ai/` — multi-provider LLM abstraction (OpenAI, Anthropic, Ollama, Azure, Gemini, Groq, DeepSeek, Mistral)

### Server (`crates/containerus-server/src/`)

- Axum web framework with Tower middleware
- `api/` — REST endpoints under `/api/` (auth, projects, environments, systems, containers, roles, clusters)
- `auth/` — JWT tokens + password hashing + permission middleware
- `db/` — PostgreSQL via sqlx with migration files in `migrations/`
- `ws/` — WebSocket handlers for terminal PTY proxy and port forward tunnels
- `k8s/` — Kubernetes cluster management via kube-rs
- `vault/` — AES-GCM encrypted credential storage

## Key Patterns

- **Dual-path service routing**: Frontend services check system ownership to route through Tauri or backend HTTP. This pattern appears in container, image, volume, network, file-browser, terminal, system-monitoring, and port-forward services.
- **Credential isolation**: Desktop uses OS keyring (migrated from SQLite on startup); server uses AES-GCM encrypted vault in PostgreSQL.
- **SSH connection pooling**: Global `SSH_POOL` in containerus-core reuses connections across commands, with jump host chain support.
- **Server SSH connection tiers** (`connections/mod.rs`): The backend server uses a dual-tier SSH model:
  - *Shared connections* (one per system): Used for API queries that return identical data for all users — containers, images, volumes, networks, system info, metrics. Methods: `connect_shared()`, `execute_shared()`.
  - *Per-user connections* (one per user per system): Used for operations needing user isolation — terminal PTY sessions, port-forward tunnels, and file operations. Methods: `connect()`, `execute()`, `get_client()`.
  - Files stay per-user because different users may edit different files simultaneously.
- **AI provider factory**: `ai::create_provider()` returns `Arc<dyn AiProvider>` based on user settings; all providers implement streaming and structured output.

## Tech Stack

- **Frontend**: Angular 21, TypeScript 5.9, Tailwind CSS 4, xterm.js 6, Vitest
- **Desktop**: Tauri 2, Rust 2021 edition
- **Server**: Axum, sqlx, PostgreSQL 17, kube-rs
- **Shared**: tokio, russh, rig-core, serde
