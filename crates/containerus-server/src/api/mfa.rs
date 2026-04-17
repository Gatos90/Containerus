//! MFA (TOTP) enrollment, verification, and disable endpoints, plus the
//! post-password MFA-verify step that exchanges a challenge token for a
//! real access/refresh pair.
//!
//! See [`crate::auth::totp`] for the cryptographic core. The flow is:
//!
//! 1. `POST /api/auth/mfa/enroll` — authenticated. Generates a secret,
//!    stores it encrypted (but NOT enabled yet), returns the otpauth:// URI
//!    and the raw base32 secret for manual entry.
//! 2. `POST /api/auth/mfa/verify` — authenticated. Confirms the user can
//!    produce a valid TOTP, flips `enabled_at`, and returns 10 single-use
//!    backup codes (shown exactly once).
//! 3. `POST /api/auth/mfa/disable` — authenticated. Requires a current TOTP
//!    (or backup code) to disable; an attacker with a stolen session alone
//!    can't undo the mandate.
//! 4. `POST /api/auth/mfa/verify-login` — unauthenticated, takes the
//!    challenge token from `/auth/login` plus a code and returns the real
//!    `AuthResponse`.

use std::time::{SystemTime, UNIX_EPOCH};
use containerus_rbac_macros::{public_endpoint, require_permissions};
use axum::{
    extract::{ConnectInfo, State},
    http::{HeaderMap, StatusCode},
    routing::post,
    Json, Router,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::audit::{log_event, AuditCaller, AuditEvent};
use crate::auth::jwt::ProjectMembership;
use crate::auth::middleware::AuthUser;
use crate::auth::{jwt, totp};
use crate::db::models::UserResponse;
use crate::AppState;

/// Number of backup codes issued each time MFA is enabled (or re-enrolled).
const BACKUP_CODE_COUNT: usize = 10;
/// Length of the user-visible portion of each backup code in characters.
/// 10 alphanum ≈ 51 bits — well above the RFC 6238 secret for a single code.
const BACKUP_CODE_CHARS: usize = 10;

const BACKUP_ALPHABET: &[u8; 32] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// ============================================================================
// Router
// ============================================================================

/// Authenticated MFA routes — mounted under `/api/auth/mfa`.
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/enroll", post(enroll))
        .route("/verify", post(verify_enrollment))
        .route("/disable", post(disable))
        .route("/verify-login", post(verify_login))
}

