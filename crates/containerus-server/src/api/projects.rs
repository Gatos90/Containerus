use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::audit::log_action;
use crate::auth::middleware::{AuthUser, ProjectScoped};
use crate::db::models::{Project, ProjectMemberResponse};
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_projects).post(create_project))
        .route("/{project_id}", get(get_project).delete(delete_project))
        .route("/{project_id}/members", get(list_members))
        .route("/{project_id}/members/invite", post(invite_member))
        .route(
            "/{project_id}/members/{user_id}/role",
            put(update_member_role),
        )
        .route(
            "/{project_id}/members/{user_id}",
            delete(remove_member),
        )
        .route("/{project_id}/my-permissions", get(get_my_permissions))
}

// ============================================================================
// Request types
// ============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectRequest {
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteMemberRequest {
    pub email: String,
    pub role_id: Uuid,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRoleRequest {
    pub role_id: Uuid,
}

// ============================================================================
// Response types
// ============================================================================

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MyPermissionsResponse {
    pub permissions: Vec<String>,
    pub is_company_admin: bool,
}

// ============================================================================
// Handlers
// ============================================================================

/// List projects visible to the authenticated user.
/// Company admins see ALL projects; regular users see only projects they belong to.
async fn list_projects(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<Project>>, (StatusCode, Json<Value>)> {
    let projects = if auth.claims.is_company_admin {
        sqlx::query_as::<_, Project>(
            "SELECT * FROM projects ORDER BY name",
        )
        .fetch_all(&state.db)
        .await
    } else {
        sqlx::query_as::<_, Project>(
            "SELECT p.* FROM projects p
             JOIN project_members pm ON pm.project_id = p.id
             WHERE pm.user_id = $1
             ORDER BY p.name",
        )
        .bind(auth.claims.sub)
        .fetch_all(&state.db)
        .await
    }
    .map_err(|e| {
        tracing::error!("Database error: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Internal server error" })),
        )
    })?;

    Ok(Json(projects))
}

/// Create a new project. Requires company admin or `projects.create` permission.
/// The creator is added as a member with the Project Admin role.
async fn create_project(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreateProjectRequest>,
) -> Result<(StatusCode, Json<Project>), (StatusCode, Json<Value>)> {
    // Check if user is company admin or has projects.create in any membership
    if !auth.claims.is_company_admin {
        let has_perm = auth.claims.memberships.iter().any(|m| {
            state
                .permission_cache
                .get_permissions(&m.role_id)
                .contains("projects.create")
        });
        if !has_perm {
            return Err((
                StatusCode::FORBIDDEN,
                Json(json!({ "error": "You do not have permission to create projects" })),
            ));
        }
    }

    if req.name.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Project name is required" })),
        ));
    }

    let slug = req.slug.trim();
    if slug.is_empty()
        || slug.len() > 64
        || !slug
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        || slug.starts_with('-')
        || slug.ends_with('-')
        || slug.contains("--")
    {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Slug must be 1-64 characters, lowercase alphanumeric and hyphens only, no leading/trailing hyphens" })),
        ));
    }

    let project_id = Uuid::new_v4();
    let now = chrono::Utc::now();

    let mut tx = state.db.begin().await.map_err(|e| {
        tracing::error!("Failed to start transaction: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to start database transaction" })),
        )
    })?;

    // Get or create the company (singleton). The company row should always exist
    // (created by migration 0007 or seed_admin), but we auto-create defensively.
    let company_id: Uuid = match sqlx::query_scalar::<_, Uuid>("SELECT id FROM company LIMIT 1")
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Failed to query company: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to query company" })),
            )
        })? {
        Some(id) => id,
        None => {
            tracing::warn!("Company singleton missing — auto-creating default company");
            sqlx::query_scalar::<_, Uuid>(
                "INSERT INTO company (name, slug) VALUES ('Default Company', 'default') RETURNING id",
            )
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| {
                tracing::error!("Failed to auto-create company: {e}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to initialize company" })),
                )
            })?
        }
    };

    sqlx::query(
        "INSERT INTO projects (id, company_id, name, slug, description, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(project_id)
    .bind(company_id)
    .bind(req.name.trim())
    .bind(slug)
    .bind(req.description.as_deref().map(str::trim))
    .bind(now)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        if let Some(db_err) = e.as_database_error() {
            if db_err.is_unique_violation() {
                return (
                    StatusCode::CONFLICT,
                    Json(json!({ "error": "Project slug already taken" })),
                );
            }
        }
        tracing::error!("Failed to create project: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to create project" })),
        )
    })?;

    // Create default environment for the project
    sqlx::query(
        "INSERT INTO environments (project_id, name, slug, is_default) VALUES ($1, 'Default', 'default', true)",
    )
    .bind(project_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to create default environment: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to create default environment" })),
        )
    })?;

    // The creator always gets the built-in Project Admin role in the new project
    let creator_role_id: Uuid = "00000000-0000-0000-0000-000000000001".parse().unwrap();

    // Verify the built-in Project Admin role exists before attempting the FK insert
    let role_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM roles WHERE id = $1)",
    )
    .bind(creator_role_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to verify role existence: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to verify project role" })),
        )
    })?;

    if !role_exists {
        tracing::error!(
            "Built-in Project Admin role ({creator_role_id}) missing from roles table"
        );
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Server configuration error: required role is missing. Please re-run database migrations." })),
        ));
    }

    sqlx::query("INSERT INTO project_members (project_id, user_id, role_id) VALUES ($1, $2, $3)")
        .bind(project_id)
        .bind(auth.claims.sub)
        .bind(creator_role_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Failed to add project member: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to add project membership" })),
            )
        })?;

    tx.commit().await.map_err(|e| {
        tracing::error!("Failed to commit transaction: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to commit project creation" })),
        )
    })?;

    let project = Project {
        id: project_id,
        company_id,
        name: req.name.trim().to_string(),
        slug: slug.to_string(),
        description: req.description.map(|d| d.trim().to_string()),
        created_at: now,
        updated_at: now,
    };

    log_action(&state.db, Some(project.id), Some(auth.claims.sub), "project.create", "project", Some(&project.id.to_string()), Some(serde_json::json!({"name": &project.name})), auth.client_ip.as_deref(), None).await;

    Ok((StatusCode::CREATED, Json(project)))
}

