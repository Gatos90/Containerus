use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, post, put},
    Json, Router,
};
use containerus_rbac_macros::require_permissions;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;
use validator::ValidateEmail;

use crate::audit::log_action;
use crate::auth::middleware::{AuthUser, ProjectScoped};
use crate::db::models::{PendingInviteResponse, Project, ProjectMemberResponse};
use crate::ws::events::{InvalidationScope, PermissionEvent};
use crate::AppState;

/// Max invites accepted in a single `invite-bulk` payload (CON-120).
const BULK_INVITE_MAX: usize = 100;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_projects).post(create_project))
        .route("/{project_id}", get(get_project).delete(delete_project))
        .route("/{project_id}/members", get(list_members))
        .route("/{project_id}/members/invite", post(invite_member))
        .route("/{project_id}/members/invite-bulk", post(invite_members_bulk))
        .route(
            "/{project_id}/members/{user_id}/role",
            put(update_member_role),
        )
        .route(
            "/{project_id}/members/{user_id}",
            delete(remove_member),
        )
        .route("/{project_id}/invites", get(list_invites))
        .route(
            "/{project_id}/invites/{invite_id}/resend",
            post(resend_invite),
        )
        .route(
            "/{project_id}/invites/{invite_id}",
            delete(revoke_invite),
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
pub struct BulkInviteEntry {
    pub email: String,
    pub role_id: Uuid,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkInviteRequest {
    pub invites: Vec<BulkInviteEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkInviteInvited {
    pub email: String,
    pub user_id: Uuid,
    pub role_id: Uuid,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkInviteSkipped {
    pub email: String,
    pub reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkInviteErrored {
    pub email: String,
    pub reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkInviteResponse {
    pub invited: Vec<BulkInviteInvited>,
    pub skipped: Vec<BulkInviteSkipped>,
    pub errored: Vec<BulkInviteErrored>,
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
#[require_permissions("projects.view")]
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
#[require_permissions("company.admin")]
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
#[require_permissions("projects.view")]
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
#[require_permissions("projects.edit")]
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
#[require_permissions("projects.members.view")]
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
                pm.role_id, r.name as role_name, r.slug as role_slug, pm.joined_at,
                u.is_active
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
#[require_permissions("projects.members.manage")]
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

    // Shared invite throttle with `/members/invite-bulk` (CON-120). One tick
    // per invited email so callers cannot bypass the bulk ceiling by firing
    // single-invites in a loop.
    if !state
        .project_invite_limiter
        .check(&invite_bucket_key(project_id, scoped.claims.sub))
    {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({ "error": "Invite rate limit exceeded — please wait before inviting more members" })),
        ));
    }

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

    // Find user by email. CON-129: if no matching user exists we fall through
    // to `project_invites` so the People screen can show a pending row that
    // admins can resend or revoke, instead of the pre-CON-129 400 which left
    // the invite nowhere.
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
        })?;

    if let Some(target_user_id) = target_user_id {
        // Existing user — immediate membership (unchanged pre-CON-129 path).
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

        state.permission_events.publish(
            target_user_id,
            PermissionEvent::invalidated(InvalidationScope::Member, Some(project_id)),
        );

        return Ok((
            StatusCode::CREATED,
            Json(json!({ "message": "Member added successfully" })),
        ));
    }

    // Unknown email — record a pending invite. Collides on (project_id,
    // lower(email)) so the same address can't be pending twice on the same
    // project.
    let invite_id: Uuid = match sqlx::query_scalar(
        "INSERT INTO project_invites (project_id, email, role_id, invited_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id",
    )
    .bind(project_id)
    .bind(&req.email)
    .bind(req.role_id)
    .bind(scoped.claims.sub)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(id) => id,
        Err(e) => {
            if let Some(db_err) = e.as_database_error() {
                if db_err.is_unique_violation() {
                    return Err((
                        StatusCode::CONFLICT,
                        Json(json!({ "error": "An invite for this email is already pending on this project" })),
                    ));
                }
            }
            tracing::error!("Database error: {e}");
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Internal server error" })),
            ));
        }
    };

    tx.commit().await.map_err(|e| {
        tracing::error!("Failed to commit transaction: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Internal server error" })),
        )
    })?;

    log_action(
        &state.db,
        Some(project_id),
        Some(scoped.claims.sub),
        "invite.create",
        "invite",
        Some(&invite_id.to_string()),
        Some(json!({ "role_id": req.role_id.to_string(), "email": req.email })),
        scoped.client_ip.as_deref(),
        None,
    )
    .await;

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "message": "Invite created — user will be added when they sign up",
            "inviteId": invite_id,
        })),
    ))
}

