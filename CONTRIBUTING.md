# Contributing to Containerus

Thank you for your interest in contributing! Containerus is a container management application built with Rust (Tauri + Axum) and Angular. We welcome bug reports, feature ideas, documentation improvements, and code contributions.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Ways to Contribute](#ways-to-contribute)
- [Setting Up the Dev Environment](#setting-up-the-dev-environment)
- [Branch and PR Workflow](#branch-and-pr-workflow)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Commit Message Format](#commit-message-format)
- [Issue Labels](#issue-labels)

---

## Code of Conduct

Be respectful and constructive. We follow the [Contributor Covenant v2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). Harassment, discrimination, or bad-faith behaviour will not be tolerated.

---

## Ways to Contribute

### Report a bug

Open a GitHub Issue and include:
- Containerus version (shown in the About dialog or `cargo metadata`)
- OS and version
- Steps to reproduce
- Expected vs. actual behaviour
- Relevant logs (Help → Show Logs, or `RUST_LOG=debug` server output)

### Request a feature

Open a GitHub Issue with the `enhancement` label. Describe the use case, not just the solution — this helps us understand the problem.

### Improve documentation

Documentation lives in:
- `README.md` — project overview
- `docs/ENGINEERING_STANDARDS.md` — code standards for contributors
- `CONTRIBUTING.md` — this file
- `CLAUDE.md` — guidance for AI coding assistants

Feel free to open a PR fixing typos, adding examples, or improving clarity.

### Submit code

See the workflow below.

---

## Setting Up the Dev Environment

### Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Rust | 1.78+ | Desktop app + server |
| Node.js | 20+ | Frontend toolchain |
| pnpm | 9+ | Package manager |
| Docker | 24+ | Server dev environment |

Install Rust via [rustup](https://rustup.rs). Install pnpm via `npm install -g pnpm`.

### Clone and install

```bash
git clone https://github.com/your-org/containerus.git
cd containerus
pnpm install
```

### Run the frontend dev server

```bash
pnpm start
# Angular dev server on http://localhost:1420
```

### Run the Tauri desktop app

```bash
pnpm tauri dev
# Starts Angular dev server + Tauri shell
```

### Run the backend server

```bash
# Start PostgreSQL
docker compose -f crates/containerus-server/docker-compose.yml up -d db

# Copy and fill in the env file
cp crates/containerus-server/.env.example crates/containerus-server/.env
# Edit .env — set JWT_SECRET, ENCRYPTION_KEY, ENCRYPTION_SALT

# Run the server
cargo run -p containerus-server
```

### Run tests

```bash
# Frontend (Vitest)
pnpm test

# All Rust tests
cargo test

# Specific crate
cargo test -p containerus-core
cargo test -p containerus-server
```

---

## Branch and PR Workflow

1. **Fork** the repository and create a branch off `main`:
   ```bash
   git checkout -b feature/my-feature
   # or: fix/issue-123-describe-the-fix
   ```

2. **Make your changes.** Keep commits focused — one logical change per commit.

3. **Test locally** before pushing:
   ```bash
   pnpm test          # frontend
   cargo test         # Rust
   cargo clippy       # lints
   cargo fmt --check  # formatting
   ```

4. **Open a Pull Request** against `main`. Fill in the PR template:
   - What changed and why
   - How to test it
   - Screenshots for UI changes

5. **Review**: at least one maintainer approval is required to merge. Address feedback in new commits (do not force-push during review).

6. **Merge**: maintainers use squash-merge for small PRs and merge-commit for larger feature branches.

---

## Coding Standards

Full standards are in `docs/ENGINEERING_STANDARDS.md`. Key rules:

### Rust

- **No `unwrap()` or `expect()` in application code.** Use `?` or explicit error handling. `unwrap` is only acceptable in tests and at startup for truly unrecoverable conditions.
- Library crates (`containerus-core`): use `thiserror` for typed errors.
- Application crates (`src-tauri`, `containerus-server`): use `anyhow` for error context.
- Run `cargo clippy -- -D warnings` and fix all warnings before opening a PR.
- Format with `cargo fmt` (checked in CI).

### TypeScript / Angular

- Use **Angular signals** for state — no RxJS `BehaviorSubject` for new code.
- Use `@if` / `@for` control flow — not `*ngIf` / `*ngFor`.
- Standalone components only — no NgModules for new code.
- Path alias `@/*` maps to `src/app/*`.
- Follow the dual-path service pattern: check `BackendService.isBackendSystem()` before deciding between Tauri invoke and HTTP.

### Security

- Never log or return credentials (passwords, private keys, API keys) to clients.
- Credentials stored in the server must go through the vault (`ServerVault`), never raw SQL.
- Validate and sanitize all user-supplied input at API boundaries.
- CORS origins must be explicit in production — never `*`.

---

## Testing

### Frontend

Tests use [Vitest](https://vitest.dev). Test files live next to the component they test (`*.spec.ts`).

```bash
pnpm test           # run once
pnpm test:watch     # watch mode
pnpm test:coverage  # coverage report
```

### Rust

Unit tests live in `#[cfg(test)]` blocks at the bottom of each file. Integration tests go in the `tests/` directory of the relevant crate.

```bash
cargo test                           # all tests
cargo test -p containerus-core       # one crate
cargo test -- --nocapture            # show println output
```

> **Note:** Two tests in `src-tauri` are known to fail on `main` (pre-existing issues unrelated to new contributions):
> - `agent::providers::tests::test_preamble_not_empty`
> - `agent::safety::classifier::tests::test_dangerous_commands`

---

## Commit Message Format

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body]

[optional footer]
```

**Types:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `perf`

**Examples:**
```
feat(server): add trust-host-key endpoint for key rotation
fix(frontend): prevent duplicate system names in the list
docs: add OSS contribution guidelines
chore(deps): bump russh to 0.47
```

Keep the subject line under 72 characters. Use the body to explain *why*, not *what* (the diff shows what).

---

## Issue Labels

| Label | Meaning |
|---|---|
| `bug` | Confirmed defect |
| `enhancement` | New feature or improvement |
| `good first issue` | Suitable for first-time contributors |
| `help wanted` | Extra attention needed, open for community |
| `documentation` | Docs-only change |
| `security` | Security-sensitive — coordinate with maintainers before disclosing |
| `wontfix` | Will not be addressed |

---

## Questions?

Open a GitHub Discussion or join the community Discord (link in README). For security issues, email the maintainers directly rather than opening a public issue.
