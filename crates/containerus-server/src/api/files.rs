use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use base64::Engine;
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use containerus_core::models::container::ContainerRuntime;
use containerus_core::models::file_browser::{DirectoryListing, FileContent};
use containerus_core::runtime::{CommandBuilder, OutputParser};

use crate::auth::middleware::SystemScoped;
use crate::AppState;

use super::containers::ensure_connected;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/{system_id}/files/list", get(list_directory))
        .route("/{system_id}/files/read", get(read_file))
        .route("/{system_id}/files/write", post(write_file))
        .route("/{system_id}/files/mkdir", post(create_directory))
        .route("/{system_id}/files/delete", delete(delete_path))
        .route("/{system_id}/files/rename", post(rename_path))
        .route("/{system_id}/files/download", get(download_file))
        .route("/{system_id}/files/upload", post(upload_file))
}

// ============================================================================
// Query / Request types
// ============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileQuery {
    pub path: String,
    pub container_id: Option<String>,
    pub runtime: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteRequest {
    pub path: String,
    pub content: String,
    pub container_id: Option<String>,
    pub runtime: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MkdirRequest {
    pub path: String,
    pub container_id: Option<String>,
    pub runtime: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteRequest {
    pub path: String,
    pub is_directory: bool,
    pub container_id: Option<String>,
    pub runtime: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameRequest {
    pub old_path: String,
    pub new_path: String,
    pub container_id: Option<String>,
    pub runtime: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadRequest {
    pub remote_path: String,
    /// Base64-encoded file content
    pub content: String,
    pub container_id: Option<String>,
    pub runtime: Option<String>,
}

// ============================================================================
// Helpers
// ============================================================================

fn validate_path(path: &str) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    if path.contains('\0') {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Path contains null byte"})),
        ));
    }
    if !path.starts_with('/') {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Path must be absolute (start with /)"})),
        ));
    }
    if path.split('/').any(|segment| segment == "..") {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Path traversal (..) is not allowed"})),
        ));
    }
    // Reject shell metacharacters that could enable command injection
    const FORBIDDEN_CHARS: &[char] = &['\n', '\r', ';', '`', '$', '|', '&', '>', '<', '\'', '"', '(', ')', '{', '}', '*', '?', '\\'];
    if path.chars().any(|c| FORBIDDEN_CHARS.contains(&c)) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Path contains forbidden characters"})),
        ));
    }
    Ok(())
}

fn parse_runtime(s: &str) -> Result<ContainerRuntime, (StatusCode, Json<serde_json::Value>)> {
    match s {
        "docker" => Ok(ContainerRuntime::Docker),
        "podman" => Ok(ContainerRuntime::Podman),
        "apple" => Ok(ContainerRuntime::Apple),
        other => Err((StatusCode::BAD_REQUEST, Json(json!({"error": format!("Unknown runtime: {other}")})))),
    }
}

/// Validate that a container ID is safe (alphanumeric, hyphens, underscores, dots).
fn validate_container_id(cid: &str) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    if cid.is_empty() || cid.len() > 256 || !cid.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-' || c == '.') {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Invalid container ID format"})),
        ));
    }
    Ok(())
}

/// Build the final command, optionally wrapping for container exec.
fn build_command(
    base_cmd: &str,
    container_id: Option<&str>,
    runtime: Option<&str>,
) -> Result<String, (StatusCode, Json<serde_json::Value>)> {
    if let Some(cid) = container_id {
        validate_container_id(cid)?;
    }
    match (container_id, runtime) {
        (Some(cid), Some(rt)) => {
            Ok(CommandBuilder::exec_command(parse_runtime(rt)?, cid, base_cmd))
        }
        (Some(cid), None) => {
            Ok(CommandBuilder::exec_command(ContainerRuntime::Docker, cid, base_cmd))
        }
        _ => Ok(base_cmd.to_string()),
    }
}

/// Execute a command on the system on behalf of a specific user.
async fn execute(
    state: &AppState,
    user_id: Uuid,
    system_id: Uuid,
    command: &str,
) -> Result<containerus_core::executor::CommandResult, (StatusCode, Json<serde_json::Value>)> {
    state
        .connections
        .execute(user_id, system_id, command)
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({"error": format!("Execution failed: {e}")})),
            )
        })
}

// ============================================================================
// Handlers
// ============================================================================

