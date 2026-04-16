# Build and dev

**Summary**: Commands to build, run, and test each piece of the stack.

**Sources**: `CLAUDE.md`, `package.json`, `Cargo.toml`, `crates/containerus-server/docker-compose.yml`.

**Last updated**: 2026-04-16

**Parent**: [[containerus]]
**Siblings**: [[tech-stack]], [[testing]]

---

## Frontend (Angular)

| Command | Effect |
|---|---|
| `pnpm install` | Install deps |
| `pnpm start` | Dev server on port **1420** |
| `pnpm build` | Production build (`dist/`) |
| `pnpm test` | Vitest, run once |
| `pnpm test:watch` | Vitest, watch mode |
| `pnpm test:coverage` | Vitest with v8 coverage |
| `pnpm test:e2e` | Playwright (headless) |
| `pnpm test:e2e:ui` | Playwright UI |
| `pnpm test:e2e:report` | Open the last Playwright report |

Dev port: **1420** (Angular), which Tauri also uses when running in dev.

## Desktop app (Tauri)

| Command | Effect |
|---|---|
| `pnpm tauri dev` | Angular dev server + Tauri desktop wrapper |
| `pnpm tauri build` | Production desktop build (platform-native installer in `src-tauri/target/release/bundle/`) |

## Server

From the repo root:

```bash
cargo run -p containerus-server        # requires crates/containerus-server/.env (see .env.example)
```

Or with Postgres via compose:

```bash
docker-compose -f crates/containerus-server/docker-compose.yml up
```

Key env vars (see [[crate-containerus-server]] for the full list):
- `DATABASE_URL` — Postgres connection string
- `JWT_SECRET` — min 32 bytes
- `ENCRYPTION_KEY` — min 32 bytes
- `ENCRYPTION_SALT` — min 16 bytes
- `BIND_ADDR` — default `0.0.0.0:8080`
- `CORS_ORIGINS` — default `http://localhost:1420`
- `ADMIN_EMAIL`, `ADMIN_PASSWORD` — optional bootstrap admin

## Rust

```bash
cargo build                                   # whole workspace
cargo build -p containerus                    # desktop app only
cargo build -p containerus-core               # shared library only
cargo build -p containerus-server             # server only
cargo test                                    # all tests
cargo test -p containerus-core                # scoped tests
cargo clippy --workspace --all-targets        # lint
cargo fmt                                     # format
```

Note: `src-tauri/Cargo.toml` is the package `containerus`; `cargo` commands from `src-tauri/` work against just the desktop crate. See [[crate-src-tauri]].

## sqlx offline mode

The server uses `sqlx::query!` macros, which need `DATABASE_URL` at compile time unless `SQLX_OFFLINE=true` is set and a prepared query cache exists (`.sqlx/`). Prepare with:

```bash
cargo sqlx prepare --workspace -- --bin containerus-server
```

## Logging

Tauri: `RUST_LOG=containerus=debug pnpm tauri dev`. Default filter is `containerus=debug,info` if `RUST_LOG` is unset.

Server: same pattern, or tune per-module via `RUST_LOG=containerus_server=info,sqlx=warn`.

## Development ports summary

| Service | Port |
|---|---|
| Angular dev server | 1420 |
| Server HTTP | 8080 |
| Postgres (compose) | 5432 |
| Ollama (if using) | 11434 |

## Related pages

- [[tech-stack]]
- [[testing]]
- [[crate-src-tauri]]
- [[crate-containerus-server]]
