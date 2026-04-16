use tauri::State;

use crate::executor::local::LocalExecutor;
use crate::executor::CommandExecutor;
use crate::models::container::ContainerRuntime;
use crate::models::error::ContainerError;
use crate::models::system::ConnectionType;
use crate::state::AppState;

/// Returns the compose command prefix for the given runtime.
/// Docker Compose v2: `docker compose`
/// Podman Compose: `podman compose`
fn compose_prefix(runtime: ContainerRuntime) -> &'static str {
    match runtime {
        ContainerRuntime::Docker => "docker compose",
        ContainerRuntime::Podman => "podman compose",
        ContainerRuntime::Apple => "docker compose",
    }
}

async fn run_compose_command(
    state: &State<'_, AppState>,
    system_id: &str,
    command: &str,
) -> Result<String, ContainerError> {
    let system = state
        .get_system(system_id)
        .await
        .ok_or_else(|| ContainerError::SystemNotFound(system_id.to_string()))?;

    let result = match system.connection_type {
        ConnectionType::Local => {
            let executor = LocalExecutor::new();
            executor.execute(command).await?
        }
        ConnectionType::Remote => {
            crate::ssh::execute_on_system(system_id, command).await?
        }
    };

    // Combine stdout + stderr so callers get full compose output
    let output = format!("{}{}", result.stdout, result.stderr);

    if !result.success() {
        return Err(ContainerError::CommandExecutionFailed {
            command: command.to_string(),
            exit_code: result.exit_code,
            stderr: result.stderr,
        });
    }

    Ok(output)
}

/// Start all services in a compose project (`docker compose -p <name> up -d`).
///
/// Returns the combined stdout/stderr output from compose.
#[tauri::command]
pub async fn compose_up(
    state: State<'_, AppState>,
    system_id: String,
    project_name: String,
    runtime: ContainerRuntime,
) -> Result<String, ContainerError> {
    let prefix = compose_prefix(runtime);
    let command = format!("{} -p {} up -d", prefix, shell_escape(&project_name));
    tracing::info!("compose_up: {} on system {}", command, system_id);
    run_compose_command(&state, &system_id, &command).await
}

/// Stop and remove containers for a compose project (`docker compose -p <name> down`).
#[tauri::command]
pub async fn compose_down(
    state: State<'_, AppState>,
    system_id: String,
    project_name: String,
    runtime: ContainerRuntime,
) -> Result<String, ContainerError> {
    let prefix = compose_prefix(runtime);
    let command = format!("{} -p {} down", prefix, shell_escape(&project_name));
    tracing::info!("compose_down: {} on system {}", command, system_id);
    run_compose_command(&state, &system_id, &command).await
}

/// Restart all services (or a specific service) in a compose project.
///
/// If `service_name` is `None`, all services are restarted.
#[tauri::command]
pub async fn compose_restart(
    state: State<'_, AppState>,
    system_id: String,
    project_name: String,
    runtime: ContainerRuntime,
    service_name: Option<String>,
) -> Result<String, ContainerError> {
    let prefix = compose_prefix(runtime);
    let svc = service_name
        .as_deref()
        .map(|s| format!(" {}", shell_escape(s)))
        .unwrap_or_default();
    let command = format!(
        "{} -p {} restart{}",
        prefix,
        shell_escape(&project_name),
        svc
    );
    tracing::info!("compose_restart: {} on system {}", command, system_id);
    run_compose_command(&state, &system_id, &command).await
}

/// Fetch logs for all services (or a specific service) in a compose project.
///
/// Returns the last `tail` lines of combined log output.
#[tauri::command]
pub async fn compose_logs(
    state: State<'_, AppState>,
    system_id: String,
    project_name: String,
    runtime: ContainerRuntime,
    service_name: Option<String>,
    tail: u32,
) -> Result<String, ContainerError> {
    let system = state
        .get_system(&system_id)
        .await
        .ok_or_else(|| ContainerError::SystemNotFound(system_id.clone()))?;

    let prefix = compose_prefix(runtime);
    let svc = service_name
        .as_deref()
        .map(|s| format!(" {}", shell_escape(s)))
        .unwrap_or_default();
    let command = format!(
        "{} -p {} logs --no-color --tail={}{}",
        prefix,
        shell_escape(&project_name),
        tail,
        svc
    );

    tracing::info!("compose_logs: {} on system {}", command, system_id);

    let result = match system.connection_type {
        ConnectionType::Local => {
            let executor = LocalExecutor::new();
            executor.execute(&command).await?
        }
        ConnectionType::Remote => {
            crate::ssh::execute_on_system(&system_id, &command).await?
        }
    };

    // Logs may be on stderr even when compose exits 0
    Ok(format!("{}{}", result.stdout, result.stderr))
}

/// Minimal single-argument shell escaping: wraps value in single quotes,
/// escaping any embedded single quotes. Sufficient for project/service names
/// which should only contain alphanumerics, hyphens, and underscores in
/// practice, but we guard against unusual characters.
fn shell_escape(s: &str) -> String {
    // If the name is simple (alphanumeric + hyphen + underscore + dot),
    // return it as-is to keep command output readable in logs.
    if s.chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return s.to_string();
    }
    // Otherwise wrap in single quotes and escape embedded single quotes.
    format!("'{}'", s.replace('\'', "'\\''"))
}
