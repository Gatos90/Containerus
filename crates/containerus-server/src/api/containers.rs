use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use containerus_core::models::container::{ContainerAction, ContainerRuntime};
use containerus_core::runtime::{CommandBuilder, OutputParser};

use crate::audit::{log_action, log_container_action};
use crate::auth::middleware::SystemScoped;
use crate::db::models::SystemRow;
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/{system_id}/containers", get(list_containers))
        .route(
            "/{system_id}/containers/{container_id}/action",
            post(container_action),
        )
        .route(
            "/{system_id}/containers/{container_id}/logs",
            get(container_logs),
        )
        .route(
            "/{system_id}/containers/{container_id}/inspect",
            get(inspect_container),
        )
        .route("/{system_id}/images", get(list_images))
        .route("/{system_id}/images/pull", post(pull_image))
        .route("/{system_id}/images/{image_id}", delete(remove_image))
        .route("/{system_id}/volumes", get(list_volumes).post(create_volume))
        .route("/{system_id}/volumes/{name}", delete(remove_volume))
        .route("/{system_id}/networks", get(list_networks).post(create_network))
        .route("/{system_id}/networks/{name}", delete(remove_network))
        .route("/{system_id}/networks/{name}/connect", post(connect_to_network))
        .route("/{system_id}/networks/{name}/disconnect", post(disconnect_from_network))
}

