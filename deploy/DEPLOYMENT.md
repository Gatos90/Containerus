# Containerus Server — Production Deployment Guide

> **Staging canonical URL**: <http://87.106.170.40.nip.io/> exposes the **backend API only** under `/api/*`. The Containerus desktop app runs on each user's machine and connects to this URL — we do not deploy the Angular web UI in staging. See [`docs/SHARED_DEPLOY_SERVER.md`](../docs/SHARED_DEPLOY_SERVER.md) for day-to-day deploy operations; this document covers bootstrapping a new Helm/Compose environment from scratch.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Configuration Reference](#configuration-reference)
3. [Option A: Docker Compose (Self-Hosted)](#option-a-docker-compose-self-hosted)
4. [Option B: Kubernetes / Helm](#option-b-kubernetes--helm)
5. [Monitoring](#monitoring)
6. [Database Operations](#database-operations)
7. [Upgrading](#upgrading)
8. [Security Hardening](#security-hardening)
9. [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Docker | ≥ 24 | Container runtime |
| Docker Compose | ≥ 2.20 | Self-hosted deployment |
| Helm | ≥ 3.14 | Kubernetes deployment |
| kubectl | ≥ 1.28 | Kubernetes management |
| openssl | any | Generating secrets |
| psql | ≥ 15 | Database operations |

---

## Configuration Reference

All secrets must be unique per deployment. Generate them with:

```bash
openssl rand -base64 32   # for JWT_SECRET and ENCRYPTION_KEY
openssl rand -base64 16   # for ENCRYPTION_SALT
```

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | yes | `postgres://user:pass@host:5432/db` |
| `JWT_SECRET` | yes | Signs access/refresh tokens — never share |
| `ENCRYPTION_KEY` | yes | Encrypts stored SSH keys and kubeconfigs |
| `ENCRYPTION_SALT` | yes | Argon2 KDF salt — **do not change after initial setup** |
| `ADMIN_EMAIL` | yes | Initial admin user email |
| `ADMIN_PASSWORD` | yes | Initial admin user password |
| `BIND_ADDR` | no | Server bind address (default: `0.0.0.0:8080`) |
| `CORS_ORIGINS` | no | Comma-separated allowed origins |
| `RUST_LOG` | no | Log level (default: `containerus_server=info,tower_http=info`) |

> **Warning:** `ENCRYPTION_SALT` must remain stable after first run. Changing it invalidates all stored credentials.

---

## Option A: Docker Compose (Self-Hosted)

### 1. Create environment file

```bash
cd deploy/
cp .env.example .env   # or create from scratch
```

Edit `.env`:

```bash
DB_PASSWORD=$(openssl rand -base64 32)
JWT_SECRET=$(openssl rand -base64 32)
ENCRYPTION_KEY=$(openssl rand -base64 32)
ENCRYPTION_SALT=$(openssl rand -base64 16)
ADMIN_EMAIL=admin@yourcompany.com
ADMIN_PASSWORD=<strong-password>
GF_ADMIN_PASSWORD=<grafana-admin-password>
CORS_ORIGINS=https://your-frontend.example.com,tauri://localhost
```

### 2. Start the stack

```bash
docker compose -f deploy/docker-compose.prod.yml up -d
```

This starts:
- `app` — containerus-server on port 8080
- `db` — PostgreSQL 17 with persistent volume
- `prometheus` — metrics collection (port 9090, localhost-only)
- `grafana` — dashboards (port 3000, localhost-only)
- `alertmanager` — alert routing (port 9093, localhost-only)
- `postgres_exporter` — PostgreSQL metrics for Prometheus

### 3. Verify

```bash
curl http://localhost:8080/api/health
# {"status":"ok","database":"ok"}
```

### 4. Configure TLS (recommended)

Place a reverse proxy (nginx, Caddy, Traefik) in front of the app container on port 443.

Example Caddy config:
```
api.containerus.example.com {
  reverse_proxy localhost:8080
}
```

---

## Option B: Kubernetes / Helm

### 1. Add the bitnami repo (for PostgreSQL subchart)

```bash
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update
```

### 2. Generate secrets

```bash
export JWT_SECRET=$(openssl rand -base64 32)
export ENCRYPTION_KEY=$(openssl rand -base64 32)
export ENCRYPTION_SALT=$(openssl rand -base64 16)
export DB_PASSWORD=$(openssl rand -base64 32)
export ADMIN_PASSWORD=<strong-password>
```

### 3. Deploy

```bash
helm upgrade --install containerus ./deploy/helm/containerus-server \
  -n containerus --create-namespace \
  -f deploy/helm/containerus-server/values-production.yaml \
  --set image.tag="$GITHUB_SHA" \
  --set secrets.jwtSecret="$JWT_SECRET" \
  --set secrets.encryptionKey="$ENCRYPTION_KEY" \
  --set secrets.encryptionSalt="$ENCRYPTION_SALT" \
  --set secrets.adminPassword="$ADMIN_PASSWORD" \
  --set postgresql.auth.password="$DB_PASSWORD"
```

### 3a. Frontend (containerus-web)

The same chart ships an optional Angular frontend. Enable it alongside the backend when you want `/` → UI and `/api/*` → backend on the same host:

```bash
helm upgrade --install containerus ./deploy/helm/containerus-server \
  -n containerus --create-namespace \
  -f deploy/helm/containerus-server/values-production.yaml \
  --set web.enabled=true \
  --set web.image.tag=sha-4e6cdf5 \
  --set-string 'ingress.hosts[0].host=containerus.example.com' \
  --set-string 'ingress.hosts[0].paths[0].path=/api' \
  --set-string 'ingress.hosts[0].paths[0].pathType=Prefix' \
  --set-string 'ingress.hosts[0].paths[0].service.name={{ include "containerus-server.fullname" . }}' \
  --set      'ingress.hosts[0].paths[0].service.port=80' \
  --set-string 'ingress.hosts[0].paths[1].path=/' \
  --set-string 'ingress.hosts[0].paths[1].pathType=Prefix' \
  --set-string 'ingress.hosts[0].paths[1].service.name={{ include "containerus-server.fullname" . }}-web' \
  --set      'ingress.hosts[0].paths[1].service.port=80' \
  ...
```

The shared staging environment `87.106.170.40.nip.io` intentionally runs **backend-only** — `deploy/helm/containerus-server/values-staging.yaml` keeps `web.enabled: false` and routes `/` to the backend Service so desktop clients can hit `/api/*` directly:

```bash
helm upgrade containerus-server deploy/helm/containerus-server \
  -n containerus \
  --reset-then-reuse-values \
  -f deploy/helm/containerus-server/values-staging.yaml
```

### 4. Verify rollout

```bash
kubectl rollout status deployment/containerus-containerus-server -n containerus
kubectl get pods -n containerus
```

### 5. Port-forward for local access

```bash
kubectl port-forward -n containerus svc/containerus-containerus-server 8080:80
curl http://localhost:8080/api/health
```

### Using External PostgreSQL

Set `postgresql.enabled: false` in `values.yaml` and provide `secrets.databaseUrl` with a full connection string:

```bash
helm upgrade --install containerus ./deploy/helm/containerus-server \
  --set postgresql.enabled=false \
  --set secrets.databaseUrl="postgres://user:pass@external-host:5432/containerus"
```

---

## Monitoring

### Grafana dashboards

After Docker Compose startup, Grafana is available at `http://localhost:3000`.

Login: `admin` / `$GF_ADMIN_PASSWORD`

The **Containerus Server** dashboard is pre-provisioned and shows:
- Request rate and error rate
- Request latency (p50/p95/p99)
- Memory usage
- SSH connection pool utilization
- PostgreSQL connection count
- Active WebSocket sessions

### Alerts

Alerts are defined in `deploy/monitoring/prometheus/alerts.yml`.

Configure alert delivery in `deploy/monitoring/alertmanager/alertmanager.yml`.
Supported integrations: Slack, PagerDuty, email (see commented examples).

### Kubernetes (Prometheus Operator)

Set `serviceMonitor.enabled: true` in your Helm values to create a `ServiceMonitor`
resource. Requires `prometheus-operator` in the cluster.

---

## Database Operations

### Manual backup

```bash
export DATABASE_URL=postgres://containerus:password@localhost:5432/containerus
./deploy/db/backup.sh --output-dir /backups --keep-days 30
```

### Automated backups (Docker Compose)

Add a cron job on the host:

```cron
0 2 * * * cd /opt/containerus && DATABASE_URL=... ./deploy/db/backup.sh --output-dir /backups 2>&1 | tee -a /var/log/containerus-backup.log
```

### Restore

```bash
export DATABASE_URL=postgres://containerus:password@localhost:5432/containerus
./deploy/db/restore.sh --backup-file /backups/containerus_containerus_20260101_020000.sql.gz
```

### Running migrations manually

```bash
# Docker Compose
docker compose -f deploy/docker-compose.prod.yml exec app containerus-server --migrate-only

# Kubernetes
kubectl exec -n containerus deploy/containerus-containerus-server -- containerus-server --migrate-only
```

> Migrations run automatically on startup via the init container (Kubernetes) or the startup sequence (Docker Compose).

---

## Upgrading

### Docker Compose

```bash
docker compose -f deploy/docker-compose.prod.yml pull
docker compose -f deploy/docker-compose.prod.yml up -d --no-deps app
```

### Kubernetes / Helm

```bash
helm upgrade containerus ./deploy/helm/containerus-server \
  -n containerus \
  -f deploy/helm/containerus-server/values-production.yaml \
  --set image.tag="$NEW_IMAGE_TAG" \
  --reuse-values
```

The Helm chart uses `RollingUpdate` with `maxUnavailable: 0`, so upgrades are zero-downtime.

---

## Security Hardening

1. **Rotate secrets regularly** — `JWT_SECRET` and `ENCRYPTION_KEY` can be rotated. After rotating `JWT_SECRET`, existing sessions expire immediately (users re-login). `ENCRYPTION_SALT` must **never** be rotated (it would invalidate all stored credentials).

2. **Restrict database access** — remove the `ports:` block from the `db` service in Docker Compose. In Kubernetes, use `NetworkPolicy` to restrict DB traffic to the app pod only.

3. **TLS everywhere** — expose only port 443 externally. All monitoring ports (9090, 3000, 9093) should be localhost-only or protected by network policy.

4. **CORS** — always set `CORS_ORIGINS` to your specific frontend origin(s) in production (never `*`).

5. **Read-only filesystem** — the Helm chart sets `readOnlyRootFilesystem: true`. If the server needs temp space, it mounts an `emptyDir` at `/tmp`.

6. **Non-root user** — both Docker image and Helm chart run as UID 1000 (`containerus` user).

7. **CI security scanning** — the `.github/workflows/security.yml` workflow runs:
   - `cargo audit` (Rust CVE database)
   - `pnpm audit` (npm advisory database)
   - `clippy -D warnings` (Rust SAST)
   - `gitleaks` (secret scanning)
   - `trivy` (container image CVE scan, on main branch)
   - migration idempotency check

---

## Troubleshooting

### Health check failing

```bash
# Check server logs
docker compose -f deploy/docker-compose.prod.yml logs app --tail=100

# Check DB connectivity
docker compose -f deploy/docker-compose.prod.yml exec app \
  sh -c 'echo $DATABASE_URL'
```

### Migrations not running

Check for migration errors in startup logs. The server exits on migration failure.

Common causes:
- `DATABASE_URL` points to wrong host
- DB not yet healthy (check `db` container health)
- Permission denied (check `POSTGRES_USER` owns the database)

### SSH connections failing

Look for `SSH pool` log lines at `DEBUG` level:

```bash
RUST_LOG=containerus_server=debug,containerus_core::ssh=debug docker compose up app
```

### WebSocket terminal drops

Ensure your reverse proxy sets `Connection: upgrade` and `Upgrade: websocket` headers and has a long enough `proxy_read_timeout` (≥ 3600s).
