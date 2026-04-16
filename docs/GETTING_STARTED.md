# Getting Started with Containerus Development

Quick-start guide for contributors. Get the project building and running locally in under 10 minutes.

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 20+ | [nodejs.org](https://nodejs.org) |
| pnpm | 9+ | `npm i -g pnpm` |
| Rust | 1.80+ (stable) | [rustup.rs](https://rustup.rs) |
| Docker or Podman | any | [docker.com](https://www.docker.com) / [podman.io](https://podman.io) |

macOS only: Apple Containers requires macOS 15+ and a compatible Apple silicon Mac.

---

## Clone & Install

```bash
git clone https://github.com/Gatos90/Containerus.git
cd Containerus
pnpm install
```

---

## Run in Development

```bash
pnpm tauri dev
```

This starts the Angular dev server (port 1420) and launches the Tauri window. Hot-reload is enabled for the frontend; Rust changes trigger a recompile.

---

## Branch Policy

All agent-driven and contributor code work must happen on **`Ai-Test`** or a worktree branched from it. Do not push directly to `main`.

```bash
git checkout Ai-Test
# or, for parallel work:
git worktree add ../my-feature-branch -b agent/me/my-feature Ai-Test
```

---

## Project Layout

```
Containerus/
├── src/                    # Angular frontend (TypeScript)
│   └── app/
│       ├── core/           # Services, models, state
│       ├── features/       # Feature modules (containers, images, …)
│       └── shared/         # Shared components, directives, utils
├── src-tauri/              # Tauri shell + Rust commands
│   └── src/
│       └── commands/       # Tauri IPC command handlers
├── crates/
│   ├── containerus-core/   # Shared Rust library (AI providers, SSH, runtime)
│   └── containerus-server/ # Headless server mode
└── docs/
    ├── openapi.yaml        # IPC command reference (OpenAPI 3.1)
    └── ENGINEERING_STANDARDS.md
```

---

## Running Tests

```bash
# Angular unit tests
pnpm test

# E2E tests (requires a running container runtime)
pnpm e2e

# Rust unit tests
cargo test --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path crates/containerus-core/Cargo.toml
```

---

## Build for Production

```bash
pnpm tauri build
```

Artifacts are placed in `src-tauri/target/release/bundle/`.

---

## Contributor Checklist

- [ ] Fork the repo and create a branch from `Ai-Test`
- [ ] Run `pnpm install` and verify `pnpm tauri dev` starts cleanly
- [ ] Write or update unit tests for any logic changes
- [ ] Verify accessibility: modals must have `role="dialog"`, `aria-modal`, `aria-labelledby`, and `cdkTrapFocus`
- [ ] Run `pnpm test` and ensure all tests pass before opening a PR
- [ ] Reference the relevant issue identifier in your PR description

---

## API Reference

The full Tauri IPC command reference is in [`docs/openapi.yaml`](./openapi.yaml). It covers all ~80 commands across containers, images, volumes, networks, compose, AI, SSH, terminal, and more.

---

## Need Help?

Open an issue or start a discussion on GitHub.