// ============================================================================
// Request types
// ============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerActionRequest {
    pub action: String, // "start", "stop", "restart", "pause", "unpause", "remove"
    pub runtime: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogsQuery {
    pub tail: Option<u32>,
    pub timestamps: Option<bool>,
    pub runtime: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerQuery {
    pub runtime: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullImageRequest {
    pub image: String,
    pub runtime: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveImageQuery {
    pub runtime: Option<String>,
    pub force: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateVolumeRequest {
    pub name: String,
    pub runtime: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveVolumeQuery {
    pub runtime: Option<String>,
    pub force: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNetworkRequest {
    pub name: String,
    pub runtime: String,
    pub driver: Option<String>,
    pub subnet: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveNetworkQuery {
    pub runtime: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkContainerRequest {
    pub container_id: String,
    pub runtime: String,
}

// ============================================================================
// Helpers
// ============================================================================

/// Validate a CIDR/subnet string (e.g. 192.168.1.0/24).
fn is_valid_subnet(s: &str) -> bool {
    if s.is_empty() || s.len() > 128 {
        return false;
    }
    match s.split_once('/') {
        Some((ip, prefix)) => {
            let prefix_val = match prefix.parse::<u8>() {
                Ok(p) => p,
                Err(_) => return false,
            };
            if ip.parse::<std::net::Ipv4Addr>().is_ok() {
                prefix_val <= 32
            } else if ip.parse::<std::net::Ipv6Addr>().is_ok() {
                prefix_val <= 128
            } else {
                false
            }
        }
        None => false,
    }
}

/// Validate that a user-controlled string is a safe identifier (no shell metacharacters).
fn is_valid_identifier(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 256
        && s.chars()
            .all(|c| c.is_alphanumeric() || c == '_' || c == '-' || c == '.' || c == '/' || c == ':' || c == '@')
}

/// Fetch a system by ID (no project filtering — use SystemScoped extractor for auth).
pub async fn get_system_by_id(
    state: &AppState,
    system_id: Uuid,
) -> Result<SystemRow, (StatusCode, Json<serde_json::Value>)> {
    sqlx::query_as::<_, SystemRow>(
        "SELECT * FROM systems WHERE id = $1",
    )
    .bind(system_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Database error: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Database error"})))
    })?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "System not found"}))))
}

/// Ensure the system is connected for this user, attempting to connect if not.
pub async fn ensure_connected(
    state: &AppState,
    user_id: Uuid,
    system: &SystemRow,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    if !state.connections.is_connected(user_id, system.id) {
        state
            .connections
            .connect(&state.db, user_id, system)
            .await
            .map_err(|e| {
                (
                    StatusCode::BAD_GATEWAY,
                    Json(json!({"error": format!("Cannot connect to system: {e}")})),
                )
            })?;
    }
    Ok(())
}

/// Ensure the system has a shared connection, attempting to connect if not.
/// Used for API queries (containers, images, volumes, networks) where all users
/// see the same data — no per-user connection needed.
pub async fn ensure_shared_connected(
    state: &AppState,
    system: &SystemRow,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    if !state.connections.is_shared_connected(system.id) {
        state
            .connections
            .connect_shared(&state.db, system)
            .await
            .map_err(|e| {
                (
                    StatusCode::BAD_GATEWAY,
                    Json(json!({"error": format!("Cannot connect to system: {e}")})),
                )
            })?;
    }
    Ok(())
}

fn parse_runtime(s: &str) -> Result<ContainerRuntime, (StatusCode, Json<serde_json::Value>)> {
    match s {
        "docker" => Ok(ContainerRuntime::Docker),
        "podman" => Ok(ContainerRuntime::Podman),
        "apple" => Ok(ContainerRuntime::Apple),
        other => Err((StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": format!("Unknown runtime: {other}")})))),
    }
}

fn parse_action(s: &str) -> Result<ContainerAction, String> {
    match s {
        "start" => Ok(ContainerAction::Start),
        "stop" => Ok(ContainerAction::Stop),
        "restart" => Ok(ContainerAction::Restart),
        "pause" => Ok(ContainerAction::Pause),
        "unpause" => Ok(ContainerAction::Unpause),
        "remove" => Ok(ContainerAction::Remove),
        other => Err(format!("Unknown action: {other}")),
    }
}

// ============================================================================
// Handlers
// ============================================================================

/// List containers on a system with full inspect details.
async fn list_containers(
    user: SystemScoped,
    State(state): State<AppState>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    user.require("containers.view").map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;
    let system = &user.system;
    let system_id = system.id;


    if let Err(e) = ensure_shared_connected(&state, system).await {
        return Ok(e.into_response());
    }

    let system_id_str = system_id.to_string();

    // Determine which runtimes to query: use available_runtimes if present, otherwise primary
    let runtimes_to_query: Vec<ContainerRuntime> = {
        let available: Vec<ContainerRuntime> = system
            .available_runtimes
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().and_then(|s| parse_runtime(s).ok()))
                    .collect()
            })
            .unwrap_or_default();
        if available.is_empty() {
            match parse_runtime(&system.primary_runtime) {
                Ok(rt) => vec![rt],
                Err(e) => return Ok(e.into_response()),
            }
        } else {
            available
        }
    };

    let mut all_containers = Vec::new();

    for runtime in runtimes_to_query {
        // Step 1: Get basic container list
        let cmd = CommandBuilder::list_containers(runtime);
        let result = match state.connections.execute_shared(system_id, &cmd).await {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("Failed to list containers for {:?}: {e}", runtime);
                continue;
            }
        };

        if !result.success() {
            tracing::debug!("Container list command failed for {:?}: {}", runtime, result.stderr);
            continue;
        }

        let basic_containers = match OutputParser::parse_container_list(&result.stdout, runtime, &system_id_str) {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!("Failed to parse container list for {:?}: {e}", runtime);
                continue;
            }
        };

        if basic_containers.is_empty() {
            continue;
        }

        // Step 2: Batch inspect for full details
        let container_ids: Vec<&str> = basic_containers.iter()
            .map(|c| c.id.0.as_str())
            .collect();
        let inspect_cmd = CommandBuilder::batch_inspect_containers(runtime, &container_ids);

        match state.connections.execute_shared(system_id, &inspect_cmd).await {
            Ok(inspect_result) if inspect_result.success() => {
                match OutputParser::parse_full_containers_from_inspect(&inspect_result.stdout, runtime, &system_id_str) {
                    Ok(containers) => all_containers.extend(containers),
                    Err(e) => {
                        tracing::warn!("Failed to parse inspect output for {:?}, using basic list: {e}", runtime);
                        all_containers.extend(basic_containers);
                    }
                }
            }
            Ok(inspect_result) => {
                tracing::warn!("Inspect command failed for {:?}: {}, using basic list", runtime, inspect_result.stderr);
                all_containers.extend(basic_containers);
            }
            Err(e) => {
                tracing::warn!("Failed to execute inspect for {:?}: {e}, using basic list", runtime);
                all_containers.extend(basic_containers);
            }
        }
    }

    Ok(Json(json!(all_containers)).into_response())
}

