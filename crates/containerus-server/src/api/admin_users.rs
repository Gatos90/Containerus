//! Admin user endpoints (CON-119).
//!
//! Today only one route lives here: `PATCH /api/admin/users/{user_id}` for
//! deactivating or reactivating an account. Deactivation is the moment we
//! actually flip `users.is_active = false` — the column is checked in the
//! login/refresh paths already, but before this endpoint existed nothing in
//! the API wrote to it, so accounts could only be disabled by hand in SQL.
//!
//! Behavioural contract (matches the ticket acceptance):
//!   * Gated by `users.deactivate` AND `is_company_admin` for defence in
//!     depth. There is no company-scoped role system yet, so we rely on the
//!     `company_admins` flag; the permission exists so a future custom-role
//!     system can grant it without us having to rewrite the handler.
//!   * Self-deactivation returns 400 — a company admin locking themselves
//!     out is a support problem we don't want to own.
//!   * On deactivation we wipe every refresh token, every MFA secret, and
//!     every backup code for the target user. The "revoke all sessions"
//!     behaviour is the whole point — a disabled user must not be able to
//!     keep using an already-issued access token past its ~15-minute life,
//!     and they must not be able to refresh, re-enrol, or rotate around the
//!     deactivation.
//!   * The updated user row is returned without the password hash.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::patch,
    Json, Router,
};
use chrono::{DateTime, Utc};
use containerus_rbac_macros::require_permissions;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::audit::{log_event, AuditEvent};
use crate::auth::middleware::AuthUser;
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/{user_id}", patch(update_user))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminUpdateUserRequest {
    /// Only writable field today. Future fields (display_name override,
    /// role pinning, etc.) should be optional so partial PATCH works the
    /// same way.
    pub is_active: Option<bool>,
}

/// Admin-only representation of a user. Unlike the public [`UserResponse`]
/// this includes `is_active` so the caller can confirm the flip landed and
/// render the updated state without a second round-trip.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminUserResponse {
    pub id: Uuid,
    pub email: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub is_active: bool,
    pub auth_provider: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<crate::db::models::UserRow> for AdminUserResponse {
    fn from(row: crate::db::models::UserRow) -> Self {
        Self {
            id: row.id,
            email: row.email,
            display_name: row.display_name,
            avatar_url: row.avatar_url,
            is_active: row.is_active,
            auth_provider: row.auth_provider,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

#[require_permissions("users.deactivate")]
async fn update_user(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(user_id): Path<Uuid>,
    Json(req): Json<AdminUpdateUserRequest>,
) -> Result<Json<AdminUserResponse>, (StatusCode, Json<Value>)> {
    // Defence in depth: the permission key is not attached to any built-in
    // role, but a misconfigured custom role_permissions row should still not
    // unlock this path for a non-admin.
    if !auth.claims.is_company_admin {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "Company admin required" })),
        ));
    }

    let Some(target_is_active) = req.is_active else {
        // PATCH with no mutable field is a client bug — surface it rather
        // than silently no-op and hand back an optimistic row.
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "No updatable fields provided" })),
        ));
    };

    if user_id == auth.claims.sub {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Cannot change your own active status" })),
        ));
    }

    let mut tx = state.db.begin().await.map_err(|e| {
        tracing::error!("Failed to begin transaction: {e}");
        internal_error()
    })?;

    // Lock the row so a concurrent request can't race us between the read
    // and the session-revocation step below.
    let current: Option<crate::db::models::UserRow> = sqlx::query_as(
        "SELECT * FROM users WHERE id = $1 FOR UPDATE",
    )
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("User lookup failed: {e}");
        internal_error()
    })?;

    let Some(current) = current else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "User not found" })),
        ));
    };

    // No-op writes still return the current row but skip the audit/revoke
    // side-effects — calling deactivate twice should not spam the audit log
    // with fake "session.revoke_all" rows.
    if current.is_active == target_is_active {
        tx.commit().await.map_err(|e| {
            tracing::error!("Failed to commit transaction: {e}");
            internal_error()
        })?;
        return Ok(Json(AdminUserResponse::from(current)));
    }

    let updated: crate::db::models::UserRow = sqlx::query_as(
        r#"
        UPDATE users
           SET is_active = $1, updated_at = now()
         WHERE id = $2
        RETURNING *
        "#,
    )
    .bind(target_is_active)
    .bind(user_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to update user.is_active: {e}");
        internal_error()
    })?;

    // On deactivate: kill every session + every MFA secret. Reactivation
    // leaves MFA intact because re-enrolling every device would be hostile
    // to the ops team who are usually the ones flipping this back on after
    // a false positive.
    let mut revoked_tokens: u64 = 0;
    let mut cleared_mfa: bool = false;
    if !target_is_active {
        revoked_tokens = sqlx::query("DELETE FROM refresh_tokens WHERE user_id = $1")
            .bind(user_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                tracing::error!("Failed to revoke refresh tokens: {e}");
                internal_error()
            })?
            .rows_affected();

        // ON DELETE CASCADE covers mfa_backup_codes via user_mfa — but the
        // MFA migration (0008) does NOT set CASCADE across user_mfa, so do
        // both explicitly to avoid leaving orphaned backup codes.
        let mfa_rows = sqlx::query("DELETE FROM user_mfa WHERE user_id = $1")
            .bind(user_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                tracing::error!("Failed to clear MFA secret: {e}");
                internal_error()
            })?
            .rows_affected();

        sqlx::query("DELETE FROM mfa_backup_codes WHERE user_id = $1")
            .bind(user_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                tracing::error!("Failed to clear MFA backup codes: {e}");
                internal_error()
            })?;

        cleared_mfa = mfa_rows > 0;
    }

    tx.commit().await.map_err(|e| {
        tracing::error!("Failed to commit transaction: {e}");
        internal_error()
    })?;

    let action = if target_is_active { "user.reactivate" } else { "user.deactivate" };
    let user_id_str = updated.id.to_string();
    log_event(
        &state.db,
        AuditEvent {
            caller: &auth.caller(),
            project_id: None,
            environment_id: None,
            action,
            resource_type: "user",
            resource_id: Some(&user_id_str),
            details: Some(json!({
                "revokedSessions": revoked_tokens,
                "clearedMfa": cleared_mfa,
            })),
        },
    )
    .await;

    Ok(Json(AdminUserResponse::from(updated)))
}

fn internal_error() -> (StatusCode, Json<Value>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": "Internal server error" })),
    )
}
