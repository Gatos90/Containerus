# Connecting to the Containerus Server

Drop-in guide for agents, developers, and the testing product (Containerus) on how to reach
the running `containerus-server` backend — locally, and over IP on the LAN.

Two things run under the name "Containerus":

1. **Desktop app** (`pnpm tauri dev`) — Angular UI at `http://127.0.0.1:1420` talking to the
   Rust backend over Tauri IPC. No TCP port to connect to from outside the app.
2. **`containerus-server`** — headless Axum backend (see `crates/containerus-server`). This
   is the thing you connect to from the testing product, from CI, or over the LAN.

Everything below is about `containerus-server`.

---

## 1. Local connect

### 1.1 Run it via docker compose (recommended)

```bash
cd crates/containerus-server
JWT_SECRET=$(openssl rand -hex 32) \
ENCRYPTION_KEY=$(openssl rand -hex 32) \
ADMIN_PASSWORD=changeme \
docker compose up
```

Listens on `http://127.0.0.1:8080`. Postgres runs in the `db` service and is not exposed.

### 1.2 Run it directly with cargo

```bash
# Requires a Postgres reachable via DATABASE_URL.
export DATABASE_URL=postgres://containerus:containerus@127.0.0.1:5432/containerus
export JWT_SECRET=$(openssl rand -hex 32)
export ENCRYPTION_KEY=$(openssl rand -hex 32)
export ENCRYPTION_SALT=$(openssl rand -hex 16)
export ADMIN_PASSWORD=changeme
cargo run -p containerus-server
```

Defaults: `BIND_ADDR=0.0.0.0:8080`, `CORS_ORIGINS=http://localhost:1420`.

### 1.3 Smoke test

```bash
curl http://127.0.0.1:8080/api/health
# → 200 {"database":"connected","status":"healthy","version":"0.1.0"}
```

### 1.4 Staging (already deployed)

The shared staging server is reachable without any local setup:

```bash
curl http://87.106.170.40.nip.io/api/health
```

See [`SHARED_DEPLOY_SERVER.md`](./SHARED_DEPLOY_SERVER.md) for the full operational guide.

---

## 2. LAN / IP connect

`containerus-server` defaults to `BIND_ADDR=0.0.0.0:8080`, so it already listens on every
interface. A client on the same network can hit it directly by IP — no config change needed
on the server host. If you have overridden `BIND_ADDR=127.0.0.1:8080`, flip it back to
`0.0.0.0:8080` (or a specific LAN interface) to allow remote clients.

### 2.1 Find the host's LAN IP

```bash
# macOS / Linux:
ipconfig getifaddr en0         # macOS, first Wi-Fi interface
hostname -I                    # Linux
# Windows:
ipconfig | findstr IPv4
```

Assume `192.0.2.10` for the examples below.

### 2.2 Reach it from another machine

```bash
curl http://192.0.2.10:8080/api/health
```

If the call hangs or is refused:

- Host firewall is blocking 8080 (see 4.3).
- Server is bound to loopback — check logs for `Server listening on 127.0.0.1:8080` vs
  `0.0.0.0:8080`.
- Client and server are on different VLANs / Wi-Fi isolation is on.

### 2.3 Full auth round-trip over IP

```bash
HOST=http://192.0.2.10:8080

# Register (admin is seeded on first boot with ADMIN_EMAIL / ADMIN_PASSWORD).
curl -s -X POST "$HOST/api/auth/register" \
  -H 'Content-Type: application/json' \
  -d '{"email":"tester@example.com","password":"correct-horse-battery","displayName":"Tester"}'

# Login → returns {accessToken, refreshToken}
TOKEN=$(curl -s -X POST "$HOST/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"tester@example.com","password":"correct-horse-battery"}' \
  | jq -r .accessToken)

# Call an authed endpoint.
curl -s "$HOST/api/company" -H "Authorization: Bearer $TOKEN"
```

### 2.4 WebSocket paths (terminal, k8s exec/watch, tunnel)

Same host + port, upgrade to `ws://`:

```
ws://192.0.2.10:8080/ws/terminal
ws://192.0.2.10:8080/ws/tunnel
ws://192.0.2.10:8080/ws/k8s/exec
ws://192.0.2.10:8080/ws/k8s/watch
```

