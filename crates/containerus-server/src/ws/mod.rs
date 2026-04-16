pub mod k8s_exec;
pub mod k8s_watch;
pub mod security;
pub mod terminal;
pub mod tunnel;

use axum::Router;
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .nest("/api/ws", terminal::router())
        .nest("/api/ws", tunnel::router())
        .nest("/api/ws", k8s_exec::router())
        .nest("/api/ws", k8s_watch::router())
}