/// Get a single project by ID. Requires `projects.view` permission.
async fn get_project(
    State(state): State<AppState>,
    scoped: ProjectScoped,
) -> Result<Json<Project>, (StatusCode, Json<Value>)> {
    scoped.require("projects.view").map_err(|_| {
        (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "You do not have permission to view this project" })),
        )
    })?;

    let project = sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE id = $1")
        .bind(scoped.project_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Database error: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Internal server error" })),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Project not found" })),
            )
        })?;

    Ok(Json(project))
}

/// Delete a project. Requires `projects.edit` permission (or company admin).
/// Only allowed when the project has no environments.
async fn delete_project(
    State(state): State<AppState>,
    scoped: ProjectScoped,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    scoped.require("projects.edit").map_err(|_| {
        (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "You do not have permission to delete this project" })),
        )
    })?;

    let project_id = scoped.project_id;

    // Delete project members, ACLs, audit log references, then the project itself
    let mut tx = state.db.begin().await.map_err(|e| {
        tracing::error!("Failed to start transaction: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to start database transaction" })),
        )
    })?;

    // Check for remaining environments inside the transaction
    let env_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM environments WHERE project_id = $1",
    )
    .bind(project_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to count environments: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to check project environments" })),
        )
    })?;

    if env_count > 0 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "Cannot delete project that still has environments. Remove all environments first.",
                "environments": env_count
            })),
        ));
    }

    // Clean up project_members
    sqlx::query("DELETE FROM project_members WHERE project_id = $1")
        .bind(project_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Failed to delete project members: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to delete project" })),
            )
        })?;

    // Clean up resource_acls
    sqlx::query("DELETE FROM resource_acls WHERE project_id = $1")
        .bind(project_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Failed to delete resource ACLs: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to delete project" })),
            )
        })?;

    // Nullify audit_log references (keep logs but detach from project)
    sqlx::query("UPDATE audit_log SET project_id = NULL WHERE project_id = $1")
        .bind(project_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Failed to update audit logs: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to delete project" })),
            )
        })?;

    // Delete the project
    let result = sqlx::query("DELETE FROM projects WHERE id = $1")
        .bind(project_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Failed to delete project: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to delete project" })),
            )
        })?;

    if result.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Project not found" })),
        ));
    }

    tx.commit().await.map_err(|e| {
        tracing::error!("Failed to commit transaction: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to commit project deletion" })),
        )
    })?;

    log_action(&state.db, Some(project_id), Some(scoped.claims.sub), "project.delete", "project", Some(&project_id.to_string()), None, scoped.client_ip.as_deref(), None).await;

    Ok(Json(json!({ "message": "Project deleted" })))
}