async fn list_directory(
    user: SystemScoped,
    State(state): State<AppState>,
    Query(query): Query<FileQuery>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    user.require_for_system("files.view", &state).await
        .map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;

    validate_path(&query.path)?;

    ensure_connected(&state, user.claims.sub, &user.system).await?;

    let base_cmd = CommandBuilder::list_directory(&query.path);
    let cmd = build_command(&base_cmd, query.container_id.as_deref(), query.runtime.as_deref())?;
    let result = execute(&state, user.claims.sub, user.system.id, &cmd).await?;

    if !result.success() {
        if result.stderr.contains("Permission denied") {
            return Err((
                StatusCode::FORBIDDEN,
                Json(json!({"error": format!("Permission denied: {}", query.path)})),
            ));
        }
        return Err((
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": format!("Command failed: {}", result.stderr)})),
        ));
    }

    let entries = OutputParser::parse_directory_listing(&result.stdout, &query.path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": format!("Parse error: {e}")})),
        )
    })?;

    let parent_path = if query.path == "/" {
        None
    } else {
        Some(
            std::path::Path::new(&query.path)
                .parent()
                .map(|p| {
                    let s = p.to_string_lossy().to_string();
                    if s.is_empty() { "/".to_string() } else { s }
                })
                .unwrap_or_else(|| "/".to_string()),
        )
    };

    Ok(Json(DirectoryListing {
        path: query.path,
        entries,
        parent_path,
    }))
}

async fn read_file(
    user: SystemScoped,
    State(state): State<AppState>,
    Query(query): Query<FileQuery>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    user.require_for_system("files.view", &state).await
        .map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;

    validate_path(&query.path)?;

    ensure_connected(&state, user.claims.sub, &user.system).await?;

    let max_size: u64 = 1_048_576; // 1 MB
    let base_cmd = CommandBuilder::read_file(&query.path, max_size);
    let cmd = build_command(&base_cmd, query.container_id.as_deref(), query.runtime.as_deref())?;
    let result = execute(&state, user.claims.sub, user.system.id, &cmd).await?;

    if !result.success() {
        if result.stderr.contains("Permission denied") {
            return Err((
                StatusCode::FORBIDDEN,
                Json(json!({"error": format!("Permission denied: {}", query.path)})),
            ));
        }
        return Err((
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": format!("Command failed: {}", result.stderr)})),
        ));
    }

    if result.stdout.starts_with("__FILE_TOO_LARGE__:") {
        let size_str = result.stdout.trim_start_matches("__FILE_TOO_LARGE__:").trim();
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({"error": format!("File is too large ({} bytes, max 1 MB)", size_str)})),
        ));
    }

    let content = result.stdout;
    let size = content.len() as u64;
    let is_binary = content.bytes().any(|b| b == 0);

    Ok(Json(FileContent {
        path: query.path,
        content,
        size,
        is_binary,
    }))
}

async fn write_file(
    user: SystemScoped,
    State(state): State<AppState>,
    Json(req): Json<WriteRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    user.require_for_system("files.write", &state).await
        .map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;

    validate_path(&req.path)?;

    if req.content.len() > 10_000_000 {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({"error": "Content too large (max 10 MB)"})),
        ));
    }

    ensure_connected(&state, user.claims.sub, &user.system).await?;

    let encoded = base64::engine::general_purpose::STANDARD.encode(&req.content);
    let base_cmd = CommandBuilder::write_file_from_base64(&req.path, &encoded);
    let cmd = build_command(&base_cmd, req.container_id.as_deref(), req.runtime.as_deref())?;
    let result = execute(&state, user.claims.sub, user.system.id, &cmd).await?;

    if !result.success() {
        if result.stderr.contains("Permission denied") {
            return Err((
                StatusCode::FORBIDDEN,
                Json(json!({"error": format!("Permission denied: {}", req.path)})),
            ));
        }
        return Err((
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": format!("Command failed: {}", result.stderr)})),
        ));
    }

    Ok(Json(json!({"ok": true})))
}

async fn create_directory(
    user: SystemScoped,
    State(state): State<AppState>,
    Json(req): Json<MkdirRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    user.require_for_system("files.write", &state).await
        .map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;

    validate_path(&req.path)?;

    ensure_connected(&state, user.claims.sub, &user.system).await?;

    let base_cmd = CommandBuilder::create_directory(&req.path);
    let cmd = build_command(&base_cmd, req.container_id.as_deref(), req.runtime.as_deref())?;
    let result = execute(&state, user.claims.sub, user.system.id, &cmd).await?;

    if !result.success() {
        return Err((
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": format!("Command failed: {}", result.stderr)})),
        ));
    }

    Ok(Json(json!({"ok": true})))
}

async fn delete_path(
    user: SystemScoped,
    State(state): State<AppState>,
    Json(req): Json<DeleteRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    user.require_for_system("files.delete", &state).await
        .map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;

    validate_path(&req.path)?;

    if req.path == "/" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Cannot delete root directory"})),
        ));
    }

    ensure_connected(&state, user.claims.sub, &user.system).await?;

    let base_cmd = if req.is_directory {
        CommandBuilder::delete_directory(&req.path)
    } else {
        CommandBuilder::delete_file(&req.path)
    };
    let cmd = build_command(&base_cmd, req.container_id.as_deref(), req.runtime.as_deref())?;
    let result = execute(&state, user.claims.sub, user.system.id, &cmd).await?;

    if !result.success() {
        if result.stderr.contains("Permission denied") {
            return Err((
                StatusCode::FORBIDDEN,
                Json(json!({"error": format!("Permission denied: {}", req.path)})),
            ));
        }
        return Err((
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": format!("Command failed: {}", result.stderr)})),
        ));
    }

    Ok(Json(json!({"ok": true})))
}

