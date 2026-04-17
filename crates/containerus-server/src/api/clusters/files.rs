use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use containerus_rbac_macros::require_permissions;
use base64::Engine;
use k8s_openapi::api::core::v1::Pod;
use kube::api::{Api, AttachParams};
use serde::Deserialize;
use serde_json::json;
use tokio::io::AsyncReadExt;
use uuid::Uuid;

use containerus_core::models::file_browser::{DirectoryListing, FileContent};
use containerus_core::runtime::{CommandBuilder, OutputParser};

use crate::auth::middleware::AuthUser;
use crate::AppState;

use super::common::{get_kube_client, get_verified_cluster, verify_cluster_access, ApiError};

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/{id}/namespaces/{namespace}/pods/{pod}/files/list",
            get(list_directory),
        )
        .route(
            "/{id}/namespaces/{namespace}/pods/{pod}/files/read",
            get(read_file),
        )
        .route(
            "/{id}/namespaces/{namespace}/pods/{pod}/files/write",
            post(write_file),
        )
        .route(
            "/{id}/namespaces/{namespace}/pods/{pod}/files/mkdir",
            post(create_directory),
        )
        .route(
            "/{id}/namespaces/{namespace}/pods/{pod}/files/delete",
            delete(delete_path),
        )
        .route(
            "/{id}/namespaces/{namespace}/pods/{pod}/files/rename",
            post(rename_path),
        )
        .route(
            "/{id}/namespaces/{namespace}/pods/{pod}/files/download",
            get(download_file),
        )
        .route(
            "/{id}/namespaces/{namespace}/pods/{pod}/files/upload",
            post(upload_file),
        )
}

// ============================================================================
// Query / Request types
// ============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PodFileQuery {
    pub path: String,
    pub container: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PodWriteRequest {
    pub path: String,
    pub content: String,
    pub container: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PodMkdirRequest {
    pub path: String,
    pub container: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PodDeleteRequest {
    pub path: String,
    pub is_directory: bool,
    pub container: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PodRenameRequest {
    pub old_path: String,
    pub new_path: String,
    pub container: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PodUploadRequest {
    pub remote_path: String,
    /// Base64-encoded file content
    pub content: String,
    pub container: Option<String>,
}

// ============================================================================
// Helpers
// ============================================================================

fn validate_path(path: &str) -> Result<(), ApiError> {
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
    const FORBIDDEN_CHARS: &[char] = &[
        '\n', '\r', ';', '`', '$', '|', '&', '>', '<', '\'', '"', '(', ')', '{', '}', '*', '?',
        '\\',
    ];
    if path.chars().any(|c| FORBIDDEN_CHARS.contains(&c)) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Path contains forbidden characters"})),
        ));
    }
    Ok(())
}

/// Execute a command inside a K8s pod via exec and return (stdout, stderr).
async fn pod_exec(
    state: &AppState,
    cluster_id: Uuid,
    namespace: &str,
    pod_name: &str,
    container: Option<&str>,
    command: &str,
) -> Result<(String, String), ApiError> {
    let cluster = get_verified_cluster(state, cluster_id).await?;
    let client = get_kube_client(state, &cluster).await?;

    let pods: Api<Pod> = Api::namespaced(client, namespace);

    let mut ap = AttachParams::default();
    ap.stdin = false;
    ap.stdout = true;
    ap.stderr = true;
    ap.tty = false;
    if let Some(c) = container {
        ap.container = Some(c.to_string());
    }

    let mut attached = pods
        .exec(pod_name, vec!["sh", "-c", command], &ap)
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({"error": format!("Pod exec failed: {e}")})),
            )
        })?;

    let mut stdout = String::new();
    if let Some(mut reader) = attached.stdout() {
        reader.read_to_string(&mut stdout).await.map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({"error": format!("Failed to read stdout: {e}")})),
            )
        })?;
    }

    let mut stderr = String::new();
    if let Some(mut reader) = attached.stderr() {
        reader.read_to_string(&mut stderr).await.map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({"error": format!("Failed to read stderr: {e}")})),
            )
        })?;
    }

    // Wait for the process to complete
    if let Some(status) = attached.take_status() {
        let _ = status.await;
    }

    Ok((stdout, stderr))
}