fn invite_bucket_key(project_id: Uuid, user_id: Uuid) -> String {
    format!("{project_id}:{user_id}")
}

/// Bulk-invite users to a project by email (CON-120).
///
/// Partial-success semantics: each entry is validated, looked up, and inserted
/// in its own transaction so one bad row does not abort the batch. The
/// response splits results into `invited`, `skipped` (duplicate payload /
/// already a member), and `errored` (invalid email, unknown user, unknown
/// role, transient DB error). Returns `200 OK` when every entry succeeded,
/// `207 Multi-Status` when any entry was skipped or errored.
#[require_permissions("projects.members.manage")]
async fn invite_members_bulk(
    State(state): State<AppState>,
    scoped: ProjectScoped,
    Json(req): Json<BulkInviteRequest>,
) -> Result<(StatusCode, Json<BulkInviteResponse>), (StatusCode, Json<Value>)> {
    scoped.require("projects.members.manage").map_err(|_| {
        (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "You do not have permission to manage project members" })),
        )
    })?;

    if req.invites.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "invites must contain at least one entry" })),
        ));
    }
    if req.invites.len() > BULK_INVITE_MAX {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": format!("invites may contain at most {BULK_INVITE_MAX} entries per request"),
                "max": BULK_INVITE_MAX,
            })),
        ));
    }

    let project_id = scoped.project_id;
    let inviter_id = scoped.claims.sub;
    let bucket_key = invite_bucket_key(project_id, inviter_id);

    // Pre-flight rate-limit check: refuse the whole batch if the bucket has
    // no room for even one invite. Matching the shared single-invite bucket
    // keeps bulk from sidestepping the per-hour ceiling. Each accepted entry
    // below ticks the bucket again so a 100-row batch actually consumes 100
    // tokens, not one.
    if !state.project_invite_limiter.check(&bucket_key) {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({ "error": "Invite rate limit exceeded — please wait before inviting more members" })),
        ));
    }

    let mut invited: Vec<BulkInviteInvited> = Vec::new();
    let mut skipped: Vec<BulkInviteSkipped> = Vec::new();
    let mut errored: Vec<BulkInviteErrored> = Vec::new();
    let mut seen_emails: std::collections::HashSet<String> = std::collections::HashSet::new();

    for (idx, entry) in req.invites.iter().enumerate() {
        let raw_email = entry.email.trim();
        let normalised = raw_email.to_lowercase();
        let display_email = raw_email.to_string();

        // Spend one rate-limit token per entry after the first (the pre-flight
        // check above already consumed one). Once the bucket is empty the
        // remaining entries fall through to `errored` rather than partially
        // inserting without audit/throttle coverage.
        if idx > 0 && !state.project_invite_limiter.check(&bucket_key) {
            errored.push(BulkInviteErrored {
                email: display_email,
                reason: "rate_limited".to_string(),
            });
            continue;
        }

        if normalised.is_empty() || !normalised.validate_email() {
            errored.push(BulkInviteErrored {
                email: display_email,
                reason: "invalid_email".to_string(),
            });
            continue;
        }

        if !seen_emails.insert(normalised.clone()) {
            skipped.push(BulkInviteSkipped {
                email: display_email,
                reason: "duplicate_in_payload".to_string(),
            });
            continue;
        }

        match insert_bulk_invite(
            &state,
            project_id,
            inviter_id,
            scoped.client_ip.as_deref(),
            &normalised,
            entry.role_id,
        )
        .await
        {
            BulkInviteOutcome::Invited { user_id } => {
                invited.push(BulkInviteInvited {
                    email: display_email,
                    user_id,
                    role_id: entry.role_id,
                });
            }
            BulkInviteOutcome::Skipped(reason) => {
                skipped.push(BulkInviteSkipped {
                    email: display_email,
                    reason,
                });
            }
            BulkInviteOutcome::Errored(reason) => {
                errored.push(BulkInviteErrored {
                    email: display_email,
                    reason,
                });
            }
        }
    }

    // Bulk-level audit row mirrors the per-invite audit rows emitted inside
    // `insert_bulk_invite`. `count` is the accepted-for-insert count so the
    // audit trail shows how many rows actually landed, not just how many the
    // caller attempted.
    log_action(
        &state.db,
        Some(project_id),
        Some(inviter_id),
        "project.invite.bulk",
        "project",
        Some(&project_id.to_string()),
        Some(json!({
            "count": invited.len(),
            "requested": req.invites.len(),
            "skipped": skipped.len(),
            "errored": errored.len(),
        })),
        scoped.client_ip.as_deref(),
        None,
    )
    .await;

    let status = if skipped.is_empty() && errored.is_empty() {
        StatusCode::OK
    } else {
        StatusCode::MULTI_STATUS
    };

    Ok((
        status,
        Json(BulkInviteResponse {
            invited,
            skipped,
            errored,
        }),
    ))
}