/// Inspect a single container for detailed information.
async fn inspect_container(
    user: SystemScoped,
    State(state): State<AppState>,
    Path((_sys_id, container_id)): Path<(Uuid, String)>,
    Query(query): Query<ContainerQuery>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    user.require("containers.view").map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;
    let system = &user.system;
    let system_id = system.id;


    if !is_valid_identifier(&container_id) {
        return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid container_id"}))).into_response());
    }

    if let Err(e) = ensure_shared_connected(&state, system).await {
        return Ok(e.into_response());
    }

    let runtime = match parse_runtime(query.runtime.as_deref().unwrap_or(&system.primary_runtime)) {
        Ok(rt) => rt,
        Err(e) => return Ok(e.into_response()),
    };
    let cmd = CommandBuilder::inspect_container(runtime, &container_id);

    match state.connections.execute_shared(system_id, &cmd).await {
        Ok(result) if result.success() => {
            match OutputParser::parse_container_details(&result.stdout, runtime) {
                Ok(details) => Ok(Json(json!(details)).into_response()),
                Err(e) => {
                    Ok((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": format!("Failed to parse inspect: {e}")}))).into_response())
                }
            }
        }
        Ok(result) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Inspect failed: {}", result.stderr)}))).into_response())
        }
        Err(e) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Execution failed: {e}")}))).into_response())
        }
    }
}

/// Perform an action on a container (start, stop, restart, etc.).
async fn container_action(
    user: SystemScoped,
    State(state): State<AppState>,
    Path((_sys_id, container_id)): Path<(Uuid, String)>,
    Json(req): Json<ContainerActionRequest>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    // Determine the required permission based on the action
    let permission = match req.action.as_str() {
        "start" => "containers.start",
        "stop" => "containers.stop",
        "restart" => "containers.restart",
        "remove" => "containers.delete",
        "pause" | "unpause" => "containers.manage",
        _ => return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": "Unknown container action"}))).into_response()),
    };
    user.require(permission).map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;
    let system = &user.system;
    let system_id = system.id;


    if !is_valid_identifier(&container_id) {
        return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid container_id"}))).into_response());
    }

    if let Err(e) = ensure_shared_connected(&state, system).await {
        return Ok(e.into_response());
    }

    let action = match parse_action(&req.action) {
        Ok(a) => a,
        Err(msg) => {
            return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": msg}))).into_response());
        }
    };

    let runtime = match parse_runtime(req.runtime.as_deref().unwrap_or(&system.primary_runtime)) {
        Ok(rt) => rt,
        Err(e) => return Ok(e.into_response()),
    };
    let cmd = CommandBuilder::container_action(runtime, action, &container_id);

    match state.connections.execute_shared(system_id, &cmd).await {
        Ok(result) if result.success() => {
            log_container_action(&state.db, user.project_id, user.claims.sub, &format!("container.{}", req.action), system_id, &container_id, Some(user.environment_id)).await;
            Ok(Json(json!({
                "status": "ok",
                "action": req.action,
                "containerId": container_id,
                "output": result.stdout.trim()
            })).into_response())
        }
        Ok(result) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({
                "error": format!("Action '{}' failed: {}", req.action, result.stderr)
            }))).into_response())
        }
        Err(e) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Execution failed: {e}")}))).into_response())
        }
    }
}

