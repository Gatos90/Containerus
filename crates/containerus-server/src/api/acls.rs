use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, post, put},
    Json, Router,
};
use containerus_rbac_macros::require_permissions;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::middleware::ProjectScoped;
use crate::db::models::ResourceAcl;
use crate::ws::events::{InvalidationScope, PermissionEvent};
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
    /// Only valid when `resource_type == "container"`. Identifies the parent
    /// system so the DB can cascade the ACL row when the system is deleted
    /// (CON-117). MUST be null for non-container types; MUST be set for
    /// container rows — enforced by the DB CHECK constraint.
    pub system_id: Option<Uuid>,
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
// Permission-key normalization (CON-78)
// ============================================================================

/// Normalize a single permission key: trim surrounding whitespace and
/// lowercase. All catalog keys are lowercase dotted (e.g. `systems.delete`),
/// so stray casing or padding in request bodies would silently fail to match
/// the resolver's `HashSet` lookups. Normalising at the write boundary keeps
/// ACL deny/allow keys unambiguously comparable to role-permission keys.
fn normalize_key(raw: &str) -> String {
    raw.trim().to_ascii_lowercase()
}

/// Normalise and deduplicate a list of raw permission keys while preserving
/// first-seen order. Empty keys (after trimming) are dropped from the list so
/// we don't ship `""` into the catalog lookup; the caller still sees them as
/// unknown if they were the only content.
fn normalize_keys(raw: &[String]) -> Vec<String> {
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut out = Vec::with_capacity(raw.len());
    for key in raw {
        let norm = normalize_key(key);
        if norm.is_empty() {
            continue;
        }
        if seen.insert(norm.clone()) {
            out.push(norm);
        }
    }
    out
}

/// Validate that every normalised key exists in the permissions catalog.
/// Returns the normalised, de-duplicated list on success, or a `400` payload
/// listing the unknown keys on failure so callers can fix their request.
async fn normalize_and_validate(
    db: &PgPool,
    raw: &[String],
    field: &str,
) -> Result<Vec<String>, (StatusCode, Json<Value>)> {
    let normalized = normalize_keys(raw);
    if normalized.is_empty() {
        return Ok(normalized);
    }

    let known: Vec<String> = sqlx::query_scalar(
        "SELECT key FROM permissions WHERE key = ANY($1)",
    )
    .bind(&normalized)
    .fetch_all(db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to validate permission keys against catalog: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Internal server error" })),
        )
    })?;

    let known_set: std::collections::HashSet<String> = known.into_iter().collect();
    let unknown: Vec<&String> = normalized
        .iter()
        .filter(|k| !known_set.contains(*k))
        .collect();

    if !unknown.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "Unknown permission keys",
                "field": field,
                "unknownKeys": unknown,
            })),
        ));
    }

    Ok(normalized)
}

// ============================================================================
// Handlers
// ============================================================================

/// List all resource ACLs for a project. Requires projects.members.manage permission.
#[require_permissions("projects.members.manage")]
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
#[require_permissions("projects.members.manage")]
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

    // CON-117: the `system_id` field is only meaningful for container-scoped
    // ACLs — it carries the parent system so the FK `ON DELETE CASCADE` can
    // clean the row up when the system is torn down. Enforce the invariant
    // at the API layer too so we return a crisp 400 instead of the raw
    // Postgres CHECK-constraint error.
    let resource_type_norm = req.resource_type.trim();
    match (resource_type_norm, req.system_id) {
        ("container", None) => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": "container-scoped ACLs require systemId",
                    "field": "systemId",
                })),
            ));
        }
        (t, Some(_)) if t != "container" => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": "systemId is only allowed for container-scoped ACLs",
                    "field": "systemId",
                })),
            ));
        }
        _ => {}
    }

    // CON-79: `resource_acls.role_id` is reserved — the column persists but the
    // resolver never reads it. Accepting a non-null value here would silently
    // create a per-resource role overlay that never runs, which is a deny/allow
    // bypass waiting to happen once CONTAINERUS_ENFORCE_ACLS=1 ships. Reject
    // the write until a future change wires it into the resolver.
    if req.role_id.is_some() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "roleId on resource_acls is not supported",
                "field": "roleId",
                "detail": "Per-resource role overlays are not implemented by the resolver; omit roleId or send null. See CON-79.",
            })),
        ));
    }

    // CON-78: normalise + validate permission keys before they land in JSONB.
    // Exact match against the catalog keeps the resolver's HashSet lookup
    // from silently missing a deny because of stray casing/whitespace.
    let extra = normalize_and_validate(&state.db, &req.extra_permissions, "extraPermissions").await?;
    let denied = normalize_and_validate(&state.db, &req.denied_permissions, "deniedPermissions").await?;

    let acl_id = Uuid::new_v4();
    let extra_perms = serde_json::to_value(&extra).unwrap_or(json!([]));
    let denied_perms = serde_json::to_value(&denied).unwrap_or(json!([]));
    let now = chrono::Utc::now();

    let acl = sqlx::query_as::<_, ResourceAcl>(
        r#"
        INSERT INTO resource_acls (id, user_id, project_id, resource_type, resource_id, system_id, role_id, extra_permissions, denied_permissions, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
        "#,
    )
    .bind(acl_id)
    .bind(req.user_id)
    .bind(project_id)
    .bind(resource_type_norm)
    .bind(req.resource_id)
    .bind(req.system_id)
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

    // CON-122: the target user's resolved permissions for this project
    // just changed. Publish so any live session refetches before the
    // user hits a 403.
    state.permission_events.publish(
        acl.user_id,
        PermissionEvent::invalidated(InvalidationScope::Acl, Some(project_id)),
    );

    Ok((StatusCode::CREATED, Json(acl)))
}

