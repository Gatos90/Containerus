use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::audit::log_action;
use crate::auth::middleware::ProjectScoped;
use crate::db::models::Environment;
use crate::AppState;

// ============================================================================
// Router — nested under /api/projects/{project_id}/environments
// ============================================================================

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_environments).post(create_environment))
        .route(
            "/{environment_id}",
            get(get_environment)
                .put(update_environment)
                .delete(delete_environment),
        )
}

// ============================================================================
// Request types
// ============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEnvironmentRequest {
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateEnvironmentRequest {
    pub name: Option<String>,
    pub slug: Option<String>,
    pub description: Option<String>,
}

// ============================================================================
// Helpers
// ============================================================================

/// Validate a slug: must start with a lowercase letter, end with alphanumeric,
/// contain only lowercase alphanumeric and hyphens, 1-63 characters.
/// RFC 1123 compatible for DNS/Kubernetes label use.
fn is_valid_slug(s: &str) -> bool {
    let len = s.len();
    if len == 0 || len > 63 {
        return false;
    }
    let bytes = s.as_bytes();
    // Must start with a lowercase letter
    if !bytes[0].is_ascii_lowercase() {
        return false;
    }
    // Must end with lowercase letter or digit
    if !bytes[len - 1].is_ascii_lowercase() && !bytes[len - 1].is_ascii_digit() {
        return false;
    }
    // All characters must be lowercase alphanumeric or hyphen
    s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

// ============================================================================
// Handlers
// ============================================================================

/// List all environments for a project.
async fn list_environments(
    scoped: ProjectScoped,
    State(state): State<AppState>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    scoped.require("environments.view").map_err(|_| {
        (
            StatusCode::FORBIDDEN,
            Json(json!({"error": "Insufficient permissions"})),
        )
    })?;

    let environments = sqlx::query_as::<_, Environment>(
        "SELECT * FROM environments WHERE project_id = $1 ORDER BY is_default DESC, name",
    )
    .bind(scoped.project_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to list environments: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to list environments"})),
        )
    })?;

    Ok(Json(json!(environments)).into_response())
}

/// Create a new environment in a project.
async fn create_environment(
    scoped: ProjectScoped,
    State(state): State<AppState>,
    Json(req): Json<CreateEnvironmentRequest>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    scoped.require("environments.create").map_err(|_| {
        (
            StatusCode::FORBIDDEN,
            Json(json!({"error": "Insufficient permissions"})),
        )
    })?;

    // Validate name is not empty
    let name = req.name.trim();
    if name.is_empty() {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Name is required"})),
        )
            .into_response());
    }

    // Trim and validate slug format
    let slug = req.slug.trim();
    if !is_valid_slug(slug) {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Invalid slug: must be 1-63 characters, start with a letter, end with alphanumeric, lowercase alphanumeric and hyphens only"})),
        )
            .into_response());
    }

    let environment = sqlx::query_as::<_, Environment>(
        r#"
        INSERT INTO environments (id, project_id, name, slug, description, is_default, created_at, updated_at)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, false, now(), now())
        RETURNING *
        "#,
    )
    .bind(scoped.project_id)
    .bind(name)
    .bind(slug)
    .bind(&req.description)
    .fetch_one(&state.db)
    .await;

    match environment {
        Ok(env) => {
            log_action(&state.db, Some(scoped.project_id), Some(scoped.claims.sub), "environment.create", "environment", Some(&env.id.to_string()), Some(serde_json::json!({"name": &env.name})), None, None).await;
            Ok((StatusCode::CREATED, Json(json!(env))).into_response())
        }
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("unique") || msg.contains("duplicate") || msg.contains("idx_environments") {
                return Ok((
                    StatusCode::CONFLICT,
                    Json(json!({"error": "An environment with that slug already exists in this project"})),
                )
                    .into_response());
            }
            tracing::error!("Failed to create environment: {e}");
            Ok((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to create environment"})),
            )
                .into_response())
        }
    }
}

/// Get a single environment by ID.
async fn get_environment(
    scoped: ProjectScoped,
    State(state): State<AppState>,
    Path((_pid, environment_id)): Path<(Uuid, Uuid)>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    scoped.require("environments.view").map_err(|_| {
        (
            StatusCode::FORBIDDEN,
            Json(json!({"error": "Insufficient permissions"})),
        )
    })?;

    match sqlx::query_as::<_, Environment>(
        "SELECT * FROM environments WHERE id = $1 AND project_id = $2",
    )
    .bind(environment_id)
    .bind(scoped.project_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(env)) => Ok(Json(json!(env)).into_response()),
        Ok(None) => Ok((
            StatusCode::NOT_FOUND,
            Json(json!({"error": "Environment not found"})),
        )
            .into_response()),
        Err(e) => {
            tracing::error!("Failed to get environment: {e}");
            Ok((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to get environment"})),
            )
                .into_response())
        }
    }
}

