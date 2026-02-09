use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use k8s_openapi::api::apps::v1::Deployment;
use k8s_openapi::api::core::v1::{Namespace, Pod, Service};
use kube::{
    api::{Api, ListParams, Patch, PatchParams},
    Client,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::auth::middleware::{ProjectScoped, AuthUser};
use crate::db::models::{ClusterResponse, ClusterRow};
use crate::k8s::manager::K8sError;
use crate::AppState;

/// Routes for single-cluster operations.
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/{id}", get(get_cluster).delete(delete_cluster))
        .route("/{id}/test", post(test_cluster))
        .route("/{id}/namespaces", get(list_namespaces))
        .route("/{id}/namespaces/{ns}/pods", get(list_pods))
        .route("/{id}/namespaces/{ns}/deployments", get(list_deployments))
        .route(
            "/{id}/namespaces/{ns}/deployments/{name}/scale",
            post(scale_deployment),
        )
        .route("/{id}/namespaces/{ns}/services", get(list_services))
        .route("/{id}/apply", post(apply_yaml))
}

/// Routes for listing/creating clusters within an environment.
pub fn environment_router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_clusters).post(create_cluster))
}

// ============================================================================
// Request / Response types
// ============================================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateClusterRequest {
    pub name: String,
    /// Full kubeconfig YAML content
    pub kubeconfig: String,
    /// Optional context name within the kubeconfig
    pub context_name: Option<String>,
}

impl std::fmt::Debug for CreateClusterRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CreateClusterRequest")
            .field("name", &self.name)
            .field("kubeconfig", &"[REDACTED]")
            .field("context_name", &self.context_name)
            .finish()
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScaleRequest {
    pub replicas: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyYamlRequest {
    pub namespace: String,
    pub yaml: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PodSummary {
    pub name: String,
    pub namespace: String,
    pub status: String,
    pub ready: String,
    pub restarts: i32,
    pub age: String,
    pub node: Option<String>,
    pub ip: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentSummary {
    pub name: String,
    pub namespace: String,
    pub ready: String,
    pub up_to_date: i32,
    pub available: i32,
    pub age: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceSummary {
    pub name: String,
    pub namespace: String,
    pub service_type: String,
    pub cluster_ip: Option<String>,
    pub external_ip: Option<String>,
    pub ports: Vec<String>,
    pub age: String,
}

// ============================================================================
// Helpers
// ============================================================================

/// Look up a cluster by ID (no project/environment filter).
async fn get_verified_cluster(
    state: &AppState,
    cluster_id: Uuid,
) -> Result<ClusterRow, (StatusCode, Json<serde_json::Value>)> {
    sqlx::query_as::<_, ClusterRow>("SELECT * FROM clusters WHERE id = $1")
        .bind(cluster_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("Database error: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Database error"})))
        })?
        .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Cluster not found"}))))
}

/// Verify the user has access to a cluster by checking membership in the cluster's project.
async fn verify_cluster_access(
    state: &AppState,
    claims: &crate::auth::jwt::AccessClaims,
    cluster: &ClusterRow,
    required_permission: &str,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    let env = sqlx::query_as::<_, crate::db::models::Environment>(
        "SELECT * FROM environments WHERE id = $1",
    )
    .bind(cluster.environment_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Database error: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Database error"})))
    })?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Environment not found"}))))?;

    if claims.is_company_admin {
        return Ok(());
    }

    let role_id = claims.role_for_project(&env.project_id)
        .ok_or_else(|| (StatusCode::FORBIDDEN, Json(json!({"error": "Not a member of this project"}))))?;

    let perms = state.permission_cache.get_permissions(&role_id);
    if !perms.contains(required_permission) {
        return Err((StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))));
    }

    Ok(())
}

async fn get_kube_client(
    state: &AppState,
    cluster: &ClusterRow,
) -> Result<Client, (StatusCode, Json<serde_json::Value>)> {
    state
        .k8s
        .get_client(cluster)
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({"error": format!("Cannot connect to cluster: {e}")})),
            )
        })
}

fn format_age(created: Option<chrono::DateTime<chrono::Utc>>) -> String {
    let Some(created) = created else {
        return "unknown".to_string();
    };
    let dur = chrono::Utc::now() - created;
    if dur.num_seconds() < 0 {
        return "0m".to_string();
    }
    if dur.num_days() > 0 {
        format!("{}d", dur.num_days())
    } else if dur.num_hours() > 0 {
        format!("{}h", dur.num_hours())
    } else {
        format!("{}m", dur.num_minutes())
    }
}

// ============================================================================
// Handlers — environment-scoped (list / create)
// ============================================================================