Pass the JWT as the `Authorization: Bearer <token>` header on the upgrade request (or your
client's equivalent).

---

## 3. Auth, ports, CORS, TLS

| Concern | Default | Override |
| --- | --- | --- |
| Bind address | `0.0.0.0:8080` | `BIND_ADDR=<ip>:<port>` |
| Auth | JWT (HS256); 15 min access, 7 day refresh | `JWT_ACCESS_EXPIRY_SECS`, `JWT_REFRESH_EXPIRY_SECS` |
| CORS origins | `http://localhost:1420` (Tauri dev) | `CORS_ORIGINS=http://192.0.2.10:1420,https://app.example.com` — comma-separated, or `*` (not recommended) |
| TLS | None — plain HTTP | Terminate TLS in front (Traefik/Caddy/nginx). The staging box already does this via Traefik. |
| Body limit | Enforced by `RequestBodyLimitLayer` | — |
| Secrets encryption | AES-256 with `ENCRYPTION_KEY` + `ENCRYPTION_SALT` | Must not be rotated after first boot — doing so destroys vault data. |

Required env vars to boot: `DATABASE_URL`, `JWT_SECRET` (≥32 bytes), `ENCRYPTION_KEY`
(≥32 bytes), `ENCRYPTION_SALT` (≥16 bytes). On first boot, `ADMIN_EMAIL` + `ADMIN_PASSWORD`
seed the initial admin.

### 3.1 Security considerations for IP exposure

- **No TLS on 8080.** Tokens and passwords cross the wire in plaintext. Do not expose 8080
  to an untrusted network or the public internet without a TLS-terminating reverse proxy.
- **CORS defaults are browser-client-safe but restrictive.** A browser on a different
  origin than `http://localhost:1420` will be blocked until you add it to `CORS_ORIGINS`.
  `curl` / server-to-server clients are unaffected (CORS is a browser rule).
- **Scope of listener.** Binding to `0.0.0.0` exposes the server to every attached
  interface — Wi-Fi, Ethernet, VPN, and any Docker bridge. To restrict to one interface,
  set `BIND_ADDR` to its specific IP (e.g. `192.0.2.10:8080`).
- **Admin credentials.** The seeded `ADMIN_PASSWORD` is for first login only — rotate it
  through the UI immediately after bootstrap.
- **Rate limiting.** Auth endpoints are rate-limited. Expect `429 Too Many Requests` from a
  script that hammers `/api/auth/login`.

---

## 4. Troubleshooting

### 4.1 `connection refused`

- Server isn't running: `docker compose ps` or `lsof -i :8080`.
- Bound to loopback only: restart with `BIND_ADDR=0.0.0.0:8080`.

### 4.2 `200` locally but times out from another machine

Host firewall. Quick checks:

```bash
# macOS — built-in pf is usually off in dev, but:
sudo pfctl -s info

# Linux — ufw:
sudo ufw status
sudo ufw allow from 192.0.2.0/24 to any port 8080 proto tcp

# Windows — PowerShell as admin:
New-NetFirewallRule -DisplayName "Containerus 8080" -Direction Inbound \
  -Protocol TCP -LocalPort 8080 -Action Allow
```

### 4.3 `401 Unauthorized` on authed routes

- Token expired (15 min). Use the refresh token against `/api/auth/refresh`.
- `Authorization` header missing the `Bearer ` prefix.
- Admin was seeded with different credentials than you're sending.

### 4.4 Browser app can't reach the server (CORS preflight fails)

Add the browser's origin to `CORS_ORIGINS` and restart the server:

```bash
CORS_ORIGINS=http://localhost:1420,http://192.0.2.10:4200 cargo run -p containerus-server
```

### 4.5 Health says `degraded`

`database: disconnected` → Postgres is down or `DATABASE_URL` is wrong. For docker-compose,
`docker compose logs db` usually tells you why.

---

## 5. Quick reference — one-liner probes

```bash
# Local:
curl http://127.0.0.1:8080/api/health

# LAN:
curl http://<host-ip>:8080/api/health

# Staging:
curl http://87.106.170.40.nip.io/api/health

# Authed smoke test:
TOKEN=$(curl -s -X POST http://<host>/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<admin>","password":"<pw>"}' | jq -r .accessToken)
curl -s http://<host>/api/company -H "Authorization: Bearer $TOKEN"
```
