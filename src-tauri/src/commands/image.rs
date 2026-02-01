use tauri::State;

use crate::executor::local::LocalExecutor;
use crate::executor::CommandExecutor;
use crate::models::container::ContainerRuntime;
use crate::models::error::ContainerError;
use crate::models::image::ContainerImage;
use crate::models::system::ConnectionType;
use crate::runtime::{CommandBuilder, OutputParser};
use crate::state::AppState;

/// List all images for a system across all available runtimes
#[tauri::command]
pub async fn list_images(
    state: State<'_, AppState>,
    system_id: String,
) -> Result<Vec<ContainerImage>, ContainerError> {
    let system = state
        .get_system(&system_id)
        .ok_or_else(|| ContainerError::SystemNotFound(system_id.clone()))?;

    let mut all_images = Vec::new();

    for runtime in &system.available_runtimes {
        let command = CommandBuilder::list_images(*runtime);

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
            match OutputParser::parse_image_list(&result.stdout, *runtime, &system_id) {
                Ok(images) => all_images.extend(images),
                Err(e) => {
                    tracing::warn!("Failed to parse image list for {:?}: {}", runtime, e);
                }
            }
        }
    }

    Ok(all_images)
}

/// Pull an image from a registry
#[tauri::command]
pub async fn pull_image(
    state: State<'_, AppState>,
    system_id: String,
    image: String,
    runtime: ContainerRuntime,
) -> Result<String, ContainerError> {
    let system = state
        .get_system(&system_id)
        .ok_or_else(|| ContainerError::SystemNotFound(system_id.clone()))?;

    let command = CommandBuilder::pull_image(runtime, &image);

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

    tracing::info!("Pulled image {} on system {}", image, system_id);
    Ok(result.stdout)
}

/// Remove an image
#[tauri::command]
pub async fn remove_image(
    state: State<'_, AppState>,
    system_id: String,
    image_id: String,
    runtime: ContainerRuntime,
    force: bool,
) -> Result<(), ContainerError> {
    let system = state
        .get_system(&system_id)
        .ok_or_else(|| ContainerError::SystemNotFound(system_id.clone()))?;

    let command = CommandBuilder::remove_image(runtime, &image_id, force);

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

    tracing::info!("Removed image {} on system {}", image_id, system_id);
    Ok(())
}
