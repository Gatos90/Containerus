use std::time::Duration;

use axum::{extract::State, http::StatusCode, routing::get, Json, Router};
use serde_json::{json, Value};

use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(health_check))
}

async fn health_check(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    // Verify database connectivity with a timeout to fail fast
    let db_ok = tokio::time::timeout(
        Duration::from_secs(3),
        sqlx::query("SELECT 1").fetch_one(&state.db),
    )
    .await
    .map(|r| r.is_ok())
    .unwrap_or(false);

    let status_code = if db_ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    (status_code, Json(json!({
        "status": if db_ok { "healthy" } else { "degraded" },
        "version": env!("CARGO_PKG_VERSION"),
        "database": if db_ok { "connected" } else { "disconnected" },
    })))
}
