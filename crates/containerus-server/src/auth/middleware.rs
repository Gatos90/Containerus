use std::collections::HashSet;
use std::sync::Arc;

use axum::{
    extract::FromRequestParts,
    http::{header::AUTHORIZATION, request::Parts, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use dashmap::DashMap;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use super::jwt::{decode_access_token, AccessClaims};
use crate::db::models::EffectivePermissions;
use crate::AppState;

// ============================================================================
// TokenRevocationCache — in-memory revocation list for access tokens
// ============================================================================

/// In-memory revocation list mapping jti -> expiry Unix timestamp.
/// On logout the token's jti is inserted here; the middleware rejects revoked tokens.
/// Expired entries are pruned on each insertion to prevent unbounded growth.
#[derive(Clone)]
pub struct TokenRevocationCache {
    revoked: Arc<DashMap<Uuid, i64>>,
}

impl TokenRevocationCache {
    pub fn new() -> Self {
        Self { revoked: Arc::new(DashMap::new()) }
    }

    /// Mark a token as revoked until `exp` (Unix timestamp).
    pub fn revoke(&self, jti: Uuid, exp: i64) {
        self.prune_expired();
        self.revoked.insert(jti, exp);
    }

    /// Returns true if the given jti has been explicitly revoked.
    pub fn is_revoked(&self, jti: &Uuid) -> bool {
        self.revoked.contains_key(jti)
    }

    /// Remove entries whose expiry has already passed (they can no longer be used anyway).
    fn prune_expired(&self) {
        let now = chrono::Utc::now().timestamp();
        self.revoked.retain(|_, &mut exp| exp > now);
    }
}

// ============================================================================
// Permission Cache (in-memory, loaded at startup, invalidated on role changes)
// ============================================================================

/// In-memory cache mapping role_id -> set of permission keys.
/// Avoids a DB query on every authenticated request.
#[derive(Clone)]
pub struct PermissionCache {
    cache: Arc<DashMap<Uuid, HashSet<String>>>,
}

impl PermissionCache {
    /// Load all role->permission mappings from the database.
    pub async fn load_from_db(db: &PgPool) -> Result<Self, sqlx::Error> {
        let cache = Arc::new(DashMap::new());

        let rows: Vec<(Uuid, String)> = sqlx::query_as(
            r#"
            SELECT rp.role_id, p.key
            FROM role_permissions rp
            JOIN permissions p ON p.id = rp.permission_id
            "#,
        )
        .fetch_all(db)
        .await?;

        for (role_id, key) in rows {
            cache.entry(role_id).or_insert_with(HashSet::new).insert(key);
        }

        Ok(Self { cache })
    }

    /// Get the permission set for a given role.
    pub fn get_permissions(&self, role_id: &Uuid) -> HashSet<String> {
        self.cache
            .get(role_id)
            .map(|set| set.clone())
            .unwrap_or_default()
    }

    /// Invalidate and reload a single role's permissions from the database.
    pub async fn invalidate_role(&self, db: &PgPool, role_id: Uuid) -> Result<(), sqlx::Error> {
        let keys: Vec<String> = sqlx::query_scalar(
            r#"
            SELECT p.key
            FROM role_permissions rp
            JOIN permissions p ON p.id = rp.permission_id
            WHERE rp.role_id = $1
            "#,
        )
        .bind(role_id)
        .fetch_all(db)
        .await?;

        self.cache.insert(role_id, keys.into_iter().collect());
        Ok(())
    }

    /// Reload all role mappings from the database.
    pub async fn reload_all(&self, db: &PgPool) -> Result<(), sqlx::Error> {
        let rows: Vec<(Uuid, String)> = sqlx::query_as(
            r#"
            SELECT rp.role_id, p.key
            FROM role_permissions rp
            JOIN permissions p ON p.id = rp.permission_id
            "#,
        )
        .fetch_all(db)
        .await?;

        // Build a complete new map and swap atomically.
        let new_cache: DashMap<Uuid, HashSet<String>> = DashMap::new();
        for (role_id, key) in rows {
            new_cache.entry(role_id).or_insert_with(HashSet::new).insert(key);
        }

        // Clear the old cache and populate from the new map in one pass.
        self.cache.clear();
        for entry in new_cache.into_iter() {
            self.cache.insert(entry.0, entry.1);
        }

        Ok(())
    }
}

// ============================================================================
// AuthUser — basic JWT validation (no permission checks)
// ============================================================================

/// Extractor that validates the JWT and provides the authenticated user's claims.
/// Usage: `async fn handler(auth: AuthUser) -> impl IntoResponse { ... }`
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub claims: AccessClaims,
}

impl<S> FromRequestParts<S> for AuthUser
where
    AppState: axum::extract::FromRef<S>,
    S: Send + Sync,
{
    type Rejection = AuthError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let app_state = <AppState as axum::extract::FromRef<S>>::from_ref(state);

        let header = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or(AuthError::MissingToken)?;

        let token = if header.len() >= 7 && header[..7].eq_ignore_ascii_case("bearer ") {
            &header[7..]
        } else {
            return Err(AuthError::InvalidToken);
        };

        let claims = decode_access_token(token, &app_state.config.jwt_secret)
            .map_err(|_| AuthError::InvalidToken)?;

        if app_state.revocation_cache.is_revoked(&claims.jti) {
            return Err(AuthError::InvalidToken);
        }

        Ok(AuthUser { claims })
    }
}