enum BulkInviteOutcome {
    Invited { user_id: Uuid },
    Skipped(String),
    Errored(String),
}

async fn insert_bulk_invite(
    state: &AppState,
    project_id: Uuid,
    inviter_id: Uuid,
    client_ip: Option<&str>,
    email: &str,
    role_id: Uuid,
) -> BulkInviteOutcome {
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!("bulk invite: failed to begin tx: {e}");
            return BulkInviteOutcome::Errored("internal_error".to_string());
        }
    };

    let role_exists: i64 =
        match sqlx::query_scalar("SELECT COUNT(*) FROM roles WHERE id = $1")
            .bind(role_id)
            .fetch_one(&mut *tx)
            .await
        {
            Ok(count) => count,
            Err(e) => {
                tracing::error!("bulk invite: role lookup failed: {e}");
                return BulkInviteOutcome::Errored("internal_error".to_string());
            }
        };
    if role_exists == 0 {
        return BulkInviteOutcome::Errored("invalid_role".to_string());
    }

    let target_user_id: Option<Uuid> =
        match sqlx::query_scalar("SELECT id FROM users WHERE email = $1")
            .bind(email)
            .fetch_optional(&mut *tx)
            .await
        {
            Ok(row) => row,
            Err(e) => {
                tracing::error!("bulk invite: user lookup failed: {e}");
                return BulkInviteOutcome::Errored("internal_error".to_string());
            }
        };
    let Some(target_user_id) = target_user_id else {
        return BulkInviteOutcome::Errored("unknown_user".to_string());
    };

    let insert = sqlx::query(
        "INSERT INTO project_members (project_id, user_id, role_id) VALUES ($1, $2, $3)",
    )
    .bind(project_id)
    .bind(target_user_id)
    .bind(role_id)
    .execute(&mut *tx)
    .await;

    if let Err(e) = insert {
        if let Some(db_err) = e.as_database_error() {
            if db_err.is_unique_violation() {
                // Already a member — not an error, just a skip.
                return BulkInviteOutcome::Skipped("already_member".to_string());
            }
        }
        tracing::error!("bulk invite: insert failed for {email}: {e}");
        return BulkInviteOutcome::Errored("internal_error".to_string());
    }

    if let Err(e) = tx.commit().await {
        tracing::error!("bulk invite: commit failed: {e}");
        return BulkInviteOutcome::Errored("internal_error".to_string());
    }

    // Per-invite audit row (CON-120: "match single-invite auditing"). Kept
    // outside the transaction so an audit-log outage never rolls back the
    // membership insert the caller already depends on.
    log_action(
        &state.db,
        Some(project_id),
        Some(inviter_id),
        "member.invite",
        "member",
        Some(&target_user_id.to_string()),
        Some(json!({
            "role_id": role_id.to_string(),
            "source": "bulk",
        })),
        client_ip,
        None,
    )
    .await;

    state.permission_events.publish(
        target_user_id,
        PermissionEvent::invalidated(InvalidationScope::Member, Some(project_id)),
    );

    BulkInviteOutcome::Invited {
        user_id: target_user_id,
    }
}

