pub mod terminal;
pub mod tunnel;

use axum::Router;
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .nest("/api/ws", terminal::router())
        .nest("/api/ws", tunnel::router())
}
