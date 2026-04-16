use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use k8s_openapi::api::{
    apps::v1::{Deployment, ReplicaSet, StatefulSet},
    core::v1::{Pod, Service},
};
use kube::api::{Api, ListParams};
use serde::Serialize;
use serde_json::json;
use uuid::Uuid;

use crate::auth::middleware::AuthUser;
use crate::AppState;

use super::common::{get_kube_client, get_verified_cluster, verify_cluster_access, ApiError};

pub fn router() -> Router<AppState> {
    Router::new().route("/{id}/namespaces/{ns}/topology", get(get_topology))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TopologyResponse {
    nodes: Vec<TopologyNode>,
    edges: Vec<TopologyEdge>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TopologyNode {
    kind: String,
    name: String,
    namespace: String,
    status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TopologyEdge {
    from: TopologyRef,
    to: TopologyRef,
    relation: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TopologyRef {
    kind: String,
    name: String,
}

async fn get_topology(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((id, ns)): Path<(Uuid, String)>,
) -> Result<impl IntoResponse, ApiError> {
    let cluster = get_verified_cluster(&state, id).await?;
    verify_cluster_access(&state, &auth.claims, &cluster, "clusters.view").await?;

    let client = get_kube_client(&state, &cluster).await?;

    // Fetch all relevant resources in parallel
    let deployments_api: Api<Deployment> = Api::namespaced(client.clone(), &ns);
    let statefulsets_api: Api<StatefulSet> = Api::namespaced(client.clone(), &ns);
    let replicasets_api: Api<ReplicaSet> = Api::namespaced(client.clone(), &ns);
    let pods_api: Api<Pod> = Api::namespaced(client.clone(), &ns);
    let services_api: Api<Service> = Api::namespaced(client.clone(), &ns);

    let lp = ListParams::default();
    let (deployments, statefulsets, replicasets, pods, services) = tokio::try_join!(
        deployments_api.list(&lp),
        statefulsets_api.list(&lp),
        replicasets_api.list(&lp),
        pods_api.list(&lp),
        services_api.list(&lp),
    )
    .map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": format!("Failed to fetch resources: {e}")})),
        )
    })?;

    let mut nodes = Vec::new();
    let mut edges = Vec::new();

    // Add Deployments
    for dep in &deployments.items {
        let name = dep.metadata.name.as_deref().unwrap_or("");
        let status = dep
            .status
            .as_ref()
            .map(|s| {
                let ready = s.ready_replicas.unwrap_or(0);
                let desired = s.replicas.unwrap_or(0);
                if ready == desired {
                    "ready".to_string()
                } else {
                    format!("{ready}/{desired}")
                }
            })
            .unwrap_or_else(|| "unknown".to_string());
        nodes.push(TopologyNode {
            kind: "Deployment".to_string(),
            name: name.to_string(),
            namespace: ns.clone(),
            status,
        });
    }

    // Add StatefulSets
    for sts in &statefulsets.items {
        let name = sts.metadata.name.as_deref().unwrap_or("");
        let status = sts
            .status
            .as_ref()
            .map(|s| {
                let ready = s.ready_replicas.unwrap_or(0);
                let desired = s.replicas;
                if ready == desired {
                    "ready".to_string()
                } else {
                    format!("{ready}/{desired}")
                }
            })
            .unwrap_or_else(|| "unknown".to_string());
        nodes.push(TopologyNode {
            kind: "StatefulSet".to_string(),
            name: name.to_string(),
            namespace: ns.clone(),
            status,
        });
    }

    // Add ReplicaSets (and owner edges)
    for rs in &replicasets.items {
        let rs_name = rs.metadata.name.as_deref().unwrap_or("");
        let desired = rs.spec.as_ref().and_then(|s| s.replicas).unwrap_or(0);
        // Skip ReplicaSets with 0 desired replicas (old revisions)
        if desired == 0 {
            continue;
        }
        let ready = rs.status.as_ref().and_then(|s| s.ready_replicas).unwrap_or(0);
        nodes.push(TopologyNode {
            kind: "ReplicaSet".to_string(),
            name: rs_name.to_string(),
            namespace: ns.clone(),
            status: if ready == desired {
                "ready".to_string()
            } else {
                format!("{ready}/{desired}")
            },
        });

        // ownerReferences → Deployment or StatefulSet
        if let Some(refs) = &rs.metadata.owner_references {
            for owner in refs {
                edges.push(TopologyEdge {
                    from: TopologyRef {
                        kind: owner.kind.clone(),
                        name: owner.name.clone(),
                    },
                    to: TopologyRef {
                        kind: "ReplicaSet".to_string(),
                        name: rs_name.to_string(),
                    },
                    relation: "manages".to_string(),
                });
            }
        }
    }

    // Add Pods (and owner edges)
    for pod in &pods.items {
        let pod_name = pod.metadata.name.as_deref().unwrap_or("");
        let status = pod
            .status
            .as_ref()
            .and_then(|s| s.phase.clone())
            .unwrap_or_else(|| "Unknown".to_string());
        nodes.push(TopologyNode {
            kind: "Pod".to_string(),
            name: pod_name.to_string(),
            namespace: ns.clone(),
            status,
        });

        // ownerReferences → ReplicaSet, StatefulSet, etc.
        if let Some(refs) = &pod.metadata.owner_references {
            for owner in refs {
                edges.push(TopologyEdge {
                    from: TopologyRef {
                        kind: owner.kind.clone(),
                        name: owner.name.clone(),
                    },
                    to: TopologyRef {
                        kind: "Pod".to_string(),
                        name: pod_name.to_string(),
                    },
                    relation: "manages".to_string(),
                });
            }
        }
    }

    // Add Services (and selector → Pod edges)
    for svc in &services.items {
        let svc_name = svc.metadata.name.as_deref().unwrap_or("");
        let svc_type = svc
            .spec
            .as_ref()
            .and_then(|s| s.type_.clone())
            .unwrap_or_else(|| "ClusterIP".to_string());
        nodes.push(TopologyNode {
            kind: "Service".to_string(),
            name: svc_name.to_string(),
            namespace: ns.clone(),
            status: svc_type,
        });

        // Match service selector against pod labels
        if let Some(selector) = svc.spec.as_ref().and_then(|s| s.selector.as_ref()) {
            for pod in &pods.items {
                let pod_name = pod.metadata.name.as_deref().unwrap_or("");
                let pod_labels = pod.metadata.labels.as_ref();
                let matches = pod_labels
                    .map(|labels| {
                        selector
                            .iter()
                            .all(|(k, v)| labels.get(k).map(|lv| lv == v).unwrap_or(false))
                    })
                    .unwrap_or(false);
                if matches {
                    edges.push(TopologyEdge {
                        from: TopologyRef {
                            kind: "Service".to_string(),
                            name: svc_name.to_string(),
                        },
                        to: TopologyRef {
                            kind: "Pod".to_string(),
                            name: pod_name.to_string(),
                        },
                        relation: "routes-to".to_string(),
                    });
                }
            }
        }
    }

    Ok(Json(TopologyResponse { nodes, edges }))
}
