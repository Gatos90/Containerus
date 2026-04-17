use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse,
    },
    routing::get,
    Json, Router,
};
use futures_util::{io::AsyncBufReadExt, StreamExt};
use k8s_openapi::api::core::v1::Pod;
use kube::api::{Api, LogParams};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::auth::middleware::AuthUser;
use crate::AppState;

use super::common::{get_kube_client, get_verified_cluster, verify_cluster_access, ApiError};

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/{id}/namespaces/{ns}/pods/{pod}/logs",
            get(get_pod_logs),
        )
        .route(
            "/{id}/namespaces/{ns}/pods/{pod}/logs/stream",
            get(stream_pod_logs),
        )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogQuery {
    pub container: Option<String>,
    pub tail_lines: Option<i64>,
    pub since_seconds: Option<i64>,
    pub previous: Option<bool>,
    pub timestamps: Option<bool>,
}

// ============================================================================
// Snapshot logs
// ============================================================================

async fn get_pod_logs(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((id, ns, pod)): Path<(Uuid, String, String)>,
    Query(params): Query<LogQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let cluster = get_verified_cluster(&state, id).await?;
    verify_cluster_access(&state, &auth.claims, &cluster, "clusters.view").await?;

    let client = get_kube_client(&state, &cluster).await?;
    let pods: Api<Pod> = Api::namespaced(client, &ns);

    let mut lp = LogParams {
        tail_lines: Some(params.tail_lines.unwrap_or(500)),
        previous: params.previous.unwrap_or(false),
        timestamps: params.timestamps.unwrap_or(false),
        ..Default::default()
    };

    if let Some(ref container) = params.container {
        lp.container = Some(container.clone());
    }
    if let Some(since) = params.since_seconds {
        lp.since_seconds = Some(since);
    }

    let logs = pods.logs(&pod, &lp).await.map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": format!("Failed to fetch logs: {e}")})),
        )
    })?;

    Ok(Json(json!({
        "logs": logs,
        "container": params.container,
    })))
}

// ============================================================================
// Streaming logs (SSE)
// ============================================================================

async fn stream_pod_logs(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((id, ns, pod)): Path<(Uuid, String, String)>,
    Query(params): Query<LogQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let cluster = get_verified_cluster(&state, id).await?;
    verify_cluster_access(&state, &auth.claims, &cluster, "clusters.logs.stream").await?;

    let client = get_kube_client(&state, &cluster).await?;
    let pods: Api<Pod> = Api::namespaced(client, &ns);

    let mut lp = LogParams {
        follow: true,
        tail_lines: Some(params.tail_lines.unwrap_or(100)),
        previous: params.previous.unwrap_or(false),
        timestamps: params.timestamps.unwrap_or(false),
        ..Default::default()
    };

    if let Some(ref container) = params.container {
        lp.container = Some(container.clone());
    }
    if let Some(since) = params.since_seconds {
        lp.since_seconds = Some(since);
    }

    let log_reader = pods.log_stream(&pod, &lp).await.map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": format!("Failed to start log stream: {e}")})),
        )
    })?;

    // Convert AsyncBufRead into a Stream of SSE events via lines()
    let lines_stream = log_reader.lines();
    let event_stream = lines_stream.map(|line_result| match line_result {
        Ok(line) => Ok(Event::default().data(line)),
        Err(e) => {
            tracing::warn!("Log stream error: {e}");
            Err(axum::Error::new(e))
        }
    });

    Ok(Sse::new(event_stream).keep_alive(KeepAlive::default()))
}
