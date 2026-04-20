//! Password self-service endpoints (CON-118).
//!
//! Three public routes + one admin-only Phase 1 fallback:
//!
//!   * `POST /api/auth/password/change`          — authenticated rotation
//!   * `POST /api/auth/password/reset/request`   — unauthenticated initiator
//!   * `POST /api/auth/password/reset/confirm`   — unauthenticated redeemer
//!   * `POST /api/auth/password/reset/issue`     — admin-only; returns the
//!     raw reset token so an operator can hand it off to the user while the
//!     outbound email transport is still missing (see ticket "Sends email
//!     via existing notification channel … if no email transport exists,
//!     land token return behind an admin-only endpoint for Phase 1").
//!
//! Security posture:
//!   * `reset/request` is deliberately enumeration-proof — it always
//!     responds 200 regardless of whether the email exists.
//!   * Reset tokens are stored only as SHA-256 hashes; the raw value is
//!     returned exactly once (from `reset/issue` for now, from the email
//!     body once CON-??? lands the notification channel).
//!   * A successful change/confirm deletes every refresh token for the
//!     user, forcing full re-authentication on other devices.

use std::net::SocketAddr;

use axum::{
    extract::{ConnectInfo, State},
    http::StatusCode,
    routing::post,
    Json, Router,
};
use containerus_rbac_macros::{public_endpoint, require_permissions};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use validator::ValidateEmail;

use crate::audit::{log_event, AuditCaller, AuditEvent};
use crate::auth::middleware::AuthUser;
use crate::auth::password;
use crate::AppState;

/// Minimum accepted password length. Matches `/auth/register` — if either
/// policy ever grows (complexity rules, zxcvbn gating, etc.) keep both call
/// sites in sync or this endpoint becomes a backdoor around the new rule.
const MIN_PASSWORD_LEN: usize = 8;

/// Lifetime of a single-use reset token. 30 minutes keeps the window short
/// enough that a leaked email link is mostly unusable, while still being
/// long enough for a user to switch devices between receiving the email and
/// acting on it.
const RESET_TOKEN_TTL_SECS: i64 = 30 * 60;

/// Raw reset token length in bytes before base64url encoding.
/// 32 bytes = 256 bits of entropy — the hash we store in the DB doesn't
/// protect against brute force once the raw token format is known, so the
/// raw value has to stand on its own.
const RESET_TOKEN_BYTES: usize = 32;

// ============================================================================
// Router
// ============================================================================

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/change", post(change))
        .route("/reset/request", post(reset_request))
        .route("/reset/confirm", post(reset_confirm))
        .route("/reset/issue", post(reset_issue_admin))
}

// ============================================================================
// Request / Response shapes
// ============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetRequestRequest {
    pub email: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetConfirmRequest {
    pub token: String,
    pub new_password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetIssueRequest {
    pub email: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetIssueResponse {
    /// Raw (un-hashed) reset token. Shown exactly once — this is the same
    /// value the user would otherwise receive via email. The caller is
    /// responsible for transmitting it to the user through a trusted
    /// channel.
    pub token: String,
    /// ISO 8601 timestamp when the token stops being valid.
    pub expires_at: chrono::DateTime<chrono::Utc>,
}

// ============================================================================
// Handlers
// ============================================================================

/// Change the signed-in user's password.
///
/// Requires the current password to defeat a stolen-access-token scenario —
/// an attacker with only an access token cannot rotate the credential out
/// from under the legitimate owner. On success every refresh token for the
/// user is deleted (forces re-login on all other devices) and the current
/// access token is placed on the revocation list so it cannot be reused.
#[public_endpoint]
async fn change(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<ChangePasswordRequest>,
) -> Result<StatusCode, (StatusCode, Json<Value>)> {
    if req.new_password.len() < MIN_PASSWORD_LEN {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": format!("New password must be at least {MIN_PASSWORD_LEN} characters") })),
        ));
    }

    // Fetch user + current hash inside a transaction so the update is
    // serialised against other auth mutations on the same row.
    let mut tx = state.db.begin().await.map_err(internal("Failed to start transaction"))?;

    let row = sqlx::query_as::<_, crate::db::models::UserRow>(
        "SELECT * FROM users WHERE id = $1 AND is_active = true",
    )
    .bind(auth.claims.sub)
    .fetch_optional(&mut *tx)
    .await
    .map_err(internal("User lookup failed"))?
    .ok_or_else(|| (StatusCode::UNAUTHORIZED, Json(json!({ "error": "User not found" }))))?;

    // IDP-only users have no local password to change. Surface that
    // explicitly rather than 500ing on the None hash.
    let current_hash = row.password_hash.as_deref().ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "This account signs in via an external identity provider; password cannot be changed here",
                "code": "idp_only_account",
            })),
        )
    })?;

    let valid = password::verify_password(&req.current_password, current_hash)
        .map_err(internal("Password verify failed"))?;
    if !valid {
        // Generic 401 — don't tell the caller whether the session was
        // valid but the current password was wrong, which is still useful
        // signal for an attacker poking around with a stolen access token.
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Current password is incorrect" })),
        ));
    }

    // Reject no-op rotations. It's a low-severity mistake but cheap to
    // catch, and skipping the write keeps the audit log from being noisy.
    if req.current_password == req.new_password {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "New password must differ from the current password" })),
        ));
    }

    let new_hash = password::hash_password(&req.new_password)
        .map_err(internal("Password hash failed"))?;

    sqlx::query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2")
        .bind(&new_hash)
        .bind(row.id)
        .execute(&mut *tx)
        .await
        .map_err(internal("Password update failed"))?;

    // Revoke every refresh token — forces re-login on other devices. The
    // current access token is separately placed on the revocation cache
    // below so the attacker-with-stolen-access scenario closes completely.
    sqlx::query("DELETE FROM refresh_tokens WHERE user_id = $1")
        .bind(row.id)
        .execute(&mut *tx)
        .await
        .map_err(internal("Refresh token cleanup failed"))?;

    tx.commit().await.map_err(internal("Transaction commit failed"))?;

    state.revocation_cache.revoke(auth.claims.jti, auth.claims.exp);

    let caller = auth.caller();
    log_event(
        &state.db,
        AuditEvent {
            caller: &caller,
            project_id: None,
            environment_id: None,
            action: "user.password.change",
            resource_type: "user",
            resource_id: Some(&row.id.to_string()),
            details: None,
        },
    )
    .await;

    Ok(StatusCode::NO_CONTENT)
}

