use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use uuid::Uuid;

use crate::audit::log_action;
use crate::auth::middleware::AuthUser;
use crate::db::models::{Permission, Role, RoleWithPermissions};
use crate::AppState;

// ============================================================================
// Roles Router — /api/roles
// ============================================================================

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_roles).post(create_role))
        .route("/{id}", get(get_role).put(update_role).delete(delete_role))
}

// ============================================================================
// Permissions Router — /api/permissions
// ============================================================================

pub fn permissions_router() -> Router<AppState> {
    Router::new().route("/", get(list_permissions))
}

// ============================================================================
// Request types
// ============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRoleRequest {
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub permissions: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRoleRequest {
    pub name: Option<String>,
    pub slug: Option<String>,
    pub description: Option<String>,
    pub permissions: Option<Vec<String>>,
}

// ============================================================================
// Handlers — Roles
// ============================================================================

/// List all roles, ordered by system roles first then by name.
async fn list_roles(
    State(state): State<AppState>,
    _auth: AuthUser,
) -> Result<Json<Vec<Role>>, (StatusCode, Json<Value>)> {
    let roles = sqlx::query_as::<_, Role>(
        "SELECT * FROM roles ORDER BY is_system DESC, name",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to list roles: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?;

    Ok(Json(roles))
}

/// Get a single role by ID, including its permission keys.
async fn get_role(
    State(state): State<AppState>,
    _auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<RoleWithPermissions>, (StatusCode, Json<Value>)> {
    let role = sqlx::query_as::<_, Role>(
        "SELECT * FROM roles WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to fetch role: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({ "error": "Role not found" }))))?;

    let permissions: Vec<String> = sqlx::query_scalar(
        r#"
        SELECT p.key
        FROM role_permissions rp
        JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = $1
        ORDER BY p.category, p.key
        "#,
    )
    .bind(id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to fetch role permissions: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?;

    Ok(Json(RoleWithPermissions { role, permissions }))
}

/// Create a new custom role with the given permissions.
/// Requires company admin.
async fn create_role(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreateRoleRequest>,
) -> Result<(StatusCode, Json<RoleWithPermissions>), (StatusCode, Json<Value>)> {
    if !auth.claims.is_company_admin {
        return Err((StatusCode::FORBIDDEN, Json(json!({ "error": "Company admin required" }))));
    }

    if req.name.trim().is_empty() || req.name.trim().len() > 100 {
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "Role name must be 1-100 characters" }))));
    }
    let slug = req.slug.trim();
    if slug.is_empty() || slug.len() > 64 {
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "Role slug must be 1-64 characters" }))));
    }
    if !slug.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_') {
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "Role slug may only contain lowercase letters, digits, hyphens, and underscores" }))));
    }

    let role_id = Uuid::new_v4();
    let now = chrono::Utc::now();

    let mut tx = state.db.begin().await.map_err(|e| {
        tracing::error!("Failed to start transaction: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?;

    // Insert the role
    sqlx::query(
        r#"
        INSERT INTO roles (id, name, slug, description, is_system, created_at, updated_at)
        VALUES ($1, $2, $3, $4, false, $5, $6)
        "#,
    )
    .bind(role_id)
    .bind(req.name.trim())
    .bind(req.slug.trim())
    .bind(req.description.as_deref().map(|s| s.trim()))
    .bind(now)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        if let Some(db_err) = e.as_database_error() {
            if db_err.is_unique_violation() {
                return (StatusCode::CONFLICT, Json(json!({ "error": "A role with that slug already exists" })));
            }
        }
        tracing::error!("Failed to create role: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?;

    // Deduplicate permission keys to avoid duplicate INSERT errors
    let mut unique_permissions: Vec<String> = req.permissions.iter()
        .collect::<HashSet<_>>()
        .into_iter()
        .cloned()
        .collect();
    unique_permissions.sort();

    // Insert role_permissions by looking up permission IDs from keys
    for key in &unique_permissions {
        let perm_id: Option<Uuid> = sqlx::query_scalar(
            "SELECT id FROM permissions WHERE key = $1",
        )
        .bind(key)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Failed to look up permission '{key}': {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
        })?;

        let perm_id = perm_id.ok_or_else(|| {
            (StatusCode::BAD_REQUEST, Json(json!({ "error": format!("Unknown permission key: {key}") })))
        })?;

        sqlx::query(
            "INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)",
        )
        .bind(role_id)
        .bind(perm_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Failed to insert role permission: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
        })?;
    }

    tx.commit().await.map_err(|e| {
        tracing::error!("Failed to commit transaction: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?;

    // Invalidate the permission cache for the new role
    if let Err(e) = state.permission_cache.invalidate_role(&state.db, role_id).await {
        tracing::warn!("Failed to invalidate permission cache for role {role_id}: {e}");
    }

    let role = Role {
        id: role_id,
        company_id: None,
        name: req.name.trim().to_string(),
        slug: req.slug.trim().to_string(),
        description: req.description.map(|d| d.trim().to_string()).filter(|d| !d.is_empty()),
        is_system: false,
        created_at: now,
        updated_at: now,
    };

    log_action(&state.db, None, Some(auth.claims.sub), "role.create", "role", Some(&role.id.to_string()), Some(serde_json::json!({"name": &role.name})), None, None).await;

    Ok((StatusCode::CREATED, Json(RoleWithPermissions {
        role,
        permissions: unique_permissions,
    })))
}

/// Update an existing custom role. Cannot modify system roles.
/// Requires company admin.
async fn update_role(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateRoleRequest>,
) -> Result<Json<RoleWithPermissions>, (StatusCode, Json<Value>)> {
    if !auth.claims.is_company_admin {
        return Err((StatusCode::FORBIDDEN, Json(json!({ "error": "Company admin required" }))));
    }

    let mut tx = state.db.begin().await.map_err(|e| {
        tracing::error!("Failed to start transaction: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?;

    // Fetch existing role with row lock to prevent TOCTOU
    let existing = sqlx::query_as::<_, Role>(
        "SELECT * FROM roles WHERE id = $1 FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to fetch role: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({ "error": "Role not found" }))))?;

    if existing.is_system {
        return Err((StatusCode::FORBIDDEN, Json(json!({ "error": "Cannot modify system roles" }))));
    }

    let name = req.name.as_deref().unwrap_or(&existing.name);
    let slug = req.slug.as_deref().unwrap_or(&existing.slug);
    let description = req.description.as_deref().or(existing.description.as_deref()).map(|s| s.trim()).filter(|s| !s.is_empty());

    // Update role fields
    let now = chrono::Utc::now();
    sqlx::query(
        r#"
        UPDATE roles SET name = $1, slug = $2, description = $3, updated_at = $5
        WHERE id = $4 AND is_system = false
        "#,
    )
    .bind(name.trim())
    .bind(slug.trim())
    .bind(description)
    .bind(id)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        if let Some(db_err) = e.as_database_error() {
            if db_err.is_unique_violation() {
                return (StatusCode::CONFLICT, Json(json!({ "error": "A role with that slug already exists" })));
            }
        }
        tracing::error!("Failed to update role: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?;

    // If permissions were provided, replace them
    let final_permissions = if let Some(ref perm_keys) = req.permissions {
        // Deduplicate permission keys to avoid duplicate INSERT errors
        let mut unique_perm_keys: Vec<String> = perm_keys.iter()
            .collect::<HashSet<_>>()
            .into_iter()
            .cloned()
            .collect();
        unique_perm_keys.sort();

        // Delete existing role_permissions
        sqlx::query("DELETE FROM role_permissions WHERE role_id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                tracing::error!("Failed to delete old role permissions: {e}");
                (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
            })?;

        // Insert new permissions
        for key in &unique_perm_keys {
            let perm_id: Option<Uuid> = sqlx::query_scalar(
                "SELECT id FROM permissions WHERE key = $1",
            )
            .bind(key)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| {
                tracing::error!("Failed to look up permission '{key}': {e}");
                (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
            })?;

            let perm_id = perm_id.ok_or_else(|| {
                (StatusCode::BAD_REQUEST, Json(json!({ "error": format!("Unknown permission key: {key}") })))
            })?;

            sqlx::query(
                "INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)",
            )
            .bind(id)
            .bind(perm_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                tracing::error!("Failed to insert role permission: {e}");
                (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
            })?;
        }

        unique_perm_keys
    } else {
        // Permissions not being updated, fetch existing ones for the response
        sqlx::query_scalar(
            r#"
            SELECT p.key
            FROM role_permissions rp
            JOIN permissions p ON p.id = rp.permission_id
            WHERE rp.role_id = $1
            ORDER BY p.category, p.key
            "#,
        )
        .bind(id)
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch role permissions: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
        })?
    };

    tx.commit().await.map_err(|e| {
        tracing::error!("Failed to commit transaction: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?;

    // Invalidate the permission cache for this role
    if let Err(e) = state.permission_cache.invalidate_role(&state.db, id).await {
        tracing::warn!("Failed to invalidate permission cache for role {id}: {e}");
    }

    let role = Role {
        id,
        company_id: existing.company_id,
        name: name.trim().to_string(),
        slug: slug.trim().to_string(),
        description: description.map(|s| s.to_string()),
        is_system: false,
        created_at: existing.created_at,
        updated_at: now,
    };

    log_action(&state.db, None, Some(auth.claims.sub), "role.update", "role", Some(&role.id.to_string()), Some(serde_json::json!({"name": &role.name})), None, None).await;

    Ok(Json(RoleWithPermissions {
        role,
        permissions: final_permissions,
    }))
}

/// Delete a custom role. Cannot delete system roles or roles still in use.
/// Requires company admin.
async fn delete_role(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if !auth.claims.is_company_admin {
        return Err((StatusCode::FORBIDDEN, Json(json!({ "error": "Company admin required" }))));
    }

    // Wrap role fetch, usage check and delete in a transaction to prevent TOCTOU
    let mut tx = state.db.begin().await.map_err(|e| {
        tracing::error!("Failed to start transaction: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?;

    // Fetch and lock the role within the transaction
    let role = sqlx::query_as::<_, Role>(
        "SELECT * FROM roles WHERE id = $1 FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to fetch role: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({ "error": "Role not found" }))))?;

    if role.is_system {
        return Err((StatusCode::FORBIDDEN, Json(json!({ "error": "Cannot delete system roles" }))));
    }

    // Check if any project members still reference this role
    let usage_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM project_members WHERE role_id = $1",
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to check role usage: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?;

    if usage_count > 0 {
        return Err((StatusCode::CONFLICT, Json(json!({
            "error": format!("Cannot delete role: still assigned to {usage_count} project member(s)")
        }))));
    }

    // Delete the role (CASCADE will remove role_permissions)
    let result = sqlx::query(
        "DELETE FROM roles WHERE id = $1 AND is_system = false",
    )
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to delete role: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?;

    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, Json(json!({ "error": "Role not found or is a system role" }))));
    }

    tx.commit().await.map_err(|e| {
        tracing::error!("Failed to commit transaction: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?;

    // Invalidate the permission cache for the deleted role
    if let Err(e) = state.permission_cache.invalidate_role(&state.db, id).await {
        tracing::warn!("Failed to invalidate permission cache for deleted role {id}: {e}");
    }

    log_action(&state.db, None, Some(auth.claims.sub), "role.delete", "role", Some(&id.to_string()), Some(serde_json::json!({"name": &role.name})), None, None).await;

    Ok(Json(json!({ "message": "Role deleted successfully" })))
}

// ============================================================================
// Handlers — Permissions
// ============================================================================

/// List all available permissions, ordered by category and key.
async fn list_permissions(
    State(state): State<AppState>,
    _auth: AuthUser,
) -> Result<Json<Vec<Permission>>, (StatusCode, Json<Value>)> {
    let permissions = sqlx::query_as::<_, Permission>(
        "SELECT * FROM permissions ORDER BY category, key",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to list permissions: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?;

    Ok(Json(permissions))
}
