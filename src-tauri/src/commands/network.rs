use tauri::State;

use crate::executor::local::LocalExecutor;
use crate::executor::CommandExecutor;
use crate::models::container::ContainerRuntime;
use crate::models::error::ContainerError;
use crate::models::network::Network;
use crate::models::system::ConnectionType;
use crate::runtime::{CommandBuilder, OutputParser};
use crate::state::AppState;

/// List all networks for a system across all available runtimes
#[tauri::command]
pub async fn list_networks(
    state: State<'_, AppState>,
    system_id: String,
) -> Result<Vec<Network>, ContainerError> {
    let system = state
        .get_system(&system_id)
        .ok_or_else(|| ContainerError::SystemNotFound(system_id.clone()))?;

    let mut all_networks = Vec::new();

    for runtime in &system.available_runtimes {
        let command = CommandBuilder::list_networks(*runtime);

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
            match OutputParser::parse_network_list(&result.stdout, *runtime, &system_id) {
                Ok(networks) => all_networks.extend(networks),
                Err(e) => {
                    tracing::warn!("Failed to parse network list for {:?}: {}", runtime, e);
                }
            }
        }
    }

    Ok(all_networks)
}

/// Create a new network
#[tauri::command]
pub async fn create_network(
    state: State<'_, AppState>,
    system_id: String,
    name: String,
    runtime: ContainerRuntime,
    driver: Option<String>,
    subnet: Option<String>,
) -> Result<(), ContainerError> {
    let system = state
        .get_system(&system_id)
        .ok_or_else(|| ContainerError::SystemNotFound(system_id.clone()))?;

    let command = CommandBuilder::create_network(
        runtime,
        &name,
        driver.as_deref(),
        subnet.as_deref(),
    );

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

    tracing::info!("Created network {} on system {}", name, system_id);
    Ok(())
}

/// Remove a network
#[tauri::command]
pub async fn remove_network(
    state: State<'_, AppState>,
    system_id: String,
    name: String,
    runtime: ContainerRuntime,
) -> Result<(), ContainerError> {
    let system = state
        .get_system(&system_id)
        .ok_or_else(|| ContainerError::SystemNotFound(system_id.clone()))?;

    let command = CommandBuilder::remove_network(runtime, &name);

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

    tracing::info!("Removed network {} on system {}", name, system_id);
    Ok(())
}

/// Connect a container to a network
#[tauri::command]
pub async fn connect_container_to_network(
    state: State<'_, AppState>,
    system_id: String,
    container_id: String,
    network_name: String,
    runtime: ContainerRuntime,
) -> Result<(), ContainerError> {
    let system = state
        .get_system(&system_id)
        .ok_or_else(|| ContainerError::SystemNotFound(system_id.clone()))?;

    let command = CommandBuilder::connect_to_network(runtime, &network_name, &container_id);

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

    tracing::info!(
        "Connected container {} to network {} on system {}",
        container_id,
        network_name,
        system_id
    );
    Ok(())
}

/// Disconnect a container from a network
#[tauri::command]
pub async fn disconnect_container_from_network(
    state: State<'_, AppState>,
    system_id: String,
    container_id: String,
    network_name: String,
    runtime: ContainerRuntime,
) -> Result<(), ContainerError> {
    let system = state
        .get_system(&system_id)
        .ok_or_else(|| ContainerError::SystemNotFound(system_id.clone()))?;

    let command = CommandBuilder::disconnect_from_network(runtime, &network_name, &container_id);

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

    tracing::info!(
        "Disconnected container {} from network {} on system {}",
        container_id,
        network_name,
        system_id
    );
    Ok(())
}