async fn list_clusters(
    user: ProjectScoped,
    State(state): State<AppState>,
    Path((_pid, environment_id)): Path<(Uuid, Uuid)>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    user.require("clusters.view").map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;

    match sqlx::query_as::<_, ClusterRow>(
        "SELECT * FROM clusters WHERE environment_id = $1 ORDER BY name",
    )
    .bind(environment_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let clusters: Vec<ClusterResponse> = rows.into_iter().map(Into::into).collect();
            Ok(Json(json!(clusters)).into_response())
        }
        Err(e) => {
            tracing::error!("Failed to list clusters: {e}");
            Ok((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to list clusters"}))).into_response())
        }
    }
}

async fn create_cluster(
    user: ProjectScoped,
    State(state): State<AppState>,
    Path((_pid, environment_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<CreateClusterRequest>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    user.require("clusters.create").map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;

    match state
        .k8s
        .store_cluster(
            &state.db,
            environment_id,
            &req.name,
            &req.kubeconfig,
            req.context_name.as_deref(),
            user.claims.sub,
        )
        .await
    {
        Ok(row) => {
            Ok((StatusCode::CREATED, Json(json!(ClusterResponse::from(row)))).into_response())
        }
        Err(e) => {
            if let K8sError::Database(sqlx::Error::Database(ref db_err)) = e {
                if db_err.is_unique_violation() {
                    return Ok((StatusCode::CONFLICT, Json(json!({"error": "A cluster with that name already exists"}))).into_response());
                }
            }
            tracing::error!("Failed to create cluster: {e}");
            Ok((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to create cluster"}))).into_response())
        }
    }
}

// ============================================================================
// Handlers — single-cluster operations (AuthUser + manual access check)
// ============================================================================

async fn get_cluster(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    let cluster = get_verified_cluster(&state, id).await?;
    verify_cluster_access(&state, &auth.claims, &cluster, "clusters.view").await?;
    Ok(Json(json!(ClusterResponse::from(cluster))).into_response())
}

async fn delete_cluster(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    let cluster = get_verified_cluster(&state, id).await?;
    verify_cluster_access(&state, &auth.claims, &cluster, "clusters.delete").await?;

    let result = sqlx::query("DELETE FROM clusters WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await;

    match result {
        Ok(r) if r.rows_affected() > 0 => {
            state.k8s.remove_client(id);
            Ok(Json(json!({"message": "Cluster deleted"})).into_response())
        }
        Ok(_) => Ok((StatusCode::NOT_FOUND, Json(json!({"error": "Cluster not found"}))).into_response()),
        Err(e) => {
            tracing::error!("Failed to delete cluster: {e}");
            Ok((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to delete cluster"}))).into_response())
        }
    }
}

async fn test_cluster(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    let cluster = get_verified_cluster(&state, id).await?;
    verify_cluster_access(&state, &auth.claims, &cluster, "clusters.view").await?;

    match state.k8s.test_connection(&cluster).await {
        Ok(version) => {
            let _ = sqlx::query("UPDATE clusters SET last_connected_at = now() WHERE id = $1")
                .bind(id)
                .execute(&state.db)
                .await;
            Ok(Json(json!({"status": "ok", "version": version})).into_response())
        }
        Err(e) => {
            tracing::error!("Cluster test connection failed for {}: {e}", id);
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"status": "error", "message": "Failed to connect to cluster"}))).into_response())
        }
    }
}

async fn list_namespaces(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    let cluster = get_verified_cluster(&state, id).await?;
    verify_cluster_access(&state, &auth.claims, &cluster, "clusters.view").await?;

    let client = get_kube_client(&state, &cluster).await?;

    let ns_api: Api<Namespace> = Api::all(client);
    match ns_api.list(&ListParams::default()).await {
        Ok(ns_list) => {
            let namespaces: Vec<serde_json::Value> = ns_list
                .items
                .iter()
                .map(|ns| {
                    let name = ns.metadata.name.as_deref().unwrap_or("unknown");
                    let status = ns
                        .status
                        .as_ref()
                        .and_then(|s| s.phase.as_deref())
                        .unwrap_or("Unknown");
                    let age = format_age(ns.metadata.creation_timestamp.as_ref().map(|t| t.0));
                    json!({"name": name, "status": status, "age": age})
                })
                .collect();
            Ok(Json(json!(namespaces)).into_response())
        }
        Err(e) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Failed to list namespaces: {e}")}))).into_response())
        }
    }
}

async fn list_pods(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((id, ns)): Path<(Uuid, String)>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    let cluster = get_verified_cluster(&state, id).await?;
    verify_cluster_access(&state, &auth.claims, &cluster, "clusters.view").await?;

    let client = get_kube_client(&state, &cluster).await?;

    let pod_api: Api<Pod> = Api::namespaced(client, &ns);
    match pod_api.list(&ListParams::default()).await {
        Ok(pod_list) => {
            let pods: Vec<PodSummary> = pod_list
                .items
                .iter()
                .map(|pod| {
                    let status = pod
                        .status
                        .as_ref()
                        .and_then(|s| s.phase.as_deref())
                        .unwrap_or("Unknown")
                        .to_string();

                    let containers = pod
                        .spec
                        .as_ref()
                        .map(|s| s.containers.len())
                        .unwrap_or(0);

                    let ready_count = pod
                        .status
                        .as_ref()
                        .and_then(|s| s.container_statuses.as_ref())
                        .map(|cs| cs.iter().filter(|c| c.ready).count())
                        .unwrap_or(0);

                    let restarts: i32 = pod
                        .status
                        .as_ref()
                        .and_then(|s| s.container_statuses.as_ref())
                        .map(|cs| cs.iter().map(|c| c.restart_count).sum())
                        .unwrap_or(0);

                    PodSummary {
                        name: pod.metadata.name.clone().unwrap_or_default(),
                        namespace: ns.clone(),
                        status,
                        ready: format!("{ready_count}/{containers}"),
                        restarts,
                        age: format_age(pod.metadata.creation_timestamp.as_ref().map(|t| t.0)),
                        node: pod.spec.as_ref().and_then(|s| s.node_name.clone()),
                        ip: pod.status.as_ref().and_then(|s| s.pod_ip.clone()),
                    }
                })
                .collect();
            Ok(Json(json!(pods)).into_response())
        }
        Err(e) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Failed to list pods: {e}")}))).into_response())
        }
    }
}

async fn list_deployments(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((id, ns)): Path<(Uuid, String)>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    let cluster = get_verified_cluster(&state, id).await?;
    verify_cluster_access(&state, &auth.claims, &cluster, "clusters.view").await?;

    let client = get_kube_client(&state, &cluster).await?;

    let dep_api: Api<Deployment> = Api::namespaced(client, &ns);
    match dep_api.list(&ListParams::default()).await {
        Ok(dep_list) => {
            let deps: Vec<DeploymentSummary> = dep_list
                .items
                .iter()
                .map(|dep| {
                    let status = dep.status.as_ref();
                    let replicas = status.and_then(|s| s.replicas).unwrap_or(0);
                    let ready = status.and_then(|s| s.ready_replicas).unwrap_or(0);
                    let up_to_date = status.and_then(|s| s.updated_replicas).unwrap_or(0);
                    let available = status.and_then(|s| s.available_replicas).unwrap_or(0);

                    DeploymentSummary {
                        name: dep.metadata.name.clone().unwrap_or_default(),
                        namespace: ns.clone(),
                        ready: format!("{ready}/{replicas}"),
                        up_to_date,
                        available,
                        age: format_age(dep.metadata.creation_timestamp.as_ref().map(|t| t.0)),
                    }
                })
                .collect();
            Ok(Json(json!(deps)).into_response())
        }
        Err(e) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Failed to list deployments: {e}")}))).into_response())
        }
    }
}

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

    let dep_api: Api<Deployment> = Api::namespaced(client, &ns);
    let patch = json!({
        "spec": {
            "replicas": req.replicas
        }
    });

    match dep_api
        .patch(&name, &PatchParams::apply("containerus"), &Patch::Merge(&patch))
        .await
    {
        Ok(_) => {
            Ok(Json(json!({"status": "ok", "deployment": name, "replicas": req.replicas})).into_response())
        }
        Err(e) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Failed to scale: {e}")}))).into_response())
        }
    }
}

