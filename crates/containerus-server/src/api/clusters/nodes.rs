use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use k8s_openapi::api::core::v1::{Node, Pod};
use kube::api::{Api, EvictParams, ListParams};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::auth::middleware::AuthUser;
use crate::AppState;

use super::common::{get_kube_client, get_verified_cluster, verify_cluster_access, ApiError};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/{id}/nodes/{node}/cordon", post(cordon_node))
        .route("/{id}/nodes/{node}/uncordon", post(uncordon_node))
        .route("/{id}/nodes/{node}/drain", post(drain_node))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DrainRequest {
    pub force: Option<bool>,
}

// ============================================================================
// Cordon — mark node as unschedulable
// ============================================================================

async fn cordon_node(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((id, node_name)): Path<(Uuid, String)>,
) -> Result<impl IntoResponse, ApiError> {
    let cluster = get_verified_cluster(&state, id).await?;
    verify_cluster_access(&state, &auth.claims, &cluster, "clusters.manage").await?;

    let client = get_kube_client(&state, &cluster).await?;
    let nodes: Api<Node> = Api::all(client);

    let patch = serde_json::json!({
        "spec": { "unschedulable": true }
    });
    nodes
        .patch(
            &node_name,
            &kube::api::PatchParams::apply("containerus"),
            &kube::api::Patch::Merge(&patch),
        )
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({"error": format!("Failed to cordon node: {e}")})),
            )
        })?;

    Ok(Json(json!({"status": "cordoned", "node": node_name})))
}

// ============================================================================
// Uncordon — mark node as schedulable
// ============================================================================

async fn uncordon_node(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((id, node_name)): Path<(Uuid, String)>,
) -> Result<impl IntoResponse, ApiError> {
    let cluster = get_verified_cluster(&state, id).await?;
    verify_cluster_access(&state, &auth.claims, &cluster, "clusters.manage").await?;

    let client = get_kube_client(&state, &cluster).await?;
    let nodes: Api<Node> = Api::all(client);

    let patch = serde_json::json!({
        "spec": { "unschedulable": false }
    });
    nodes
        .patch(
            &node_name,
            &kube::api::PatchParams::apply("containerus"),
            &kube::api::Patch::Merge(&patch),
        )
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({"error": format!("Failed to uncordon node: {e}")})),
            )
        })?;

    Ok(Json(json!({"status": "uncordoned", "node": node_name})))
}

// ============================================================================
// Drain — evict all pods from node
// ============================================================================

async fn drain_node(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((id, node_name)): Path<(Uuid, String)>,
    body: Option<Json<DrainRequest>>,
) -> Result<impl IntoResponse, ApiError> {
    let cluster = get_verified_cluster(&state, id).await?;
    verify_cluster_access(&state, &auth.claims, &cluster, "clusters.manage").await?;

    let force = body.as_ref().and_then(|b| b.force).unwrap_or(false);

    let client = get_kube_client(&state, &cluster).await?;

    // Step 1: Cordon the node first
    let nodes: Api<Node> = Api::all(client.clone());
    let patch = serde_json::json!({
        "spec": { "unschedulable": true }
    });
    nodes
        .patch(
            &node_name,
            &kube::api::PatchParams::apply("containerus"),
            &kube::api::Patch::Merge(&patch),
        )
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({"error": format!("Failed to cordon node before drain: {e}")})),
            )
        })?;

    // Step 2: List pods on the node
    let pods_api: Api<Pod> = Api::all(client.clone());
    let lp = ListParams::default().fields(&format!("spec.nodeName={node_name}"));
    let pod_list = pods_api.list(&lp).await.map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": format!("Failed to list pods on node: {e}")})),
        )
    })?;

    // Step 3: Evict each pod (skip DaemonSet-owned pods and mirror pods)
    let mut evicted = 0u32;
    let mut errors = Vec::new();

    for pod in &pod_list.items {
        let pod_name = pod.metadata.name.as_deref().unwrap_or("");
        let pod_ns = pod.metadata.namespace.as_deref().unwrap_or("default");

        // Skip DaemonSet-owned pods
        let is_daemonset = pod
            .metadata
            .owner_references
            .as_ref()
            .map(|refs| refs.iter().any(|r| r.kind == "DaemonSet"))
            .unwrap_or(false);
        if is_daemonset {
            continue;
        }

        // Skip mirror pods (static pods)
        let is_mirror = pod
            .metadata
            .annotations
            .as_ref()
            .map(|a| a.contains_key("kubernetes.io/config.mirror"))
            .unwrap_or(false);
        if is_mirror {
            continue;
        }

        let ns_pods: Api<Pod> = Api::namespaced(client.clone(), pod_ns);

        match ns_pods.evict(pod_name, &EvictParams::default()).await {
            Ok(_) => evicted += 1,
            Err(e) => {
                if force {
                    // Force delete
                    let _ = ns_pods
                        .delete(pod_name, &kube::api::DeleteParams::default())
                        .await;
                    evicted += 1;
                } else {
                    errors.push(format!("{pod_ns}/{pod_name}: {e}"));
                }
            }
        }
    }

    if !errors.is_empty() {
        return Ok(Json(json!({
            "status": "partial",
            "node": node_name,
            "evicted": evicted,
            "errors": errors,
        }))
        .into_response());
    }

    Ok(Json(json!({
        "status": "drained",
        "node": node_name,
        "evicted": evicted,
    }))
    .into_response())
}