/// Kick off a password reset for `email`.
///
/// Always returns 200 with a neutral body — whether or not the email is
/// known to the system. The only observable side effect from the caller's
/// perspective is that a reset email eventually arrives (or an operator
/// retrieves the token via `/reset/issue` during Phase 1).
#[public_endpoint]
async fn reset_request(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(req): Json<ResetRequestRequest>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let email = req.email.trim().to_lowercase();
    let ip_str = addr.ip().to_string();

    // Per-IP throttle first — cheap, no DB touch. Stops "spray across
    // every email in a leaked dump from one host" before the email-keyed
    // limiter can even see it.
    if !state.password_reset_ip_limiter.check(addr.ip()) {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({ "error": "Too many password reset requests — please wait before trying again" })),
        ));
    }

    // Per-email throttle. We validate the email format before touching
    // the limiter so obviously malformed inputs don't poison the key space
    // (which is unbounded in size by design — valid emails only).
    if !email.is_empty() && email.validate_email() && !state.password_reset_email_limiter.check(&email) {
        // Still respond 200 to keep the endpoint enumeration-proof; the
        // audit event is how an operator notices the storm.
        log_event(
            &state.db,
            AuditEvent {
                caller: &AuditCaller::system(),
                project_id: None,
                environment_id: None,
                action: "user.password.reset.request.throttled",
                resource_type: "user",
                resource_id: None,
                details: Some(json!({ "email": email, "ip": ip_str })),
            },
        )
        .await;
        return Ok((StatusCode::OK, Json(neutral_reset_response())));
    }

    // Resolve the user. Missing/invalid email → same 200 response.
    let user_row = if email.is_empty() || !email.validate_email() {
        None
    } else {
        sqlx::query_as::<_, crate::db::models::UserRow>(
            "SELECT * FROM users WHERE email = $1 AND is_active = true",
        )
        .bind(&email)
        .fetch_optional(&state.db)
        .await
        .map_err(internal("User lookup failed"))?
    };

    if let Some(user) = user_row {
        // External-IDP accounts can't meaningfully reset a local password.
        // Audit it but do not leak that fact to the caller.
        if user.password_hash.is_none() {
            let caller = AuditCaller::user(user.id, Some(ip_str.clone()));
            log_event(
                &state.db,
                AuditEvent {
                    caller: &caller,
                    project_id: None,
                    environment_id: None,
                    action: "user.password.reset.request.idp_only",
                    resource_type: "user",
                    resource_id: Some(&user.id.to_string()),
                    details: None,
                },
            )
            .await;
            return Ok((StatusCode::OK, Json(neutral_reset_response())));
        }

        let (raw_token, _row_id, expires_at) =
            issue_reset_token(&state, user.id, &ip_str).await?;

        // Phase 1: no email transport. Log the token at INFO so operators
        // can relay it manually. Once the notification channel lands, swap
        // this block for a real send and drop the raw token from logs.
        tracing::info!(
            user_id = %user.id,
            email = %email,
            expires_at = %expires_at,
            "Password reset token issued (no email transport; deliver manually): {raw_token}",
        );

        let caller = AuditCaller::user(user.id, Some(ip_str.clone()));
        log_event(
            &state.db,
            AuditEvent {
                caller: &caller,
                project_id: None,
                environment_id: None,
                action: "user.password.reset.request",
                resource_type: "user",
                resource_id: Some(&user.id.to_string()),
                details: Some(json!({ "expiresAt": expires_at })),
            },
        )
        .await;
    } else {
        // Unknown email — record it so enumeration attempts are visible
        // in the audit log even though the response is indistinguishable
        // from the happy path.
        log_event(
            &state.db,
            AuditEvent {
                caller: &AuditCaller::system(),
                project_id: None,
                environment_id: None,
                action: "user.password.reset.request.unknown_email",
                resource_type: "user",
                resource_id: None,
                details: Some(json!({ "email": email, "ip": ip_str })),
            },
        )
        .await;
    }

    Ok((StatusCode::OK, Json(neutral_reset_response())))
}

