# Shared Deploy Server — Onboarding

Operational guide for the shared staging/test server every Containerus employee uses to deploy and test builds.

- Host: `87.106.170.40` (Ubuntu 24.04, 6 vCPU / 8 GiB / 232 GiB)
- Stack: Axum backend + PostgreSQL 17 on k3s, single node, single namespace (`containerus`)
- Provisioned under [CON-89](/CON/issues/CON-89); stack spec in [CON-90](/CON/issues/CON-90#document-plan); hardening in [CON-96](/CON/issues/CON-96)

Forward-looking: the shared `deploy` identity is tracked for restructure in [CON-97](/CON/issues/CON-97). When per-user SSH accounts land, the bootstrap private key attached to [CON-89](/CON/issues/CON-89) will be removed and rotated.

---

## Who uses this server

| Role | Responsibility |
| --- | --- |
| DeploymentEngineer | Provisioning, deploy pipeline, k3s manifests. First contact for box issues. |
| BackendEngineer | Backend builds and DB migrations (embedded, auto-run on pod boot). |
| SecurityEngineer | Hardening review + re-verification. |
| QAEngineer / Board | Validates builds end-to-end over HTTPS. |
| TechnicalWriter | Keeps this doc current. |

---

## 1. Connect

### 1.1 First-time access (bootstrap key)

Bootstrap artefacts are attached to [CON-89](/CON/issues/CON-89):

- `containerus_bootstrap` — private ed25519 key. Save off the ticket, `chmod 600`. **Never** copy it onto the server.
- `containerus_bootstrap.pub` — public key (already installed for `root` and `deploy`).

```bash
chmod 600 containerus_bootstrap
ssh -i containerus_bootstrap deploy@87.106.170.40
```

Always prefer the `deploy` user. `root` is password-locked and SSH password auth is disabled — keys only.

### 1.2 Rotate to your personal key (first login)

```bash
ssh -i containerus_bootstrap deploy@87.106.170.40 \
  'umask 077 && mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys' \
  < ~/.ssh/id_ed25519.pub
```

Then drop `-i containerus_bootstrap` from your SSH command. Once everyone has rotated (and [CON-97](/CON/issues/CON-97) lands per-user accounts), DeploymentEngineer will remove the bootstrap key.

SSH is restricted to the `ssh-users` group (currently `root`, `deploy`). If you need a new named user on the box, DeploymentEngineer has to add them to that group — SSH will reject logins otherwise.

### 1.3 SSH / firewall baseline

- Key-only SSH. `PasswordAuthentication no`, `PermitRootLogin without-password`, root password locked.
- `sshd_config.d/00-hardening.conf`: `MaxAuthTries 3`, `LoginGraceTime 30`, modern-only ciphers/MACs/kex, `AllowGroups ssh-users`.
- fail2ban: `sshd` jail (maxretry 3, bantime 1h) + `recidive` jail (findtime 1d, bantime 1w, ufw banaction).
- ufw: deny-in by default. `22/tcp LIMIT`, `80/tcp ALLOW`, `443/tcp ALLOW`. Nothing else is reachable from the internet. If too many SSH attempts hit `22/tcp LIMIT`, ufw will temporarily refuse connections — that's expected.
- sysctl hardening active: `send_redirects=0`, `log_martians=1`, `accept_redirects=0`, `accept_source_route=0`, `rp_filter=1`, `tcp_syncookies=1`.

---

## 2. Where services live

Single k3s cluster, one release in namespace `containerus`.

| Component | Where |
| --- | --- |
| Backend (Axum) | Deployment `containerus-containerus-server`, ns `containerus` |
| Postgres 17 | Bitnami subchart StatefulSet `containerus-postgresql`, ns `containerus` |
| Public ingress | 443 → Service `containerus-containerus-server` (port 8080) |
| Config / secrets | Helm-managed `ConfigMap` + `Secret` in ns `containerus` |

- Public entry point: **443 only** (ingress). Internal app port is 8080.
- Image: `ghcr.io/gatos90/containerus-server:<tag>`.
- DB migrations: embedded via `sqlx::migrate!`, run automatically on pod startup. No separate job.
- Scale cap: `replicaCount: 1`. Terminal / k8s-exec / k8s-watch / port-forward sessions hold in-memory per-pod state. Do **not** scale out without session affinity.
- Docker daemon: `live-restore`, `icc: false`, `no-new-privileges`, `log-driver: journald`, `userland-proxy: false`.
- k3s: secrets-at-rest encryption enabled (AES-CBC); audit logging on; default-deny `NetworkPolicy` + DNS-egress allow applied to `default` ns (baseline template at `/opt/containerus/templates/network-policy-baseline.yaml` for new namespaces).

### 2.1 k3s API access

`/etc/rancher/k3s/k3s.yaml` is `0600 root:root` and `k3s` binds the API to `127.0.0.1:6443` only — port 6443 is not reachable from the internet. Use one of:

```bash
# On the server as deploy (uses deploy's own ~/.kube/config, not the admin file):
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
kubectl -n containerus logs -f deployment/containerus-containerus-server
kubectl -n containerus logs -f statefulset/containerus-postgresql
sudo journalctl -u k3s -f
sudo journalctl -u ssh -f
sudo journalctl -p err -b
```

---

## 3. Deploy a new build

The canonical runbook lives in [`deploy/DEPLOYMENT.md`](../deploy/DEPLOYMENT.md). Short version for this server:

```bash
# One-time on your laptop:
helm repo add bitnami https://charts.bitnami.com/bitnami && helm repo update

# One-time: generate + store secrets in a password manager
export JWT_SECRET=$(openssl rand -base64 32)
export ENCRYPTION_KEY=$(openssl rand -base64 32)   # NEVER rotate (decrypts stored credentials)
export ENCRYPTION_SALT=$(openssl rand -base64 16)  # NEVER rotate
export DB_PASSWORD=$(openssl rand -base64 32)
export ADMIN_PASSWORD=<strong-password>

# Every deploy:
helm upgrade --install containerus ./deploy/helm/containerus-server \
  -n containerus --create-namespace \
  -f deploy/helm/containerus-server/values-production.yaml \
  --set image.tag="$GITHUB_SHA" \
  --set secrets.jwtSecret="$JWT_SECRET" \
  --set secrets.encryptionKey="$ENCRYPTION_KEY" \
  --set secrets.encryptionSalt="$ENCRYPTION_SALT" \
  --set secrets.adminPassword="$ADMIN_PASSWORD" \
  --set postgresql.auth.password="$DB_PASSWORD"

kubectl rollout status deployment/containerus-containerus-server -n containerus
```

> `ENCRYPTION_KEY` and `ENCRYPTION_SALT` decrypt credentials stored in the vault. Rotating them loses stored secrets. Keep them in a password manager and reuse across deploys.

One-command / CI deploy hook: still pending — DeploymentEngineer will wire it under [CON-89](/CON/issues/CON-89). Until then, run the `helm upgrade` above.

---

## 4. Operate the box

### Restart the backend

```bash
kubectl -n containerus rollout restart deployment/containerus-containerus-server
kubectl -n containerus rollout status  deployment/containerus-containerus-server
```

### Restart Postgres (rare)

```bash
kubectl -n containerus rollout restart statefulset/containerus-postgresql
```

### Rerun migrations

Migrations are embedded and run automatically on pod startup. To force a re-run, bounce the pod:

```bash
kubectl -n containerus rollout restart deployment/containerus-containerus-server
```

For manual recovery-path migrations, see "Running migrations manually" in [`deploy/DEPLOYMENT.md`](../deploy/DEPLOYMENT.md).

### Health check

```bash
# From your laptop once ingress is live:
curl https://<public-hostname>/api/health

# Tunneled via port-forward:
kubectl -n containerus port-forward svc/containerus-containerus-server 8080:80
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
| Can't SSH in, key rotation, box unreachable | DeploymentEngineer |
| Deploy / Helm upgrade failing | DeploymentEngineer |
| Backend build broken, app returns 500, migration failing | BackendEngineer |
| Suspected security issue or hardening question | SecurityEngineer |
| Doc wrong, confusing, or missing something | TechnicalWriter |

Escalate to the CEO if the box is down and no one is responding.

---

## 6. Known open items

- [CON-89](/CON/issues/CON-89) — DeploymentEngineer will land the one-command / CI deploy hook (section 3).
- [CON-97](/CON/issues/CON-97) — restructure the shared `deploy` account into per-user SSH identities; triggers bootstrap-key rotation and removal.
- Ingress controller choice (Traefik default vs. ingress-nginx), in-cluster vs. managed Postgres, and on-cluster Grafana/Prometheus are open DeploymentEngineer calls (see [CON-90 plan](/CON/issues/CON-90#document-plan)). This doc will be updated when each is decided.
