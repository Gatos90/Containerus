use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::auth::middleware::ProjectScoped;
use crate::db::models::ResourceAcl;
use crate::AppState;

// ============================================================================
// ACL Router — nested under /api/projects/{project_id}/acls
// ============================================================================

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_acls).post(create_acl))
        .route("/{acl_id}", put(update_acl).delete(delete_acl))
}

// ============================================================================
// Request types
// ============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAclRequest {
    pub user_id: Uuid,
    pub resource_type: String,
    pub resource_id: Uuid,
    pub role_id: Option<Uuid>,
    pub extra_permissions: Vec<String>,
    pub denied_permissions: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAclRequest {
    pub role_id: Option<Uuid>,
    pub extra_permissions: Option<Vec<String>>,
    pub denied_permissions: Option<Vec<String>>,
}

// ============================================================================
// Handlers
// ============================================================================

/// List all resource ACLs for a project. Requires projects.members.manage permission.
async fn list_acls(
    State(state): State<AppState>,
    scoped: ProjectScoped,
) -> Result<Json<Vec<ResourceAcl>>, (StatusCode, Json<Value>)> {
    scoped.require("projects.members.manage").map_err(|_| {
        (StatusCode::FORBIDDEN, Json(json!({ "error": "Insufficient permissions: projects.members.manage required" })))
    })?;

    let acls = sqlx::query_as::<_, ResourceAcl>(
        "SELECT * FROM resource_acls WHERE project_id = $1 ORDER BY created_at",
    )
    .bind(scoped.project_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to list resource ACLs: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?;

    Ok(Json(acls))
}

/// Create a resource ACL entry. Requires projects.members.manage permission.
async fn create_acl(
    State(state): State<AppState>,
    scoped: ProjectScoped,
    Json(req): Json<CreateAclRequest>,
) -> Result<(StatusCode, Json<ResourceAcl>), (StatusCode, Json<Value>)> {
    scoped.require("projects.members.manage").map_err(|_| {
        (StatusCode::FORBIDDEN, Json(json!({ "error": "Insufficient permissions: projects.members.manage required" })))
    })?;

    let project_id = scoped.project_id;

    if req.resource_type.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "Resource type is required" }))));
    }

    let acl_id = Uuid::new_v4();
    let extra_perms = serde_json::to_value(&req.extra_permissions).unwrap_or(json!([]));
    let denied_perms = serde_json::to_value(&req.denied_permissions).unwrap_or(json!([]));
    let now = chrono::Utc::now();

    let acl = sqlx::query_as::<_, ResourceAcl>(
        r#"
        INSERT INTO resource_acls (id, user_id, project_id, resource_type, resource_id, role_id, extra_permissions, denied_permissions, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
        "#,
    )
    .bind(acl_id)
    .bind(req.user_id)
    .bind(project_id)
    .bind(req.resource_type.trim())
    .bind(req.resource_id)
    .bind(req.role_id)
    .bind(&extra_perms)
    .bind(&denied_perms)
    .bind(now)
    .bind(now)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        if let Some(db_err) = e.as_database_error() {
            if db_err.is_unique_violation() {
                return (StatusCode::CONFLICT, Json(json!({ "error": "An ACL entry already exists for this user/resource combination" })));
            }
        }
        tracing::error!("Failed to create resource ACL: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?;

    Ok((StatusCode::CREATED, Json(acl)))
}

/// Update a resource ACL entry. Requires projects.members.manage permission.
async fn update_acl(
    State(state): State<AppState>,
    scoped: ProjectScoped,
    Path((_project_id, acl_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<UpdateAclRequest>,
) -> Result<Json<ResourceAcl>, (StatusCode, Json<Value>)> {
    scoped.require("projects.members.manage").map_err(|_| {
        (StatusCode::FORBIDDEN, Json(json!({ "error": "Insufficient permissions: projects.members.manage required" })))
    })?;

    let project_id = scoped.project_id;

    // Fetch existing ACL to merge optional fields
    let existing = sqlx::query_as::<_, ResourceAcl>(
        "SELECT * FROM resource_acls WHERE id = $1 AND project_id = $2",
    )
    .bind(acl_id)
    .bind(project_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to fetch resource ACL: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({ "error": "ACL entry not found" }))))?;

    // When req.role_id is None, intentionally preserve the existing role_id.
    // This allows partial updates where only extra_permissions or denied_permissions
    // are changed without requiring the client to re-send the current role_id.
    let role_id = req.role_id.or(existing.role_id);
    let extra_perms = req
        .extra_permissions
        .map(|p| serde_json::to_value(p).unwrap_or(json!([])))
        .unwrap_or(existing.extra_permissions);
    let denied_perms = req
        .denied_permissions
        .map(|p| serde_json::to_value(p).unwrap_or(json!([])))
        .unwrap_or(existing.denied_permissions);

    let acl = sqlx::query_as::<_, ResourceAcl>(
        r#"
        UPDATE resource_acls
        SET role_id = $1, extra_permissions = $2, denied_permissions = $3, updated_at = now()
        WHERE id = $4 AND project_id = $5
        RETURNING *
        "#,
    )
    .bind(role_id)
    .bind(&extra_perms)
    .bind(&denied_perms)
    .bind(acl_id)
    .bind(project_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to update resource ACL: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({ "error": "ACL entry not found" }))))?;

    Ok(Json(acl))
}

/// Delete a resource ACL entry. Requires projects.members.manage permission.
async fn delete_acl(
    State(state): State<AppState>,
    scoped: ProjectScoped,
    Path((_project_id, acl_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    scoped.require("projects.members.manage").map_err(|_| {
        (StatusCode::FORBIDDEN, Json(json!({ "error": "Insufficient permissions: projects.members.manage required" })))
    })?;

    let project_id = scoped.project_id;

    let result = sqlx::query(
        "DELETE FROM resource_acls WHERE id = $1 AND project_id = $2",
    )
    .bind(acl_id)
    .bind(project_id)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to delete resource ACL: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?;

    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, Json(json!({ "error": "ACL entry not found" }))));
    }

    Ok(Json(json!({ "message": "ACL entry deleted successfully" })))
}
