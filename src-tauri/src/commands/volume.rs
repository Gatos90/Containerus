use tauri::State;

use crate::executor::local::LocalExecutor;
use crate::executor::CommandExecutor;
use crate::models::container::ContainerRuntime;
use crate::models::error::ContainerError;
use crate::models::system::ConnectionType;
use crate::models::volume::Volume;
use crate::runtime::{CommandBuilder, OutputParser};
use crate::state::AppState;

/// List all volumes for a system across all available runtimes
#[tauri::command]
pub async fn list_volumes(
    state: State<'_, AppState>,
    system_id: String,
) -> Result<Vec<Volume>, ContainerError> {
    let system = state
        .get_system(&system_id)
        .ok_or_else(|| ContainerError::SystemNotFound(system_id.clone()))?;

    let mut all_volumes = Vec::new();

    for runtime in &system.available_runtimes {
        let command = CommandBuilder::list_volumes(*runtime);

        let result = match system.connection_type {
            ConnectionType::Local => {
                let executor = LocalExecutor::new();
                executor.execute(&command).await?
            }
            ConnectionType::Remote => {
                crate::ssh::execute_on_system(&system_id, &command).await?
            }
        };

        if result.success() {
            match OutputParser::parse_volume_list(&result.stdout, *runtime, &system_id) {
                Ok(volumes) => all_volumes.extend(volumes),
                Err(e) => {
                    tracing::warn!("Failed to parse volume list for {:?}: {}", runtime, e);
                }
            }
        }
    }

    Ok(all_volumes)
}

/// Create a new volume
#[tauri::command]
pub async fn create_volume(
    state: State<'_, AppState>,
    system_id: String,
    name: String,
    runtime: ContainerRuntime,
) -> Result<(), ContainerError> {
    let system = state
        .get_system(&system_id)
        .ok_or_else(|| ContainerError::SystemNotFound(system_id.clone()))?;

    let command = CommandBuilder::create_volume(runtime, &name);

    let result = match system.connection_type {
        ConnectionType::Local => {
            let executor = LocalExecutor::new();
            executor.execute(&command).await?
        }
        ConnectionType::Remote => crate::ssh::execute_on_system(&system_id, &command).await?,
    };

    if !result.success() {
        return Err(ContainerError::CommandExecutionFailed {
            command,
            exit_code: result.exit_code,
            stderr: result.stderr,
        });
    }

    tracing::info!("Created volume {} on system {}", name, system_id);
    Ok(())
}

/// Remove a volume
#[tauri::command]
pub async fn remove_volume(
    state: State<'_, AppState>,
    system_id: String,
    name: String,
    runtime: ContainerRuntime,
    force: bool,
) -> Result<(), ContainerError> {
    let system = state
        .get_system(&system_id)
        .ok_or_else(|| ContainerError::SystemNotFound(system_id.clone()))?;

    let command = CommandBuilder::remove_volume(runtime, &name, force);

    let result = match system.connection_type {
        ConnectionType::Local => {
            let executor = LocalExecutor::new();
            executor.execute(&command).await?
        }
        ConnectionType::Remote => crate::ssh::execute_on_system(&system_id, &command).await?,
    };

    if !result.success() {
        return Err(ContainerError::CommandExecutionFailed {
            command,
            exit_code: result.exit_code,
            stderr: result.stderr,
        });
    }

    tracing::info!("Removed volume {} on system {}", name, system_id);
    Ok(())
}