// ============================================================================
// Request / Response shapes
// ============================================================================

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrollResponse {
    /// Base32-encoded raw secret. Shown so the user can copy-paste into
    /// authenticator apps that don't scan QR codes.
    pub secret: String,
    /// otpauth:// URI. The frontend renders this as a QR code; most
    /// authenticator apps scan it directly.
    pub otpauth_uri: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyRequest {
    pub code: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyEnrollmentResponse {
    pub enabled: bool,
    /// Single-use recovery codes. Returned exactly once — if the user loses
    /// them they must re-enroll.
    pub backup_codes: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyLoginRequest {
    pub challenge_token: String,
    pub code: String,
}

// ============================================================================
// Handlers
// ============================================================================

/// Kick off enrollment. Stores an encrypted secret (disabled until verified)
/// and hands back the provisioning URI.
///
/// If MFA is already enabled, the caller has to disable first — re-enrolling
/// silently would let a compromised session lock out the real user.
#[require_permissions("mfa.self.manage")]
async fn enroll(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<EnrollResponse>, (StatusCode, Json<Value>)> {
    if is_mfa_enabled(&state.db, auth.claims.sub).await? {
        return Err((
            StatusCode::CONFLICT,
            Json(json!({ "error": "MFA is already enabled — disable it first to re-enroll" })),
        ));
    }

    let secret = totp::generate_secret();
    let (ciphertext, nonce) = state
        .vault
        .encrypt(&secret)
        .map_err(|e| internal_error("Failed to encrypt MFA secret", e))?;

    sqlx::query(
        r#"
        INSERT INTO user_mfa (user_id, method, secret_encrypted, secret_nonce)
        VALUES ($1, 'totp', $2, $3)
        ON CONFLICT (user_id) DO UPDATE
            SET secret_encrypted = EXCLUDED.secret_encrypted,
                secret_nonce     = EXCLUDED.secret_nonce,
                enabled_at       = NULL,
                last_used_at     = NULL
        "#,
    )
    .bind(auth.claims.sub)
    .bind(&ciphertext)
    .bind(&nonce)
    .execute(&state.db)
    .await
    .map_err(|e| internal_error("Failed to persist MFA enrollment", e))?;

    let otpauth_uri = totp::provisioning_uri("Containerus", &auth.claims.email, &secret);
    let secret_b32 = totp::base32_encode(&secret);

    log_event(
        &state.db,
        AuditEvent {
            caller: &auth.caller(),
            project_id: None,
            environment_id: None,
            action: "mfa.enroll",
            resource_type: "user",
            resource_id: Some(&auth.claims.sub.to_string()),
            details: None,
        },
    )
    .await;

    Ok(Json(EnrollResponse {
        secret: secret_b32,
        otpauth_uri,
    }))
}

/// Confirm enrollment by presenting a valid TOTP, then enable MFA and
/// return the one-time backup codes.
#[require_permissions("mfa.self.manage")]
async fn verify_enrollment(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<VerifyRequest>,
) -> Result<Json<VerifyEnrollmentResponse>, (StatusCode, Json<Value>)> {
    let row = fetch_mfa_row(&state.db, auth.claims.sub)
        .await?
        .ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "No pending MFA enrollment — call /enroll first" })),
            )
        })?;

    if row.enabled_at.is_some() {
        return Err((
            StatusCode::CONFLICT,
            Json(json!({ "error": "MFA is already enabled" })),
        ));
    }

    let secret = state
        .vault
        .decrypt(&row.secret_encrypted, &row.secret_nonce)
        .map_err(|e| internal_error("Failed to decrypt MFA secret", e))?;

    if !totp::verify(&secret, &req.code, now_unix_secs()) {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Invalid verification code" })),
        ));
    }

    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|e| internal_error("Failed to begin transaction", e))?;

    sqlx::query("UPDATE user_mfa SET enabled_at = now() WHERE user_id = $1 AND enabled_at IS NULL")
        .bind(auth.claims.sub)
        .execute(&mut *tx)
        .await
        .map_err(|e| internal_error("Failed to enable MFA", e))?;

    let backup_codes = regenerate_backup_codes(&mut tx, auth.claims.sub).await?;

    tx.commit()
        .await
        .map_err(|e| internal_error("Failed to commit MFA enable", e))?;

    log_event(
        &state.db,
        AuditEvent {
            caller: &auth.caller(),
            project_id: None,
            environment_id: None,
            action: "mfa.enable",
            resource_type: "user",
            resource_id: Some(&auth.claims.sub.to_string()),
            details: Some(json!({ "backupCodesIssued": backup_codes.len() })),
        },
    )
    .await;

    Ok(Json(VerifyEnrollmentResponse {
        enabled: true,
        backup_codes,
    }))
}

