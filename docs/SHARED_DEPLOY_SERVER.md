# Shared Deploy Server — Onboarding

Operational guide for the shared staging/test server every Containerus employee uses to deploy and test builds.

- Host: `87.106.170.40` (Ubuntu 24.04, 6 vCPU / 8 GiB / 232 GiB)
- Staging URL: <http://87.106.170.40.nip.io> (Traefik ingress → `containerus-server` Service)
- Health: `curl http://87.106.170.40.nip.io/api/health` → `200 {"database":"connected","status":"healthy","version":"0.1.0"}`
- Stack: Axum backend + PostgreSQL 17 on k3s v1.34.6 (Traefik + flannel + local-path), single node, namespace `containerus`
- Current image: `ghcr.io/gatos90/containerus-server:sha-f70aad6` (pinned)
- Provisioned under [CON-89](/CON/issues/CON-89); stack spec in [CON-90](/CON/issues/CON-90#document-plan); hardening in [CON-96](/CON/issues/CON-96)

Forward-looking: the shared `deploy` Unix account is tracked for restructure into per-user accounts in [CON-97](/CON/issues/CON-97).

---

## Who uses this server

| Role | Responsibility |
| --- | --- |
| DeploymentEngineer | Provisioning, deploy pipeline, k3s manifests. Issues per-user SSH keys. First contact for box issues. |
| BackendEngineer | Backend builds and DB migrations (embedded, auto-run on pod boot). |
| SecurityEngineer | Hardening review + re-verification. |
| QAEngineer / Board | Validates builds end-to-end via the staging URL. |
| TechnicalWriter | Keeps this doc current. |

---

## 1. Connect

### 1.1 Get a per-user SSH key

Request access from DeploymentEngineer. They will:

1. Generate a per-engineer ed25519 key for you out-of-band.
2. Authorise your public key on the shared `deploy` account on the server.

You receive your own private key and log in as `deploy@87.106.170.40`. Everyone shares the Unix user for now — per-user Unix accounts are tracked in [CON-97](/CON/issues/CON-97) — but every engineer has their own SSH key, so access can be revoked individually.

Do **not** paste or scp a private key onto the server. Keep yours at `~/.ssh/` with mode `600`.

### 1.2 Log in

```bash
chmod 600 ~/.ssh/<your-key>
ssh -i ~/.ssh/<your-key> deploy@87.106.170.40
# or add the key to ~/.ssh/config with `Host deploy-staging` and just: ssh deploy-staging
```

`root` is password-locked and SSH password auth is disabled globally — keys only.

### 1.3 SSH / firewall baseline

- Key-only SSH. `PasswordAuthentication no`, `PermitRootLogin prohibit-password`, root password locked.
- `sshd_config.d/00-hardening.conf`: `MaxAuthTries 3`, `LoginGraceTime 30`, modern-only ciphers/MACs/kex, `AllowGroups ssh-users`. Ask DeploymentEngineer to add new Unix users to that group — SSH will reject logins otherwise.
- fail2ban: `sshd` jail (maxretry 3, bantime 1h) + `recidive` jail (findtime 1d, bantime 1w, ufw banaction).
- ufw: deny-in by default. `22/tcp LIMIT`, `80/tcp ALLOW`, `443/tcp ALLOW`. Nothing else is reachable from the internet. If too many SSH attempts hit `22/tcp LIMIT`, ufw will temporarily refuse connections — that's expected.
- sysctl hardening active: `send_redirects=0`, `log_martians=1`, `accept_redirects=0`, `accept_source_route=0`, `rp_filter=1`, `tcp_syncookies=1`. Unprivileged user namespaces enabled.

---

## 2. Where services live

Single k3s cluster, one release in namespace `containerus`.

| Component | Where |
| --- | --- |
| Backend (Axum) | Deployment selectable by label `app.kubernetes.io/name=containerus-server`, ns `containerus` |
| Service | `containerus-server` (port 80 → app 8080) |
| Public ingress | Traefik, 80 → `containerus-server`; host `87.106.170.40.nip.io` |
| Postgres 17 | Helm release `pg-postgresql` (Bitnami subchart), StatefulSet in ns `containerus`, local-path PVC |
| Config / secrets | Helm-managed `ConfigMap` + `Secret` in ns `containerus` |

- Public entry point: **80 on `87.106.170.40.nip.io`** (Traefik). App listens internally on 8080.
- Image: `ghcr.io/gatos90/containerus-server:<tag>` — current pinned tag is `sha-f70aad6`.
- DB migrations: embedded via `sqlx::migrate!`, run automatically on pod startup. No separate job.
- Scale cap: `replicaCount: 1`. Terminal / k8s-exec / k8s-watch / port-forward sessions hold in-memory per-pod state. Do **not** scale out without session affinity.
- Docker daemon: `live-restore`, `icc: false`, `no-new-privileges`, `log-driver: journald`, `userland-proxy: false`.
- k3s: secrets-at-rest encryption enabled (AES-CBC); audit logging on (`/var/log/k3s/audit.log`); default-deny `NetworkPolicy` + DNS-egress allow applied to `default` ns (baseline template at `/opt/containerus/templates/network-policy-baseline.yaml` for new namespaces).
- Namespace-scoped `deploy` ServiceAccount is what the deploy script uses — not the cluster admin kubeconfig.

### 2.1 k3s API access

`/etc/rancher/k3s/k3s.yaml` is `0600 root:root` and `k3s` binds the API to `127.0.0.1:6443` only — port 6443 is not reachable from the internet. Options in order of preference:

```bash
# On the server as deploy (uses deploy's own namespace-scoped kubeconfig):
kubectl -n containerus get pods

# On the server with the admin kubeconfig (sudo only, rare):
sudo KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl -n containerus get pods

# From your laptop, via SSH tunnel:
ssh -L 6443:127.0.0.1:6443 deploy@87.106.170.40
# then point KUBECONFIG at a local copy with server: https://127.0.0.1:6443
```

For persistent external access, ask DeploymentEngineer for a scoped kubeconfig with narrow RoleBindings — sharing the admin file is not allowed.

### 2.2 Logs

```bash
# Backend, label-selected so it survives release-name changes:
kubectl -n containerus logs -l app.kubernetes.io/name=containerus-server -f

# Postgres:
kubectl -n containerus logs -f statefulset/pg-postgresql

# Host-level:
sudo journalctl -u k3s -f
sudo journalctl -u ssh -f
sudo journalctl -p err -b
```

---

## 3. Deploy a new build

Run the deploy script on the server as `deploy`:

```bash
ssh deploy@87.106.170.40
sudo -u deploy KUBECONFIG=/etc/rancher/k3s/k3s.yaml \
  /home/deploy/bin/deploy-containerus.sh <image-tag>
```

The script is idempotent: pulls `Ai-Test`, pre-pulls the image, runs `helm upgrade --reuse-values`, waits for rollout, and curls `/api/health` before returning. Pass a tag like `sha-f70aad6` as `$1` to pin a specific build; omit it to redeploy the last-deployed tag.

Secrets (JWT, encryption, admin creds, DB URL) live at `/home/deploy/secrets/staging_credentials.env` (mode 0600, owned by `deploy`) and are reused by the script via `--reuse-values`. You do not need to regenerate or pass them on every deploy.

> `ENCRYPTION_KEY` and `ENCRYPTION_SALT` decrypt credentials stored in the vault. They must **never** be rotated — doing so destroys stored secrets. Treat the existing values as permanent for this environment.

Low-level Helm / Docker Compose instructions (for bootstrapping a new environment from scratch, not for routine staging redeploys) live in [`deploy/DEPLOYMENT.md`](../deploy/DEPLOYMENT.md).

### 3.1 Admin login

The seeded admin account is available at the staging URL. Credentials live in `/home/deploy/secrets/staging_credentials.env` on the server (`ADMIN_EMAIL`, `ADMIN_PASSWORD`). The board should change the admin password through the UI after their first login.

---

## 4. Operate the box

### Restart the backend

```bash
kubectl -n containerus rollout restart deployment -l app.kubernetes.io/name=containerus-server
kubectl -n containerus rollout status   deployment -l app.kubernetes.io/name=containerus-server
```

### Restart Postgres (rare)

```bash
kubectl -n containerus rollout restart statefulset/pg-postgresql
```

### Rerun migrations

Migrations are embedded and run automatically on pod startup. To force a re-run, bounce the pod:

```bash
kubectl -n containerus rollout restart deployment -l app.kubernetes.io/name=containerus-server
```

For manual recovery-path migrations, see "Running migrations manually" in [`deploy/DEPLOYMENT.md`](../deploy/DEPLOYMENT.md).

### Health check

```bash
# From anywhere:
curl http://87.106.170.40.nip.io/api/health

# Tunneled via port-forward (when ingress is in doubt):
kubectl -n containerus port-forward svc/containerus-server 8080:80
curl http://localhost:8080/api/health
```

### Database backup / restore

Scripts: `deploy/db/backup.sh`, `deploy/db/restore.sh`. Usage: [`deploy/DEPLOYMENT.md` → Database Operations](../deploy/DEPLOYMENT.md#database-operations).

### Quick host health

```bash
kubectl get nodes
kubectl get pods -A
df -h
sudo journalctl -p err -b
```

---

## 5. Who to ping

| Problem | First contact |
| --- | --- |
| Can't SSH in, key issuance, box unreachable | DeploymentEngineer |
| Deploy script failing, rollout stuck | DeploymentEngineer |
| Backend build broken, app returns 500, migration failing | BackendEngineer |
| Suspected security issue or hardening question | SecurityEngineer |
| Doc wrong, confusing, or missing something | TechnicalWriter |

Escalate to the CEO if the box is down and no one is responding.

---

## 6. Known open items

- [CON-97](/CON/issues/CON-97) — split the shared `deploy` Unix account into per-user Unix accounts. Does not block current usage; engineers already have per-user SSH keys.
- Two upstream chart patches were applied locally on the server during the CON-89 rollout ([CON-89 close-out comment](/CON/issues/CON-89)) and need matching fixes in-repo: the `run-migrations` init container in `deploy/helm/containerus-server/templates/deployment.yaml` needs the full backend env (or `--migrate-only` needs to skip non-migration vars), and `--migrate-only` needs to actually exit instead of listening on `0.0.0.0:8080`. These are BackendEngineer / DeploymentEngineer follow-ups, filed separately.
- On-cluster Grafana / Prometheus stack is not deployed yet. Pending DeploymentEngineer decision (see [CON-90 plan](/CON/issues/CON-90#document-plan)).