/// List members of a project. Requires `projects.members.view` permission.
async fn list_members(
    State(state): State<AppState>,
    scoped: ProjectScoped,
) -> Result<Json<Vec<ProjectMemberResponse>>, (StatusCode, Json<Value>)> {
    scoped.require("projects.members.view").map_err(|_| {
        (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "You do not have permission to view project members" })),
        )
    })?;

    let project_id = scoped.project_id;

    let members = sqlx::query_as::<_, ProjectMemberResponse>(
        "SELECT pm.user_id, u.email, u.display_name, u.avatar_url,
                pm.role_id, r.name as role_name, r.slug as role_slug, pm.joined_at
         FROM project_members pm
         JOIN users u ON u.id = pm.user_id
         JOIN roles r ON r.id = pm.role_id
         WHERE pm.project_id = $1
         ORDER BY pm.joined_at",
    )
    .bind(project_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Database error: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Internal server error" })),
        )
    })?;

    Ok(Json(members))
}

/// Invite a user to a project by email. Requires `projects.members.manage` permission.
async fn invite_member(
    State(state): State<AppState>,
    scoped: ProjectScoped,
    Json(req): Json<InviteMemberRequest>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    scoped.require("projects.members.manage").map_err(|_| {
        (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "You do not have permission to manage project members" })),
        )
    })?;

    let project_id = scoped.project_id;

    // Wrap role check, user lookup, and INSERT in a single transaction to ensure
    // atomicity: the role and user must still exist at INSERT time.
    let mut tx = state.db.begin().await.map_err(|e| {
        tracing::error!("Failed to start transaction: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Internal server error" })),
        )
    })?;

    // Verify the role_id exists in the roles table
    let role_exists = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM roles WHERE id = $1")
        .bind(req.role_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Database error: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Internal server error" })),
            )
        })?;

    if role_exists == 0 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Invalid role ID" })),
        ));
    }

    // Find user by email
    let target_user_id = sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE email = $1")
        .bind(&req.email)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Database error: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Internal server error" })),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Unable to add member. Please verify the email address." })),
            )
        })?;

    // Insert the member and handle unique constraint violation atomically
    sqlx::query(
        "INSERT INTO project_members (project_id, user_id, role_id) VALUES ($1, $2, $3)",
    )
    .bind(project_id)
    .bind(target_user_id)
    .bind(req.role_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        if let Some(db_err) = e.as_database_error() {
            if db_err.is_unique_violation() {
                return (
                    StatusCode::CONFLICT,
                    Json(json!({ "error": "User is already a member of this project" })),
                );
            }
        }
        tracing::error!("Database error: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Internal server error" })),
        )
    })?;

    tx.commit().await.map_err(|e| {
        tracing::error!("Failed to commit transaction: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Internal server error" })),
        )
    })?;

    log_action(&state.db, Some(project_id), Some(scoped.claims.sub), "member.invite", "member", Some(&target_user_id.to_string()), Some(serde_json::json!({"role_id": req.role_id.to_string()})), scoped.client_ip.as_deref(), None).await;

    Ok((
        StatusCode::CREATED,
        Json(json!({ "message": "Member added successfully" })),
    ))
}

