# Executor abstraction

**Summary**: `CommandExecutor` is the async trait every command-dispatching piece of the code uses to avoid caring whether a command runs on the local shell or over SSH. Two implementations — `LocalExecutor` and `RemoteExecutor` — behind the factory `get_executor_for_system`.

**Sources**: `crates/containerus-core/src/executor/{mod.rs,local.rs,remote.rs}`.

**Last updated**: 2026-04-16

**Parent**: [[crate-containerus-core]]
**Siblings**: [[container-runtimes]], [[domain-models]], [[error-model]]

---

## The trait

```rust
#[async_trait]
pub trait CommandExecutor: Send + Sync {
    async fn execute(&self, command: &str) -> Result<CommandResult>;
    async fn execute_with_timeout(&self, command: &str, timeout: Duration) -> Result<CommandResult>;
    fn can_execute(&self, system: &ContainerSystem) -> bool;
    fn connection_type(&self) -> ConnectionType;
}

pub struct CommandResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub execution_time_ms: u64,
}

impl CommandResult {
    pub fn success(&self) -> bool { self.exit_code == 0 }
    pub fn combined_output(&self) -> String { /* stdout + stderr */ }
}
```

## `LocalExecutor`

File: `executor/local.rs`. Runs commands via `tokio::process::Command`.

Key details:

- **Shell** — `get_shell_command()` returns `(program, arg)`:
  - Windows: `("cmd", "/C")`
  - Unix: `("/bin/sh", "-c")`
- **PATH augmentation** — `get_path_env()` appends platform-specific directories:
  - Windows: common Docker/Podman install paths
  - macOS: `/opt/homebrew/bin`, `/usr/local/bin`
  - Linux: standard system paths
  This matters because Containerus runs as a GUI app on macOS, where `PATH` defaults to a minimal value without the user's shell env — so `docker` wouldn't resolve without explicit augmentation.
- **No console window** — on Windows, spawns with `CREATE_NO_WINDOW` to prevent a cmd.exe window from flashing.
- **Capture** — waits for the child to exit, captures `stdout` and `stderr`, measures wall time.

## `RemoteExecutor`

File: `executor/remote.rs`. Thin wrapper that delegates to the global SSH pool.

```rust
impl CommandExecutor for RemoteExecutor {
    async fn execute(&self, command: &str) -> Result<CommandResult> {
        ssh::execute_on_system(&self.system_id, command).await
    }
    async fn execute_with_timeout(&self, command: &str, timeout: Duration) -> Result<CommandResult> {
        tokio::time::timeout(timeout, self.execute(command))
            .await
            .map_err(|_| ContainerError::NetworkTimeout)?
    }
    fn connection_type(&self) -> ConnectionType { ConnectionType::Remote }
}
```

The pool returns cached `SshClient` if present; see [[ssh-connection-pooling]].

## Factory

```rust
pub fn get_executor_for_system(system: &ContainerSystem) -> Box<dyn CommandExecutor> {
    match system.connection_type {
        ConnectionType::Local  => Box::new(LocalExecutor::new()),
        ConnectionType::Remote => Box::new(RemoteExecutor::new(system.id.clone())),
    }
}
```

Callers never instantiate executors directly. This one line is the entry into all command execution.

## Who calls executors

- `CommandBuilder` ([[container-runtimes]]) builds the command string.
- `get_executor_for_system(system).execute(command)` runs it.
- `OutputParser` parses the `CommandResult.stdout` into typed models.

This is the pipeline for every list / inspect / action operation in Containerus.

## Timeout conventions

- List commands (`list_containers`, `list_images`, …) don't impose a timeout — they use `execute`. If the network hangs, the request hangs.
- Action commands (`container_action`, `remove_*`) use `execute_with_timeout` with a 60s cap.
- Metrics probes use short timeouts (5s) so a slow probe doesn't delay the next tick.
- The agent's `shell_execute` tool propagates the user-visible `timeout_ms` down into `execute_with_timeout`.

## Error mapping

- Non-zero exit + empty stderr → `CommandExecutionFailed { command, exit_code, stderr: "" }`.
- Process spawn failure → `Internal("failed to spawn: ...")`.
- SSH-backed execution errors → `NotConnected` / `ConnectionFailed` from the pool.
- Timeout → `NetworkTimeout` (retryable).

See [[error-model]].

## Related pages

- [[crate-containerus-core]]
- [[ssh-connection-pooling]]
- [[container-runtimes]]
- [[error-model]]
