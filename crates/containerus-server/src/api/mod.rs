pub mod acls;
pub mod admin_users;
pub mod audit;
pub mod auth;
pub mod clusters;
pub mod company;
pub mod container_metrics;
pub mod containers;
pub mod environments;
pub mod files;
pub mod health;
pub mod mfa;
pub mod password;
pub mod projects;
pub mod roles;
pub mod sessions;
pub mod systems;

use axum::body::Body;
use axum::extract::Request;
use axum::http::StatusCode;
use axum::middleware::{self, Next};
use axum::response::IntoResponse;
use axum::{Json, Router};
use serde_json::json;
use crate::rate_limit::{client_ip, RateLimiter};
use crate::AppState;

/// Build the full API router.
///
/// `auth_limiter` is applied only to the `/api/auth` sub-router so that
/// login/register attempts are rate-limited per client IP.
pub fn router(auth_limiter: RateLimiter) -> Router<AppState> {
    // Apply rate limiting only to auth endpoints (login, register, refresh).
    let auth = auth::router().layer(middleware::from_fn(move |req: Request<Body>, next: Next| {
        let limiter = auth_limiter.clone();
        async move {
            let ip = client_ip(&req);
            if !limiter.check(ip) {
                return (
                    StatusCode::TOO_MANY_REQUESTS,
                    Json(json!({"error": "Too many requests — please wait before trying again"})),
                )
                    .into_response();
            }
            next.run(req).await
        }
    }));

    Router::new()
        .nest("/api/health", health::router())
        .nest("/api/auth", auth)
        .nest("/api/projects", projects::router())
        // Environment-scoped list/create routes
        .nest("/api/projects/{project_id}/environments", environments::router())
        .nest("/api/projects/{project_id}/environments/{environment_id}/systems", systems::environment_router())
        .nest("/api/projects/{project_id}/environments/{environment_id}/clusters", clusters::environment_router())
        // Single-resource operations (access resolved via system/cluster -> env -> project chain)
        .nest("/api/systems", systems::router())
        .nest("/api/systems", containers::router())
        .nest("/api/systems", container_metrics::router())
        .nest("/api/systems", files::router())
        .nest("/api/clusters", clusters::router())
        // Project-scoped routes
        .nest("/api/projects/{project_id}/audit", audit::router())
        .nest("/api/projects/{project_id}/acls", acls::router())
        // Global routes
        .nest("/api/roles", roles::router())
        .nest("/api/permissions", roles::permissions_router())
        .nest("/api/company", company::router())
        // Per-user session management (authed; no rate-limit wrapper)
        .nest("/api/users/me/sessions", sessions::router())
        // Admin-only user management (CON-119: deactivate/reactivate)
        .nest("/api/admin/users", admin_users::router())
}