/// Get logs for a container.
async fn container_logs(
    user: SystemScoped,
    State(state): State<AppState>,
    Path((_sys_id, container_id)): Path<(Uuid, String)>,
    Query(query): Query<LogsQuery>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    user.require("containers.logs").map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;
    let system = &user.system;
    let system_id = system.id;


    if !is_valid_identifier(&container_id) {
        return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid container_id"}))).into_response());
    }

    if let Err(e) = ensure_shared_connected(&state, system).await {
        return Ok(e.into_response());
    }

    let runtime = match parse_runtime(query.runtime.as_deref().unwrap_or(&system.primary_runtime)) {
        Ok(rt) => rt,
        Err(e) => return Ok(e.into_response()),
    };
    let cmd = CommandBuilder::container_logs(
        runtime,
        &container_id,
        query.tail.or(Some(500)),
        query.timestamps.unwrap_or(false),
    );

    match state.connections.execute_shared(system_id, &cmd).await {
        Ok(result) => {
            Ok(Json(json!({
                "logs": result.stdout,
                "stderr": result.stderr,
                "exitCode": result.exit_code,
            })).into_response())
        }
        Err(e) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Failed to get logs: {e}")}))).into_response())
        }
    }
}

/// List images on a system.
async fn list_images(
    user: SystemScoped,
    State(state): State<AppState>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    user.require("images.view").map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;
    let system = &user.system;
    let system_id = system.id;


    if let Err(e) = ensure_shared_connected(&state, system).await {
        return Ok(e.into_response());
    }

    let runtime = match parse_runtime(&system.primary_runtime) {
        Ok(rt) => rt,
        Err(e) => return Ok(e.into_response()),
    };
    let system_id_str = system_id.to_string();
    let cmd = CommandBuilder::list_images(runtime);

    match state.connections.execute_shared(system_id, &cmd).await {
        Ok(result) if result.success() => {
            match OutputParser::parse_image_list(&result.stdout, runtime, &system_id_str) {
                Ok(images) => Ok(Json(json!(images)).into_response()),
                Err(e) => {
                    tracing::warn!("Failed to parse image list: {e}");
                    Ok(Json(json!([])).into_response())
                }
            }
        }
        Ok(result) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Command failed: {}", result.stderr)}))).into_response())
        }
        Err(e) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Failed to list images: {e}")}))).into_response())
        }
    }
}

/// List volumes on a system.
async fn list_volumes(
    user: SystemScoped,
    State(state): State<AppState>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    user.require("volumes.view").map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;
    let system = &user.system;
    let system_id = system.id;


    if let Err(e) = ensure_shared_connected(&state, system).await {
        return Ok(e.into_response());
    }

    let runtime = match parse_runtime(&system.primary_runtime) {
        Ok(rt) => rt,
        Err(e) => return Ok(e.into_response()),
    };
    let system_id_str = system_id.to_string();
    let cmd = CommandBuilder::list_volumes(runtime);

    match state.connections.execute_shared(system_id, &cmd).await {
        Ok(result) if result.success() => {
            match OutputParser::parse_volume_list(&result.stdout, runtime, &system_id_str) {
                Ok(volumes) => Ok(Json(json!(volumes)).into_response()),
                Err(e) => {
                    tracing::warn!("Failed to parse volume list: {e}");
                    Ok(Json(json!([])).into_response())
                }
            }
        }
        Ok(result) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Command failed: {}", result.stderr)}))).into_response())
        }
        Err(e) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Failed to list volumes: {e}")}))).into_response())
        }
    }
}

