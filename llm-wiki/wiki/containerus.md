# Containerus

**Summary**: Cross-platform desktop application for managing Docker, Podman, and Apple Container Runtime, with built-in AI assistance and an optional multi-tenant backend server.

**Sources**: `README.md`, `Cargo.toml`, `package.json`, `CLAUDE.md`.

**Last updated**: 2026-04-16

---

## What it is

Containerus is a Tauri desktop app written in Angular (frontend) and Rust (backend) that gives you one interface for container workloads across three runtimes (Docker, Podman, Apple Container) and across multiple machines (local or over SSH). An AI terminal assistant sits inside the app and can translate natural-language queries into shell commands with safety-classified execution.

The same frontend can talk to a separate `containerus-server` (Axum + PostgreSQL) that adds multi-user auth, RBAC, project/environment scoping, Kubernetes cluster management, and audit logging. See [[architecture]] and [[dual-mode-operation]] for the two modes.

## Core capabilities

| Capability | Notes |
|---|---|
| Multi-runtime containers | Docker, Podman, Apple Container — unified command/parser in [[container-runtimes]] |
| Remote management | SSH (password / key / ProxyJump / ProxyCommand), see [[ssh-subsystem]] |
| Built-in terminal | PTY locally, SSH channels remotely, xterm.js on the frontend — [[terminal-subsystem]] |
| AI terminal assistant | Multi-provider, multi-turn agent with tool use and safety gates — [[ai-agent]] |
| Port forwarding | Direct-tcpip over SSH, plus a WebSocket-tunneled path for backend mode — [[port-forwarding]] |
| Live monitoring | Background metrics stream from SSH or local — [[monitoring]] |
| File browser | Shell-based (ls/cat/base64), works for systems, containers, and K8s pods — [[file-browser]] |
| Kubernetes | Cluster management via kube-rs on the server — [[kubernetes]] |
| Command templates | Saved runnable command snippets with variable prompts |
| Audit & RBAC (server) | See [[auth-and-rbac]] |

## Top-level layout

```
Containerus/
├── src/                     Angular app (frontend)
├── src-tauri/               Tauri desktop shell (Rust)
├── crates/
│   ├── containerus-core/    shared Rust library
│   └── containerus-server/  Axum backend server
├── e2e/                     Playwright tests
└── llm-wiki/                this wiki
```

Version at time of writing: `1.0.0-beta4` (`package.json`).

## Related pages

- [[architecture]]
- [[dual-mode-operation]]
- [[tech-stack]]
- [[build-and-dev]]