/// Verify the user has file access for the cluster.
async fn verify_file_access(
    state: &AppState,
    auth: &AuthUser,
    cluster_id: Uuid,
    permission: &str,
) -> Result<(), ApiError> {
    let cluster = get_verified_cluster(state, cluster_id).await?;
    verify_cluster_access(state, &auth.claims, &cluster, permission).await
}

// ============================================================================
// Handlers
// ============================================================================

#[require_permissions("clusters.exec")]
async fn list_directory(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((id, namespace, pod)): Path<(Uuid, String, String)>,
    Query(query): Query<PodFileQuery>,
) -> Result<impl IntoResponse, ApiError> {
    verify_file_access(&state, &auth, id, "clusters.exec").await?;
    validate_path(&query.path)?;

    let cmd = CommandBuilder::list_directory(&query.path);
    let (stdout, stderr) = pod_exec(&state, id, &namespace, &pod, query.container.as_deref(), &cmd).await?;

    if stdout.is_empty() && !stderr.is_empty() {
        if stderr.contains("Permission denied") {
            return Err((
                StatusCode::FORBIDDEN,
                Json(json!({"error": format!("Permission denied: {}", query.path)})),
            ));
        }
        return Err((
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": format!("Command failed: {}", stderr)})),
        ));
    }

    let entries = OutputParser::parse_directory_listing(&stdout, &query.path).map_err(|e| {
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
                    if s.is_empty() {
                        "/".to_string()
                    } else {
                        s
                    }
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

#[require_permissions("clusters.exec")]
async fn read_file(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((id, namespace, pod)): Path<(Uuid, String, String)>,
    Query(query): Query<PodFileQuery>,
) -> Result<impl IntoResponse, ApiError> {
    verify_file_access(&state, &auth, id, "clusters.exec").await?;
    validate_path(&query.path)?;

    let max_size: u64 = 1_048_576;
    let cmd = CommandBuilder::read_file(&query.path, max_size);
    let (stdout, stderr) = pod_exec(&state, id, &namespace, &pod, query.container.as_deref(), &cmd).await?;

    if stdout.is_empty() && !stderr.is_empty() {
        if stderr.contains("Permission denied") {
            return Err((
                StatusCode::FORBIDDEN,
                Json(json!({"error": format!("Permission denied: {}", query.path)})),
            ));
        }
        return Err((
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": format!("Command failed: {}", stderr)})),
        ));
    }

    if stdout.starts_with("__FILE_TOO_LARGE__:") {
        let size_str = stdout.trim_start_matches("__FILE_TOO_LARGE__:").trim();
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({"error": format!("File is too large ({} bytes, max 1 MB)", size_str)})),
        ));
    }

    let content = stdout;
    let size = content.len() as u64;
    let is_binary = content.bytes().any(|b| b == 0);

    Ok(Json(FileContent {
        path: query.path,
        content,
        size,
        is_binary,
    }))
}

#[require_permissions("clusters.exec")]
async fn write_file(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((id, namespace, pod)): Path<(Uuid, String, String)>,
    Json(req): Json<PodWriteRequest>,
) -> Result<impl IntoResponse, ApiError> {
    verify_file_access(&state, &auth, id, "clusters.exec").await?;
    validate_path(&req.path)?;

    if req.content.len() > 10_000_000 {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({"error": "Content too large (max 10 MB)"})),
        ));
    }

    let encoded = base64::engine::general_purpose::STANDARD.encode(&req.content);
    let cmd = CommandBuilder::write_file_from_base64(&req.path, &encoded);
    let (_stdout, stderr) = pod_exec(&state, id, &namespace, &pod, req.container.as_deref(), &cmd).await?;

    if !stderr.is_empty() {
        if stderr.contains("Permission denied") {
            return Err((
                StatusCode::FORBIDDEN,
                Json(json!({"error": format!("Permission denied: {}", req.path)})),
            ));
        }
        return Err((
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": format!("Command failed: {}", stderr)})),
        ));
    }

    Ok(Json(json!({"ok": true})))
}