/// List networks on a system.
async fn list_networks(
    user: SystemScoped,
    State(state): State<AppState>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    user.require("networks.view").map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;
    let system = &user.system;
    let system_id = system.id;


    if let Err(e) = ensure_shared_connected(&state, system).await {
        return Ok(e.into_response());
    }

    let runtime = match parse_runtime(&system.primary_runtime) {
        Ok(rt) => rt,
        Err(e) => return Ok(e.into_response()),
    };
    let system_id_str = system_id.to_string();
    let cmd = CommandBuilder::list_networks(runtime);

    match state.connections.execute_shared(system_id, &cmd).await {
        Ok(result) if result.success() => {
            match OutputParser::parse_network_list(&result.stdout, runtime, &system_id_str) {
                Ok(networks) => Ok(Json(json!(networks)).into_response()),
                Err(e) => {
                    tracing::warn!("Failed to parse network list: {e}");
                    Ok(Json(json!([])).into_response())
                }
            }
        }
        Ok(result) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Command failed: {}", result.stderr)}))).into_response())
        }
        Err(e) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Failed to list networks: {e}")}))).into_response())
        }
    }
}

// ============================================================================
// Image / Volume / Network write operations
// ============================================================================

/// Pull an image on a system.
async fn pull_image(
    user: SystemScoped,
    State(state): State<AppState>,
    Json(req): Json<PullImageRequest>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    user.require("images.pull").map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;
    let system = &user.system;
    let system_id = system.id;


    if !is_valid_identifier(&req.image) {
        return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid image name"}))).into_response());
    }

    if let Err(e) = ensure_shared_connected(&state, system).await {
        return Ok(e.into_response());
    }

    let runtime = match parse_runtime(&req.runtime) {
        Ok(rt) => rt,
        Err(e) => return Ok(e.into_response()),
    };
    let cmd = CommandBuilder::pull_image(runtime, &req.image);

    match state.connections.execute_shared(system_id, &cmd).await {
        Ok(result) if result.success() => {
            log_action(&state.db, Some(user.project_id), Some(user.claims.sub), "image.pull", "image", Some(&req.image), Some(serde_json::json!({"systemId": system_id.to_string()})), None, Some(user.environment_id)).await;
            Ok(Json(json!({"status": "ok", "output": result.stdout.trim()})).into_response())
        }
        Ok(result) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Pull failed: {}", result.stderr)}))).into_response())
        }
        Err(e) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Execution failed: {e}")}))).into_response())
        }
    }
}

/// Remove an image from a system.
async fn remove_image(
    user: SystemScoped,
    State(state): State<AppState>,
    Path((_sys_id, image_id)): Path<(Uuid, String)>,
    Query(query): Query<RemoveImageQuery>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    user.require("images.delete").map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;
    let system = &user.system;
    let system_id = system.id;


    if !is_valid_identifier(&image_id) {
        return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid image_id"}))).into_response());
    }

    if let Err(e) = ensure_shared_connected(&state, system).await {
        return Ok(e.into_response());
    }

    let runtime = match parse_runtime(query.runtime.as_deref().unwrap_or(&system.primary_runtime)) {
        Ok(rt) => rt,
        Err(e) => return Ok(e.into_response()),
    };
    let force = query.force.unwrap_or(false);
    let cmd = CommandBuilder::remove_image(runtime, &image_id, force);

    match state.connections.execute_shared(system_id, &cmd).await {
        Ok(result) if result.success() => {
            log_action(&state.db, Some(user.project_id), Some(user.claims.sub), "image.remove", "image", Some(&image_id), Some(serde_json::json!({"systemId": system_id.to_string()})), None, Some(user.environment_id)).await;
            Ok(Json(json!({"status": "ok"})).into_response())
        }
        Ok(result) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Remove failed: {}", result.stderr)}))).into_response())
        }
        Err(e) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Execution failed: {e}")}))).into_response())
        }
    }
}

/// Create a volume on a system.
async fn create_volume(
    user: SystemScoped,
    State(state): State<AppState>,
    Json(req): Json<CreateVolumeRequest>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    user.require("volumes.create").map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;
    let system = &user.system;
    let system_id = system.id;


    if !is_valid_identifier(&req.name) {
        return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid volume name"}))).into_response());
    }

    if let Err(e) = ensure_shared_connected(&state, system).await {
        return Ok(e.into_response());
    }

    let runtime = match parse_runtime(&req.runtime) {
        Ok(rt) => rt,
        Err(e) => return Ok(e.into_response()),
    };
    let cmd = CommandBuilder::create_volume(runtime, &req.name);

    match state.connections.execute_shared(system_id, &cmd).await {
        Ok(result) if result.success() => {
            log_action(&state.db, Some(user.project_id), Some(user.claims.sub), "volume.create", "volume", Some(&req.name), Some(serde_json::json!({"systemId": system_id.to_string()})), None, Some(user.environment_id)).await;
            Ok(Json(json!({"status": "ok"})).into_response())
        }
        Ok(result) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Create volume failed: {}", result.stderr)}))).into_response())
        }
        Err(e) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Execution failed: {e}")}))).into_response())
        }
    }
}