/// Update a member's role in a project. Requires `projects.members.manage` permission.
#[require_permissions("projects.members.manage")]
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

    // CON-122: the affected user's effective permissions just changed.
    state.permission_events.publish(
        target_user_id,
        PermissionEvent::invalidated(InvalidationScope::Member, Some(project_id)),
    );

    Ok(Json(json!({ "message": "Role updated successfully" })))
}

/// Remove a member from a project. Requires `projects.members.manage` permission.
#[require_permissions("projects.members.manage")]
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

    // CON-122: the removed user's permissions just collapsed for this
    // project. Fire an invalidation so any live session re-renders and
    // drops access-gated UI.
    state.permission_events.publish(
        target_user_id,
        PermissionEvent::invalidated(InvalidationScope::Member, Some(project_id)),
    );

    Ok(Json(json!({ "message": "Member removed successfully" })))
}

/// CON-129 — list pending invites for a project. Gated on
/// `projects.members.view` (the same permission that lets you see the
/// members list).
#[require_permissions("projects.members.view")]
async fn list_invites(
    State(state): State<AppState>,
    scoped: ProjectScoped,
) -> Result<Json<Vec<PendingInviteResponse>>, (StatusCode, Json<Value>)> {
    scoped.require("projects.members.view").map_err(|_| {
        (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "You do not have permission to view project members" })),
        )
    })?;

    let project_id = scoped.project_id;

    let invites = sqlx::query_as::<_, PendingInviteResponse>(
        "SELECT pi.id, pi.email, pi.role_id, r.name AS role_name,
                pi.invited_at, pi.invited_by, pi.expires_at
         FROM project_invites pi
         JOIN roles r ON r.id = pi.role_id
         WHERE pi.project_id = $1
         ORDER BY pi.invited_at DESC",
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

    Ok(Json(invites))
}

/// CON-129 — resend a pending invite. Bumps `invited_at` + `updated_at` so
/// the People screen reflects the action; the audit row is the canonical
/// record of the resend. Real notification delivery is a follow-up
/// (no mailer infra in the server today).
#[require_permissions("projects.members.manage")]
async fn resend_invite(
    State(state): State<AppState>,
    scoped: ProjectScoped,
    Path((_project_id, invite_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, (StatusCode, Json<Value>)> {
    scoped.require("projects.members.manage").map_err(|_| {
        (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "You do not have permission to manage project members" })),
        )
    })?;

    let project_id = scoped.project_id;

    // Scope the update to (project_id, invite_id) so an invite on a different
    // project can't be touched by a manage-perm holder on this one.
    let result = sqlx::query(
        "UPDATE project_invites
            SET invited_at = now(), updated_at = now(), invited_by = $3
          WHERE id = $1 AND project_id = $2",
    )
    .bind(invite_id)
    .bind(project_id)
    .bind(scoped.claims.sub)
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
            Json(json!({ "error": "Invite not found in this project" })),
        ));
    }

    log_action(
        &state.db,
        Some(project_id),
        Some(scoped.claims.sub),
        "invite.resend",
        "invite",
        Some(&invite_id.to_string()),
        None,
        scoped.client_ip.as_deref(),
        None,
    )
    .await;

    Ok(StatusCode::NO_CONTENT)
}

/// CON-129 — revoke a pending invite so its token can no longer be redeemed.
#[require_permissions("projects.members.manage")]
async fn revoke_invite(
    State(state): State<AppState>,
    scoped: ProjectScoped,
    Path((_project_id, invite_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, (StatusCode, Json<Value>)> {
    scoped.require("projects.members.manage").map_err(|_| {
        (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "You do not have permission to manage project members" })),
        )
    })?;

    let project_id = scoped.project_id;

    let result = sqlx::query(
        "DELETE FROM project_invites WHERE id = $1 AND project_id = $2",
    )
    .bind(invite_id)
    .bind(project_id)
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
            Json(json!({ "error": "Invite not found in this project" })),
        ));
    }

    log_action(
        &state.db,
        Some(project_id),
        Some(scoped.claims.sub),
        "invite.revoke",
        "invite",
        Some(&invite_id.to_string()),
        None,
        scoped.client_ip.as_deref(),
        None,
    )
    .await;

    Ok(StatusCode::NO_CONTENT)
}

/// Get the authenticated user's effective permissions for a specific project.
#[require_permissions("projects.view")]
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

