# Domain models

**Summary**: Every domain type is defined in `containerus-core::models` so both the desktop and the server share the same shapes. Secrets use `Debug` redaction.

**Sources**: `crates/containerus-core/src/models/*.rs`.

**Last updated**: 2026-04-16

**Parent**: [[crate-containerus-core]]
**Siblings**: [[ssh-subsystem]], [[container-runtimes]], [[executor-abstraction]], [[ai-providers]], [[error-model]]
**See also**: [[glossary]]

---

## Files

| File | Top-level types |
|---|---|
| `container.rs` | `Container`, `ContainerDetails`, `ContainerId`, `ContainerStatus`, `ContainerRuntime`, `ContainerAction`, `PortMapping`, `VolumeMount`, `NetworkInfo`, `NetworkSettings`, `ResourceLimits`, `RestartPolicy`, `HealthCheck`, `ContainerState`, `ContainerConfig`, `DeviceMapping`, `LogConfig`, `Ulimit`, `HostConfigExtras` |
| `system.rs` | `SystemId`, `ContainerSystem`, `ConnectionType`, `ConnectionState`, `SshAuthMethod`, `SshConfig`, `JumpHost`, `SystemHealth`, `SystemInfo`, `OsType`, `LiveSystemMetrics` |
| `image.rs` | `ContainerImage` (with `full_name()`, `size_human()`) |
| `volume.rs` | `Volume` |
| `network.rs` | `Network` |
| `port_forward.rs` | `PortForward`, `PortForwardStatus`, `CreatePortForwardRequest` |
| `credentials.rs` | `SshCredentials`, `JumpHostCredentials`, `BackendTokens`, `CredentialVault` |
| `command_template.rs` | `CommandTemplate`, `CommandCategory`, `TemplateVariable`, `CommandCompatibility` |
| `agent.rs` | `AgentPreferences`, `AgentSessionInfo`, `AttachedBlock`, `ContextSummary`, `AgentError` |
| `file_browser.rs` | `FileType`, `FileEntry`, `DirectoryListing`, `FileContent` |
| `error.rs` | `ContainerError` — see [[error-model]] |

## Container — the big one

`Container` (`container.rs:40-73`) is the main data structure the app revolves around.

Basic fields: `id`, `name`, `image`, `status`, `runtime`, `system_id`, `created_at`, `ports: Vec<PortMapping>`.

Details: `environment`, `volumes: Vec<VolumeMount>`, `network_settings`, `resource_limits`, `labels`, `restart_policy`, `health_check`, `state: ContainerState`, `config: ContainerConfig`, `host_config: HostConfigExtras`.

Methods: `short_id()`, `display_name()`, `is_running()`, `available_actions()`.

`ContainerDetails` is a compatibility alias used by the inspect command.

`PortMapping { host_ip, host_port, container_port, protocol }` — `parse_docker_ports` produces these from Docker's compact `"80/tcp, 443/tcp"` strings.

## System

`ContainerSystem { id, name, hostname, connection_type, primary_runtime, available_runtimes, ssh_config, auto_connect }`.

`SshConfig { username, port, auth_method, private_key_path, private_key_content, connection_timeout, proxy_command, proxy_jump: Option<Vec<JumpHost>>, ssh_config_host }`.

`JumpHost { hostname, port, username, identity_file, auth_method, private_key_content }`.

`ConnectionState { Disconnected, Connecting, Connected, Error { message } }`.

`LiveSystemMetrics` — see [[monitoring]].

## Credentials — redacted `Debug`

Every struct in `credentials.rs` implements `Debug` with `<redacted>` for the secret fields. That means accidentally printing `SshCredentials` in a log or panic message won't leak the password / key / tokens.

## Command templates

`CommandTemplate` represents a saved shell template:

- `id`, `name`, `description`, `command` (with `${variable}` placeholders)
- `category: CommandCategory` (ContainerManagement / Debugging / Networking / Images / Volumes / System / Pods / Custom)
- `tags: Vec<String>`
- `variables: Vec<TemplateVariable>` (each with name, description, default, required)
- `compatibility: CommandCompatibility { runtimes: Vec<ContainerRuntime>, system_ids: Option<Vec<String>> }`
- `is_favorite`, `is_built_in`, `created_at`, `updated_at`

## Agent

See [[ai-agent]]. Core types: `AgentPreferences` (user tuning), `AgentSessionInfo` (session summary for the UI), `ContextSummary` (displayed in context panel), `AttachedBlock` (a captured command+output).

`AgentError` enumerates 11 failure modes: session-not-found, provider-unavailable, rate-limited, context-too-large, confirmation-timeout, and so on.

## File browser

See [[file-browser]]. Just enough metadata to render a file list and open a Monaco editor buffer.

## Related pages

- [[error-model]]
- [[crate-containerus-core]]
- [[ai-agent]]
- [[container-runtimes]]