/// Consume a reset token and set a new password.
///
/// One-shot: the row is atomically marked `used_at = now()` inside the same
/// transaction as the user update. A token that wins a race is the only
/// one that gets to flip the password. On success every refresh token is
/// deleted so the attacker path "reset via stolen token, keep session on
/// old password" is closed.
#[public_endpoint]
async fn reset_confirm(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(req): Json<ResetConfirmRequest>,
) -> Result<StatusCode, (StatusCode, Json<Value>)> {
    if req.token.trim().is_empty() {
        return Err(invalid_token_error());
    }
    if req.new_password.len() < MIN_PASSWORD_LEN {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": format!("New password must be at least {MIN_PASSWORD_LEN} characters") })),
        ));
    }

    let token_hash = hash_reset_token(req.token.trim());
    let ip_str = addr.ip().to_string();

    let mut tx = state.db.begin().await.map_err(internal("Failed to start transaction"))?;

    // Atomically claim the row. The partial unique index on (user_id) WHERE
    // used_at IS NULL guarantees one active row per user; the single-row
    // UPDATE ... RETURNING here guarantees this consumer wins outright.
    let claimed: Option<(Uuid, Uuid)> = sqlx::query_as(
        r#"
        UPDATE password_reset_tokens
           SET used_at = now()
         WHERE token_hash = $1
           AND used_at IS NULL
           AND expires_at > now()
        RETURNING id, user_id
        "#,
    )
    .bind(&token_hash)
    .fetch_optional(&mut *tx)
    .await
    .map_err(internal("Token claim failed"))?;

    let Some((token_id, user_id)) = claimed else {
        // Don't tell the caller why — "expired" vs "already used" vs
        // "never existed" is enumeration signal.
        return Err(invalid_token_error());
    };

    let new_hash = password::hash_password(&req.new_password)
        .map_err(internal("Password hash failed"))?;

    sqlx::query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2 AND is_active = true")
        .bind(&new_hash)
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(internal("Password update failed"))?;

    // Nuke every session — the reset flow is the "I lost access" path, so
    // every existing refresh token is presumed suspect.
    sqlx::query("DELETE FROM refresh_tokens WHERE user_id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(internal("Refresh token cleanup failed"))?;

    tx.commit().await.map_err(internal("Transaction commit failed"))?;

    let caller = AuditCaller::user(user_id, Some(ip_str));
    log_event(
        &state.db,
        AuditEvent {
            caller: &caller,
            project_id: None,
            environment_id: None,
            action: "user.password.reset.confirm",
            resource_type: "user",
            resource_id: Some(&user_id.to_string()),
            details: Some(json!({ "tokenId": token_id })),
        },
    )
    .await;

    Ok(StatusCode::NO_CONTENT)
}

