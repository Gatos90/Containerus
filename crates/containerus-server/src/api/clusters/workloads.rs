use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use k8s_openapi::api::apps::v1::{DaemonSet, Deployment, StatefulSet};
use kube::api::{Api, Patch, PatchParams};
use serde_json::json;
use uuid::Uuid;

use crate::auth::middleware::AuthUser;
use crate::AppState;

use super::common::{get_kube_client, get_verified_cluster, verify_cluster_access, ScaleRequest};

pub fn router() -> Router<AppState> {
    Router::new()
        // Deployments
        .route(
            "/{id}/namespaces/{ns}/deployments/{name}/scale",
            post(scale_deployment),
        )
        .route(
            "/{id}/namespaces/{ns}/deployments/{name}/restart",
            post(restart_deployment),
        )
        // StatefulSets
        .route(
            "/{id}/namespaces/{ns}/statefulsets/{name}/scale",
            post(scale_statefulset),
        )
        .route(
            "/{id}/namespaces/{ns}/statefulsets/{name}/restart",
            post(restart_statefulset),
        )
        // DaemonSets (restart only — no replicas)
        .route(
            "/{id}/namespaces/{ns}/daemonsets/{name}/restart",
            post(restart_daemonset),
        )
}

// ============================================================================
// Generic helpers
// ============================================================================

async fn scale_workload<T>(
    client: kube::Client,
    ns: &str,
    name: &str,
    replicas: i32,
) -> Result<axum::response::Response, axum::response::Response>
where
    T: kube::Resource<Scope = k8s_openapi::NamespaceResourceScope, DynamicType = ()>
        + Clone
        + serde::de::DeserializeOwned
        + serde::Serialize
        + std::fmt::Debug,
{
    let api: Api<T> = Api::namespaced(client, ns);
    let patch = json!({"spec": {"replicas": replicas}});

    match api
        .patch(name, &PatchParams::default(), &Patch::Merge(&patch))
        .await
    {
        Ok(_) => Ok(Json(json!({"status": "ok", "name": name, "replicas": replicas})).into_response()),
        Err(e) => Err((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Failed to scale: {e}")}))).into_response()),
    }
}

async fn restart_workload<T>(
    client: kube::Client,
    ns: &str,
    name: &str,
) -> Result<axum::response::Response, axum::response::Response>
where
    T: kube::Resource<Scope = k8s_openapi::NamespaceResourceScope, DynamicType = ()>
        + Clone
        + serde::de::DeserializeOwned
        + serde::Serialize
        + std::fmt::Debug,
{
    let api: Api<T> = Api::namespaced(client, ns);
    let patch = json!({
        "spec": {
            "template": {
                "metadata": {
                    "annotations": {
                        "kubectl.kubernetes.io/restartedAt": chrono::Utc::now().to_rfc3339()
                    }
                }
            }
        }
    });

    match api
        .patch(name, &PatchParams::default(), &Patch::Merge(&patch))
        .await
    {
        Ok(_) => Ok(Json(json!({"status": "ok", "name": name, "action": "restart"})).into_response()),
        Err(e) => Err((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Failed to restart: {e}")}))).into_response()),
    }
}

// ============================================================================
// Deployment handlers
// ============================================================================

async fn scale_deployment(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((id, ns, name)): Path<(Uuid, String, String)>,
    Json(req): Json<ScaleRequest>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    let cluster = get_verified_cluster(&state, id).await?;
    verify_cluster_access(&state, &auth.claims, &cluster, "clusters.manage").await?;

    if req.replicas < 0 {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Replicas must be non-negative"})),
        ).into_response());
    }

    let client = get_kube_client(&state, &cluster).await?;
    scale_workload::<Deployment>(client, &ns, &name, req.replicas)
        .await
        .or_else(|e| Ok(e))
}

async fn restart_deployment(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((id, ns, name)): Path<(Uuid, String, String)>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    let cluster = get_verified_cluster(&state, id).await?;
    verify_cluster_access(&state, &auth.claims, &cluster, "clusters.manage").await?;

    let client = get_kube_client(&state, &cluster).await?;
    restart_workload::<Deployment>(client, &ns, &name)
        .await
        .or_else(|e| Ok(e))
}

// ============================================================================
// StatefulSet handlers
// ============================================================================

async fn scale_statefulset(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((id, ns, name)): Path<(Uuid, String, String)>,
    Json(req): Json<ScaleRequest>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    let cluster = get_verified_cluster(&state, id).await?;
    verify_cluster_access(&state, &auth.claims, &cluster, "clusters.manage").await?;

    if req.replicas < 0 {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Replicas must be non-negative"})),
        ).into_response());
    }

    let client = get_kube_client(&state, &cluster).await?;
    scale_workload::<StatefulSet>(client, &ns, &name, req.replicas)
        .await
        .or_else(|e| Ok(e))
}

async fn restart_statefulset(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((id, ns, name)): Path<(Uuid, String, String)>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    let cluster = get_verified_cluster(&state, id).await?;
    verify_cluster_access(&state, &auth.claims, &cluster, "clusters.manage").await?;

    let client = get_kube_client(&state, &cluster).await?;
    restart_workload::<StatefulSet>(client, &ns, &name)
        .await
        .or_else(|e| Ok(e))
}

// ============================================================================
// DaemonSet handlers (restart only — DaemonSets don't have replicas)
// ============================================================================

async fn restart_daemonset(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((id, ns, name)): Path<(Uuid, String, String)>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    let cluster = get_verified_cluster(&state, id).await?;
    verify_cluster_access(&state, &auth.claims, &cluster, "clusters.manage").await?;

    let client = get_kube_client(&state, &cluster).await?;
    restart_workload::<DaemonSet>(client, &ns, &name)
        .await
        .or_else(|e| Ok(e))
}