/// Disable MFA. Requires a currently-valid TOTP or backup code so that a
/// stolen session alone can't defeat the mandate.
#[require_permissions("mfa.self.manage")]
async fn disable(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<VerifyRequest>,
) -> Result<StatusCode, (StatusCode, Json<Value>)> {
    let row = fetch_mfa_row(&state.db, auth.claims.sub)
        .await?
        .ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "MFA is not configured for this user" })),
            )
        })?;

    if row.enabled_at.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "MFA is not enabled" })),
        ));
    }

    // Accept either a live TOTP or a one-shot backup code — we're about to
    // delete the row so don't bother consuming a backup code atomically.
    let secret = state
        .vault
        .decrypt(&row.secret_encrypted, &row.secret_nonce)
        .map_err(|e| internal_error("Failed to decrypt MFA secret", e))?;
    let totp_ok = totp::verify(&secret, &req.code, now_unix_secs());
    let backup_ok = if !totp_ok {
        consume_backup_code(&state.db, auth.claims.sub, &req.code).await?
    } else {
        false
    };

    if !totp_ok && !backup_ok {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Invalid verification code" })),
        ));
    }

    // ON DELETE CASCADE on user_mfa drops the row directly; backup codes
    // cascade from users only, so clear them here explicitly.
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|e| internal_error("Failed to begin transaction", e))?;

    sqlx::query("DELETE FROM user_mfa WHERE user_id = $1")
        .bind(auth.claims.sub)
        .execute(&mut *tx)
        .await
        .map_err(|e| internal_error("Failed to delete MFA record", e))?;

    sqlx::query("DELETE FROM mfa_backup_codes WHERE user_id = $1")
        .bind(auth.claims.sub)
        .execute(&mut *tx)
        .await
        .map_err(|e| internal_error("Failed to clear backup codes", e))?;

    tx.commit()
        .await
        .map_err(|e| internal_error("Failed to commit MFA disable", e))?;

    log_event(
        &state.db,
        AuditEvent {
            caller: &auth.caller(),
            project_id: None,
            environment_id: None,
            action: "mfa.disable",
            resource_type: "user",
            resource_id: Some(&auth.claims.sub.to_string()),
            details: Some(json!({ "viaBackupCode": backup_ok })),
        },
    )
    .await;

    Ok(StatusCode::NO_CONTENT)
}

/// Complete a login flow that required MFA. Consumes the challenge token
/// issued by `/auth/login` and the user's TOTP / backup code; on success
/// mints the real access + refresh pair.
#[public_endpoint]
async fn verify_login(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<VerifyLoginRequest>,
) -> Result<Json<super::auth::AuthResponse>, (StatusCode, Json<Value>)> {
    let claims = jwt::decode_mfa_challenge_token(&req.challenge_token, &state.config.jwt_secret)
        .map_err(|_| {
            (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "Invalid or expired MFA challenge" })),
            )
        })?;

    let row = fetch_mfa_row(&state.db, claims.sub)
        .await?
        .ok_or_else(|| {
            (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "MFA is not configured for this user" })),
            )
        })?;

    if row.enabled_at.is_none() {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "MFA is not enabled for this user" })),
        ));
    }

    let secret = state
        .vault
        .decrypt(&row.secret_encrypted, &row.secret_nonce)
        .map_err(|e| internal_error("Failed to decrypt MFA secret", e))?;

    let totp_ok = totp::verify(&secret, &req.code, now_unix_secs());
    let backup_ok = if !totp_ok {
        consume_backup_code(&state.db, claims.sub, &req.code).await?
    } else {
        false
    };

    if !totp_ok && !backup_ok {
        log_event(
            &state.db,
            AuditEvent {
                caller: &AuditCaller::user(claims.sub, Some(addr.ip().to_string())),
                project_id: None,
                environment_id: None,
                action: "mfa.login.failure",
                resource_type: "user",
                resource_id: Some(&claims.sub.to_string()),
                details: None,
            },
        )
        .await;
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Invalid verification code" })),
        ));
    }

    // Update last_used_at on the MFA row. Non-critical, log but ignore errors.
    if let Err(e) = sqlx::query("UPDATE user_mfa SET last_used_at = now() WHERE user_id = $1")
        .bind(claims.sub)
        .execute(&state.db)
        .await
    {
        tracing::warn!("Failed to update user_mfa.last_used_at: {e}");
    }

    let user = sqlx::query_as::<_, crate::db::models::UserRow>(
        "SELECT * FROM users WHERE id = $1 AND is_active = true",
    )
    .bind(claims.sub)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| internal_error("User lookup failed during MFA verify", e))?
    .ok_or_else(|| {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "User not found or disabled" })),
        )
    })?;

    let is_company_admin = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM company_admins WHERE user_id = $1)",
    )
    .bind(user.id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| internal_error("Company admin check failed", e))?;

    let memberships: Vec<ProjectMembership> = sqlx::query_as::<_, crate::db::models::ProjectMemberRow>(
        "SELECT * FROM project_members WHERE user_id = $1",
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| internal_error("Membership fetch failed", e))?
    .into_iter()
    .map(|m| ProjectMembership { project_id: m.project_id, role_id: m.role_id })
    .collect();

    let (access_token, _access_jti) = jwt::create_access_token(
        user.id,
        &user.email,
        memberships,
        is_company_admin,
        &state.config.jwt_secret,
        state.config.jwt_access_expiry_secs,
    )
    .map_err(|e| internal_error("Access token creation failed", e))?;

    let (refresh_token, refresh_jti) = jwt::create_refresh_token(
        user.id,
        &state.config.jwt_secret,
        state.config.jwt_refresh_expiry_secs,
    )
    .map_err(|e| internal_error("Refresh token creation failed", e))?;

    let user_agent = headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .map(truncate_user_agent);

    let expires_at = chrono::Utc::now()
        + chrono::Duration::seconds(state.config.jwt_refresh_expiry_secs);

    sqlx::query(
        "INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address) VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(user.id)
    .bind(super::auth::hash_token_jti(refresh_jti))
    .bind(expires_at)
    .bind(user_agent.as_deref())
    .bind(addr.ip().to_string())
    .execute(&state.db)
    .await
    .map_err(|e| internal_error("Refresh token insert failed", e))?;

    log_event(
        &state.db,
        AuditEvent {
            caller: &AuditCaller::user(user.id, Some(addr.ip().to_string())),
            project_id: None,
            environment_id: None,
            action: "mfa.login.success",
            resource_type: "user",
            resource_id: Some(&user.id.to_string()),
            details: Some(json!({ "viaBackupCode": backup_ok })),
        },
    )
    .await;

    Ok(Json(super::auth::AuthResponse {
        access_token,
        refresh_token,
        user: UserResponse::from(user),
    }))
}

