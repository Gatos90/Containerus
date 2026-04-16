# Tech stack

**Summary**: The moving parts and notable versions. Angular 21 + Tailwind 4 on the frontend, Tauri 2 / Rust 2021 on the desktop shell, Axum + sqlx + PostgreSQL 17 on the server, and `russh` + `rig-core` for SSH and LLM plumbing.

**Sources**: `package.json`, `Cargo.toml`, `crates/containerus-core/Cargo.toml`, `crates/containerus-server/Cargo.toml`.

**Last updated**: 2026-04-16

**Parent**: [[containerus]]
**Siblings**: [[architecture]], [[dual-mode-operation]], [[build-and-dev]]

---

## Frontend

- **Angular 21.0.6** — standalone components, signals, new control flow (`@if`, `@for`)
- **TypeScript 5.9.3**
- **Tailwind CSS 4.1.18** via `@tailwindcss/postcss`
- **Vitest 4** + `@analogjs/vitest-angular` — fast, Vite-powered unit tests
- **Playwright 1.52** — end-to-end
- **xterm 6** plus addons (`fit`, `search`, `serialize`, `web-links`)
- **Monaco Editor 0.55** via `@monaco-editor/loader` — YAML, Dockerfile editing
- **Lucide Angular 0.562** — icon set
- **`marked`, `js-yaml`, `clsx`, `tailwind-merge`, `class-variance-authority`**
- Custom `provideZard()` — project-local UI primitives
- No `HttpClientModule`; `BackendService` uses native `fetch`

Tauri plugins bundled:
- `@tauri-apps/api` 2.x, plus `plugin-dialog`, `plugin-opener`, `plugin-os`, `plugin-process`, `plugin-updater`
- `tauri-plugin-keychain` 2.0.1

## Tauri desktop

- **Tauri 2** / Rust 2021 edition
- **rusqlite** for SQLite (singleton pattern `id INTEGER PRIMARY KEY CHECK (id = 1)` for settings tables)
- **`tracing` + `tracing_subscriber`** — structured logging (`containerus=debug,info` default)
- **`keyring`** — OS credential vault (single JSON blob under `containerus.vault`/`default`)
- **`tokio-util`, `parking_lot`, `dashmap`** — concurrency
- **`portable-pty`** (implied by terminal design) — local PTY terminals

## containerus-core (shared)

- **`russh` 0.57** + `russh-keys` 0.49 + `ssh-key` 0.6 — SSH client, ProxyJump, known_hosts
- **`tokio` 1** (full features) + `tokio-util`, `futures-util`
- **`reqwest` 0.12** — rustls TLS, streaming
- **`rig-core` 0.28** — agent/LLM framework used selectively for Ollama, OpenAI, Anthropic
- **`schemars` 1.2** — JSON schema for structured AI output
- **`thiserror`, `uuid`, `regex`, `once_cell`, `dirs`, `glob`, `base64`**
- **`vt100` 0.15** — terminal emulation / PTY screen state
- **`whoami`, `open`**

## containerus-server (backend)

- **Axum 0.8** (ws + macros) with `tower` 0.5 / `tower-http` 0.6 (cors, trace, catch-panic, body limit)
- **sqlx 0.8** (runtime-tokio, tls-rustls, postgres, uuid, chrono, json) — compile-time checked queries via `sqlx::query!`
- **PostgreSQL 17** (target), migrations in `crates/containerus-server/migrations/`
- **`jsonwebtoken` 9** — HS256 JWT access + refresh tokens
- **`argon2` 0.5** — password hashing (Argon2id, random salt)
- **`aes-gcm` 0.10** + `sha2`, `rand`, `base64` — encrypted vault
- **`kube` 0.98** + `k8s-openapi` 0.24 (v1_31) — Kubernetes integration
- **`dashmap` 6** — concurrent maps for connection tiers, permission cache, revocation cache, rate-limit buckets
- **`dotenvy` 0.15** — `.env` loading
- **`serde_yaml`, `validator`**

## Ops / dev

- **pnpm** for the JS/TS side, **cargo** workspace for Rust
- **docker-compose.yml** in `crates/containerus-server/` for Postgres and server together
- Dev ports: frontend dev server on `1420` (Tauri uses the same port), server default `0.0.0.0:8080`

## Related pages

- [[build-and-dev]]
- [[crate-src-tauri]]
- [[crate-containerus-core]]
- [[crate-containerus-server]]