/// Remove a volume from a system.
async fn remove_volume(
    user: SystemScoped,
    State(state): State<AppState>,
    Path((_sys_id, name)): Path<(Uuid, String)>,
    Query(query): Query<RemoveVolumeQuery>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    user.require("volumes.delete").map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;
    let system = &user.system;
    let system_id = system.id;


    if !is_valid_identifier(&name) {
        return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid volume name"}))).into_response());
    }

    if let Err(e) = ensure_shared_connected(&state, system).await {
        return Ok(e.into_response());
    }

    let runtime = match parse_runtime(query.runtime.as_deref().unwrap_or(&system.primary_runtime)) {
        Ok(rt) => rt,
        Err(e) => return Ok(e.into_response()),
    };
    let force = query.force.unwrap_or(false);
    let cmd = CommandBuilder::remove_volume(runtime, &name, force);

    match state.connections.execute_shared(system_id, &cmd).await {
        Ok(result) if result.success() => {
            log_action(&state.db, Some(user.project_id), Some(user.claims.sub), "volume.remove", "volume", Some(&name), Some(serde_json::json!({"systemId": system_id.to_string()})), None, Some(user.environment_id)).await;
            Ok(Json(json!({"status": "ok"})).into_response())
        }
        Ok(result) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Remove volume failed: {}", result.stderr)}))).into_response())
        }
        Err(e) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Execution failed: {e}")}))).into_response())
        }
    }
}

/// Create a network on a system.
async fn create_network(
    user: SystemScoped,
    State(state): State<AppState>,
    Json(req): Json<CreateNetworkRequest>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    user.require("networks.create").map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;
    let system = &user.system;
    let system_id = system.id;


    if !is_valid_identifier(&req.name) {
        return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid network name"}))).into_response());
    }
    if let Some(ref driver) = req.driver {
        if !is_valid_identifier(driver) {
            return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid driver name"}))).into_response());
        }
    }
    if let Some(ref subnet) = req.subnet {
        if !is_valid_subnet(subnet) {
            return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid subnet value"}))).into_response());
        }
    }

    if let Err(e) = ensure_shared_connected(&state, system).await {
        return Ok(e.into_response());
    }

    let runtime = match parse_runtime(&req.runtime) {
        Ok(rt) => rt,
        Err(e) => return Ok(e.into_response()),
    };
    let cmd = CommandBuilder::create_network(
        runtime,
        &req.name,
        req.driver.as_deref(),
        req.subnet.as_deref(),
    );

    match state.connections.execute_shared(system_id, &cmd).await {
        Ok(result) if result.success() => {
            log_action(&state.db, Some(user.project_id), Some(user.claims.sub), "network.create", "network", Some(&req.name), Some(serde_json::json!({"systemId": system_id.to_string()})), None, Some(user.environment_id)).await;
            Ok(Json(json!({"status": "ok"})).into_response())
        }
        Ok(result) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Create network failed: {}", result.stderr)}))).into_response())
        }
        Err(e) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Execution failed: {e}")}))).into_response())
        }
    }
}