// ============================================================================
// Helpers shared with `auth.rs`
// ============================================================================

pub(super) async fn is_mfa_enabled(
    db: &PgPool,
    user_id: Uuid,
) -> Result<bool, (StatusCode, Json<Value>)> {
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM user_mfa WHERE user_id = $1 AND enabled_at IS NOT NULL)",
    )
    .bind(user_id)
    .fetch_one(db)
    .await
    .map_err(|e| internal_error("Failed to read user_mfa state", e))
}

/// Is the company-wide MFA mandate on? Reads the singleton company row.
/// Falls back to `false` if the company isn't configured yet so the very
/// first registration can succeed without MFA.
pub(super) async fn company_mfa_required(
    db: &PgPool,
) -> Result<bool, (StatusCode, Json<Value>)> {
    let settings = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT settings FROM company LIMIT 1",
    )
    .fetch_optional(db)
    .await
    .map_err(|e| internal_error("Failed to read company settings", e))?;

    Ok(settings
        .and_then(|s| {
            s.get("security")
                .and_then(|sec| sec.get("mfa"))
                .and_then(|mfa| mfa.get("require"))
                .and_then(|v| v.as_bool())
        })
        .unwrap_or(false))
}

pub(super) fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub(super) fn truncate_user_agent(raw: &str) -> String {
    // Browser UA strings can be arbitrarily long in the wild (extensions
    // append their own). Cap to keep the DB row small — the session list
    // only renders the browser/OS bit anyway.
    const MAX: usize = 512;
    if raw.len() <= MAX {
        raw.to_string()
    } else {
        raw.chars().take(MAX).collect()
    }
}

#[derive(sqlx::FromRow)]
struct MfaRow {
    secret_encrypted: Vec<u8>,
    secret_nonce: Vec<u8>,
    enabled_at: Option<chrono::DateTime<chrono::Utc>>,
}

