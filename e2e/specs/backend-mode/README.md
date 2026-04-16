# Backend-mode E2E (CON-39)

End-to-end coverage for the `containerus-server` surface:

- `auth.spec.ts` — register, login, refresh, logout over real HTTP.
- `systems.spec.ts` — REST plumbing through the shared SSH tier.
- `terminal-pty.spec.ts` — WebSocket PTY through the per-user SSH tier.
- `tunnel.spec.ts` — WebSocket port-forward handshake + SSRF guard.
- `audit-log.spec.ts` — `/api/projects/:id/audit` feed entries for mutations.

## Running

```
BACKEND_MODE=1 pnpm test:e2e:backend
```

Requires Docker. The suite:

1. `globalSetup` spins up the compose stack in `e2e/fixtures/backend-mode/docker-compose.yml`
   (`postgres` + `containerus-server` + disposable `linuxserver/openssh-server`) and waits
   for `/api/health`.
2. Each spec registers a fresh first-user and builds its own project/environment/system.
3. `globalTeardown` removes containers and volumes (skip with `BACKEND_MODE_KEEP=1`).

## Known limitations (tracked follow-ups)

- **K8s dashboard coverage** is not in this suite — kind/k3d inside CI is its own project;
  file a follow-up before wiring this into CI.
- **Tunnel payload round-trip** is blocked by the CON-46 SSRF guard until a non-private
  destination (or the CON-54 per-system allowlist) is available on Ai-Test. The spec
  currently asserts the guard fires on `127.0.0.1` and `169.254.169.254`; the skipped
  `bytes round-trip` test is the placeholder.
- **Container listing** uses the shared SSH tier but the sidecar SSH target has no
  `docker` binary. Spec asserts the server surfaces the runtime failure rather than
  hanging. Full runtime coverage already lives in `e2e/specs/real-docker/`.