// ============================================================================
// ProjectScoped — JWT + project from URL path + permissions resolved
// ============================================================================

/// Extractor that validates the JWT AND resolves the user's effective permissions
/// for a project specified in the URL path (e.g. `/api/projects/{project_id}/...`).
/// Replaces the old `AuthenticatedUser` which required a single project in the JWT.
#[derive(Debug, Clone)]
pub struct ProjectScoped {
    pub claims: AccessClaims,
    pub project_id: Uuid,
    pub permissions: EffectivePermissions,
}

impl<S> FromRequestParts<S> for ProjectScoped
where
    AppState: axum::extract::FromRef<S>,
    S: Send + Sync,
{
    type Rejection = AuthError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let app_state = <AppState as axum::extract::FromRef<S>>::from_ref(state);
        let auth = AuthUser::from_request_parts(parts, state).await?;

        // Extract project_id from URL path parameters.
        // Uses the public Path extractor (not RawPathParams) so that captures
        // from .nest() prefixes are included (Axum 0.8 behaviour).
        let params = axum::extract::Path::<std::collections::HashMap<String, String>>::from_request_parts(parts, state)
            .await
            .map_err(|_| AuthError::NoProjectSelected)?;
        let project_id = params.0.get("project_id")
            .and_then(|v| v.parse::<Uuid>().ok())
            .ok_or(AuthError::NoProjectSelected)?;

        let is_company_admin = auth.claims.is_company_admin;

        // Find the user's role for this project from the JWT memberships
        let role_id = auth.claims.role_for_project(&project_id);

        let permission_set = if let Some(role_id) = role_id {
            app_state.permission_cache.get_permissions(&role_id)
        } else if is_company_admin {
            HashSet::new()
        } else {
            return Err(AuthError::NotProjectMember);
        };

        let permissions = EffectivePermissions {
            permissions: permission_set,
            is_company_admin,
        };

        Ok(ProjectScoped {
            claims: auth.claims,
            project_id,
            permissions,
        })
    }
}

impl ProjectScoped {
    /// Check if the user has a specific permission. Returns an error response if not.
    pub fn require(&self, perm: &str) -> Result<(), AuthError> {
        if self.permissions.has(perm) {
            Ok(())
        } else {
            Err(AuthError::InsufficientPermission)
        }
    }

    /// Check if the user has any of the given permissions. Returns an error response if not.
    pub fn require_any(&self, perms: &[&str]) -> Result<(), AuthError> {
        if self.permissions.has_any(perms) {
            Ok(())
        } else {
            Err(AuthError::InsufficientPermission)
        }
    }
}

// ============================================================================
// SystemScoped — resolve system_id → environment → project → permissions
// ============================================================================

/// Extractor for system-level endpoints (`/api/systems/{id}/...`).
/// Resolves the system → environment → project chain and checks permissions.
#[derive(Debug, Clone)]
pub struct SystemScoped {
    pub claims: AccessClaims,
    pub system: crate::db::models::SystemRow,
    pub project_id: Uuid,
    pub environment_id: Uuid,
    pub permissions: EffectivePermissions,
}