/// Update a member's role in a project. Requires `projects.members.manage` permission.
async fn update_member_role(
    State(state): State<AppState>,
    scoped: ProjectScoped,
    Path((_project_id, target_user_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<UpdateRoleRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    scoped.require("projects.members.manage").map_err(|_| {
        (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "You do not have permission to manage project members" })),
        )
    })?;

    let project_id = scoped.project_id;

    // Cannot change your own role
    if target_user_id == scoped.claims.sub {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Cannot change your own role" })),
        ));
    }

    // Wrap role check and update in a transaction for atomicity
    let mut tx = state.db.begin().await.map_err(|e| {
        tracing::error!("Failed to start transaction: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Internal server error" })),
        )
    })?;

    // Verify the new role_id exists
    let role_exists = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM roles WHERE id = $1")
        .bind(req.role_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Database error: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Internal server error" })),
            )
        })?;

    if role_exists == 0 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Invalid role ID" })),
        ));
    }

    // Update the member's role
    let result = sqlx::query(
        "UPDATE project_members SET role_id = $1 WHERE project_id = $2 AND user_id = $3",
    )
    .bind(req.role_id)
    .bind(project_id)
    .bind(target_user_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Database error: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Internal server error" })),
        )
    })?;

    if result.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Member not found in this project" })),
        ));
    }

    tx.commit().await.map_err(|e| {
        tracing::error!("Failed to commit transaction: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Internal server error" })),
        )
    })?;

    log_action(&state.db, Some(project_id), Some(scoped.claims.sub), "member.role_update", "member", Some(&target_user_id.to_string()), Some(serde_json::json!({"role_id": req.role_id.to_string()})), scoped.client_ip.as_deref(), None).await;

    Ok(Json(json!({ "message": "Role updated successfully" })))
}

/// Remove a member from a project. Requires `projects.members.manage` permission.
async fn remove_member(
    State(state): State<AppState>,
    scoped: ProjectScoped,
    Path((_project_id, target_user_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    scoped.require("projects.members.manage").map_err(|_| {
        (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "You do not have permission to manage project members" })),
        )
    })?;

    let project_id = scoped.project_id;

    // Cannot remove yourself
    if target_user_id == scoped.claims.sub {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Cannot remove yourself from a project" })),
        ));
    }

    // Prevent removing the last project admin
    let target_role_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT role_id FROM project_members WHERE project_id = $1 AND user_id = $2",
    )
    .bind(project_id)
    .bind(target_user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Database error: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?;

    if let Some(role_id) = target_role_id {
        let is_admin_role: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM roles WHERE id = $1 AND slug = 'project-admin')",
        )
        .bind(role_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(false);

        if is_admin_role {
            let admin_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM project_members pm JOIN roles r ON pm.role_id = r.id WHERE pm.project_id = $1 AND r.slug = 'project-admin'",
            )
            .bind(project_id)
            .fetch_one(&state.db)
            .await
            .unwrap_or(0);

            if admin_count <= 1 {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "Cannot remove the last project admin" })),
                ));
            }
        }
    }

    let result = sqlx::query(
        "DELETE FROM project_members WHERE project_id = $1 AND user_id = $2",
    )
    .bind(project_id)
    .bind(target_user_id)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Database error: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Internal server error" })),
        )
    })?;

    if result.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Member not found in this project" })),
        ));
    }

    log_action(&state.db, Some(project_id), Some(scoped.claims.sub), "member.remove", "member", Some(&target_user_id.to_string()), None, scoped.client_ip.as_deref(), None).await;

    Ok(Json(json!({ "message": "Member removed successfully" })))
}

/// Get the authenticated user's effective permissions for a specific project.
async fn get_my_permissions(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(project_id): Path<Uuid>,
) -> Result<Json<MyPermissionsResponse>, (StatusCode, Json<Value>)> {
    // Verify project exists
    let project_exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1)",
    )
    .bind(project_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Database error: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Internal server error" })),
        )
    })?;

    if !project_exists {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Project not found" })),
        ));
    }

    // Check if the user is a company admin
    let is_company_admin = auth.claims.is_company_admin;

    // Look up the user's role_id in this project
    let role_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT role_id FROM project_members WHERE project_id = $1 AND user_id = $2",
    )
    .bind(project_id)
    .bind(auth.claims.sub)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Database error: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Internal server error" })),
        )
    })?;

    let permissions = if let Some(role_id) = role_id {
        let perm_set = state.permission_cache.get_permissions(&role_id);
        let mut perms: Vec<String> = perm_set.into_iter().collect();
        perms.sort();
        perms
    } else if is_company_admin {
        // Company admins have implicit access to everything but may not be
        // an explicit member. Return an empty set; the frontend should check
        // is_company_admin for full-access semantics.
        Vec::new()
    } else {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "Not a member of this project" })),
        ));
    };

    Ok(Json(MyPermissionsResponse {
        permissions,
        is_company_admin,
    }))
}