/// Update an environment.
async fn update_environment(
    scoped: ProjectScoped,
    State(state): State<AppState>,
    Path((_pid, environment_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<UpdateEnvironmentRequest>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    scoped.require("environments.edit").map_err(|_| {
        (
            StatusCode::FORBIDDEN,
            Json(json!({"error": "Insufficient permissions"})),
        )
    })?;

    // Fetch existing environment to merge optional fields
    let existing = sqlx::query_as::<_, Environment>(
        "SELECT * FROM environments WHERE id = $1 AND project_id = $2",
    )
    .bind(environment_id)
    .bind(scoped.project_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to fetch environment: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to fetch environment"})),
        )
    })?
    .ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "Environment not found"})),
        )
    })?;

    let name = req.name.as_deref().unwrap_or(&existing.name);
    let slug = req.slug.as_deref().map(|s| s.trim()).unwrap_or(&existing.slug);
    let description = req.description.as_ref().or(existing.description.as_ref());

    // Validate name is not empty
    if name.trim().is_empty() {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Name cannot be empty"})),
        )
            .into_response());
    }

    // Validate slug format if it was provided (or use existing which was already validated)
    if req.slug.is_some() && !is_valid_slug(slug) {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Invalid slug: must be 1-63 characters, start with a letter, end with alphanumeric, lowercase alphanumeric and hyphens only"})),
        )
            .into_response());
    }

    let result = sqlx::query_as::<_, Environment>(
        r#"
        UPDATE environments
        SET name = $1, slug = $2, description = $3, updated_at = now()
        WHERE id = $4 AND project_id = $5
        RETURNING *
        "#,
    )
    .bind(name.trim())
    .bind(slug)
    .bind(description)
    .bind(environment_id)
    .bind(scoped.project_id)
    .fetch_optional(&state.db)
    .await;

    match result {
        Ok(Some(env)) => {
            log_action(&state.db, Some(scoped.project_id), Some(scoped.claims.sub), "environment.update", "environment", Some(&env.id.to_string()), Some(serde_json::json!({"name": &env.name})), None, None).await;
            Ok(Json(json!(env)).into_response())
        }
        Ok(None) => Ok((
            StatusCode::NOT_FOUND,
            Json(json!({"error": "Environment not found"})),
        )
            .into_response()),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("unique") || msg.contains("duplicate") || msg.contains("idx_environments") {
                return Ok((
                    StatusCode::CONFLICT,
                    Json(json!({"error": "An environment with that slug already exists in this project"})),
                )
                    .into_response());
            }
            tracing::error!("Failed to update environment: {e}");
            Ok((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to update environment"})),
            )
                .into_response())
        }
    }
}

/// Delete an environment. Prevents deletion if it still contains resources.
async fn delete_environment(
    scoped: ProjectScoped,
    State(state): State<AppState>,
    Path((_pid, environment_id)): Path<(Uuid, Uuid)>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    scoped.require("environments.delete").map_err(|_| {
        (
            StatusCode::FORBIDDEN,
            Json(json!({"error": "Insufficient permissions"})),
        )
    })?;

    // Verify environment exists and belongs to this project
    let environment = sqlx::query_as::<_, Environment>(
        "SELECT * FROM environments WHERE id = $1 AND project_id = $2",
    )
    .bind(environment_id)
    .bind(scoped.project_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to fetch environment: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to fetch environment"})),
        )
    })?
    .ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "Environment not found"})),
        )
    })?;

    if environment.is_default {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Cannot delete the default environment"})),
        )
            .into_response());
    }

    let mut tx = state.db.begin().await.map_err(|e| {
        tracing::error!("Failed to begin transaction: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to delete environment"})),
        )
    })?;

    // Check for systems in this environment
    let system_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM systems WHERE environment_id = $1",
    )
    .bind(environment_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to count systems: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to check environment resources"})),
        )
    })?;

    // Check for clusters in this environment
    let cluster_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM clusters WHERE environment_id = $1",
    )
    .bind(environment_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to count clusters: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to check environment resources"})),
        )
    })?;

    if system_count.0 > 0 || cluster_count.0 > 0 {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "Cannot delete environment that contains resources. Remove all systems and clusters first.",
                "systems": system_count.0,
                "clusters": cluster_count.0
            })),
        )
            .into_response());
    }

    let result = sqlx::query(
        "DELETE FROM environments WHERE id = $1 AND project_id = $2",
    )
    .bind(environment_id)
    .bind(scoped.project_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to delete environment: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to delete environment"})),
        )
    })?;

    if result.rows_affected() == 0 {
        return Ok((
            StatusCode::NOT_FOUND,
            Json(json!({"error": "Environment not found"})),
        )
            .into_response());
    }

    tx.commit().await.map_err(|e| {
        tracing::error!("Failed to commit transaction: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to delete environment"})),
        )
    })?;

    log_action(&state.db, Some(scoped.project_id), Some(scoped.claims.sub), "environment.delete", "environment", Some(&environment_id.to_string()), Some(serde_json::json!({"name": &environment.name})), None, None).await;

    Ok(Json(json!({"message": "Environment deleted"})).into_response())
}
