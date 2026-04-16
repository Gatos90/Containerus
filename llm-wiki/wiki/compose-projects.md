# Docker Compose projects

**Summary**: Compose project view is derived from container labels — `com.docker.compose.project` and `com.docker.compose.service`. No separate data source, no compose file parsing — Containerus aggregates over the existing container list. `compose up|down|restart|logs` then issues the matching CLI command on the system.

**Sources**: `src-tauri/src/commands/compose.rs`, `src/app/features/compose-projects/*`, `src/app/state/compose.state.ts`.

**Last updated**: 2026-04-16

**Parent**: [[frontend-features]]
**Siblings**: [[command-templates]], [[feature-containers]], [[feature-systems]]

---

## Where the project list comes from

Instead of parsing `docker-compose.yml`, `ComposeState` derives projects from `ContainerState`:

```ts
readonly projects = computed<ComposeProject[]>(() => {
  const byProject = new Map<string, Container[]>();
  for (const c of this.containers.containers()) {
    const project = c.labels['com.docker.compose.project'];
    if (project) {
      (byProject.get(project) ?? byProject.set(project, []).get(project)!).push(c);
    }
  }
  return [...byProject.entries()].map(([name, containers]) => ({
    name,
    containers,
    services: groupBy(containers, c => c.labels['com.docker.compose.service']),
    status: aggregateStatus(containers),
  }));
});
```

This is pure derivation — no extra network round-trip, no cache to invalidate. Whenever containers refresh, the compose list refreshes too.

## Project aggregate status

Rolled up from the contained services:
- **running** — all services have ≥1 running container
- **partial** — some services running, some stopped
- **stopped** — no running containers
- **unhealthy** — any container is in `dead` / `restarting` / `exited-nonzero`

## Actions — `commands/compose.rs`

Four Tauri commands that shell out:

| Command | Shell |
|---|---|
| `compose_up(system_id, project_name, runtime)` | `docker compose -p <name> up -d` |
| `compose_down(system_id, project_name, runtime)` | `docker compose -p <name> down` |
| `compose_restart(system_id, project_name, runtime)` | `docker compose -p <name> restart` |
| `compose_logs(system_id, project_name, runtime, tail?, follow?)` | `docker compose -p <name> logs [--tail N] [-f]` |

Runtime choice follows the runtime of the containers in the project (Docker / Podman). Apple Container doesn't support compose yet, so compose actions on Apple-only systems are disabled.

One caveat: `docker compose -p <name> up -d` without a compose file in the cwd will fail. Containerus doesn't know the file path — it just triggers the action relative to the shell's cwd on the target system. For SSH systems, users typically launched compose from a known directory and the intent is to restart/stop/log that same deployment. "Up" from scratch needs the user to be in the compose directory.

## Frontend

Components:
- `compose-list` — all projects with status badge, service counts, action buttons
- `compose-service-card` — one service's containers inline

State: `ComposeState` — derived signals, plus a `filter` (by status) and `search`.

Service: `ComposeApiService` — invokes the four Tauri commands.

## Runtime compatibility

| Runtime | Up | Down | Restart | Logs |
|---|---|---|---|---|
| Docker | yes | yes | yes | yes |
| Podman | yes (`podman compose`) | yes | yes | yes |
| Apple Container | no | no | no | no |

## Limitations

- No compose-file editing in-app — that's what the [[file-browser]] or the user's own editor is for.
- No scale operations (`docker compose scale`) — planned.
- No environment variable override UI.
- `compose up` assumes the compose file is in the target shell's default cwd.

## Related pages

- [[frontend-features]]
- [[feature-containers]]
- [[container-runtimes]]