async fn list_services(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((id, ns)): Path<(Uuid, String)>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    let cluster = get_verified_cluster(&state, id).await?;
    verify_cluster_access(&state, &auth.claims, &cluster, "clusters.view").await?;

    let client = get_kube_client(&state, &cluster).await?;

    let svc_api: Api<Service> = Api::namespaced(client, &ns);
    match svc_api.list(&ListParams::default()).await {
        Ok(svc_list) => {
            let services: Vec<ServiceSummary> = svc_list
                .items
                .iter()
                .map(|svc| {
                    let spec = svc.spec.as_ref();
                    let ports: Vec<String> = spec
                        .and_then(|s| s.ports.as_ref())
                        .map(|ports| {
                            ports
                                .iter()
                                .map(|p| {
                                    let port = p.port;
                                    let proto = p.protocol.as_deref().unwrap_or("TCP");
                                    if let Some(node_port) = p.node_port {
                                        format!("{port}:{node_port}/{proto}")
                                    } else {
                                        format!("{port}/{proto}")
                                    }
                                })
                                .collect()
                        })
                        .unwrap_or_default();

                    let external_ip = svc
                        .status
                        .as_ref()
                        .and_then(|s| s.load_balancer.as_ref())
                        .and_then(|lb| lb.ingress.as_ref())
                        .and_then(|ingress| ingress.first())
                        .and_then(|ing| ing.ip.clone().or_else(|| ing.hostname.clone()))
                        .or_else(|| spec.and_then(|s| s.external_ips.as_ref()).and_then(|ips| ips.first().cloned()));

                    ServiceSummary {
                        name: svc.metadata.name.clone().unwrap_or_default(),
                        namespace: ns.clone(),
                        service_type: spec
                            .and_then(|s| s.type_.as_deref())
                            .unwrap_or("ClusterIP")
                            .to_string(),
                        cluster_ip: spec.and_then(|s| s.cluster_ip.clone()),
                        external_ip,
                        ports,
                        age: format_age(svc.metadata.creation_timestamp.as_ref().map(|t| t.0)),
                    }
                })
                .collect();
            Ok(Json(json!(services)).into_response())
        }
        Err(e) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Failed to list services: {e}")}))).into_response())
        }
    }
}

