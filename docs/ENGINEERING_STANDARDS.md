# Engineering Standards — Containerus

This document defines the engineering standards all contributors must follow.
It is the authoritative reference for code reviews and PR gates.

---

## Error Handling (Rust)

### Rule: No `unwrap()` or `expect()` outside of tests and startup

All fallible operations in application code must propagate errors using `?` or handle them explicitly.
`unwrap()` and `expect()` are only permitted in:
- unit/integration tests (`#[cfg(test)]` blocks or `tests/` directories)
- startup initialization where a failure is truly unrecoverable (e.g. `bind_addr.parse()` at boot)

### Patterns

**Library crates (`containerus-core`)** — define typed errors with `thiserror`:

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SshError {
    #[error("connection refused: {0}")]
    ConnectionRefused(String),
    #[error("authentication failed for user {user}")]
    AuthFailed { user: String },
    #[error(transparent)]
    Io(#[from] std::io::Error),
}
```

**Application crates (`src-tauri`, `containerus-server`)** — use `anyhow` for ad-hoc error context:

```rust
use anyhow::{Context, Result};

pub async fn fetch_containers(system_id: &str) -> Result<Vec<Container>> {
    let conn = pool.get(system_id)
        .context("failed to get SSH connection")?;
    let output = conn.execute("docker ps --format json")
        .await
        .context("docker ps failed")?;
    parse_containers(&output).context("failed to parse container list")
}
```

**Tauri command handlers** — return `Result<T, String>` (Tauri requirement) by mapping at the boundary:

```rust
#[tauri::command]
pub async fn list_containers(system_id: String) -> Result<Vec<Container>, String> {
    fetch_containers(&system_id)
        .await
        .map_err(|e| e.to_string())
}
```

### What to fix in the existing codebase

390+ `unwrap()`/`panic!()` calls exist today. Priority order for remediation:
1. SSH connection paths (crash risk under load)
2. Database access in hot paths
3. JSON serialization (use `serde_json::to_string` + `?` instead of `unwrap()`)
4. Everything else incrementally

Assigned to: RustEngineer (see CONA-7)

---

## Testing Gates

All PRs must satisfy these gates before merge. Automated CI enforcement is planned
(see CONA-9 for DevOps pipeline).

### Backend (Rust)

| Gate | Requirement |
|------|-------------|
| Unit tests | All new public functions in `containerus-core` must have unit tests |
| Integration tests | All new API endpoints in `containerus-server` must have integration tests using a real test database |
| No regressions | `cargo test` must pass — no test may be deleted or skipped to achieve this |
| Error paths | Happy path + at least one error path tested per function |

Target: 80% line coverage for `containerus-server` and `containerus-core` (current: ~0%).

### Frontend (Angular)

| Gate | Requirement |
|------|-------------|
| Component tests | All new components must have Vitest unit tests using Angular's `TestBed` |
| Service tests | All new services must have tests covering success and error branches |
| No regressions | `pnpm test` must pass |
| Coverage floor | PRs must not decrease coverage below the current baseline |

Target: 80% overall, 60% per-component (current: 32% overall, 0% components).

Assigned to: QAEngineer (see CONA-8)

---

## CORS Configuration

- Default: `http://localhost:1420` (Angular dev server)
- Production: set `CORS_ORIGINS` to explicit origin(s), comma-separated
- `*` is permitted **only** for local development and logs a warning at startup
- Allowed methods: `GET, POST, PUT, PATCH, DELETE, OPTIONS`
- Allowed headers: `Authorization, Content-Type`

Never ship a production deployment with `CORS_ORIGINS=*`.

---

## Code Style

- Follow `rustfmt` defaults (enforced by `cargo fmt --check` in CI)
- Clippy must pass with no warnings: `cargo clippy -- -D warnings`
- Angular: follow existing signal-based patterns; no NgRx; use `@if`/`@for` control flow

---

## Pull Request Requirements

1. PR description must explain **why**, not just what
2. Linked to a Paperclip issue (include identifier, e.g. `CONA-12`)
3. All CI checks green before requesting review
4. At least one approval from a peer engineer
5. No merge if test coverage decreases (tracked by QA in CONA-8)