#[require_permissions("clusters.exec")]
async fn create_directory(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((id, namespace, pod)): Path<(Uuid, String, String)>,
    Json(req): Json<PodMkdirRequest>,
) -> Result<impl IntoResponse, ApiError> {
    verify_file_access(&state, &auth, id, "clusters.exec").await?;
    validate_path(&req.path)?;

    let cmd = CommandBuilder::create_directory(&req.path);
    let (_stdout, stderr) = pod_exec(&state, id, &namespace, &pod, req.container.as_deref(), &cmd).await?;

    if !stderr.is_empty() {
        return Err((
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": format!("Command failed: {}", stderr)})),
        ));
    }

    Ok(Json(json!({"ok": true})))
}

#[require_permissions("clusters.exec")]
async fn delete_path(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((id, namespace, pod)): Path<(Uuid, String, String)>,
    Json(req): Json<PodDeleteRequest>,
) -> Result<impl IntoResponse, ApiError> {
    verify_file_access(&state, &auth, id, "clusters.exec").await?;
    validate_path(&req.path)?;

    if req.path == "/" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Cannot delete root directory"})),
        ));
    }

    let cmd = if req.is_directory {
        CommandBuilder::delete_directory(&req.path)
    } else {
        CommandBuilder::delete_file(&req.path)
    };
    let (_stdout, stderr) = pod_exec(&state, id, &namespace, &pod, req.container.as_deref(), &cmd).await?;

    if !stderr.is_empty() {
        if stderr.contains("Permission denied") {
            return Err((
                StatusCode::FORBIDDEN,
                Json(json!({"error": format!("Permission denied: {}", req.path)})),
            ));
        }
        return Err((
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": format!("Command failed: {}", stderr)})),
        ));
    }

    Ok(Json(json!({"ok": true})))
}

#[require_permissions("clusters.exec")]
async fn rename_path(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((id, namespace, pod)): Path<(Uuid, String, String)>,
    Json(req): Json<PodRenameRequest>,
) -> Result<impl IntoResponse, ApiError> {
    verify_file_access(&state, &auth, id, "clusters.exec").await?;
    validate_path(&req.old_path)?;
    validate_path(&req.new_path)?;

    let cmd = CommandBuilder::rename_path(&req.old_path, &req.new_path);
    let (_stdout, stderr) = pod_exec(&state, id, &namespace, &pod, req.container.as_deref(), &cmd).await?;

    if !stderr.is_empty() {
        return Err((
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": format!("Command failed: {}", stderr)})),
        ));
    }

    Ok(Json(json!({"ok": true})))
}

#[require_permissions("clusters.exec")]
async fn download_file(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((id, namespace, pod)): Path<(Uuid, String, String)>,
    Query(query): Query<PodFileQuery>,
) -> Result<impl IntoResponse, ApiError> {
    verify_file_access(&state, &auth, id, "clusters.exec").await?;
    validate_path(&query.path)?;

    let cmd = CommandBuilder::read_file_base64(&query.path);
    let (stdout, stderr) = pod_exec(&state, id, &namespace, &pod, query.container.as_deref(), &cmd).await?;

    if stdout.is_empty() && !stderr.is_empty() {
        if stderr.contains("Permission denied") {
            return Err((
                StatusCode::FORBIDDEN,
                Json(json!({"error": format!("Permission denied: {}", query.path)})),
            ));
        }
        return Err((
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": format!("Command failed: {}", stderr)})),
        ));
    }

    Ok(Json(json!({
        "path": query.path,
        "content": stdout.trim(),
    })))
}

#[require_permissions("clusters.exec")]
async fn upload_file(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((id, namespace, pod)): Path<(Uuid, String, String)>,
    Json(req): Json<PodUploadRequest>,
) -> Result<impl IntoResponse, ApiError> {
    verify_file_access(&state, &auth, id, "clusters.exec").await?;
    validate_path(&req.remote_path)?;

    if req.content.len() > 67_000_000 {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({"error": "File is too large to upload (max 50 MB)"})),
        ));
    }

    let cmd = CommandBuilder::write_file_base64(&req.remote_path, &req.content);
    let (_stdout, stderr) = pod_exec(&state, id, &namespace, &pod, req.container.as_deref(), &cmd).await?;

    if !stderr.is_empty() {
        if stderr.contains("Permission denied") {
            return Err((
                StatusCode::FORBIDDEN,
                Json(json!({"error": format!("Permission denied: {}", req.remote_path)})),
            ));
        }
        return Err((
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": format!("Command failed: {}", stderr)})),
        ));
    }

    Ok(Json(json!({"ok": true})))
}
