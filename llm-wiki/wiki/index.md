# Wiki Index

**Summary**: Table of contents for the Containerus wiki — a knowledge base of the codebase, architecture, and subsystems.

**Sources**: Codebase at `/Users/kevin/Projects/Containerus/` (commit around `7222293`).

**Last updated**: 2026-04-16

---

## Project overview

- [[containerus]] — what Containerus is, features, high-level summary
- [[architecture]] — the two-mode architecture, layered diagram, component boundaries
- [[dual-mode-operation]] — local (Tauri) vs backend (server) modes side-by-side
- [[tech-stack]] — languages, frameworks, and key library versions

## Cargo workspace

- [[crate-src-tauri]] — the Tauri desktop app
- [[crate-containerus-core]] — shared Rust library (models, SSH, executor, runtime, AI)
- [[crate-containerus-server]] — Axum backend server (PostgreSQL, JWT, RBAC, K8s)

## Frontend (Angular)

- [[frontend-overview]] — app structure, routes, features, layout
- [[angular-state]] — signal-based state classes
- [[backend-service]] — multi-connection hub, token refresh, request routing
- [[dual-path-routing]] — frontend pattern: Tauri vs HTTP per system
- [[frontend-features]] — feature catalogue (containers, images, terminal, warp-terminal, etc.)

## Subsystems

- [[ssh-subsystem]] — russh client, ProxyJump, ProxyCommand, known_hosts
- [[ssh-connection-pooling]] — global SSH pool and server dual-tier model
- [[container-runtimes]] — Docker, Podman, Apple Container: builder and parser
- [[terminal-subsystem]] — local PTY vs SSH channel, xterm.js, dock layouts
- [[port-forwarding]] — SSH direct-tcpip plus WebSocket-tunneled variant
- [[ai-providers]] — multi-provider AI abstraction (8 providers)
- [[ai-agent]] — agentic loop, tool use, conversation memory
- [[agent-safety]] — danger classifier, confirmation flow
- [[credentials-and-vault]] — OS keyring vs AES-GCM server vault
- [[auth-and-rbac]] — JWT access/refresh, Argon2 passwords, permission cache
- [[kubernetes]] — server-side kube-rs integration
- [[monitoring]] — live metrics collection and streaming
- [[database-schema]] — SQLite (desktop) and PostgreSQL (server) schemas
- [[file-browser]] — shell-based browsing for containers and pods

## Domain models

- [[domain-models]] — Container, System, Volume, Network, Image (shared via containerus-core)
- [[error-model]] — ContainerError variants and retry semantics

## Operational

- [[build-and-dev]] — commands to build, test, and run
- [[testing]] — Vitest, Playwright, Rust tests, CONA-8 coverage
