use std::collections::HashSet;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::{
    extract::{connect_info::ConnectInfo, FromRequestParts},
    http::{header::AUTHORIZATION, request::Parts, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use dashmap::DashMap;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use super::jwt::{decode_access_token, AccessClaims};
use super::resolver::{self, ResolverInput};
use crate::audit::{log_permission_denied, AuditCaller};
use crate::db::models::EffectivePermissions;
use crate::AppState;

/// Pull the client IP off the request parts. The server is bound with
/// `into_make_service_with_connect_info::<SocketAddr>()`, so every request
/// carries a `ConnectInfo<SocketAddr>` in its extensions. Returning an owned
/// string keeps the extractor structs `Clone` without borrowing from Parts.
fn extract_client_ip(parts: &Parts) -> Option<String> {
    parts
        .extensions
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ci| ci.0.ip().to_string())
}

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
// UserActiveCache — short-TTL cache of `users.is_active` keyed by user id
// ============================================================================

/// TTL for cached `is_active` entries. Bounds the window in which a
/// deactivated user's access token can still be accepted after `is_active`
/// flips in the database. 30s matches the CON-137 acceptance ceiling.
pub const USER_ACTIVE_CACHE_TTL: Duration = Duration::from_secs(30);

/// In-memory cache of `(is_active, cached_at)` per user. Keeps the per-request
/// DB hit off the hot path for authenticated endpoints while still closing
/// the "deactivated user keeps API access until their JWT expires" window.
///
/// Trade-off vs. a deactivation-version counter: a plain TTL is simpler and
/// has no write-side coordination cost, but it admits a worst-case
/// `USER_ACTIVE_CACHE_TTL` of continued access post-deactivation. The
/// deactivation endpoint MUST call [`UserActiveCache::invalidate`] on the
/// deactivated user so the happy path is effectively immediate.
#[derive(Clone)]
pub struct UserActiveCache {
    entries: Arc<DashMap<Uuid, (bool, Instant)>>,
    ttl: Duration,
}

impl UserActiveCache {
    pub fn new() -> Self {
        Self {
            entries: Arc::new(DashMap::new()),
            ttl: USER_ACTIVE_CACHE_TTL,
        }
    }

    /// Construct a cache with a custom TTL. Exposed for integration tests
    /// that need a zero-TTL cache to exercise the fall-through path without
    /// `tokio::time::sleep`. Production callers should use [`Self::new`].
    pub fn with_ttl(ttl: Duration) -> Self {
        Self {
            entries: Arc::new(DashMap::new()),
            ttl,
        }
    }

    /// Returns true if the user exists and has `is_active = true`. On DB
    /// error, returns the error so callers can fail closed (middleware
    /// converts it into `AuthError::InternalError`, a 500). A missing user
    /// row is treated as `is_active = false` — a deleted user cannot hold a
    /// valid session.
    pub async fn is_user_active(
        &self,
        db: &PgPool,
        user_id: Uuid,
    ) -> Result<bool, sqlx::Error> {
        if let Some(entry) = self.entries.get(&user_id) {
            let (is_active, cached_at) = *entry;
            if cached_at.elapsed() < self.ttl {
                return Ok(is_active);
            }
        }

        let row: Option<bool> =
            sqlx::query_scalar("SELECT is_active FROM users WHERE id = $1")
                .bind(user_id)
                .fetch_optional(db)
                .await?;

        let is_active = row.unwrap_or(false);
        self.entries.insert(user_id, (is_active, Instant::now()));
        Ok(is_active)
    }

    /// Immediately drop any cached `is_active` value for this user. Call
    /// from the deactivate-user handler so the next request re-reads from
    /// the database instead of waiting out the TTL.
    pub fn invalidate(&self, user_id: Uuid) {
        self.entries.remove(&user_id);
    }

    /// Evict all entries. Useful for tests and administrative refreshes.
    pub fn clear(&self) {
        self.entries.clear();
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.entries.len()
    }
}

impl Default for UserActiveCache {
    fn default() -> Self {
        Self::new()
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
    /// Remote peer IP resolved via `ConnectInfo<SocketAddr>`. `None` only in
    /// test harnesses that don't install connect-info — production paths
    /// always populate it.
    pub client_ip: Option<String>,
}

impl AuthUser {
    /// Build the audit caller for this request. Currently all JWT-authenticated
    /// callers are `AuditActor::User`; API tokens will pick a different variant
    /// when CON-62g lands.
    pub fn caller(&self) -> AuditCaller {
        AuditCaller::user(self.claims.sub, self.client_ip.clone())
    }
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

        // CON-137: reject tokens whose owner has been deactivated. This runs
        // on every authenticated request, but `UserActiveCache` absorbs the
        // hot-path DB hit with a short TTL.
        match app_state
            .user_active_cache
            .is_user_active(&app_state.db, claims.sub)
            .await
        {
            Ok(true) => {}
            Ok(false) => return Err(AuthError::InvalidToken),
            Err(e) => {
                tracing::error!("Failed to check user is_active for {}: {e}", claims.sub);
                return Err(AuthError::InternalError);
            }
        }

        let client_ip = extract_client_ip(parts);

        Ok(AuthUser { claims, client_ip })
    }
}

// ============================================================================
// Shared access-token verifier for non-extractor paths (e.g. WebSocket auth)
// ============================================================================

/// Errors returned by [`verify_access_token_active`]. Callers translate these
/// into whatever transport-specific error shape they need (HTTP, WS frame).
#[derive(Debug)]
pub enum VerifyTokenError {
    InvalidOrExpired,
    UserDeactivated,
    Internal,
}

impl VerifyTokenError {
    pub fn user_message(&self) -> &'static str {
        match self {
            VerifyTokenError::InvalidOrExpired => "Invalid or expired token",
            VerifyTokenError::UserDeactivated => "Invalid or expired token",
            VerifyTokenError::Internal => "Authentication check failed",
        }
    }
}