impl<S> FromRequestParts<S> for SystemScoped
where
    AppState: axum::extract::FromRef<S>,
    S: Send + Sync,
{
    type Rejection = AuthError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let app_state = <AppState as axum::extract::FromRef<S>>::from_ref(state);
        let auth = AuthUser::from_request_parts(parts, state).await?;

        // Extract system id from URL path — try both "id" and "system_id".
        // Uses the public Path extractor (not RawPathParams) so that captures
        // from .nest() prefixes are included (Axum 0.8 behaviour).
        let params = axum::extract::Path::<std::collections::HashMap<String, String>>::from_request_parts(parts, state)
            .await
            .map_err(|_| AuthError::ResourceNotFound)?;
        let system_id = params.0.get("id")
            .or_else(|| params.0.get("system_id"))
            .and_then(|v| v.parse::<Uuid>().ok())
            .ok_or(AuthError::ResourceNotFound)?;

        // Look up system → environment → project
        let system = sqlx::query_as::<_, crate::db::models::SystemRow>(
            "SELECT * FROM systems WHERE id = $1",
        )
        .bind(system_id)
        .fetch_optional(&app_state.db)
        .await
        .map_err(|e| {
            tracing::error!("Database error: {}", e);
            AuthError::InternalError
        })?
        .ok_or(AuthError::ResourceNotFound)?;

        let environment = sqlx::query_as::<_, crate::db::models::Environment>(
            "SELECT * FROM environments WHERE id = $1",
        )
        .bind(system.environment_id)
        .fetch_optional(&app_state.db)
        .await
        .map_err(|e| {
            tracing::error!("Database error: {}", e);
            AuthError::InternalError
        })?
        .ok_or(AuthError::ResourceNotFound)?;

        let project_id = environment.project_id;
        let environment_id = environment.id;
        let is_company_admin = auth.claims.is_company_admin;

        let role_id = auth.claims.role_for_project(&project_id);

        let permission_set = if let Some(role_id) = role_id {
            app_state.permission_cache.get_permissions(&role_id)
        } else if is_company_admin {
            HashSet::new()
        } else {
            return Err(AuthError::NotProjectMember);
        };

        let permissions = EffectivePermissions {
            permissions: permission_set,
            is_company_admin,
        };

        Ok(SystemScoped {
            claims: auth.claims,
            system,
            project_id,
            environment_id,
            permissions,
        })
    }
}

impl SystemScoped {
    pub fn require(&self, perm: &str) -> Result<(), AuthError> {
        if self.permissions.has(perm) {
            Ok(())
        } else {
            Err(AuthError::InsufficientPermission)
        }
    }

    pub fn require_any(&self, perms: &[&str]) -> Result<(), AuthError> {
        if self.permissions.has_any(perms) {
            Ok(())
        } else {
            Err(AuthError::InsufficientPermission)
        }
    }
}

// ============================================================================
// Auth Errors
// ============================================================================

#[derive(Debug)]
pub enum AuthError {
    MissingToken,
    InvalidToken,
    NoProjectSelected,
    NotProjectMember,
    InsufficientPermission,
    ResourceNotFound,
    InternalError,
}

impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            AuthError::MissingToken => (StatusCode::UNAUTHORIZED, "Missing authorization token"),
            AuthError::InvalidToken => (StatusCode::UNAUTHORIZED, "Invalid or expired token"),
            AuthError::NoProjectSelected => (StatusCode::BAD_REQUEST, "No project_id in URL path"),
            AuthError::NotProjectMember => (StatusCode::FORBIDDEN, "Not a member of this project"),
            AuthError::InsufficientPermission => (StatusCode::FORBIDDEN, "Insufficient permissions"),
            AuthError::ResourceNotFound => (StatusCode::NOT_FOUND, "Resource not found"),
            AuthError::InternalError => (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error"),
        };

        (status, Json(json!({ "error": message }))).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_revocation_cache_revoke_and_check() {
        let cache = TokenRevocationCache::new();
        let jti = Uuid::new_v4();
        let future_exp = chrono::Utc::now().timestamp() + 3600;

        assert!(!cache.is_revoked(&jti));
        cache.revoke(jti, future_exp);
        assert!(cache.is_revoked(&jti));
    }

    #[test]
    fn test_revocation_cache_does_not_affect_other_tokens() {
        let cache = TokenRevocationCache::new();
        let jti_a = Uuid::new_v4();
        let jti_b = Uuid::new_v4();
        let future_exp = chrono::Utc::now().timestamp() + 3600;

        cache.revoke(jti_a, future_exp);
        assert!(cache.is_revoked(&jti_a));
        assert!(!cache.is_revoked(&jti_b));
    }

    #[test]
    fn test_revocation_cache_prunes_expired_on_insert() {
        let cache = TokenRevocationCache::new();
        let old_jti = Uuid::new_v4();
        let new_jti = Uuid::new_v4();

        // Insert with already-expired timestamp so it gets pruned on the next insert
        let past_exp = chrono::Utc::now().timestamp() - 10;
        cache.revoked.insert(old_jti, past_exp);
        assert_eq!(cache.revoked.len(), 1);

        // Inserting a new entry triggers prune
        cache.revoke(new_jti, chrono::Utc::now().timestamp() + 3600);

        // Expired entry must be gone; new entry must remain
        assert!(!cache.revoked.contains_key(&old_jti));
        assert!(cache.revoked.contains_key(&new_jti));
    }
}
