use std::sync::Arc;
use tauri::State;

use crate::models::error::ContainerError;
use crate::models::port_forward::{CreatePortForwardRequest, PortForward};
use crate::models::system::ConnectionType;
use crate::ssh::PortForwardManager;
use crate::state::AppState;

#[tauri::command]
pub async fn create_port_forward(
    app_state: State<'_, AppState>,
    forward_state: State<'_, Arc<PortForwardManager>>,
    request: CreatePortForwardRequest,
) -> Result<PortForward, ContainerError> {
    // Check if system exists and is connected
    let system = app_state
        .get_system(&request.system_id)
        .ok_or_else(|| ContainerError::SystemNotFound(request.system_id.clone()))?;

    let is_local = system.connection_type == ConnectionType::Local;

    // Determine remote host - use provided or default to localhost
    // Using "localhost" instead of "127.0.0.1" to support both IPv4 and IPv6
    let remote_host = request.remote_host.unwrap_or_else(|| "localhost".to_string());

    let protocol = request.protocol.unwrap_or_else(|| "tcp".to_string());

    forward_state
        .start_forward(
            request.system_id,
            request.container_id,
            request.container_port,
            request.local_port,
            remote_host,
            request.host_port, // Use host_port for tunnel (not container_port)
            protocol,
            is_local,
        )
        .await
}

#[tauri::command]
pub fn stop_port_forward(
    forward_state: State<'_, Arc<PortForwardManager>>,
    forward_id: String,
) -> Result<(), ContainerError> {
    forward_state.stop_forward(&forward_id)
}

#[tauri::command]
pub fn list_port_forwards(
    forward_state: State<'_, Arc<PortForwardManager>>,
    system_id: Option<String>,
    container_id: Option<String>,
) -> Vec<PortForward> {
    forward_state.list_forwards(system_id.as_deref(), container_id.as_deref())
}

#[tauri::command]
pub fn get_port_forward(
    forward_state: State<'_, Arc<PortForwardManager>>,
    forward_id: String,
) -> Option<PortForward> {
    forward_state.get_forward(&forward_id)
}

#[tauri::command]
pub async fn open_forwarded_port(
    forward_state: State<'_, Arc<PortForwardManager>>,
    forward_id: String,
) -> Result<(), ContainerError> {
    let forward = forward_state
        .get_forward(&forward_id)
        .ok_or_else(|| ContainerError::Internal(format!("Port forward {} not found", forward_id)))?;

    // Open in default browser
    let url = format!("http://localhost:{}", forward.local_port);

    open::that(&url).map_err(|e| {
        ContainerError::Internal(format!("Failed to open browser: {}", e))
    })?;

    Ok(())
}

#[tauri::command]
pub fn is_port_forwarded(
    forward_state: State<'_, Arc<PortForwardManager>>,
    container_id: String,
    container_port: u16,
) -> bool {
    forward_state.is_port_forwarded(&container_id, container_port)
}
