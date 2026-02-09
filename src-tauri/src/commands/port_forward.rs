use std::sync::Arc;
use tauri::State;

use crate::backend_forward::BackendPortForwardManager;
use crate::models::error::ContainerError;
use crate::models::port_forward::{CreatePortForwardRequest, PortForward};
use crate::models::system::ConnectionType;
use crate::ssh::PortForwardManager;
use crate::state::AppState;

#[tauri::command]
pub async fn create_port_forward(
    app_state: State<'_, AppState>,
    forward_state: State<'_, Arc<PortForwardManager>>,
    backend_forward_state: State<'_, Arc<BackendPortForwardManager>>,
    request: CreatePortForwardRequest,
) -> Result<PortForward, ContainerError> {
    // If tunnel_ws_url is present, this is a backend forward
    if let (Some(ws_url), Some(token)) = (&request.tunnel_ws_url, &request.tunnel_token) {
        let remote_host = request
            .remote_host
            .unwrap_or_else(|| "localhost".to_string());
        let protocol = request.protocol.unwrap_or_else(|| "tcp".to_string());

        return backend_forward_state
            .start_forward(
                request.system_id,
                request.container_id,
                request.container_port,
                request.local_port,
                remote_host,
                request.host_port,
                protocol,
                ws_url.clone(),
                token.clone(),
            )
            .await;
    }

    // Local SSH forward
    let system = app_state
        .get_system(&request.system_id)
        .ok_or_else(|| ContainerError::SystemNotFound(request.system_id.clone()))?;

    let is_local = system.connection_type == ConnectionType::Local;
    let remote_host = request
        .remote_host
        .unwrap_or_else(|| "localhost".to_string());
    let protocol = request.protocol.unwrap_or_else(|| "tcp".to_string());

    forward_state
        .start_forward(
            request.system_id,
            request.container_id,
            request.container_port,
            request.local_port,
            remote_host,
            request.host_port,
            protocol,
            is_local,
        )
        .await
}

#[tauri::command]
pub fn stop_port_forward(
    forward_state: State<'_, Arc<PortForwardManager>>,
    backend_forward_state: State<'_, Arc<BackendPortForwardManager>>,
    forward_id: String,
) -> Result<(), ContainerError> {
    // Try local first, then backend
    if forward_state.get_forward(&forward_id).is_some() {
        return forward_state.stop_forward(&forward_id);
    }
    if backend_forward_state.get_forward(&forward_id).is_some() {
        return backend_forward_state.stop_forward(&forward_id);
    }
    Err(ContainerError::Internal(format!(
        "Port forward {} not found",
        forward_id
    )))
}

#[tauri::command]
pub fn list_port_forwards(
    forward_state: State<'_, Arc<PortForwardManager>>,
    backend_forward_state: State<'_, Arc<BackendPortForwardManager>>,
    system_id: Option<String>,
    container_id: Option<String>,
) -> Vec<PortForward> {
    let mut forwards =
        forward_state.list_forwards(system_id.as_deref(), container_id.as_deref());
    forwards.extend(
        backend_forward_state.list_forwards(system_id.as_deref(), container_id.as_deref()),
    );
    forwards
}

#[tauri::command]
pub fn get_port_forward(
    forward_state: State<'_, Arc<PortForwardManager>>,
    backend_forward_state: State<'_, Arc<BackendPortForwardManager>>,
    forward_id: String,
) -> Option<PortForward> {
    forward_state
        .get_forward(&forward_id)
        .or_else(|| backend_forward_state.get_forward(&forward_id))
}

#[tauri::command]
pub async fn open_forwarded_port(
    forward_state: State<'_, Arc<PortForwardManager>>,
    backend_forward_state: State<'_, Arc<BackendPortForwardManager>>,
    forward_id: String,
) -> Result<(), ContainerError> {
    let forward = forward_state
        .get_forward(&forward_id)
        .or_else(|| backend_forward_state.get_forward(&forward_id))
        .ok_or_else(|| {
            ContainerError::Internal(format!("Port forward {} not found", forward_id))
        })?;

    if forward.protocol != "http" && forward.protocol != "https" {
        return Err(ContainerError::Internal(format!(
            "Cannot open browser for protocol '{}' — only HTTP-compatible protocols are supported",
            forward.protocol
        )));
    }

    let scheme = if forward.protocol == "https" { "https" } else { "http" };
    let url = format!("{}://localhost:{}", scheme, forward.local_port);
    open::that(&url).map_err(|e| {
        ContainerError::Internal(format!("Failed to open browser: {}", e))
    })?;

    Ok(())
}

#[tauri::command]
pub fn is_port_forwarded(
    forward_state: State<'_, Arc<PortForwardManager>>,
    backend_forward_state: State<'_, Arc<BackendPortForwardManager>>,
    container_id: String,
    container_port: u16,
) -> bool {
    forward_state.is_port_forwarded(&container_id, container_port)
        || backend_forward_state.is_port_forwarded(&container_id, container_port)
}