/// Phase 1 fallback: a company admin issues a reset token on behalf of a
/// user and receives the raw token back in the response. Used until an
/// outbound email transport exists. The endpoint is **intentionally not**
/// exposed to non-admin callers — the `users.password.reset.issue`
/// permission is granted only to the built-in project-admin role at
/// migration time, and the `require_permissions` macro enforces it.
#[require_permissions("users.password.reset.issue")]
async fn reset_issue_admin(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<ResetIssueRequest>,
) -> Result<Json<ResetIssueResponse>, (StatusCode, Json<Value>)> {
    // Company admin is the only caller that should ever land here. The
    // permission is not attached to any non-admin built-in role, but we
    // also gate on the claim directly for defence in depth against a
    // misconfigured role_permissions row.
    if !auth.claims.is_company_admin {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "Only company admins may issue password reset tokens" })),
        ));
    }

    let email = req.email.trim().to_lowercase();
    if email.is_empty() || !email.validate_email() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Invalid email address" })),
        ));
    }

    let user = sqlx::query_as::<_, crate::db::models::UserRow>(
        "SELECT * FROM users WHERE email = $1 AND is_active = true",
    )
    .bind(&email)
    .fetch_optional(&state.db)
    .await
    .map_err(internal("User lookup failed"))?
    .ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "No active user with that email" })),
        )
    })?;

    if user.password_hash.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "Target account signs in via an external identity provider",
                "code": "idp_only_account",
            })),
        ));
    }

    let ip = auth.client_ip.clone().unwrap_or_default();
    let (raw_token, _row_id, expires_at) = issue_reset_token(&state, user.id, &ip).await?;

    let caller = auth.caller();
    log_event(
        &state.db,
        AuditEvent {
            caller: &caller,
            project_id: None,
            environment_id: None,
            action: "user.password.reset.request",
            resource_type: "user",
            resource_id: Some(&user.id.to_string()),
            details: Some(json!({
                "expiresAt": expires_at,
                "issuedBy": "admin",
            })),
        },
    )
    .await;

    Ok(Json(ResetIssueResponse { token: raw_token, expires_at }))
}

// ============================================================================
// Helpers
// ============================================================================

/// Deterministic SHA-256 over the raw reset token. We store only the hash;
/// the raw value is never persisted. Matches the pattern used for refresh
/// token JTIs in `api::auth::hash_token_jti` so key-rotation stories stay
/// consistent.
pub fn hash_reset_token(raw: &str) -> String {
    let digest = Sha256::digest(raw.as_bytes());
    format!("{:x}", digest)
}

/// Generate a cryptographically-random base64url token. URL-safe so the
/// email body / clickable link doesn't need escaping.
fn generate_raw_token() -> String {
    let mut bytes = [0u8; RESET_TOKEN_BYTES];
    rand::thread_rng().fill_bytes(&mut bytes);
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// Create and persist a fresh reset token for `user_id`. Deletes any
/// prior unused row for the same user so the "one active per user" index
/// never fires — the explicit delete keeps the insert path deterministic
/// even under races.
async fn issue_reset_token(
    state: &AppState,
    user_id: Uuid,
    ip: &str,
) -> Result<(String, Uuid, chrono::DateTime<chrono::Utc>), (StatusCode, Json<Value>)> {
    let raw = generate_raw_token();
    let hash = hash_reset_token(&raw);
    let expires_at = chrono::Utc::now() + chrono::Duration::seconds(RESET_TOKEN_TTL_SECS);

    let mut tx = state.db.begin().await.map_err(internal("Failed to start transaction"))?;

    sqlx::query(
        "DELETE FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL",
    )
    .bind(user_id)
    .execute(&mut *tx)
    .await
    .map_err(internal("Prior token cleanup failed"))?;

    let row_id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, ip_address)
        VALUES ($1, $2, $3, $4)
        RETURNING id
        "#,
    )
    .bind(user_id)
    .bind(&hash)
    .bind(expires_at)
    .bind(ip)
    .fetch_one(&mut *tx)
    .await
    .map_err(internal("Reset token insert failed"))?;

    tx.commit().await.map_err(internal("Transaction commit failed"))?;

    Ok((raw, row_id, expires_at))
}

fn neutral_reset_response() -> Value {
    json!({
        "status": "ok",
        "message": "If an account exists for that email, a reset link has been issued.",
    })
}

fn invalid_token_error() -> (StatusCode, Json<Value>) {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({ "error": "Reset token is invalid or has expired" })),
    )
}

/// Factor out the `map_err(|e| { trace!(...); 500 })` pattern so the
/// individual handlers stay skim-readable. Generic over the source error so
/// the same helper works for `sqlx::Error` and the `String` errors returned
/// by `auth::password::{hash_password, verify_password}`.
fn internal<E: std::fmt::Display>(
    log_prefix: &'static str,
) -> impl FnOnce(E) -> (StatusCode, Json<Value>) {
    move |e: E| {
        tracing::error!("{log_prefix}: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Internal server error" })),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashed_token_is_deterministic() {
        let a = hash_reset_token("abc");
        let b = hash_reset_token("abc");
        let c = hash_reset_token("abd");
        assert_eq!(a, b);
        assert_ne!(a, c);
        // SHA-256 hex → 64 chars
        assert_eq!(a.len(), 64);
    }

    #[test]
    fn generated_tokens_are_unique_and_url_safe() {
        let t1 = generate_raw_token();
        let t2 = generate_raw_token();
        assert_ne!(t1, t2);
        // base64url-no-pad: only A–Z a–z 0–9 - _
        assert!(t1.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }
}
