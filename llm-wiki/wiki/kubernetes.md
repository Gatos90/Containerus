# Kubernetes

**Summary**: Server-only feature. `containerus-server` integrates `kube-rs` to manage registered clusters, discover workloads, stream logs, exec into pods, and watch resource events — all exposed via REST plus two WebSocket endpoints. The frontend's K8s dashboard is under `features/backend/k8s-dashboard`.

**Sources**: `crates/containerus-server/src/k8s/mod.rs`, `crates/containerus-server/src/api/clusters/*`, `crates/containerus-server/src/ws/k8s_exec.rs`, `crates/containerus-server/src/ws/k8s_watch.rs`.

**Last updated**: 2026-04-16

---

## ClusterManager

`k8s::ClusterManager` holds a map of `kube::Client` instances, one per registered cluster. It's built at startup (`main.rs`) and injected into every cluster API handler. Clients are constructed from encrypted kubeconfig blobs stored in PostgreSQL.

## REST API — `api/clusters/*`

Mounted at `/api/clusters` and, for project-scoped views, at `/api/projects/:pid/environments/:eid/clusters`.

| Submodule | Endpoints | Purpose |
|---|---|---|
| `crud.rs` | `POST /`, `GET /:id`, `PATCH /:id`, `DELETE /:id`, `GET /` | Register / update / delete / list clusters |
| `discovery.rs` | `POST /:id/discover` | Probe the kubeconfig, list contexts |
| `workloads.rs` | `GET /:id/deployments`, `GET /:id/statefulsets`, `GET /:id/daemonsets`, `GET /:id/cronjobs` | List workloads per namespace |
| `resources.rs` | `GET /:id/resources` | Aggregate CPU / memory per node, namespace, workload |
| `topology.rs` | `GET /:id/topology` | Graph of nodes → namespaces → workloads |
| `nodes.rs` | `GET /:id/nodes`, `GET /:id/nodes/:name` | Node list, status, taints |
| `logs.rs` | `GET /:id/logs/:pod?container=` | Stream pod logs (HTTP streaming) |
| `files.rs` | `GET /:id/files/read`, `POST /:id/files/write`, `GET /:id/files/browse` | Read / write / list files inside a pod (via kube exec) |
| `apply.rs` | `POST /:id/apply` | Apply / patch a YAML manifest |

Every handler requires the `k8s:*` permission matching the operation — see [[auth-and-rbac]] and migration `0003_k8s_permissions.sql`.

## WebSockets

### `/api/ws/k8s-exec/:clusterId`

Per-user pod exec. Takes query params: `namespace`, `pod`, `container?`, `command`. Wraps kube-rs's attach channel; streams stdin/stdout/stderr framed as JSON control messages for resize plus raw binary for data. Authenticated via access token.

### `/api/ws/k8s-watch/:clusterId`

Generic resource watch. Client sends an initial JSON subscription `{ group, version, kind, namespace? }`; server opens a `watcher` on that resource and forwards Added / Modified / Deleted events as JSON. Used by the K8s dashboard to keep lists live without polling.

## Frontend

- `BackendK8sService` — REST wrappers (`listNamespacesFor`, `listPodsFor`, `listDeploymentsFor`, `listServicesFor`, `scaleDeploymentFor`, `listCustomResourcesFor`, `getCustomResourceFor`, `applyCustomResourceFor`, …).
- `K8sWatchService` — generic WebSocket watcher (subscribe to arbitrary GVK, reactive updates in state).
- `BackendService.getK8sExecWsUrl` / `getK8sWatchWsUrl` — token-baked URL builders.
- Components under `features/backend/k8s-dashboard` render lists, topology, and exec panels.

## File operations in pods

Server-side `files.rs` shells out through `kube` exec with standard tools (`ls`, `cat`, `base64`, `tee`). Same shape as the SSH-based [[file-browser]], just a different transport at the bottom.

## Supported K8s version

Compiled against `k8s-openapi = "0.24"` with the `v1_31` feature — i.e., API types for Kubernetes 1.31. Server may still talk to 1.27+ clusters at runtime, with the caveat that deprecated resources get stripped from discovery.

## Related pages

- [[crate-containerus-server]]
- [[auth-and-rbac]]
- [[backend-service]]
- [[file-browser]]
