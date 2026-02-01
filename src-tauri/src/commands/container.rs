use tauri::State;

use crate::executor::local::LocalExecutor;
use crate::executor::CommandExecutor;
use crate::models::container::{Container, ContainerAction, ContainerDetails, ContainerRuntime};
use crate::models::error::ContainerError;
use crate::models::system::ConnectionType;
use crate::runtime::{CommandBuilder, OutputParser};
use crate::state::AppState;

/// List all containers for a system across all available runtimes
#[tauri::command]
pub async fn list_containers(
    state: State<'_, AppState>,
    system_id: String,
) -> Result<Vec<Container>, ContainerError> {
    let system = state
        .get_system(&system_id)
        .ok_or_else(|| ContainerError::SystemNotFound(system_id.clone()))?;

    // Check connection state
    let conn_state = state.get_connection_state_internal(&system_id);
    if conn_state != crate::models::system::ConnectionState::Connected {
        return Err(ContainerError::ConnectionFailed(
            system.hostname.clone(),
            "System is not connected".to_string(),
        ));
    }

    let mut all_containers = Vec::new();

    // Get executor based on connection type
    let executor: Box<dyn CommandExecutor> = match system.connection_type {
        ConnectionType::Local => Box::new(LocalExecutor::new()),
        ConnectionType::Remote => {
            // For remote, we use the SSH pool
            return list_containers_remote(&system_id, &system.available_runtimes).await;
        }
    };

    // Fetch from all available runtimes
    for runtime in &system.available_runtimes {
        // First get container IDs from docker ps
        let command = CommandBuilder::list_containers(*runtime);

        match executor.execute(&command).await {
            Ok(result) if result.success() => {
                // Parse basic list to get container IDs
                match OutputParser::parse_container_list(&result.stdout, *runtime, &system_id) {
                    Ok(basic_containers) => {
                        if basic_containers.is_empty() {
                            continue;
                        }

                        // Get IDs for batch inspect
                        let container_ids: Vec<&str> = basic_containers.iter()
                            .map(|c| c.id.0.as_str())
                            .collect();

                        // Batch inspect all containers to get full details
                        let inspect_cmd = CommandBuilder::batch_inspect_containers(*runtime, &container_ids);
                        if let Ok(inspect_result) = executor.execute(&inspect_cmd).await {
                            if inspect_result.success() {
                                // Parse full containers from inspect output
                                match OutputParser::parse_full_containers_from_inspect(
                                    &inspect_result.stdout,
                                    *runtime,
                                    &system_id,
                                ) {
                                    Ok(containers) => {
                                        all_containers.extend(containers);
                                    }
                                    Err(e) => {
                                        tracing::warn!(
                                            "Failed to parse full containers for {:?}: {}",
                                            runtime,
                                            e
                                        );
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        tracing::warn!(
                            "Failed to parse container list for {:?}: {}",
                            runtime,
                            e
                        );
                    }
                }
            }
            Ok(result) => {
                tracing::warn!(
                    "Container list command failed for {:?}: {}",
                    runtime,
                    result.stderr
                );
            }
            Err(e) => {
                tracing::warn!("Failed to execute container list for {:?}: {}", runtime, e);
            }
        }
    }

    Ok(all_containers)
}

/// List containers from a remote system via SSH
async fn list_containers_remote(
    system_id: &str,
    runtimes: &std::collections::HashSet<ContainerRuntime>,
) -> Result<Vec<Container>, ContainerError> {
    let mut all_containers = Vec::new();

    for runtime in runtimes {
        // First get container IDs from docker ps
        let command = CommandBuilder::list_containers(*runtime);

        match crate::ssh::execute_on_system(system_id, &command).await {
            Ok(result) if result.success() => {
                // Parse basic list to get container IDs
                match OutputParser::parse_container_list(&result.stdout, *runtime, system_id) {
                    Ok(basic_containers) => {
                        if basic_containers.is_empty() {
                            continue;
                        }

                        // Get IDs for batch inspect
                        let container_ids: Vec<&str> = basic_containers.iter()
                            .map(|c| c.id.0.as_str())
                            .collect();

                        // Batch inspect all containers to get full details
                        let inspect_cmd = CommandBuilder::batch_inspect_containers(*runtime, &container_ids);

                        match crate::ssh::execute_on_system(system_id, &inspect_cmd).await {
                            Ok(inspect_result) if inspect_result.success() => {
                                // Parse full containers from inspect output
                                match OutputParser::parse_full_containers_from_inspect(
                                    &inspect_result.stdout,
                                    *runtime,
                                    system_id,
                                ) {
                                    Ok(containers) => {
                                        all_containers.extend(containers);
                                    }
                                    Err(e) => {
                                        tracing::warn!(
                                            "Failed to parse full containers for {:?}: {}",
                                            runtime,
                                            e
                                        );
                                    }
                                }
                            }
                            Ok(inspect_result) => {
                                tracing::warn!(
                                    "Inspect command failed for {:?}: {}",
                                    runtime,
                                    inspect_result.stderr
                                );
                            }
                            Err(e) => {
                                tracing::warn!("Failed to execute inspect for {:?}: {}", runtime, e);
                            }
                        }
                    }
                    Err(e) => {
                        tracing::warn!(
                            "Failed to parse container list for {:?}: {}",
                            runtime,
                            e
                        );
                    }
                }
            }
            Ok(result) => {
                tracing::warn!(
                    "Container list command failed for {:?}: {}",
                    runtime,
                    result.stderr
                );
            }
            Err(e) => {
                tracing::warn!("Failed to execute container list for {:?}: {}", runtime, e);
            }
        }
    }

    Ok(all_containers)
}

/// Perform an action on a container (start, stop, restart, pause, unpause, remove)
#[tauri::command]
pub async fn perform_container_action(
    state: State<'_, AppState>,
    system_id: String,
    container_id: String,
    action: ContainerAction,
    runtime: ContainerRuntime,
) -> Result<(), ContainerError> {
    let system = state
        .get_system(&system_id)
        .ok_or_else(|| ContainerError::SystemNotFound(system_id.clone()))?;

    let command = CommandBuilder::container_action(runtime, action, &container_id);

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
        "Performed {:?} action on container {} (runtime: {:?})",
        action,
        container_id,
        runtime
    );

    Ok(())
}

/// Get container logs
#[tauri::command]
pub async fn get_container_logs(
    state: State<'_, AppState>,
    system_id: String,
    container_id: String,
    runtime: ContainerRuntime,
    tail: Option<u32>,
    timestamps: bool,
) -> Result<String, ContainerError> {
    let system = state
        .get_system(&system_id)
        .ok_or_else(|| ContainerError::SystemNotFound(system_id.clone()))?;

    let command = CommandBuilder::container_logs(runtime, &container_id, tail, timestamps);

    let result = match system.connection_type {
        ConnectionType::Local => {
            let executor = LocalExecutor::new();
            executor.execute(&command).await?
        }
        ConnectionType::Remote => crate::ssh::execute_on_system(&system_id, &command).await?,
    };

    // Logs can be in stdout or stderr depending on the container
    Ok(if result.stdout.is_empty() {
        result.stderr
    } else {
        result.stdout
    })
}

/// Inspect a container to get detailed information
#[tauri::command]
pub async fn inspect_container(
    state: State<'_, AppState>,
    system_id: String,
    container_id: String,
    runtime: ContainerRuntime,
) -> Result<ContainerDetails, ContainerError> {
    let system = state
        .get_system(&system_id)
        .ok_or_else(|| ContainerError::SystemNotFound(system_id.clone()))?;

    let command = CommandBuilder::inspect_container(runtime, &container_id);

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

    OutputParser::parse_container_details(&result.stdout, runtime)
}
