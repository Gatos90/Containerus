//! Session management — list and revoke active refresh tokens.
//!
//! Sessions are projected directly off `refresh_tokens`. Each row already
//! represents a live device/browser with its own rotation chain, so there
//! is no separate `sessions` table. The MFA migration (CON-66) added
//! `user_agent`, `ip_address`, and `last_used_at` columns so the UI can
//! render "Safari on macOS · 203.0.113.1 · 3 minutes ago".

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::FromRow;
use uuid::Uuid;

use crate::audit::{log_event, AuditEvent};
use crate::auth::middleware::AuthUser;
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_my_sessions))
        .route("/{session_id}", delete(revoke_my_session))
        .route("/all", delete(revoke_all_my_sessions))
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SessionResponse {
    pub id: Uuid,
    pub user_agent: Option<String>,
    pub ip_address: Option<String>,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
    /// Best-effort flag — the session whose refresh token jti matches the
    /// current access token's jti would tell us "this is me", but the JWT
    /// only carries the access jti, not the refresh jti. We expose the most
    /// recently used session instead so the UI can highlight it.
    pub is_current: bool,
}

async fn list_my_sessions(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<SessionResponse>>, (StatusCode, Json<Value>)> {
    let rows: Vec<(Uuid, Option<String>, Option<String>, DateTime<Utc>, DateTime<Utc>, Option<DateTime<Utc>>)> = sqlx::query_as(
        r#"
        SELECT id, user_agent, ip_address, created_at, expires_at, last_used_at
        FROM refresh_tokens
        WHERE user_id = $1 AND expires_at > now()
        ORDER BY COALESCE(last_used_at, created_at) DESC
        "#,
    )
    .bind(auth.claims.sub)
    .fetch_all(&state.db)
    .await
    .map_err(|e| internal_error("Failed to list sessions", e))?;

    let now = Utc::now();
    let most_recent_idx = rows
        .iter()
        .enumerate()
        .max_by_key(|(_, r)| r.5.unwrap_or(r.3))
        .map(|(i, _)| i);

    let sessions = rows
        .into_iter()
        .enumerate()
        .map(|(i, (id, ua, ip, created, expires, last_used))| SessionResponse {
            id,
            user_agent: ua,
            ip_address: ip,
            created_at: created,
            expires_at: expires,
            last_used_at: last_used,
            is_current: Some(i) == most_recent_idx && (now - last_used.unwrap_or(created)).num_seconds() < 120,
        })
        .collect();

    Ok(Json(sessions))
}

async fn revoke_my_session(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(session_id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, Json<Value>)> {
    let affected = sqlx::query("DELETE FROM refresh_tokens WHERE id = $1 AND user_id = $2")
        .bind(session_id)
        .bind(auth.claims.sub)
        .execute(&state.db)
        .await
        .map_err(|e| internal_error("Failed to revoke session", e))?
        .rows_affected();

    if affected == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Session not found" })),
        ));
    }

    log_event(
        &state.db,
        AuditEvent {
            caller: &auth.caller(),
            project_id: None,
            environment_id: None,
            action: "session.revoke",
            resource_type: "refresh_token",
            resource_id: Some(&session_id.to_string()),
            details: None,
        },
    )
    .await;

    Ok(StatusCode::NO_CONTENT)
}

/// Revoke every session for the current user except the one that made this
/// request. "Except" is best-effort — the access token carries a jti but
/// not the refresh jti, so we keep the most recently used refresh token on
/// the assumption it's the caller. Clients that want a hard "sign out
/// everywhere including me" can follow up with `/auth/logout`.
async fn revoke_all_my_sessions(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let deleted = sqlx::query_scalar::<_, i64>(
        r#"
        WITH keeper AS (
            SELECT id FROM refresh_tokens
             WHERE user_id = $1 AND expires_at > now()
             ORDER BY COALESCE(last_used_at, created_at) DESC
             LIMIT 1
        ), deleted AS (
            DELETE FROM refresh_tokens
             WHERE user_id = $1
               AND id NOT IN (SELECT id FROM keeper)
             RETURNING 1
        )
        SELECT COUNT(*) FROM deleted
        "#,
    )
    .bind(auth.claims.sub)
    .fetch_one(&state.db)
    .await
    .map_err(|e| internal_error("Failed to revoke other sessions", e))?;

    log_event(
        &state.db,
        AuditEvent {
            caller: &auth.caller(),
            project_id: None,
            environment_id: None,
            action: "session.revoke_all",
            resource_type: "user",
            resource_id: Some(&auth.claims.sub.to_string()),
            details: Some(json!({ "revokedCount": deleted })),
        },
    )
    .await;

    Ok(Json(json!({ "revoked": deleted })))
}

fn internal_error<E: std::fmt::Debug>(msg: &str, e: E) -> (StatusCode, Json<Value>) {
    tracing::error!("{msg}: {e:?}");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": "Internal server error" })),
    )
}
