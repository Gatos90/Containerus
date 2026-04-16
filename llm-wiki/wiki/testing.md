# Testing

**Summary**: Vitest for Angular unit tests, Playwright for end-to-end, `cargo test` for the Rust crates. The frontend suite as of CONA-8 covers 93 spec files (~2,333 tests, 80.95% statement coverage).

**Sources**: `vitest.config.ts`, `playwright.config.ts`, `src/test-setup.ts`, `e2e/`.

**Last updated**: 2026-04-16

---

## Frontend unit tests — Vitest

- **Runner**: Vitest 4 via `@analogjs/vitest-angular`.
- **Setup**: `src/test-setup.ts` imports `@angular/compiler` so Angular's JIT path works in Vitest.
- **Config**: `vitest.config.ts` has `setupFiles: ['./src/test-setup.ts']` plus jsdom environment.
- **Pattern**: `Injector.create()` + `runInInjectionContext()` for DI-in-test (see `memory/feedback_angular_testing.md`).
- **Coverage**: `pnpm test:coverage` uses `@vitest/coverage-v8`; output in `coverage/`.

At the time of writing (CONA-8, branch `agent/qaengineer/CONA-8`):
- 2,333 tests across 93 spec files
- 80.95% statement coverage

## End-to-end — Playwright

- `pnpm test:e2e` for headless runs.
- `pnpm test:e2e:ui` for the UI runner.
- Spec files under `e2e/`.
- Reports in `playwright-report/`; results in `test-results/`.

## Rust tests

- `cargo test` — everything.
- `cargo test -p containerus-core` — scoped.
- `cargo test -p containerus-server` — scoped; requires `DATABASE_URL` (sqlx compile-time checks) unless `SQLX_OFFLINE=true`.
- `cargo test -p containerus` — the desktop app crate.

Pre-existing test failures tracked in project memory (not considered active bugs):
- `agent::providers::tests::test_preamble_not_empty` — asserts literal substring `"execute_shell"`
- `agent::safety::classifier::tests::test_dangerous_commands` — edge cases around `chmod 777`

## What's covered well

- State classes (`src/app/state/*`) — near-full coverage, exercising computed signals across multiple input combinations.
- Services — especially `BackendService`, where token-refresh serialization, health monitoring, and 401 handling have dedicated suites.
- Rust parser functions (`runtime/parser.rs`) — golden tests with captured Docker/Podman/Apple output.
- SSH known-hosts verification — all four `HostKeyCheckResult` outcomes have unit tests.

## What's covered less well

- UI components beyond smoke tests (rendered structure, event wiring) — intentionally relies on Playwright for real behavior.
- WebSocket paths on the server — scaffolding only; full integration coverage awaits CON-### tickets.
- The Warp terminal view — most of its behavior is interactive and only covered by Playwright.

## Test database (server)

Integration tests that hit PostgreSQL use a per-test transaction that rolls back at teardown. Schema comes from the same migrations that run in production. See `crates/containerus-server/tests/` for fixtures.

## Adding a test

- Angular spec — colocate as `*.spec.ts` next to the source file.
- Rust — `#[cfg(test)] mod tests { ... }` inside the module, or integration tests under `tests/` for the server.
- Playwright — new `.spec.ts` under `e2e/` plus a fixture if the scenario needs backend state.

## Related pages

- [[build-and-dev]]
- [[frontend-overview]]
- [[crate-src-tauri]]
