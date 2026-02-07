use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::executor::local::LocalExecutor;
use crate::executor::CommandExecutor;
use crate::keyring_store::JumpHostCredentials;
use crate::models::container::ContainerRuntime;
use crate::models::error::ContainerError;
use crate::models::system::{ConnectionState, ConnectionType, ContainerSystem, ExtendedSystemInfo, LiveSystemMetrics, SshConfig, SystemId};
use crate::monitoring::MonitoringManager;
use crate::runtime::{CommandBuilder, OutputParser};
use crate::state::AppState;

#[tauri::command]
pub fn list_systems(state: State<'_, AppState>) -> Vec<ContainerSystem> {
    state.list_systems()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSystemRequest {
    pub name: String,
    pub hostname: String,
    pub connection_type: ConnectionType,
    pub primary_runtime: ContainerRuntime,
    pub available_runtimes: Vec<ContainerRuntime>,
    pub ssh_config: Option<SshConfig>,
    pub auto_connect: bool,
}

#[tauri::command]
pub fn add_system(state: State<'_, AppState>, payload: NewSystemRequest) -> Result<ContainerSystem, ContainerError> {
    let available_runtimes = payload.available_runtimes.into_iter().collect::<HashSet<_>>();

    state.add_system(ContainerSystem {
        id: SystemId(String::new()),
        name: payload.name,
        hostname: payload.hostname,
        connection_type: payload.connection_type,
        primary_runtime: payload.primary_runtime,
        available_runtimes,
        ssh_config: payload.ssh_config,
        auto_connect: payload.auto_connect,
    })
}

#[tauri::command]
pub async fn connect_system(
    state: State<'_, AppState>,
    system_id: String,
    password: Option<String>,
    passphrase: Option<String>,
    private_key: Option<String>,
    jump_host_credentials: Option<HashMap<String, JumpHostCredentials>>,
) -> Result<ConnectionState, ContainerError> {
    let system = state
        .get_system(&system_id)
        .ok_or_else(|| ContainerError::SystemNotFound(system_id.clone()))?;

    // Set state to connecting
    state.set_connection_state(&system_id, ConnectionState::Connecting);

    match system.connection_type {
        ConnectionType::Local => {
            let _ = jump_host_credentials; // not used for local
            // For local, just verify we can execute commands
            let executor = LocalExecutor::new();
            match executor.execute("echo ok").await {
                Ok(result) if result.success() => {
                    state.set_connection_state(&system_id, ConnectionState::Connected);
                    Ok(ConnectionState::Connected)
                }
                Ok(result) => {
                    state.set_connection_state(&system_id, ConnectionState::Error);
                    Err(ContainerError::CommandExecutionFailed {
                        command: "echo ok".to_string(),
                        exit_code: result.exit_code,
                        stderr: result.stderr,
                    })
                }
                Err(e) => {
                    state.set_connection_state(&system_id, ConnectionState::Error);
                    Err(e)
                }
            }
        }
        ConnectionType::Remote => {
            // Resolve jump host credentials: prefer parameter, fall back to cache
            let provided_jhc = jump_host_credentials.unwrap_or_default();

            // Try to get stored credentials if not provided
            let (effective_password, effective_passphrase, effective_private_key, jump_host_creds) =
                if password.is_some() || passphrase.is_some() || private_key.is_some() {
                    // Use provided credentials; merge jump host creds from param + cache
                    let mut jhc = state.get_cached_ssh_credentials(&system_id)
                        .map(|c| c.jump_host_credentials)
                        .unwrap_or_default();
                    jhc.extend(provided_jhc);
                    (password, passphrase, private_key, jhc)
                } else if !provided_jhc.is_empty() {
                    // Jump host creds provided but no target creds — resolve target from cache/DB
                    #[cfg(not(target_os = "android"))]
                    {
                        let cached = state.get_cached_ssh_credentials(&system_id);
                        let (pw, pp, pk) = match &cached {
                            Some(kr) if kr.password.is_some() || kr.passphrase.is_some() || kr.private_key.is_some() => {
                                (kr.password.clone(), kr.passphrase.clone(), kr.private_key.clone())
                            }
                            _ => {
                                match state.get_ssh_credentials(&system_id) {
                                    Ok(creds) => (creds.password, creds.passphrase, creds.private_key),
                                    Err(_) => (None, None, None),
                                }
                            }
                        };
                        let mut jhc = cached.map(|c| c.jump_host_credentials).unwrap_or_default();
                        jhc.extend(provided_jhc);
                        (pw, pp, pk, jhc)
                    }
                    #[cfg(target_os = "android")]
                    {
                        match state.get_ssh_credentials(&system_id) {
                            Ok(creds) => (creds.password, creds.passphrase, creds.private_key, provided_jhc),
                            Err(_) => (None, None, None, provided_jhc),
                        }
                    }
                } else {
                    // No credentials provided at all — resolve everything from cache/DB
                    #[cfg(not(target_os = "android"))]
                    {
                        match state.get_cached_ssh_credentials(&system_id) {
                            Some(kr) if kr.password.is_some() || kr.passphrase.is_some() || kr.private_key.is_some() => {
                                tracing::debug!("Retrieved credentials from cache for system {}", system_id);
                                let jhc = kr.jump_host_credentials.clone();
                                (kr.password, kr.passphrase, kr.private_key, jhc)
                            }
                            Some(kr) if !kr.jump_host_credentials.is_empty() => {
                                let jhc = kr.jump_host_credentials.clone();
                                match state.get_ssh_credentials(&system_id) {
                                    Ok(creds) => (creds.password, creds.passphrase, creds.private_key, jhc),
                                    Err(_) => (None, None, None, jhc),
                                }
                            }
                            _ => {
                                match state.get_ssh_credentials(&system_id) {
                                    Ok(creds) => {
                                        tracing::debug!("Retrieved stored credentials from DB for system {}", system_id);
                                        (creds.password, creds.passphrase, creds.private_key, HashMap::new())
                                    }
                                    Err(e) => {
                                        tracing::debug!("No stored credentials for system {}: {}", system_id, e);
                                        (None, None, None, HashMap::new())
                                    }
                                }
                            }
                        }
                    }
                    #[cfg(target_os = "android")]
                    {
                        match state.get_ssh_credentials(&system_id) {
                            Ok(creds) => {
                                tracing::debug!("Retrieved stored credentials for system {}", system_id);
                                (creds.password, creds.passphrase, creds.private_key, HashMap::new())
                            }
                            Err(e) => {
                                tracing::debug!("No stored credentials for system {}: {}", system_id, e);
                                (None, None, None, HashMap::new())
                            }
                        }
                    }
                };

            // For remote, establish SSH connection
            match crate::ssh::connect(
                &system,
                effective_password.as_deref(),
                effective_passphrase.as_deref(),
                effective_private_key.as_deref(),
                &jump_host_creds,
            ).await {
                Ok(()) => {
                    state.set_connection_state(&system_id, ConnectionState::Connected);
                    Ok(ConnectionState::Connected)
                }
                Err(e) => {
                    state.set_connection_state(&system_id, ConnectionState::Error);
                    Err(e)
                }
            }
        }
    }
}

#[tauri::command]
pub async fn disconnect_system(
    state: State<'_, AppState>,
    system_id: String,
) -> Result<ConnectionState, ContainerError> {
    let system = state
        .get_system(&system_id)
        .ok_or_else(|| ContainerError::SystemNotFound(system_id.clone()))?;

    if system.connection_type == ConnectionType::Remote {
        // Disconnect SSH
        crate::ssh::disconnect(&system_id).await?;
    }

    state.set_connection_state(&system_id, ConnectionState::Disconnected);
    Ok(ConnectionState::Disconnected)
}

#[tauri::command]
pub fn get_connection_state(state: State<'_, AppState>, system_id: String) -> ConnectionState {
    state.connection_state(&system_id)
}

/// Detect available container runtimes on a system
#[tauri::command]
pub async fn detect_runtimes(
    state: State<'_, AppState>,
    system_id: String,
) -> Result<Vec<ContainerRuntime>, ContainerError> {
    let system = state
        .get_system(&system_id)
        .ok_or_else(|| ContainerError::SystemNotFound(system_id.clone()))?;

    let mut available_runtimes = Vec::new();
    let runtimes_to_check = [
        ContainerRuntime::Docker,
        ContainerRuntime::Podman,
        ContainerRuntime::Apple,
    ];

    for runtime in runtimes_to_check {
        // Skip Apple Container on non-macOS systems (it's only available on macOS 26+)
        if runtime == ContainerRuntime::Apple && !cfg!(target_os = "macos") {
            continue;
        }

        let command = CommandBuilder::detect_runtime(runtime);

        let result = match system.connection_type {
            ConnectionType::Local => {
                let executor = LocalExecutor::new();
                executor.execute(&command).await
            }
            ConnectionType::Remote => {
                crate::ssh::execute_on_system(&system_id, &command).await
            }
        };

        match result {
            Ok(res) if res.success() => {
                if OutputParser::parse_runtime_available(&res.stdout, runtime) {
                    tracing::info!("Detected runtime {:?} on system {}", runtime, system_id);
                    available_runtimes.push(runtime);
                }
            }
            Ok(_) => {
                tracing::debug!("Runtime {:?} not available on system {}", runtime, system_id);
            }
            Err(e) => {
                tracing::debug!(
                    "Failed to check runtime {:?} on system {}: {}",
                    runtime,
                    system_id,
                    e
                );
            }
        }
    }

    // Update the system's available runtimes
    if !available_runtimes.is_empty() {
        state.update_system_runtimes(&system_id, available_runtimes.iter().copied().collect());
    }

    Ok(available_runtimes)
}

/// Update an existing system
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSystemRequest {
    pub id: String,
    pub name: String,
    pub hostname: String,
    pub connection_type: ConnectionType,
    pub primary_runtime: ContainerRuntime,
    pub available_runtimes: Vec<ContainerRuntime>,
    pub ssh_config: Option<SshConfig>,
    pub auto_connect: bool,
}

#[tauri::command]
pub fn update_system(
    state: State<'_, AppState>,
    payload: UpdateSystemRequest,
) -> Result<ContainerSystem, ContainerError> {
    let available_runtimes = payload.available_runtimes.into_iter().collect::<HashSet<_>>();

    let system = ContainerSystem {
        id: SystemId(payload.id.clone()),
        name: payload.name,
        hostname: payload.hostname,
        connection_type: payload.connection_type,
        primary_runtime: payload.primary_runtime,
        available_runtimes,
        ssh_config: payload.ssh_config,
        auto_connect: payload.auto_connect,
    };

    state
        .update_system(system)
        .ok_or_else(|| ContainerError::SystemNotFound(payload.id))
}

/// Remove a system
#[tauri::command]
pub fn remove_system(
    state: State<'_, AppState>,
    system_id: String,
) -> Result<bool, ContainerError> {
    let removed = state.remove_system(&system_id);

    // Remove from cache and flush vault on desktop (non-fatal)
    #[cfg(not(target_os = "android"))]
    if removed {
        state.remove_cached_ssh_credentials(&system_id);
        if let Err(e) = state.flush_vault() {
            tracing::warn!("Failed to flush vault after removing system {}: {}", system_id, e);
        }
    }

    Ok(removed)
}

/// Store SSH credentials — desktop stores in OS keyring + cache, Android stores in DB
#[tauri::command]
pub fn store_ssh_credentials(
    state: State<'_, AppState>,
    system_id: String,
    password: Option<String>,
    passphrase: Option<String>,
    private_key: Option<String>,
    jump_host_credentials: Option<HashMap<String, JumpHostCredentials>>,
) -> Result<(), ContainerError> {
    tracing::info!("Storing SSH credentials for system: {}", system_id);

    #[cfg(not(target_os = "android"))]
    {
        // Merge with existing cached credentials
        let existing = state.get_cached_ssh_credentials(&system_id).unwrap_or_default();
        let mut jhc = existing.jump_host_credentials;
        if let Some(new_jhc) = jump_host_credentials {
            jhc.extend(new_jhc);
        }
        let creds = crate::keyring_store::SshCredentials {
            password: password.or(existing.password),
            passphrase: passphrase.or(existing.passphrase),
            private_key: private_key.or(existing.private_key),
            jump_host_credentials: jhc,
        };
        state.cache_ssh_credentials(&system_id, creds);
        state.flush_vault().map_err(|e| ContainerError::CredentialError(e))?;

        Ok(())
    }

    #[cfg(target_os = "android")]
    {
        let _ = jump_host_credentials; // Android: jump host creds not stored separately
        state.store_ssh_credentials(&system_id, password.as_deref(), passphrase.as_deref(), private_key.as_deref())
    }
}

/// Get stored SSH credentials — desktop reads from cache (falls back to DB), Android reads from DB
#[tauri::command]
pub fn get_ssh_credentials(
    state: State<'_, AppState>,
    system_id: String,
) -> Result<(Option<String>, Option<String>, Option<String>), ContainerError> {
    #[cfg(not(target_os = "android"))]
    {
        if let Some(kr) = state.get_cached_ssh_credentials(&system_id) {
            if kr.password.is_some() || kr.passphrase.is_some() || kr.private_key.is_some() {
                return Ok((kr.password, kr.passphrase, kr.private_key));
            }
        }
        // Fall back to DB for not-yet-migrated credentials
        let creds = state.get_ssh_credentials(&system_id)?;
        Ok((creds.password, creds.passphrase, creds.private_key))
    }

    #[cfg(target_os = "android")]
    {
        let creds = state.get_ssh_credentials(&system_id)?;
        Ok((creds.password, creds.passphrase, creds.private_key))
    }
}

/// Get extended system information (user, OS, hardware) for a connected system
#[tauri::command]
pub async fn get_extended_system_info(
    state: State<'_, AppState>,
    system_id: String,
) -> Result<ExtendedSystemInfo, ContainerError> {
    let system = state
        .get_system(&system_id)
        .ok_or_else(|| ContainerError::SystemNotFound(system_id.clone()))?;

    // Verify system is connected
    let conn_state = state.connection_state(&system_id);
    if conn_state != ConnectionState::Connected {
        return Err(ContainerError::NotConnected(system_id));
    }

    // Build the platform-appropriate command
    let command = match system.connection_type {
        ConnectionType::Local => {
            CommandBuilder::get_extended_system_info_for_local(system.primary_runtime)
        }
        ConnectionType::Remote => {
            CommandBuilder::get_extended_system_info_for_remote(system.primary_runtime)
        }
    };

    // Execute command based on connection type
    let result = match system.connection_type {
        ConnectionType::Local => {
            let executor = LocalExecutor::new();
            // On Windows, we need to use PowerShell
            if cfg!(windows) {
                executor.execute_powershell(&command).await?
            } else {
                executor.execute(&command).await?
            }
        }
        ConnectionType::Remote => {
            crate::ssh::execute_on_system(&system_id, &command).await?
        }
    };

    if !result.success() {
        tracing::warn!(
            "Extended system info command failed for {}: exit_code={}, stderr={}",
            system_id,
            result.exit_code,
            result.stderr
        );
        // Return partial info instead of failing completely
        return Ok(ExtendedSystemInfo {
            username: whoami::username().unwrap_or_else(|_| "unknown".to_string()),
            is_root: false,
            can_sudo: false,
            os_type: if cfg!(windows) {
                crate::models::system::OsType::Windows
            } else if cfg!(target_os = "macos") {
                crate::models::system::OsType::Macos
            } else {
                crate::models::system::OsType::Linux
            },
            distro: None,
            hostname: whoami::hostname().ok(),
            cpu_count: None,
            total_memory: None,
            disk_usage_percent: None,
            uptime: None,
            running_containers: None,
            total_containers: None,
            total_images: None,
            runtime_version: None,
        });
    }

    // Parse the output
    let info = OutputParser::parse_extended_system_info(&result.stdout);

    tracing::info!(
        "Extended system info for {}: user={}, root={}, sudo={}, os={:?}, containers={:?}/{:?}",
        system_id,
        info.username,
        info.is_root,
        info.can_sudo,
        info.os_type,
        info.running_containers,
        info.total_containers
    );

    Ok(info)
}

// ========================================================================
// Live Monitoring Commands
// ========================================================================

/// Start live monitoring for a system
/// Emits `system:metrics` events at the specified interval
#[tauri::command]
pub async fn start_system_monitoring(
    app: AppHandle,
    state: State<'_, AppState>,
    monitoring: State<'_, MonitoringManager>,
    system_id: String,
    interval_ms: Option<u64>,
) -> Result<bool, ContainerError> {
    // Verify system exists and is connected
    let _system = state
        .get_system(&system_id)
        .ok_or_else(|| ContainerError::SystemNotFound(system_id.clone()))?;

    let conn_state = state.connection_state(&system_id);
    if conn_state != ConnectionState::Connected {
        return Err(ContainerError::NotConnected(system_id));
    }

    // Default to 3 seconds if not specified
    let interval = interval_ms.unwrap_or(3000);

    let started = monitoring.start_monitoring(app, system_id.clone(), interval);

    tracing::info!(
        "Start monitoring request for system {}: started={}",
        system_id,
        started
    );

    Ok(started)
}

/// Stop live monitoring for a system
#[tauri::command]
pub async fn stop_system_monitoring(
    monitoring: State<'_, MonitoringManager>,
    system_id: String,
) -> Result<bool, ContainerError> {
    let stopped = monitoring.stop_monitoring(&system_id).await;

    tracing::info!(
        "Stop monitoring request for system {}: stopped={}",
        system_id,
        stopped
    );

    Ok(stopped)
}

/// Check if a system is being monitored
#[tauri::command]
pub fn is_system_monitoring(
    monitoring: State<'_, MonitoringManager>,
    system_id: String,
) -> bool {
    monitoring.is_monitoring(&system_id)
}

/// Get list of systems currently being monitored
#[tauri::command]
pub fn list_monitored_systems(
    monitoring: State<'_, MonitoringManager>,
) -> Vec<String> {
    monitoring.monitored_systems()
}

/// Get current live metrics for a system (one-shot, not streaming)
#[tauri::command]
pub async fn get_live_metrics(
    state: State<'_, AppState>,
    system_id: String,
) -> Result<LiveSystemMetrics, ContainerError> {
    let system = state
        .get_system(&system_id)
        .ok_or_else(|| ContainerError::SystemNotFound(system_id.clone()))?;

    // Verify system is connected
    let conn_state = state.connection_state(&system_id);
    if conn_state != ConnectionState::Connected {
        return Err(ContainerError::NotConnected(system_id));
    }

    // Build the platform-appropriate command
    let command = match system.connection_type {
        ConnectionType::Local => CommandBuilder::get_live_metrics_for_local(),
        ConnectionType::Remote => CommandBuilder::get_live_metrics_for_remote(),
    };

    // Execute command based on connection type
    let result = match system.connection_type {
        ConnectionType::Local => {
            let executor = LocalExecutor::new();
            if cfg!(windows) {
                executor.execute_powershell(command).await?
            } else {
                executor.execute(command).await?
            }
        }
        ConnectionType::Remote => {
            crate::ssh::execute_on_system(&system_id, command).await?
        }
    };

    if !result.success() {
        return Err(ContainerError::CommandExecutionFailed {
            command: command.to_string(),
            exit_code: result.exit_code,
            stderr: result.stderr,
        });
    }

    Ok(OutputParser::parse_live_metrics(&result.stdout, &system_id))
}

/// Import SSH private key from a file and return its content as PEM string
/// Used for mobile file picker where we can't rely on file paths
#[tauri::command]
pub async fn import_ssh_key_from_file(file_path: String) -> Result<String, ContainerError> {
    tracing::info!("Importing SSH key from file: {}", file_path);

    // Expand ~ to home directory
    let expanded_path = if file_path.starts_with("~") {
        let home = dirs::home_dir()
            .ok_or_else(|| ContainerError::InvalidConfiguration(
                "Could not determine home directory".to_string(),
            ))?;
        file_path.replacen("~", &home.to_string_lossy(), 1)
    } else {
        file_path.clone()
    };

    // Read the file content
    let content = tokio::fs::read_to_string(&expanded_path)
        .await
        .map_err(|e| ContainerError::InvalidConfiguration(format!(
            "Failed to read SSH key file '{}': {}",
            expanded_path, e
        )))?;

    // Validate PEM format
    if !content.contains("-----BEGIN") || !content.contains("PRIVATE KEY-----") {
        return Err(ContainerError::InvalidConfiguration(
            "Invalid SSH key format. Expected PEM format (-----BEGIN ... PRIVATE KEY-----)".to_string(),
        ));
    }

    tracing::info!("Successfully imported SSH key from {}", file_path);
    Ok(content)
}

// ========================================================================
// SSH Config Commands (for importing hosts from ~/.ssh/config)
// ========================================================================

/// Check if any SSH config file exists
#[tauri::command]
pub fn has_ssh_config(config_paths: Option<Vec<String>>) -> bool {
    let paths = config_paths.unwrap_or_default();
    if paths.is_empty() {
        crate::ssh::has_ssh_config(None)
    } else {
        paths.iter().any(|p| crate::ssh::has_ssh_config(Some(p.as_str())))
    }
}

/// List all SSH hosts from config files (excludes wildcard patterns)
#[tauri::command]
pub fn list_ssh_config_hosts(config_paths: Option<Vec<String>>) -> Result<Vec<crate::ssh::SshHostEntry>, ContainerError> {
    let paths = config_paths.unwrap_or_default();
    crate::ssh::list_hosts_multi(&paths)
}

/// Get resolved SSH configuration for a specific host from config files
#[tauri::command]
pub fn get_ssh_host_config(host: String, config_paths: Option<Vec<String>>) -> Result<crate::ssh::SshHostEntry, ContainerError> {
    let paths = config_paths.unwrap_or_default();
    crate::ssh::resolve_host_multi(&host, &paths)
}

// ========================================================================
// App Settings Commands
// ========================================================================

/// Get app settings (SSH config path, etc.)
#[tauri::command]
pub fn get_app_settings(state: State<'_, AppState>) -> Result<crate::database::AppSettings, ContainerError> {
    let conn = state.db.lock().map_err(|e| ContainerError::Internal(e.to_string()))?;
    crate::database::get_app_settings(&conn)
        .map_err(|e| ContainerError::Internal(format!("Failed to get app settings: {}", e)))
}

/// Remove a host key from ~/.ssh/known_hosts (used when user trusts a changed key)
#[tauri::command]
pub fn remove_known_host(hostname: String, port: u16) -> Result<usize, ContainerError> {
    tracing::info!("Removing known host key for {}:{}", hostname, port);
    crate::ssh::known_hosts::remove_host_key(&hostname, port)
}

/// Update app settings
#[tauri::command]
pub fn update_app_settings(state: State<'_, AppState>, settings: crate::database::AppSettings) -> Result<(), ContainerError> {
    let conn = state.db.lock().map_err(|e| ContainerError::Internal(e.to_string()))?;
    crate::database::upsert_app_settings(&conn, &settings)
        .map_err(|e| ContainerError::Internal(format!("Failed to update app settings: {}", e)))
}

/// Get the changelog content (embedded at compile time from CHANGELOG.md)
#[tauri::command]
pub fn get_changelog() -> String {
    include_str!("../../../CHANGELOG.md").to_string()
}
