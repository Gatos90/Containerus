use axum::{extract::State, http::StatusCode, routing::post, Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::auth::{jwt, password};
use crate::auth::jwt::ProjectMembership;
use crate::auth::middleware::AuthUser;
use crate::db::models::UserResponse;
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/register", post(register))
        .route("/login", post(login))
        .route("/refresh", post(refresh))
        .route("/me", axum::routing::get(me))
}

// ============================================================================
// Request / Response types
// ============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterRequest {
    pub email: String,
    pub password: String,
    pub display_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshRequest {
    pub refresh_token: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub user: UserResponse,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeResponse {
    #[serde(flatten)]
    pub user: UserResponse,
    pub is_company_admin: bool,
    pub permissions: Vec<String>,
}

// ============================================================================
// Handlers
// ============================================================================

/// Register a new user with email + password.
/// If this is the first user, creates the company row and makes them company admin.
async fn register(
    State(state): State<AppState>,
    Json(req): Json<RegisterRequest>,
) -> Result<(StatusCode, Json<AuthResponse>), (StatusCode, Json<Value>)> {
    // Validate input
    let email = req.email.trim().to_lowercase();
    if email.is_empty() || !email.contains('@') {
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid email address" }))));
    }
    if req.password.len() < 8 {
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "Password must be at least 8 characters" }))));
    }
    if req.display_name.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "Display name is required" }))));
    }

    // Hash password
    let password_hash = password::hash_password(&req.password)
        .map_err(|e| {
            tracing::error!("Password hashing failed: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
        })?;

    let user_id = Uuid::new_v4();

    let mut tx = state.db.begin().await
        .map_err(|e| {
            tracing::error!("Failed to start transaction: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
        })?;

    // Serialize first-user setup to prevent concurrent registrations
    // from both becoming company admins. Auto-releases on commit/rollback.
    sqlx::query("SELECT pg_advisory_xact_lock(1)")
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Failed to acquire advisory lock: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
        })?;

    // Check if this is the first user (determines company admin status)
    let user_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Failed to count users: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
        })?;
    let is_first_user = user_count == 0;

    // Create user
    if let Err(e) = sqlx::query(
        "INSERT INTO users (id, email, password_hash, display_name, auth_provider) VALUES ($1, $2, $3, $4, 'local')"
    )
        .bind(user_id)
        .bind(&email)
        .bind(&password_hash)
        .bind(req.display_name.trim())
        .execute(&mut *tx)
        .await
    {
        if let Some(db_err) = e.as_database_error() {
            if db_err.is_unique_violation() {
                return Err((StatusCode::CONFLICT, Json(json!({ "error": "Email already registered" }))));
            }
        }
        tracing::error!("Failed to create user: {e}");
        return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" }))));
    }

    // If first user, create company row and make them company admin
    if is_first_user {
        sqlx::query("INSERT INTO company (name, slug) VALUES ('My Company', 'default') ON CONFLICT DO NOTHING")
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                tracing::error!("Failed to create company: {e}");
                (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
            })?;

        sqlx::query("INSERT INTO company_admins (user_id) VALUES ($1) ON CONFLICT DO NOTHING")
            .bind(user_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                tracing::error!("Failed to add company admin: {e}");
                (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
            })?;
    }

    // Generate tokens (no project memberships yet — user creates projects explicitly)
    let access_token = jwt::create_access_token(
        user_id,
        &email,
        vec![],
        is_first_user,
        &state.config.jwt_secret,
        state.config.jwt_access_expiry_secs,
    )
    .map_err(|e| {
        tracing::error!("Token creation failed: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?;

    let (refresh_token, refresh_jti) = jwt::create_refresh_token(
        user_id,
        &state.config.jwt_secret,
        state.config.jwt_refresh_expiry_secs,
    )
    .map_err(|e| {
        tracing::error!("Refresh token creation failed: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?;

    // Store refresh token hash within the same transaction for atomicity
    let token_hash = hash_token_jti(refresh_jti);
    let expires_at = chrono::Utc::now()
        + chrono::Duration::seconds(state.config.jwt_refresh_expiry_secs);
    sqlx::query("INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)")
        .bind(user_id)
        .bind(&token_hash)
        .bind(expires_at)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Refresh token insert failed: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
        })?;

    // Fetch the created user from DB within the transaction
    let user = sqlx::query_as::<_, crate::db::models::UserRow>(
        "SELECT * FROM users WHERE id = $1"
    )
        .bind(user_id)
        .fetch_one(&mut *tx)
        .await
        .map(UserResponse::from)
        .map_err(|e| {
            tracing::error!("Failed to fetch created user: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
        })?;

    tx.commit().await
        .map_err(|e| {
            tracing::error!("Failed to commit transaction: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
        })?;

    Ok((StatusCode::CREATED, Json(AuthResponse {
        access_token,
        refresh_token,
        user,
    })))
}

/// Login with email + password.
async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, (StatusCode, Json<Value>)> {
    // Dummy hash for constant-time response when user is not found (prevents timing-based enumeration)
    const DUMMY_HASH: &str = "$argon2id$v=19$m=19456,t=2,p=1$dW5rbm93bnNhbHQ$dW5rbm93bmhhc2g";

    // Find user by email
    let email = req.email.trim().to_lowercase();
    let row = sqlx::query_as::<_, crate::db::models::UserRow>(
        "SELECT * FROM users WHERE email = $1"
    )
        .bind(&email)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("User lookup failed: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
        })?;

    let Some(row) = row else {
        // Perform dummy verification to prevent timing attacks
        let _ = password::verify_password(&req.password, DUMMY_HASH);
        return Err((StatusCode::UNAUTHORIZED, Json(json!({ "error": "Invalid email or password" }))));
    };

    // Check account is active (use generic error to prevent user enumeration)
    if !row.is_active {
        let _ = password::verify_password(&req.password, DUMMY_HASH);
        return Err((StatusCode::UNAUTHORIZED, Json(json!({ "error": "Invalid email or password" }))));
    }

    // Verify password (only for local auth — use generic error to prevent user enumeration)
    let password_hash = row.password_hash.as_deref()
        .ok_or_else(|| {
            let _ = password::verify_password(&req.password, DUMMY_HASH);
            (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Invalid email or password" })))
        })?;

    let valid = password::verify_password(&req.password, password_hash)
        .map_err(|e| {
            tracing::error!("Password verification failed: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
        })?;

    if !valid {
        return Err((StatusCode::UNAUTHORIZED, Json(json!({ "error": "Invalid email or password" }))));
    }

    // Check if user is a company admin
    let is_company_admin = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM company_admins WHERE user_id = $1)"
    )
        .bind(row.id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Company admin check failed: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
        })?;

    // Get ALL user's project memberships
    let memberships: Vec<ProjectMembership> = sqlx::query_as::<_, crate::db::models::ProjectMemberRow>(
        "SELECT * FROM project_members WHERE user_id = $1"
    )
        .bind(row.id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Membership fetch failed: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
        })?
        .into_iter()
        .map(|m| ProjectMembership { project_id: m.project_id, role_id: m.role_id })
        .collect();

    // Generate tokens
    let access_token = jwt::create_access_token(
        row.id,
        &row.email,
        memberships,
        is_company_admin,
        &state.config.jwt_secret,
        state.config.jwt_access_expiry_secs,
    )
    .map_err(|e| {
        tracing::error!("Token creation failed: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?;

    let (refresh_token, refresh_jti) = jwt::create_refresh_token(
        row.id,
        &state.config.jwt_secret,
        state.config.jwt_refresh_expiry_secs,
    )
    .map_err(|e| {
        tracing::error!("Refresh token creation failed: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?;

    // Store refresh token in a transaction for atomicity
    let mut tx = state.db.begin().await
        .map_err(|e| {
            tracing::error!("Failed to start transaction: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
        })?;

    let token_hash = hash_token_jti(refresh_jti);
    let expires_at = chrono::Utc::now()
        + chrono::Duration::seconds(state.config.jwt_refresh_expiry_secs);
    sqlx::query("INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)")
        .bind(row.id)
        .bind(&token_hash)
        .bind(expires_at)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Refresh token insert failed: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
        })?;

    tx.commit().await
        .map_err(|e| {
            tracing::error!("Failed to commit transaction: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
        })?;

    Ok(Json(AuthResponse {
        access_token,
        refresh_token,
        user: UserResponse::from(row),
    }))
}

/// Refresh an access token using a refresh token.
async fn refresh(
    State(state): State<AppState>,
    Json(req): Json<RefreshRequest>,
) -> Result<Json<AuthResponse>, (StatusCode, Json<Value>)> {
    // Decode refresh token
    let claims = jwt::decode_refresh_token(&req.refresh_token, &state.config.jwt_secret)
        .map_err(|_| (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Invalid or expired refresh token" }))))?;

    // Atomically consume the old refresh token and issue a new one in a transaction
    let token_hash = hash_token_jti(claims.jti);

    let mut tx = state.db.begin().await
        .map_err(|e| {
            tracing::error!("Failed to start transaction for token refresh: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
        })?;

    let result = sqlx::query(
        "DELETE FROM refresh_tokens WHERE user_id = $1 AND token_hash = $2 AND expires_at > now()"
    )
        .bind(claims.sub)
        .bind(&token_hash)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Database error during token refresh: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
        })?;

    if result.rows_affected() == 0 {
        return Err((StatusCode::UNAUTHORIZED, Json(json!({ "error": "Refresh token revoked or expired" }))));
    }

    // Fetch user (within the same transaction)
    let row = sqlx::query_as::<_, crate::db::models::UserRow>(
        "SELECT * FROM users WHERE id = $1 AND is_active = true"
    )
        .bind(claims.sub)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("User lookup during refresh failed: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
        })?
        .ok_or_else(|| (StatusCode::UNAUTHORIZED, Json(json!({ "error": "User not found or disabled" }))))?;

    // Check company admin status
    let is_company_admin = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM company_admins WHERE user_id = $1)"
    )
        .bind(row.id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Company admin check during refresh failed: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
        })?;

    // Get ALL user's project memberships
    let memberships: Vec<ProjectMembership> = sqlx::query_as::<_, crate::db::models::ProjectMemberRow>(
        "SELECT * FROM project_members WHERE user_id = $1"
    )
        .bind(row.id)
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Membership fetch during refresh failed: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
        })?
        .into_iter()
        .map(|m| ProjectMembership { project_id: m.project_id, role_id: m.role_id })
        .collect();

    // Issue new tokens
    let access_token = jwt::create_access_token(
        row.id,
        &row.email,
        memberships,
        is_company_admin,
        &state.config.jwt_secret,
        state.config.jwt_access_expiry_secs,
    )
    .map_err(|e| {
        tracing::error!("Token creation during refresh failed: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?;

    let (new_refresh_token, new_jti) = jwt::create_refresh_token(
        row.id,
        &state.config.jwt_secret,
        state.config.jwt_refresh_expiry_secs,
    )
    .map_err(|e| {
        tracing::error!("Refresh token creation during refresh failed: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?;

    // Store new refresh token within the same transaction
    let new_hash = hash_token_jti(new_jti);
    let expires_at = chrono::Utc::now()
        + chrono::Duration::seconds(state.config.jwt_refresh_expiry_secs);
    sqlx::query("INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)")
        .bind(row.id)
        .bind(&new_hash)
        .bind(expires_at)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Refresh token insert during refresh failed: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
        })?;

    tx.commit().await
        .map_err(|e| {
            tracing::error!("Failed to commit token refresh transaction: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
        })?;

    Ok(Json(AuthResponse {
        access_token,
        refresh_token: new_refresh_token,
        user: UserResponse::from(row),
    }))
}

/// Get the current authenticated user's info, including permissions across all project memberships.
async fn me(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<MeResponse>, (StatusCode, Json<Value>)> {
    let row = sqlx::query_as::<_, crate::db::models::UserRow>(
        "SELECT * FROM users WHERE id = $1 AND is_active = true"
    )
        .bind(auth.claims.sub)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Database error: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
        })?
        .ok_or_else(|| (StatusCode::UNAUTHORIZED, Json(json!({ "error": "User not found" }))))?;

    let is_company_admin = auth.claims.is_company_admin;

    // Resolve permissions across all project memberships
    let permissions: Vec<String> = {
        let mut all_perms = std::collections::HashSet::new();
        for m in &auth.claims.memberships {
            all_perms.extend(state.permission_cache.get_permissions(&m.role_id));
        }
        let mut perms: Vec<String> = all_perms.into_iter().collect();
        perms.sort();
        perms
    };

    Ok(Json(MeResponse {
        user: UserResponse::from(row),
        is_company_admin,
        permissions,
    }))
}

/// Deterministic hash for refresh token JTIs (for storage/lookup).
fn hash_token_jti(id: Uuid) -> String {
    use sha2::{Sha256, Digest};
    let digest = Sha256::digest(id.as_bytes());
    format!("{:x}", digest)
}
