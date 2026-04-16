# Crate: containerus-core

**Summary**: The shared Rust library. Domain models, SSH client + pool + port forwarding, command executor abstraction, Docker/Podman/Apple runtime command builder and parser, and the multi-provider AI abstraction. Used by both the Tauri desktop crate and the backend server.

**Sources**: `crates/containerus-core/src/` and `crates/containerus-core/Cargo.toml`.

**Last updated**: 2026-04-16

**Parent**: [[architecture]]
**Siblings**: [[crate-src-tauri]], [[crate-containerus-server]]
**Children**: [[domain-models]], [[ssh-subsystem]], [[ssh-connection-pooling]], [[container-runtimes]], [[ai-providers]], [[executor-abstraction]], [[error-model]]

---

## Public surface — `lib.rs`

`lib.rs` re-exports the five top-level modules: `ai`, `executor`, `models`, `runtime`, `ssh`. Anything public inside them is callable from either `src-tauri` or `containerus-server`.

## `models/` — domain types

See [[domain-models]] for the full catalogue. Highlights:

- `container.rs` — `Container`, `ContainerDetails`, `ContainerAction`, `PortMapping`, `NetworkSettings`, `HostConfigExtras`, `HealthCheck`, `ResourceLimits`, …
- `system.rs` — `ContainerSystem`, `SshConfig`, `JumpHost`, `ConnectionType`, `ConnectionState`, `LiveSystemMetrics`, …
- `image.rs` — `ContainerImage` with `size_human()`
- `volume.rs` — `Volume`
- `network.rs` — `Network`
- `port_forward.rs` — `PortForward`, `PortForwardStatus`, `CreatePortForwardRequest`
- `credentials.rs` — `SshCredentials`, `JumpHostCredentials`, `BackendTokens`, `CredentialVault`
- `command_template.rs` — `CommandTemplate`, `CommandCategory`, `TemplateVariable`, `CommandCompatibility`
- `agent.rs` — `AgentPreferences`, `AgentSessionInfo`, `AttachedBlock`, `ContextSummary`, `AgentError`
- `file_browser.rs` — `FileEntry`, `DirectoryListing`, `FileContent`, `FileType`
- `error.rs` — `ContainerError` with `is_retryable()` / `recovery_suggestion()` — see [[error-model]]

Most structs use `Debug` with explicit redaction of secrets (password / passphrase / tokens print as `<redacted>`).

## `ssh/` — SSH client and connection pool

See [[ssh-subsystem]] for the full subsystem. Layout:

- `mod.rs` — global `SSH_POOL: Lazy<Arc<RwLock<SshConnectionPool>>>` plus free functions `connect`, `disconnect`, `is_connected`, `execute_on_system`, `validate_connection`.
- `pool.rs` — `SshConnectionPool` holding `DashMap<systemId, Arc<Mutex<SshClient>>>`. Pool config: 30s keep-alive, 5m max idle, 30s connection timeout.
- `client.rs` — `SshClient` built on `russh` 0.57. Handles direct connections, `connect_via_jump()` for ProxyJump, ProxyCommand support (spawns a child and wraps its stdio as a tokio `AsyncRead`/`AsyncWrite` stream). Per-hop credentials supported via `JumpHostCredentials`.
- `known_hosts.rs` — SHA-256 fingerprint verification against `~/.ssh/known_hosts`; accept-new policy on first connect, rejection on mismatch (enum `HostKeyCheckResult: Matched | Unknown | Mismatch | Revoked`).
- `port_forward.rs` — `PortForwardManager` for SSH-tunneled forwards; spawns a `TcpListener` + bidirectional relay using russh `direct-tcpip` channels.
- `config.rs` — parsing utilities for `~/.ssh/config` (multi-file aware with a shared `visited: HashSet<PathBuf>` for Include resolution).

## `executor/` — command execution abstraction

- `CommandResult { stdout, stderr, exit_code, execution_time_ms }` with `success()` and `combined_output()` helpers.
- `CommandExecutor` async trait: `execute`, `execute_with_timeout`, `can_execute`, `connection_type`.
- `LocalExecutor` (`local.rs`) — tokio `Command` over `/bin/sh -c` (Unix) or `cmd /C` (Windows). Augments PATH so Homebrew / Podman / Docker binaries are reachable. Sets `CREATE_NO_WINDOW` on Windows to avoid console popups.
- `RemoteExecutor` (`remote.rs`) — delegates to `ssh::execute_on_system(system_id, command)` and wraps the future in `tokio::time::timeout`.
- Factory `get_executor_for_system(system)` returns `Box<dyn CommandExecutor>` based on `ConnectionType`.

## `runtime/` — runtime command builder & parser

- `builder.rs::CommandBuilder` — static methods that emit the right shell invocation for `Docker`, `Podman`, or `Apple` container runtime. Container, image, volume, network and system-info variants. Special cases for Apple Container (e.g., `container resume` in place of `unpause`, stop+sleep+start for `restart`).
- `parser.rs::OutputParser` — handles Docker/Podman JSON (line-by-line objects or JSON array) and Apple's array-only format. Maps statuses, timestamps and port strings (`"80/tcp, 443/tcp"`) into typed fields. See [[container-runtimes]].

## `ai/` — multi-provider abstraction

- `provider.rs` — the `AiProvider` async trait (`get_completion`, `list_models`, `is_available`, `test_connection`), plus `CompletionRequest`, `CompletionResponse`, `ShellCommandResponse`, `AiModel`, and the `SHELL_COMMAND_JSON_SCHEMA` used for structured output.
- `settings.rs` — `AiSettings` and `AiProviderType { Ollama, OpenAi, Anthropic, AzureOpenAi, Groq, Gemini, DeepSeek, Mistral }`. Per-provider defaults for the summarizer model.
- `mod.rs::create_provider(&AiSettings) -> Arc<dyn AiProvider>` — the factory.
- Provider implementations: `ollama.rs`, `openai.rs`, `anthropic.rs`, `azure.rs`, `gemini.rs`, plus `openai_compat.rs` reused by Groq, DeepSeek, and Mistral.

See [[ai-providers]] and [[ai-agent]].

## Notable dependencies

`russh 0.57`, `russh-keys 0.49`, `ssh-key 0.6`, `reqwest 0.12` (rustls), `rig-core 0.28`, `tokio 1`, `dashmap 6`, `parking_lot 0.12`, `thiserror`, `schemars 1.2`, `vt100 0.15`, `open 5`, `whoami`.

## Consumption

Both downstream crates depend on this one:

- `src-tauri` pulls in `containerus-core` for everything non-UI: SSH, executors, runtime parsing, models, AI providers.
- `containerus-server` reuses all of the same code plus its own `ServerVault`, `ConnectionManager`, Kubernetes layer, and Axum routes.

## Related pages

- [[ssh-subsystem]]
- [[ssh-connection-pooling]]
- [[container-runtimes]]
- [[ai-providers]]
- [[domain-models]]
- [[error-model]]
