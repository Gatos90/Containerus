# Container runtimes

**Summary**: Containerus targets three runtimes — Docker, Podman, and Apple Container. `CommandBuilder` emits the right CLI invocation per runtime; `OutputParser` normalizes the varying output formats into shared models.

**Sources**: `crates/containerus-core/src/runtime/builder.rs`, `crates/containerus-core/src/runtime/parser.rs`.

**Last updated**: 2026-04-16

---

## The `ContainerRuntime` enum

Defined in `models/container.rs`:

```rust
pub enum ContainerRuntime { Docker, Podman, Apple }
```

Systems advertise `primary_runtime` and `available_runtimes: Vec<ContainerRuntime>` (persisted in `systems.available_runtimes` as JSON). `detect_runtimes` probes each candidate binary on the target system and updates these fields.

## CommandBuilder — `builder.rs`

Static methods returning `String` commands. A few examples:

- `list_containers(runtime)` — `docker ps -a --no-trunc --format json` / `podman ps -a --format json` / `container ls --format json --all`
- `list_containers_fallback()` — for old Docker / Podman versions without JSON output, uses table format + custom parsing
- `inspect_container(runtime, id)` — `docker inspect <id>`
- `batch_inspect_containers(runtime, ids)` — multi-id inspect in one call
- `container_action(runtime, action, id)` — Start / Stop / Restart / Pause / Unpause / Remove
  - Apple Container quirks: `container resume` instead of `unpause`, and `restart` is composed from `stop && sleep 1 && start` because there's no native restart
- `force_remove_container(runtime, id)` — adds `-f`
- `container_logs(runtime, id, tail, timestamps)` — tail count and timestamp flag configurable

Plus parallel builders for images, volumes, networks, and system info (CPU/memory/disk/network probes). The `compose` subfamily uses `docker compose` / `podman compose`.

## OutputParser — `parser.rs`

`parse_container_list(output, runtime, system_id)` understands three formats:

1. **Docker/Podman JSON stream** — one JSON object per line (`format json`).
2. **Docker/Podman JSON array** — newer CLIs sometimes return a wrapped array.
3. **Apple Container JSON array** — Apple always emits an array with slightly different field names.

The parser dispatches based on runtime and detects array-vs-stream heuristically. Each object goes through `parse_container_from_json` which:

- Maps `status` strings (`"running"`, `"exited (0)"`, `"paused"`, …) onto `ContainerStatus`.
- Parses `"Created"` timestamps with several Docker date formats (`parse_docker_date`).
- Parses `"80/tcp, 443/tcp → 0.0.0.0:8080"`-style port strings with `parse_docker_ports` into `Vec<PortMapping> { host_ip, host_port, container_port, protocol }`.
- Extracts labels, mounts, image, names, and network settings.

Similar parallel functions parse images (with `size_human()` on `ContainerImage`), volumes, networks, and live metrics (CPU %, memory %, disk I/O, network I/O, load average).

## Batch inspect

Rather than issue one `docker inspect` per container, `CommandBuilder::batch_inspect_containers(runtime, ids)` produces a single command whose output is a JSON array with full details for each id. `OutputParser` then zips it back into the `Container` records produced by `list_containers`. This keeps round-trips low on high-latency SSH connections.

## Runtime-specific differences

| Feature | Docker | Podman | Apple |
|---|---|---|---|
| `unpause` | `unpause` | `unpause` | `resume` |
| `restart` | `restart` | `restart` | composed: `stop && sleep 1 && start` |
| JSON output | `--format json` | `--format json` | `--format json` (array-only) |
| Compose | `docker compose ...` | `podman compose ...` | not supported yet |
| Rootless | configurable | default | n/a |

## Where the runtime value comes from

Most commands accept a `runtime` parameter. The frontend passes the system's primary runtime unless the user specifically targeted a different one (e.g., in multi-runtime systems that expose both Docker and Podman). For commands applied to a specific container, the runtime is always the one that owns it (`Container.runtime`).

## Related pages

- [[domain-models]]
- [[crate-containerus-core]]
- [[file-browser]]
