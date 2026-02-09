pub mod acls;
pub mod audit;
pub mod auth;
pub mod clusters;
pub mod company;
pub mod containers;
pub mod environments;
pub mod files;
pub mod health;
pub mod projects;
pub mod roles;
pub mod systems;

use axum::Router;
use crate::AppState;

/// Build the full API router.
pub fn router() -> Router<AppState> {
    Router::new()
        .nest("/api/health", health::router())
        .nest("/api/auth", auth::router())
        .nest("/api/projects", projects::router())
        // Environment-scoped list/create routes
        .nest("/api/projects/{project_id}/environments", environments::router())
        .nest("/api/projects/{project_id}/environments/{environment_id}/systems", systems::environment_router())
        .nest("/api/projects/{project_id}/environments/{environment_id}/clusters", clusters::environment_router())
        // Single-resource operations (access resolved via system/cluster -> env -> project chain)
        .nest("/api/systems", systems::router())
        .nest("/api/systems", containers::router())
        .nest("/api/systems", files::router())
        .nest("/api/clusters", clusters::router())
        // Project-scoped routes
        .nest("/api/projects/{project_id}/audit", audit::router())
        .nest("/api/projects/{project_id}/acls", acls::router())
        // Global routes
        .nest("/api/roles", roles::router())
        .nest("/api/permissions", roles::permissions_router())
        .nest("/api/company", company::router())
}