async fn apply_yaml(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<ApplyYamlRequest>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    let cluster = get_verified_cluster(&state, id).await?;
    verify_cluster_access(&state, &auth.claims, &cluster, "clusters.manage").await?;

    let client = get_kube_client(&state, &cluster).await?;

    // Parse the YAML to determine resource kind
    let value: serde_json::Value = match serde_yaml::from_str(&req.yaml) {
        Ok(v) => v,
        Err(e) => {
            return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": format!("Invalid YAML: {e}")}))).into_response());
        }
    };

    let kind = value
        .get("kind")
        .and_then(|k| k.as_str())
        .unwrap_or("unknown");

    // Validate that apiVersion is present — required for all Kubernetes resources
    if value.get("apiVersion").and_then(|v| v.as_str()).is_none() {
        return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": "apiVersion is required in YAML"}))).into_response());
    }

    // Validate that YAML namespace matches request namespace (if specified in YAML)
    if let Some(yaml_ns) = value.get("metadata").and_then(|m| m.get("namespace")).and_then(|n| n.as_str()) {
        if yaml_ns != req.namespace {
            return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": format!("YAML namespace '{}' does not match request namespace '{}'", yaml_ns, req.namespace)}))).into_response());
        }
    }

    // Use server-side apply with dynamic API
    let api_resource = match kind {
        "Deployment" => {
            let api: Api<Deployment> = Api::namespaced(client, &req.namespace);
            let patch = Patch::Apply(&value);
            let pp = PatchParams::apply("containerus");
            let name = value
                .get("metadata")
                .and_then(|m| m.get("name"))
                .and_then(|n| n.as_str());
            let Some(name) = name else {
                return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": "metadata.name is required"}))).into_response());
            };
            api.patch(name, &pp, &patch).await.map(|_| ()).map_err(|e| e.to_string())
        }
        "Service" => {
            let api: Api<Service> = Api::namespaced(client, &req.namespace);
            let patch = Patch::Apply(&value);
            let pp = PatchParams::apply("containerus");
            let name = value
                .get("metadata")
                .and_then(|m| m.get("name"))
                .and_then(|n| n.as_str());
            let Some(name) = name else {
                return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": "metadata.name is required"}))).into_response());
            };
            api.patch(name, &pp, &patch).await.map(|_| ()).map_err(|e| e.to_string())
        }
        "Pod" => {
            let api: Api<Pod> = Api::namespaced(client, &req.namespace);
            let patch = Patch::Apply(&value);
            let pp = PatchParams::apply("containerus");
            let name = value
                .get("metadata")
                .and_then(|m| m.get("name"))
                .and_then(|n| n.as_str());
            let Some(name) = name else {
                return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": "metadata.name is required"}))).into_response());
            };
            api.patch(name, &pp, &patch).await.map(|_| ()).map_err(|e| e.to_string())
        }
        _ => {
            return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": format!("Unsupported resource kind: {kind}. Supported: Deployment, Service, Pod")}))).into_response());
        }
    };

    match api_resource {
        Ok(()) => {
            Ok(Json(json!({"status": "applied", "kind": kind})).into_response())
        }
        Err(e) => {
            Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Apply failed: {e}")}))).into_response())
        }
    }
}
