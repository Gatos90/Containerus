# Error model

**Summary**: `ContainerError` in `containerus-core::models::error` is the unified error type. 18 variants, each with an `is_retryable()` and a `recovery_suggestion()` so the frontend can offer a helpful action rather than a raw string.

**Sources**: `crates/containerus-core/src/models/error.rs`, `src/app/core/services/error-mapping.service.ts`.

**Last updated**: 2026-04-16

**Parent**: [[crate-containerus-core]]
**Siblings**: [[domain-models]], [[ssh-subsystem]], [[container-runtimes]], [[executor-abstraction]], [[ai-providers]]

---

## Variants

```rust
pub enum ContainerError {
    SystemNotFound(String),
    NotConnected(String),
    ConnectionFailed { reason: String },
    SshAuthenticationFailed { reason: String },
    CommandExecutionFailed { command: String, exit_code: i32, stderr: String },
    ContainerNotFound(String),
    UnsupportedRuntime(ContainerRuntime),
    NetworkTimeout,
    InvalidConfiguration(String),
    ParseError { what: String, raw: String },
    PermissionDenied(String),
    UnsupportedOperation(String),
    CredentialError(String),
    Internal(String),
    DatabaseError(String),
    NotFound { resource: String, id: String },
    InvalidOperation(String),
    HostKeyVerificationFailed { hostname: String, reason: String },
}
```

Aliases: `ContainerusError = ContainerError`, `Result<T> = std::result::Result<T, ContainerError>`.

## Retry classification

`is_retryable()` returns true for:
- `NetworkTimeout`
- `ConnectionFailed`
- `NotConnected` (can retry after reconnect)

Everything else is considered a hard error — no automatic retry by the framework. Retry policy is left to the caller.

## Recovery suggestions

`recovery_suggestion()` returns a human-friendly tip per variant. Examples:
- `SshAuthenticationFailed` → "Double-check your password or private key. If you use ssh-agent, make sure it's running."
- `HostKeyVerificationFailed` → "The server's SSH key changed. If this is expected, remove the host from known_hosts in Settings."
- `UnsupportedRuntime` → "The selected runtime isn't available on this system. Try `detect_runtimes` to probe again."
- `PermissionDenied` → "Check file/container permissions or run this from a user with rights."

The frontend's `ErrorMappingService` consumes these and renders toasts with the suggestion as the body.

## Error boundaries

- **Tauri commands** — each command returns `Result<_, ContainerError>`; serde serializes it as the JSON representation of the enum. The frontend receives a tagged object and `ErrorMappingService` maps it back.
- **Server endpoints** — `ContainerError` is converted into a `(StatusCode, Json)` pair in `impl IntoResponse`. 4xx for user-facing errors (NotFound, InvalidOperation, PermissionDenied, AuthenticationFailed), 5xx for Internal / DatabaseError / Parse. Body: `{ "error": "...", "suggestion": "...", "retryable": bool }`.
- **Streaming events** — `AgentEvent::Error { error_type, message, recoverable, suggestion }` carries the same idea for the streaming agent channel. See [[ai-agent]].

## HostKeyVerificationFailed flow

When the classifier triggers during an SSH connect, the error carries the hostname. The UI renders a modal with options to:
1. View both fingerprints (SHA-256).
2. Remove the conflicting `known_hosts` entry via `remove_known_host(hostname, port)`.
3. Retry the connection.

This is the one error variant with a directly-actionable recovery path wired through the UI.

## Related pages

- [[domain-models]]
- [[ssh-subsystem]]
- [[ai-agent]]