async fn rename_path(
    user: SystemScoped,
    State(state): State<AppState>,
    Json(req): Json<RenameRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    user.require_for_system("files.write", &state).await
        .map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;

    validate_path(&req.old_path)?;
    validate_path(&req.new_path)?;

    ensure_connected(&state, user.claims.sub, &user.system).await?;

    let base_cmd = CommandBuilder::rename_path(&req.old_path, &req.new_path);
    let cmd = build_command(&base_cmd, req.container_id.as_deref(), req.runtime.as_deref())?;
    let result = execute(&state, user.claims.sub, user.system.id, &cmd).await?;

    if !result.success() {
        return Err((
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": format!("Command failed: {}", result.stderr)})),
        ));
    }

    Ok(Json(json!({"ok": true})))
}

/// Maximum download file size in bytes (100 MB).
const MAX_DOWNLOAD_SIZE: u64 = 100 * 1024 * 1024;

async fn download_file(
    user: SystemScoped,
    State(state): State<AppState>,
    Query(query): Query<FileQuery>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    user.require_for_system("files.view", &state).await
        .map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;

    validate_path(&query.path)?;

    ensure_connected(&state, user.claims.sub, &user.system).await?;

    // Stat the file first to enforce size limit (shell-quote the path to prevent injection)
    let escaped_path = format!("'{}'", query.path);
    let stat_cmd_str = format!("stat -c '%s' {} 2>/dev/null || stat -f '%z' {} 2>/dev/null", escaped_path, escaped_path);
    let stat_cmd = build_command(&stat_cmd_str, query.container_id.as_deref(), query.runtime.as_deref())?;
    let stat_result = execute(&state, user.claims.sub, user.system.id, &stat_cmd).await?;

    if !stat_result.success() {
        return Err((
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": format!("Failed to stat file: {}", stat_result.stderr)})),
        ));
    }
    let size = stat_result.stdout.trim().parse::<u64>().map_err(|_| {
        (
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": format!("Failed to determine file size from stat output: '{}'", stat_result.stdout.trim())})),
        )
    })?;
    if size > MAX_DOWNLOAD_SIZE {
        return Err((
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(json!({"error": format!("File too large ({} bytes). Maximum download size is {} bytes.", size, MAX_DOWNLOAD_SIZE)})),
        ));
    }

    let base_cmd = CommandBuilder::read_file_base64(&query.path);
    let cmd = build_command(&base_cmd, query.container_id.as_deref(), query.runtime.as_deref())?;
    let result = execute(&state, user.claims.sub, user.system.id, &cmd).await?;

    if !result.success() {
        if result.stderr.contains("Permission denied") {
            return Err((
                StatusCode::FORBIDDEN,
                Json(json!({"error": format!("Permission denied: {}", query.path)})),
            ));
        }
        return Err((
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": format!("Command failed: {}", result.stderr)})),
        ));
    }

    // Return the base64 content — frontend can decode and save
    Ok(Json(json!({
        "path": query.path,
        "content": result.stdout.trim(),
    })))
}

async fn upload_file(
    user: SystemScoped,
    State(state): State<AppState>,
    Json(req): Json<UploadRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    user.require_for_system("files.upload", &state).await
        .map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;

    validate_path(&req.remote_path)?;

    // Limit upload size (50 MB before base64 encoding ≈ ~67 MB in base64)
    if req.content.len() > 67_000_000 {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({"error": "File is too large to upload (max 50 MB)"})),
        ));
    }

    // Validate that content is valid base64
    if base64::engine::general_purpose::STANDARD.decode(&req.content).is_err() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Invalid base64 content"})),
        ));
    }

    ensure_connected(&state, user.claims.sub, &user.system).await?;

    let base_cmd = CommandBuilder::write_file_base64(&req.remote_path, &req.content);
    let cmd = build_command(&base_cmd, req.container_id.as_deref(), req.runtime.as_deref())?;
    let result = execute(&state, user.claims.sub, user.system.id, &cmd).await?;

    if !result.success() {
        if result.stderr.contains("Permission denied") {
            return Err((
                StatusCode::FORBIDDEN,
                Json(json!({"error": format!("Permission denied: {}", req.remote_path)})),
            ));
        }
        return Err((
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": format!("Command failed: {}", result.stderr)})),
        ));
    }

    Ok(Json(json!({"ok": true})))
}
