use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use containerus_core::models::container::ContainerRuntime;
use containerus_core::runtime::{CommandBuilder, OutputParser};

use crate::audit::log_system_action;
use crate::auth::middleware::{ProjectScoped, SystemScoped};
use crate::db::models::{SystemResponse, SystemRow};
use crate::AppState;

/// Routes for operations on a specific system (by system ID).
/// Mounted at /api/systems
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/{id}", get(get_system).put(update_system).delete(delete_system))
        .route("/{id}/test", post(test_connection))
        .route("/{id}/connect", post(connect_system))
        .route("/{id}/disconnect", post(disconnect_system))
        .route("/{id}/trust-host-key", post(trust_host_key))
        .route("/{id}/info", get(get_system_info))
        .route("/{id}/metrics", get(get_live_metrics))
}

/// Routes for listing/creating systems within an environment.
/// Mounted at /api/projects/{project_id}/environments/{environment_id}/systems
pub fn environment_router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_systems).post(create_system))
}

// ============================================================================
// Request / Response types
// ============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSystemRequest {
    pub name: String,
    pub hostname: String,
    pub port: Option<i32>,
    pub username: String,
    pub primary_runtime: Option<String>,
    pub available_runtimes: Option<Vec<String>>,
    pub auth_method: Option<String>,
    pub ssh_options: Option<serde_json::Value>,
    /// SSH password (stored encrypted in vault)
    pub password: Option<String>,
    /// SSH private key PEM content (stored encrypted in vault)
    pub private_key: Option<String>,
    /// SSH key passphrase (stored encrypted in vault)
    pub passphrase: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSystemRequest {
    pub name: Option<String>,
    pub hostname: Option<String>,
    pub port: Option<i32>,
    pub username: Option<String>,
    pub primary_runtime: Option<String>,
    pub available_runtimes: Option<Vec<String>>,
    pub auth_method: Option<String>,
    pub ssh_options: Option<serde_json::Value>,
    pub is_active: Option<bool>,
    /// Updated password (re-encrypted in vault)
    pub password: Option<String>,
    /// Updated private key (re-encrypted in vault)
    pub private_key: Option<String>,
    /// Updated passphrase (re-encrypted in vault)
    pub passphrase: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemWithStatus {
    #[serde(flatten)]
    pub system: SystemResponse,
    pub connected: bool,
}

// ============================================================================
// Environment-scoped Handlers (list / create)
// ============================================================================

/// List all systems in the given environment.
async fn list_systems(
    user: ProjectScoped,
    State(state): State<AppState>,
    Path((_pid, environment_id)): Path<(Uuid, Uuid)>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    user.require("systems.view").map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;

    match sqlx::query_as::<_, SystemRow>(
        "SELECT * FROM systems WHERE environment_id = $1 ORDER BY name",
    )
    .bind(environment_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let systems: Vec<SystemWithStatus> = rows
                .into_iter()
                .map(|row| {
                    let connected = state.connections.is_system_connected(row.id);
                    SystemWithStatus {
                        system: SystemResponse::from(row),
                        connected,
                    }
                })
                .collect();
            Ok(Json(json!(systems)).into_response())
        }
        Err(e) => {
            tracing::error!("Failed to list systems: {e}");
            Ok((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to list systems"}))).into_response())
        }
    }
}

/// Create a new system in the environment.
async fn create_system(
    user: ProjectScoped,
    State(state): State<AppState>,
    Path((project_id, environment_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<CreateSystemRequest>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    user.require("systems.create").map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;
    let user_id = user.claims.sub;

    if req.name.trim().is_empty() || req.name.trim().len() > 255 {
        return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": "System name must be 1-255 characters"}))).into_response());
    }
    if req.hostname.trim().is_empty() || req.hostname.trim().len() > 255 {
        return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": "Hostname must be 1-255 characters"}))).into_response());
    }

    let port = req.port.unwrap_or(22);
    if !(1..=65535).contains(&port) {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": format!("Invalid port: {port}. Must be between 1 and 65535")})),
        ).into_response());
    }
    let primary_runtime = req.primary_runtime.as_deref().unwrap_or("docker");
    let auth_method = req.auth_method.as_deref().unwrap_or("password");
    let available_runtimes = req
        .available_runtimes
        .as_ref()
        .map(|v| serde_json::Value::Array(v.iter().map(|s| serde_json::Value::String(s.clone())).collect()))
        .unwrap_or_else(|| serde_json::json!([primary_runtime]));

    // Validate runtime values
    let valid_runtimes = ["docker", "podman", "apple"];
    if !valid_runtimes.contains(&primary_runtime) {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": format!("Invalid runtime: {primary_runtime}. Must be one of: docker, podman, apple")})),
        ).into_response());
    }
    if let Some(runtimes) = &req.available_runtimes {
        for rt in runtimes {
            if !valid_runtimes.contains(&rt.as_str()) {
                return Ok((
                    StatusCode::BAD_REQUEST,
                    Json(json!({"error": format!("Invalid runtime in available_runtimes: {rt}. Must be one of: docker, podman, apple")})),
                ).into_response());
            }
        }
    }
    let valid_auth = ["password", "publicKey"];
    if !valid_auth.contains(&auth_method) {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": format!("Invalid auth_method: {auth_method}. Must be 'password' or 'publicKey'")})),
        ).into_response());
    }

    // Insert the system
    let result = sqlx::query_as::<_, SystemRow>(
        r#"
        INSERT INTO systems (environment_id, name, hostname, port, username, primary_runtime, available_runtimes, auth_method, ssh_options, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
        "#,
    )
    .bind(environment_id)
    .bind(&req.name)
    .bind(&req.hostname)
    .bind(port)
    .bind(&req.username)
    .bind(primary_runtime)
    .bind(&available_runtimes)
    .bind(auth_method)
    .bind(&req.ssh_options)
    .bind(user_id)
    .fetch_one(&state.db)
    .await;

    let system = match result {
        Ok(row) => row,
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("idx_systems_org_name") {
                return Ok((
                    StatusCode::CONFLICT,
                    Json(json!({"error": "A system with that name already exists in this organization"})),
                ).into_response());
            }
            tracing::error!("Failed to create system: {e}");
            return Ok((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to create system"}))).into_response());
        }
    };

    // Store credentials in vault — fail and rollback if storage fails
    let mut credentials: Vec<(&str, &str)> = Vec::new();
    if let Some(password) = &req.password {
        credentials.push(("password", password.as_str()));
    }
    if let Some(private_key) = &req.private_key {
        credentials.push(("private_key", private_key.as_str()));
    }
    if let Some(passphrase) = &req.passphrase {
        credentials.push(("passphrase", passphrase.as_str()));
    }

    for (cred_type, cred_value) in &credentials {
        if let Err(e) = state.vault.store_credential(&state.db, system.id, cred_type, cred_value, None).await {
            tracing::error!("Failed to store {cred_type}: {e}");
            // Consolidated rollback: delete credentials then system
            if let Err(re) = state.vault.delete_system_credentials(&state.db, system.id).await {
                tracing::error!("Rollback: failed to delete credentials for system {}: {re}", system.id);
            }
            if let Err(re) = sqlx::query("DELETE FROM systems WHERE id = $1").bind(system.id).execute(&state.db).await {
                tracing::error!("Rollback: failed to delete system {}: {re}", system.id);
            }
            return Ok((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to store credentials"}))).into_response());
        }
    }

    log_system_action(
        &state.db,
        project_id,
        user_id,
        "system.create",
        system.id,
        Some(serde_json::json!({"name": req.name, "hostname": req.hostname})),
        Some(environment_id),
    ).await;

    Ok((StatusCode::CREATED, Json(json!(SystemResponse::from(system)))).into_response())
}

// ============================================================================
// System-scoped Handlers (single system by ID)
// ============================================================================

/// Get a single system by ID.
async fn get_system(
    user: SystemScoped,
    State(state): State<AppState>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    user.require("systems.view").map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;

    let connected = state.connections.is_system_connected(user.system.id);
    Ok(Json(json!(SystemWithStatus {
        system: SystemResponse::from(user.system),
        connected,
    })).into_response())
}

/// Update a system.
async fn update_system(
    user: SystemScoped,
    State(state): State<AppState>,
    Json(req): Json<UpdateSystemRequest>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    user.require("systems.edit").map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;
    let project_id = user.project_id;
    let user_id = user.claims.sub;
    let environment_id = user.environment_id;
    let id = user.system.id;
    let existing = user.system;

    let name = req.name.as_deref().unwrap_or(&existing.name);
    let hostname = req.hostname.as_deref().unwrap_or(&existing.hostname);
    let port = req.port.unwrap_or(existing.port);
    if !(1..=65535).contains(&port) {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": format!("Invalid port: {port}. Must be between 1 and 65535")})),
        ).into_response());
    }
    let username = req.username.as_deref().unwrap_or(&existing.username);
    let primary_runtime = req.primary_runtime.as_deref().unwrap_or(&existing.primary_runtime);
    let auth_method = req.auth_method.as_deref().unwrap_or(&existing.auth_method);
    let is_active = req.is_active.unwrap_or(existing.is_active);
    let available_runtimes = req
        .available_runtimes
        .as_ref()
        .map(|v| serde_json::Value::Array(v.iter().map(|s| serde_json::Value::String(s.clone())).collect()))
        .unwrap_or(existing.available_runtimes);
    let ssh_options = req.ssh_options.as_ref().or(existing.ssh_options.as_ref());

    // Validate runtime and auth_method values
    let valid_runtimes = ["docker", "podman", "apple"];
    if !valid_runtimes.contains(&primary_runtime) {
        return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": format!("Invalid runtime: {primary_runtime}")}))).into_response());
    }
    if let Some(runtimes) = &req.available_runtimes {
        for rt in runtimes {
            if !valid_runtimes.contains(&rt.as_str()) {
                return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": format!("Invalid runtime in available_runtimes: {rt}")}))).into_response());
            }
        }
    }
    let valid_auth = ["password", "publicKey"];
    if !valid_auth.contains(&auth_method) {
        return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": format!("Invalid auth_method: {auth_method}")}))).into_response());
    }

    // Update credentials BEFORE the DB update so that if credential storage fails,
    // the DB remains unchanged. Credential writes are idempotent, so if the DB update
    // subsequently fails, the stored credentials cause no harm.
    if let Some(password) = &req.password {
        if let Err(e) = state.vault.store_credential(&state.db, id, "password", password, None).await {
            tracing::error!("Failed to update password for system {id}: {e}");
            return Ok((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to update credentials"}))).into_response());
        }
    }
    if let Some(private_key) = &req.private_key {
        if let Err(e) = state.vault.store_credential(&state.db, id, "private_key", private_key, None).await {
            tracing::error!("Failed to update private key for system {id}: {e}");
            return Ok((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to update credentials"}))).into_response());
        }
    }
    if let Some(passphrase) = &req.passphrase {
        if let Err(e) = state.vault.store_credential(&state.db, id, "passphrase", passphrase, None).await {
            tracing::error!("Failed to update passphrase for system {id}: {e}");
            return Ok((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to update credentials"}))).into_response());
        }
    }

    // Disconnect active connection if connection parameters changed
    if req.hostname.is_some() || req.port.is_some() || req.username.is_some()
        || req.password.is_some() || req.private_key.is_some()
    {
        let _ = state.connections.disconnect_system(id).await;
    }

    let result = sqlx::query_as::<_, SystemRow>(
        r#"
        UPDATE systems SET
            name = $1, hostname = $2, port = $3, username = $4,
            primary_runtime = $5, available_runtimes = $6, auth_method = $7,
            ssh_options = $8, is_active = $9, updated_at = now()
        WHERE id = $10 AND environment_id = $11
        RETURNING *
        "#,
    )
    .bind(name)
    .bind(hostname)
    .bind(port)
    .bind(username)
    .bind(primary_runtime)
    .bind(&available_runtimes)
    .bind(auth_method)
    .bind(ssh_options)
    .bind(is_active)
    .bind(id)
    .bind(environment_id)
    .fetch_one(&state.db)
    .await;

    match result {
        Ok(row) => {
            log_system_action(
                &state.db,
                project_id,
                user_id,
                "system.update",
                id,
                None,
                Some(environment_id),
            ).await;
            Ok(Json(json!(SystemResponse::from(row))).into_response())
        }
        Err(e) => {
            tracing::error!("Failed to update system: {e}");
            Ok((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to update system"}))).into_response())
        }
    }
}

/// Delete a system and its credentials.
async fn delete_system(
    user: SystemScoped,
    State(state): State<AppState>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    user.require("systems.delete").map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;
    let project_id = user.project_id;
    let user_id = user.claims.sub;
    let environment_id = user.environment_id;
    let id = user.system.id;
    let system_name = user.system.name.clone();

    // Disconnect all users from this system
    let _ = state.connections.disconnect_system(id).await;

    let result = sqlx::query("DELETE FROM systems WHERE id = $1 AND environment_id = $2")
        .bind(id)
        .bind(environment_id)
        .execute(&state.db)
        .await;

    match result {
        Ok(r) if r.rows_affected() > 0 => {
            // Delete credentials from vault after DB delete succeeds (CASCADE handles credential table rows)
            if let Err(e) = state.vault.delete_system_credentials(&state.db, id).await {
                tracing::warn!("Failed to delete vault credentials for deleted system {id}: {e}");
            }
            log_system_action(
                &state.db,
                project_id,
                user_id,
                "system.delete",
                id,
                Some(serde_json::json!({"name": system_name})),
                Some(environment_id),
            ).await;
            Ok((StatusCode::OK, Json(json!({"message": "System deleted"}))).into_response())
        }
        Ok(_) => Ok((StatusCode::NOT_FOUND, Json(json!({"error": "System not found"}))).into_response()),
        Err(e) => {
            tracing::error!("Failed to delete system: {e}");
            Ok((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to delete system"}))).into_response())
        }
    }
}

/// Test connection to a system without persisting the connection.
async fn test_connection(
    user: SystemScoped,
    State(state): State<AppState>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    user.require("systems.connect").map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;
    let system = user.system;

    // Try connecting via shared connection
    match state.connections.connect_shared(&state.db, &system).await {
        Ok(()) => {
            // Run a simple test command
            let test_result = state.connections.execute_shared(system.id, "echo ok").await;
            // Disconnect after test
            state.connections.disconnect_shared(system.id);

            match test_result {
                Ok(result) if result.success() => {
                    Ok(Json(json!({"status": "ok", "message": "Connection successful"})).into_response())
                }
                Ok(result) => {
                    Ok(Json(json!({"status": "error", "message": format!("Command failed: {}", result.stderr)})).into_response())
                }
                Err(e) => {
                    Ok(Json(json!({"status": "error", "message": format!("Execution failed: {e}")})).into_response())
                }
            }
        }
        Err(e) => {
            Ok(Json(json!({"status": "error", "message": format!("Connection failed: {e}")})).into_response())
        }
    }
}

/// Connect to a system (persist the connection in the pool).
async fn connect_system(
    user: SystemScoped,
    State(state): State<AppState>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    user.require("systems.connect").map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;
    let project_id = user.project_id;
    let user_id = user.claims.sub;
    let environment_id = user.environment_id;
    let system = user.system;
    let system_id = system.id;

    match state.connections.connect_shared(&state.db, &system).await {
        Ok(()) => {
            // Update last_connected_at
            let _ = sqlx::query("UPDATE systems SET last_connected_at = now() WHERE id = $1")
                .bind(system_id)
                .execute(&state.db)
                .await;

            // Auto-detect available runtimes in the background
            let state_clone = state.clone();
            tokio::spawn(async move {
                detect_and_update_runtimes(&state_clone, system_id).await;
            });

            log_system_action(
                &state.db,
                project_id,
                user_id,
                "system.connect",
                system_id,
                None,
                Some(environment_id),
            ).await;

            Ok(Json(json!({"status": "connected"})).into_response())
        }
        Err(e) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Connection failed: {e}")}))).into_response())
        }
    }
}

/// Detect available container runtimes on a connected system and update the database.
pub(crate) async fn detect_and_update_runtimes(state: &AppState, system_id: Uuid) {
    let runtimes_to_check = [
        ContainerRuntime::Docker,
        ContainerRuntime::Podman,
    ];

    let mut detected = Vec::new();
    for runtime in runtimes_to_check {
        let cmd = CommandBuilder::detect_runtime(runtime);
        match state.connections.execute_shared(system_id, &cmd).await {
            Ok(result) if result.success() => {
                if OutputParser::parse_runtime_available(&result.stdout, runtime) {
                    tracing::info!("Detected runtime {:?} on system {}", runtime, system_id);
                    detected.push(runtime);
                }
            }
            _ => {}
        }
    }

    if detected.is_empty() {
        return;
    }

    let runtimes_json = serde_json::Value::Array(
        detected.iter().map(|r| {
            serde_json::Value::String(match r {
                ContainerRuntime::Docker => "docker".to_string(),
                ContainerRuntime::Podman => "podman".to_string(),
                ContainerRuntime::Apple => "apple".to_string(),
            })
        }).collect()
    );
    let primary = match detected[0] {
        ContainerRuntime::Docker => "docker",
        ContainerRuntime::Podman => "podman",
        ContainerRuntime::Apple => "apple",
    };

    // Fetch current primary_runtime to check if it's still valid
    let current_primary: Option<String> = sqlx::query_scalar(
        "SELECT primary_runtime FROM systems WHERE id = $1",
    )
    .bind(system_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let runtime_strings: Vec<String> = detected
        .iter()
        .map(|r| match r {
            ContainerRuntime::Docker => "docker".to_string(),
            ContainerRuntime::Podman => "podman".to_string(),
            ContainerRuntime::Apple => "apple".to_string(),
        })
        .collect();

    // If current primary isn't among detected runtimes, switch to first detected
    let new_primary = if current_primary
        .as_ref()
        .map(|p| !runtime_strings.contains(p))
        .unwrap_or(true)
    {
        Some(primary)
    } else {
        None
    };

    // Update available_runtimes
    let _ = sqlx::query(
        "UPDATE systems SET available_runtimes = $1, updated_at = now() WHERE id = $2",
    )
    .bind(&runtimes_json)
    .bind(system_id)
    .execute(&state.db)
    .await;

    // Update primary_runtime if needed
    if let Some(new_primary) = new_primary {
        let _ = sqlx::query(
            "UPDATE systems SET primary_runtime = $1, updated_at = now() WHERE id = $2",
        )
        .bind(new_primary)
        .bind(system_id)
        .execute(&state.db)
        .await;
    }
}

/// Get extended system info (username, CPU, RAM, uptime, containers, etc.)
async fn get_system_info(
    user: SystemScoped,
    State(state): State<AppState>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    user.require("systems.view").map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;
    let system = user.system;

    let runtime = match system.primary_runtime.as_str() {
        "podman" => ContainerRuntime::Podman,
        "apple" => ContainerRuntime::Apple,
        _ => ContainerRuntime::Docker,
    };

    let cmd = CommandBuilder::get_extended_system_info_for_remote(runtime);
    match state.connections.execute_shared(system.id, &cmd).await {
        Ok(result) => {
            let info = OutputParser::parse_extended_system_info(&result.stdout);
            Ok(Json(serde_json::to_value(info).unwrap_or_default()).into_response())
        }
        Err(e) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Failed to get system info: {e}")}))).into_response())
        }
    }
}

/// Get live system metrics (CPU usage, memory usage, load average)
async fn get_live_metrics(
    user: SystemScoped,
    State(state): State<AppState>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    user.require("systems.view").map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;
    let id = user.system.id;

    let cmd = CommandBuilder::get_live_metrics_for_remote();
    match state.connections.execute_shared(id, cmd).await {
        Ok(result) => {
            let metrics = OutputParser::parse_live_metrics(&result.stdout, &id.to_string());
            Ok(Json(serde_json::to_value(metrics).unwrap_or_default()).into_response())
        }
        Err(e) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Failed to get metrics: {e}")}))).into_response())
        }
    }
}

/// Disconnect from a system.
async fn disconnect_system(
    user: SystemScoped,
    State(state): State<AppState>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    user.require("systems.connect").map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;
    let project_id = user.project_id;
    let user_id = user.claims.sub;
    let environment_id = user.environment_id;
    let id = user.system.id;

    match state.connections.disconnect_system(id).await {
        Ok(()) => {
            log_system_action(
                &state.db,
                project_id,
                user_id,
                "system.disconnect",
                id,
                None,
                Some(environment_id),
            ).await;
            Ok(Json(json!({"status": "disconnected"})).into_response())
        }
        Err(e) => {
            Ok((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": format!("Disconnect failed: {e}")}))).into_response())
        }
    }
}

/// Remove a stale known_hosts entry for a system and retry connection.
/// Used when the server's host key has changed (e.g. server reinstalled).
async fn trust_host_key(
    user: SystemScoped,
    State(state): State<AppState>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    user.require("systems.connect").map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;
    let project_id = user.project_id;
    let user_id = user.claims.sub;
    let environment_id = user.environment_id;
    let system = user.system;

    let port: u16 = match u16::try_from(system.port) {
        Ok(p) if p > 0 => p,
        _ => {
            return Ok((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Invalid port configuration"}))).into_response());
        }
    };

    // Remove old host key from server's known_hosts
    match containerus_core::ssh::known_hosts::remove_host_key(&system.hostname, port) {
        Ok(removed) => {
            tracing::info!("Removed {} known_hosts entries for {}:{}", removed, system.hostname, port);
        }
        Err(e) => {
            tracing::error!("Failed to remove known host key: {e}");
            return Ok((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": format!("Failed to remove known host key: {e}")}))).into_response());
        }
    }

    // Retry connection — the new key will be auto-accepted
    match state.connections.connect_shared(&state.db, &system).await {
        Ok(()) => {
            let _ = sqlx::query("UPDATE systems SET last_connected_at = now() WHERE id = $1")
                .bind(system.id)
                .execute(&state.db)
                .await;

            log_system_action(
                &state.db,
                project_id,
                user_id,
                "system.trust_host_key",
                system.id,
                Some(serde_json::json!({"hostname": &system.hostname, "port": port})),
                Some(environment_id),
            ).await;

            Ok(Json(json!({"status": "connected"})).into_response())
        }
        Err(e) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Connection failed after trusting new key: {e}")}))).into_response())
        }
    }
}