async fn fetch_mfa_row(
    db: &PgPool,
    user_id: Uuid,
) -> Result<Option<MfaRow>, (StatusCode, Json<Value>)> {
    sqlx::query_as::<_, MfaRow>(
        "SELECT secret_encrypted, secret_nonce, enabled_at FROM user_mfa WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_optional(db)
    .await
    .map_err(|e| internal_error("Failed to load MFA record", e))
}

/// Attempt to consume a single backup code. Returns `true` if one was burned,
/// `false` if the code was unknown or already used. Consumption is atomic —
/// the same code submitted twice concurrently will be accepted exactly once.
async fn consume_backup_code(
    db: &PgPool,
    user_id: Uuid,
    code: &str,
) -> Result<bool, (StatusCode, Json<Value>)> {
    let normalised = normalise_backup_code(code);
    if normalised.is_empty() {
        return Ok(false);
    }
    let hash = hash_backup_code(&normalised);

    let affected = sqlx::query(
        r#"
        UPDATE mfa_backup_codes
           SET used_at = now()
         WHERE user_id = $1
           AND code_hash = $2
           AND used_at IS NULL
        "#,
    )
    .bind(user_id)
    .bind(&hash)
    .execute(db)
    .await
    .map_err(|e| internal_error("Failed to consume backup code", e))?
    .rows_affected();

    Ok(affected == 1)
}

/// Drop any remaining backup codes for the user and issue a fresh batch.
/// Returns the cleartext codes (shown once).
async fn regenerate_backup_codes(
    tx: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
) -> Result<Vec<String>, (StatusCode, Json<Value>)> {
    sqlx::query("DELETE FROM mfa_backup_codes WHERE user_id = $1")
        .bind(user_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| internal_error("Failed to clear old backup codes", e))?;

    let mut out = Vec::with_capacity(BACKUP_CODE_COUNT);
    for _ in 0..BACKUP_CODE_COUNT {
        let code = generate_backup_code();
        let hash = hash_backup_code(&code);
        sqlx::query("INSERT INTO mfa_backup_codes (user_id, code_hash) VALUES ($1, $2)")
            .bind(user_id)
            .bind(&hash)
            .execute(&mut **tx)
            .await
            .map_err(|e| internal_error("Failed to insert backup code", e))?;
        out.push(format_backup_code(&code));
    }
    Ok(out)
}

fn generate_backup_code() -> String {
    let mut rng = rand::thread_rng();
    let mut out = String::with_capacity(BACKUP_CODE_CHARS);
    let mut buf = [0u8; BACKUP_CODE_CHARS];
    rng.fill_bytes(&mut buf);
    for b in buf.iter() {
        let idx = (*b as usize) % BACKUP_ALPHABET.len();
        out.push(BACKUP_ALPHABET[idx] as char);
    }
    out
}

/// Format a backup code for display as two five-character groups so humans
/// can read them off paper without losing their place.
fn format_backup_code(code: &str) -> String {
    if code.len() <= 5 {
        code.to_string()
    } else {
        format!("{}-{}", &code[..5], &code[5..])
    }
}

/// Strip the display dash + whitespace and upper-case, so the user can paste
/// the code in the same format we rendered it.
fn normalise_backup_code(raw: &str) -> String {
    raw.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_uppercase())
        .collect()
}

fn hash_backup_code(normalised: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(normalised.as_bytes());
    format!("{:x}", digest)
}

fn internal_error<E: std::fmt::Debug>(msg: &str, e: E) -> (StatusCode, Json<Value>) {
    tracing::error!("{msg}: {e:?}");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": "Internal server error" })),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_code_normalisation_strips_dash_and_whitespace() {
        assert_eq!(normalise_backup_code("ABCDE-FGHIJ"), "ABCDEFGHIJ");
        assert_eq!(normalise_backup_code("abcde fghij"), "ABCDEFGHIJ");
        assert_eq!(normalise_backup_code(" a-b c-d "), "ABCD");
    }

    #[test]
    fn format_backup_code_inserts_dash() {
        assert_eq!(format_backup_code("ABCDEFGHIJ"), "ABCDE-FGHIJ");
        assert_eq!(format_backup_code("SHORT"), "SHORT");
    }

    #[test]
    fn backup_code_hash_is_deterministic() {
        let a = hash_backup_code("ABCDEFGHIJ");
        let b = hash_backup_code("ABCDEFGHIJ");
        assert_eq!(a, b);
        let c = hash_backup_code("ABCDEFGHIK");
        assert_ne!(a, c);
    }

    #[test]
    fn generated_backup_codes_are_unique_over_small_batches() {
        let mut seen = std::collections::HashSet::new();
        for _ in 0..32 {
            assert!(seen.insert(generate_backup_code()));
        }
    }
}