/// Update a resource ACL entry. Requires projects.members.manage permission.
#[require_permissions("projects.members.manage")]
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

    // CON-79: same fail-closed stance on updates. A `Some(_)` here would either
    // set a silently-ignored role overlay (new row value) or preserve an old
    // one that we can no longer reason about. Forcing callers to omit the
    // field keeps the contract aligned with the resolver's actual behaviour.
    if req.role_id.is_some() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "roleId on resource_acls is not supported",
                "field": "roleId",
                "detail": "Per-resource role overlays are not implemented by the resolver; omit roleId or send null. See CON-79.",
            })),
        ));
    }

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

    // CON-79: role_id writes are rejected above, so only the existing value is
    // ever carried forward. Any non-null legacy row persists untouched until a
    // future change decides whether to drop or wire in the column.
    let role_id = existing.role_id;

    // CON-78: normalise + validate any permission keys being written so the
    // resolver's exact-match HashSet lookup stays authoritative.
    let extra_perms = match req.extra_permissions {
        Some(p) => {
            let normalized = normalize_and_validate(&state.db, &p, "extraPermissions").await?;
            serde_json::to_value(&normalized).unwrap_or(json!([]))
        }
        None => existing.extra_permissions,
    };
    let denied_perms = match req.denied_permissions {
        Some(p) => {
            let normalized = normalize_and_validate(&state.db, &p, "deniedPermissions").await?;
            serde_json::to_value(&normalized).unwrap_or(json!([]))
        }
        None => existing.denied_permissions,
    };

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

    // CON-122: same fanout as create — the ACL row drives resolver
    // overrides for this user, so any change invalidates their cache.
    state.permission_events.publish(
        acl.user_id,
        PermissionEvent::invalidated(InvalidationScope::Acl, Some(project_id)),
    );

    Ok(Json(acl))
}

/// Delete a resource ACL entry. Requires projects.members.manage permission.
#[require_permissions("projects.members.manage")]
async fn delete_acl(
    State(state): State<AppState>,
    scoped: ProjectScoped,
    Path((_project_id, acl_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    scoped.require("projects.members.manage").map_err(|_| {
        (StatusCode::FORBIDDEN, Json(json!({ "error": "Insufficient permissions: projects.members.manage required" })))
    })?;

    let project_id = scoped.project_id;

    // CON-122: capture the affected user_id before the row is gone so
    // we can publish the invalidation after the delete succeeds.
    let deleted_user_id: Option<Uuid> = sqlx::query_scalar(
        r#"
        DELETE FROM resource_acls
        WHERE id = $1 AND project_id = $2
        RETURNING user_id
        "#,
    )
    .bind(acl_id)
    .bind(project_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to delete resource ACL: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?;

    let user_id = deleted_user_id.ok_or_else(|| {
        (StatusCode::NOT_FOUND, Json(json!({ "error": "ACL entry not found" })))
    })?;

    state.permission_events.publish(
        user_id,
        PermissionEvent::invalidated(InvalidationScope::Acl, Some(project_id)),
    );

    Ok(Json(json!({ "message": "ACL entry deleted successfully" })))
}

#[cfg(test)]
mod tests {
    use super::{normalize_key, normalize_keys};

    #[test]
    fn normalize_key_trims_and_lowercases() {
        assert_eq!(normalize_key(" Systems.Delete "), "systems.delete");
        assert_eq!(normalize_key("systems.delete"), "systems.delete");
        assert_eq!(normalize_key("\tCONTAINERS.EXEC\n"), "containers.exec");
    }

    #[test]
    fn normalize_keys_dedups_preserving_order() {
        let input = vec![
            "Systems.Delete".into(),
            "systems.delete".into(),
            " containers.exec".into(),
            "Containers.Exec".into(),
        ];
        assert_eq!(
            normalize_keys(&input),
            vec!["systems.delete".to_string(), "containers.exec".to_string()]
        );
    }

    #[test]
    fn normalize_keys_drops_empty_after_trim() {
        let input = vec!["   ".into(), "\t\n".into(), "systems.view".into()];
        assert_eq!(normalize_keys(&input), vec!["systems.view".to_string()]);
    }

    #[test]
    fn normalize_keys_on_empty_input_returns_empty() {
        let input: Vec<String> = vec![];
        assert!(normalize_keys(&input).is_empty());
    }
}