/// Remove a network from a system.
async fn remove_network(
    user: SystemScoped,
    State(state): State<AppState>,
    Path((_sys_id, name)): Path<(Uuid, String)>,
    Query(query): Query<RemoveNetworkQuery>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    user.require("networks.delete").map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;
    let system = &user.system;
    let system_id = system.id;


    if !is_valid_identifier(&name) {
        return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid network name"}))).into_response());
    }

    if let Err(e) = ensure_shared_connected(&state, system).await {
        return Ok(e.into_response());
    }

    let runtime = match parse_runtime(query.runtime.as_deref().unwrap_or(&system.primary_runtime)) {
        Ok(rt) => rt,
        Err(e) => return Ok(e.into_response()),
    };
    let cmd = CommandBuilder::remove_network(runtime, &name);

    match state.connections.execute_shared(system_id, &cmd).await {
        Ok(result) if result.success() => {
            log_action(&state.db, Some(user.project_id), Some(user.claims.sub), "network.remove", "network", Some(&name), Some(serde_json::json!({"systemId": system_id.to_string()})), None, Some(user.environment_id)).await;
            Ok(Json(json!({"status": "ok"})).into_response())
        }
        Ok(result) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Remove network failed: {}", result.stderr)}))).into_response())
        }
        Err(e) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Execution failed: {e}")}))).into_response())
        }
    }
}

/// Connect a container to a network.
async fn connect_to_network(
    user: SystemScoped,
    State(state): State<AppState>,
    Path((_sys_id, name)): Path<(Uuid, String)>,
    Json(req): Json<NetworkContainerRequest>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    user.require("networks.manage").map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;
    let system = &user.system;
    let system_id = system.id;


    if !is_valid_identifier(&name) {
        return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid network name"}))).into_response());
    }
    if !is_valid_identifier(&req.container_id) {
        return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid container_id"}))).into_response());
    }

    if let Err(e) = ensure_shared_connected(&state, system).await {
        return Ok(e.into_response());
    }

    let runtime = match parse_runtime(&req.runtime) {
        Ok(rt) => rt,
        Err(e) => return Ok(e.into_response()),
    };
    let cmd = CommandBuilder::connect_to_network(runtime, &name, &req.container_id);

    match state.connections.execute_shared(system_id, &cmd).await {
        Ok(result) if result.success() => {
            log_action(&state.db, Some(user.project_id), Some(user.claims.sub), "network.connect", "network", Some(&name), Some(serde_json::json!({"systemId": system_id.to_string(), "containerId": &req.container_id})), None, Some(user.environment_id)).await;
            Ok(Json(json!({"status": "ok"})).into_response())
        }
        Ok(result) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Connect failed: {}", result.stderr)}))).into_response())
        }
        Err(e) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Execution failed: {e}")}))).into_response())
        }
    }
}

/// Disconnect a container from a network.
async fn disconnect_from_network(
    user: SystemScoped,
    State(state): State<AppState>,
    Path((_sys_id, name)): Path<(Uuid, String)>,
    Json(req): Json<NetworkContainerRequest>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    user.require("networks.manage").map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;
    let system = &user.system;
    let system_id = system.id;


    if !is_valid_identifier(&name) {
        return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid network name"}))).into_response());
    }
    if !is_valid_identifier(&req.container_id) {
        return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid container_id"}))).into_response());
    }

    if let Err(e) = ensure_shared_connected(&state, system).await {
        return Ok(e.into_response());
    }

    let runtime = match parse_runtime(&req.runtime) {
        Ok(rt) => rt,
        Err(e) => return Ok(e.into_response()),
    };
    let cmd = CommandBuilder::disconnect_from_network(runtime, &name, &req.container_id);

    match state.connections.execute_shared(system_id, &cmd).await {
        Ok(result) if result.success() => {
            log_action(&state.db, Some(user.project_id), Some(user.claims.sub), "network.disconnect", "network", Some(&name), Some(serde_json::json!({"systemId": system_id.to_string(), "containerId": &req.container_id})), None, Some(user.environment_id)).await;
            Ok(Json(json!({"status": "ok"})).into_response())
        }
        Ok(result) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Disconnect failed: {}", result.stderr)}))).into_response())
        }
        Err(e) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Execution failed: {e}")}))).into_response())
        }
    }
}