/// Decode an access token and enforce revocation + `is_active` in one call.
/// Mirrors the [`AuthUser`] extractor so WebSocket auth paths (terminal,
/// tunnel, k8s watch/exec) get identical deactivation semantics. Closes the
/// CON-137 gap where WS handlers called `decode_access_token` directly and
/// missed the deactivation check the HTTP extractor now performs.
pub async fn verify_access_token_active(
    state: &AppState,
    token: &str,
) -> Result<AccessClaims, VerifyTokenError> {
    let claims = decode_access_token(token, &state.config.jwt_secret)
        .map_err(|_| VerifyTokenError::InvalidOrExpired)?;

    if state.revocation_cache.is_revoked(&claims.jti) {
        return Err(VerifyTokenError::InvalidOrExpired);
    }

    match state
        .user_active_cache
        .is_user_active(&state.db, claims.sub)
        .await
    {
        Ok(true) => Ok(claims),
        Ok(false) => Err(VerifyTokenError::UserDeactivated),
        Err(e) => {
            tracing::error!("Failed to check user is_active for {}: {e}", claims.sub);
            Err(VerifyTokenError::Internal)
        }
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
    pub client_ip: Option<String>,
}

impl ProjectScoped {
    pub fn caller(&self) -> AuditCaller {
        AuditCaller::user(self.claims.sub, self.client_ip.clone())
    }
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
            client_ip: auth.client_ip,
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

    /// Resource-scoped permission check that consults `resource_acls` when the
    /// `CONTAINERUS_ENFORCE_ACLS` flag is on. When the flag is off this is
    /// identical to [`ProjectScoped::require`] — the ACL table is not read,
    /// preserving Phase A's "enforcement off by default" rollout.
    ///
    /// CON-80: on a deny we emit an `rbac.permission_denied` audit row tagged
    /// with the resolver's [`DecisionReason`] so incident response can tell
    /// whether the 403 came from a `resource_acls` deny, an env override, or
    /// a plain default-deny. The audit is best-effort (`log_event` swallows
    /// DB errors and traces) — the request still gets the 403 either way.
    pub async fn require_for_resource(
        &self,
        perm: &str,
        resource_type: &str,
        resource_id: Uuid,
        state: &AppState,
    ) -> Result<(), AuthError> {
        let acl_view = if state.config.enforce_acls {
            resolver::load_resource_acl_view(
                &state.db,
                self.claims.sub,
                self.project_id,
                resource_type,
                resource_id,
            )
            .await
            .map_err(|e| {
                // CON-76: malformed ACL rows fail closed as 500, not silently "allow".
                tracing::error!("Failed to load resource ACL: {e}");
                AuthError::InternalError
            })?
        } else {
            None
        };

        let input = ResolverInput {
            is_company_admin: self.permissions.is_company_admin,
            role_permissions: &self.permissions.permissions,
            container_acl: None,
            resource_acl: acl_view.as_ref(),
            env_override: None,
        };

        let resolved = resolver::resolve(&input, perm);
        if resolved.is_allowed() {
            Ok(())
        } else {
            let resource_id_str = resource_id.to_string();
            log_permission_denied(
                &state.db,
                &self.caller(),
                Some(self.project_id),
                None,
                resource_type,
                Some(&resource_id_str),
                perm,
                resolved.reason.as_str(),
            )
            .await;
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
    pub client_ip: Option<String>,
}

impl SystemScoped {
    pub fn caller(&self) -> AuditCaller {
        AuditCaller::user(self.claims.sub, self.client_ip.clone())
    }
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
            client_ip: auth.client_ip,
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

    /// Resource-scoped permission check that reads `resource_acls` for this
    /// specific system when `CONTAINERUS_ENFORCE_ACLS` is on. Falls back to
    /// the plain role-grant check when the flag is off.
    ///
    /// CON-80: on deny we record an `rbac.permission_denied` audit row that
    /// includes the resolver's [`DecisionReason`] (`resource_acl_deny`,
    /// `default`, …) so the audit trail can distinguish an ACL deny from a
    /// missing role grant when triaging a real-world 403.
    pub async fn require_for_system(
        &self,
        perm: &str,
        state: &AppState,
    ) -> Result<(), AuthError> {
        let acl_view = if state.config.enforce_acls {
            resolver::load_resource_acl_view(
                &state.db,
                self.claims.sub,
                self.project_id,
                "system",
                self.system.id,
            )
            .await
            .map_err(|e| {
                tracing::error!("Failed to load resource ACL: {e}");
                AuthError::InternalError
            })?
        } else {
            None
        };

        let input = ResolverInput {
            is_company_admin: self.permissions.is_company_admin,
            role_permissions: &self.permissions.permissions,
            container_acl: None,
            resource_acl: acl_view.as_ref(),
            env_override: None,
        };

        let resolved = resolver::resolve(&input, perm);
        if resolved.is_allowed() {
            Ok(())
        } else {
            let system_id_str = self.system.id.to_string();
            log_permission_denied(
                &state.db,
                &self.caller(),
                Some(self.project_id),
                Some(self.environment_id),
                "system",
                Some(&system_id_str),
                perm,
                resolved.reason.as_str(),
            )
            .await;
            Err(AuthError::InsufficientPermission)
        }
    }

    /// Container-scoped permission check (CON-117). Layers a
    /// `resource_type='container'` ACL on top of the existing system-scoped
    /// check: a container deny wins over a system allow, and a container
    /// allow unblocks the permission even when the role lacks it.
    ///
    /// `container_runtime_id` is the opaque Docker/Podman identifier from the
    /// request path. It is hashed with the parent system id to produce the
    /// deterministic UUID we store in `resource_acls.resource_id`; that way
    /// the same container ID under two different systems never collides, and
    /// creating the ACL row from the UI is just `Uuid::new_v5(system_id,
    /// runtime_id)` on the client side too.
    ///
    /// The deny audit row is stamped with `resource_type` reflecting which
    /// layer produced the deny (`container` when the container layer rejected
    /// it, `system` otherwise) so incident response can distinguish a
    /// container-scoped deny from a system-wide one.
    pub async fn require_for_container(
        &self,
        perm: &str,
        container_runtime_id: &str,
        state: &AppState,
    ) -> Result<(), AuthError> {
        if !state.config.enforce_acls {
            // Flag-off path preserves today's role-only behaviour and skips
            // the DB load entirely — matches `require_for_system`.
            return self.require_for_system(perm, state).await;
        }

        let container_resource_id = container_acl_resource_id(self.system.id, container_runtime_id);

        let container_view = resolver::load_resource_acl_view(
            &state.db,
            self.claims.sub,
            self.project_id,
            "container",
            container_resource_id,
        )
        .await
        .map_err(|e| {
            tracing::error!("Failed to load container ACL: {e}");
            AuthError::InternalError
        })?;

        let system_view = resolver::load_resource_acl_view(
            &state.db,
            self.claims.sub,
            self.project_id,
            "system",
            self.system.id,
        )
        .await
        .map_err(|e| {
            tracing::error!("Failed to load system ACL: {e}");
            AuthError::InternalError
        })?;

        let input = ResolverInput {
            is_company_admin: self.permissions.is_company_admin,
            role_permissions: &self.permissions.permissions,
            container_acl: container_view.as_ref(),
            resource_acl: system_view.as_ref(),
            env_override: None,
        };

        let resolved = resolver::resolve(&input, perm);
        if resolved.is_allowed() {
            Ok(())
        } else {
            // Stamp the audit row with the layer that produced the deny so
            // a container-scoped deny is visibly distinct from a
            // system-scoped or default deny (CON-117 acceptance criterion).
            let (resource_type, resource_id) = match resolved.reason {
                resolver::DecisionReason::ContainerAclDeny
                | resolver::DecisionReason::ContainerAclAllow => {
                    ("container", container_runtime_id.to_owned())
                }
                _ => ("system", self.system.id.to_string()),
            };
            log_permission_denied(
                &state.db,
                &self.caller(),
                Some(self.project_id),
                Some(self.environment_id),
                resource_type,
                Some(&resource_id),
                perm,
                resolved.reason.as_str(),
            )
            .await;
            Err(AuthError::InsufficientPermission)
        }
    }
}

/// Deterministic UUID-v5 derivation for the `resource_acls.resource_id` used
/// by container-scoped ACL rows. Containers aren't a Postgres table, so we
/// can't use a real UUID primary key — we hash `(system_id, runtime_id)` into
/// the dedicated CONTAINER_ACL_NAMESPACE instead. The write path (UI) and the
/// read path (this middleware) must produce byte-identical UUIDs, so callers
/// on both sides MUST go through this helper.
pub fn container_acl_resource_id(system_id: Uuid, container_runtime_id: &str) -> Uuid {
    // v5 namespace dedicated to container ACLs. Generated once; never change
    // this constant without a data migration because it would orphan every
    // existing container ACL row.
    const CONTAINER_ACL_NAMESPACE: Uuid = Uuid::from_u128(0x7f6e5d4c_3b2a_4918_8a7b_6c5d4e3f2a1b);
    // Under a given system, the runtime id alone is unique. Hashing the
    // system id into the namespace first keeps collisions impossible across
    // systems too, even if two runtimes happened to hand out the same id.
    let per_system_ns = Uuid::new_v5(&CONTAINER_ACL_NAMESPACE, system_id.as_bytes());
    Uuid::new_v5(&per_system_ns, container_runtime_id.as_bytes())
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

    #[test]
    fn test_user_active_cache_invalidate_removes_entry() {
        let cache = UserActiveCache::new();
        let user_id = Uuid::new_v4();
        // Seed the cache directly so we don't need a live DB.
        cache.entries.insert(user_id, (true, Instant::now()));
        assert_eq!(cache.len(), 1);

        cache.invalidate(user_id);
        assert_eq!(cache.len(), 0);
    }

    #[test]
    fn test_user_active_cache_entry_expires_after_ttl() {
        // Use a 0ms TTL so every lookup treats the cached row as stale.
        let cache = UserActiveCache::with_ttl(Duration::from_millis(0));
        let user_id = Uuid::new_v4();
        cache.entries.insert(user_id, (true, Instant::now()));

        let cached = cache
            .entries
            .get(&user_id)
            .map(|e| e.1.elapsed() >= cache.ttl)
            .unwrap_or(false);
        assert!(
            cached,
            "cached_at elapsed must exceed the zero TTL so the next read falls through to DB"
        );
    }

    #[test]
    fn test_user_active_cache_clear_removes_all_entries() {
        let cache = UserActiveCache::new();
        cache.entries.insert(Uuid::new_v4(), (true, Instant::now()));
        cache.entries.insert(Uuid::new_v4(), (false, Instant::now()));
        assert_eq!(cache.len(), 2);

        cache.clear();
        assert_eq!(cache.len(), 0);
    }
}
