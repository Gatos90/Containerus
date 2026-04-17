use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use containerus_rbac_macros::require_permissions;
use k8s_openapi::api::{
    apps::v1::{DaemonSet, Deployment, StatefulSet},
    autoscaling::v2::HorizontalPodAutoscaler,
    batch::v1::{CronJob, Job},
    core::v1::{
        ConfigMap, LimitRange, Namespace, PersistentVolume, PersistentVolumeClaim, Pod,
        ResourceQuota, Secret, Service, ServiceAccount,
    },
    networking::v1::{Ingress, IngressClass, NetworkPolicy},
    policy::v1::PodDisruptionBudget,
    rbac::v1::{ClusterRole, ClusterRoleBinding, Role as K8sRole, RoleBinding},
    storage::v1::StorageClass,
};
use kube::api::{Api, Patch, PatchParams};
use serde_json::json;
use uuid::Uuid;

use crate::auth::middleware::AuthUser;
use crate::AppState;

use super::common::{get_kube_client, get_verified_cluster, verify_cluster_access, ApplyYamlRequest};

pub fn router() -> Router<AppState> {
    Router::new().route("/{id}/apply", post(apply_yaml))
}

/// Cluster-scoped resource kinds that do not require a namespace.
const CLUSTER_SCOPED_KINDS: &[&str] = &[
    "Namespace",
    "Node",
    "PersistentVolume",
    "StorageClass",
    "ClusterRole",
    "ClusterRoleBinding",
    "IngressClass",
];

#[require_permissions("clusters.apply")]
async fn apply_yaml(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<ApplyYamlRequest>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    let cluster = get_verified_cluster(&state, id).await?;
    verify_cluster_access(&state, &auth.claims, &cluster, "clusters.apply").await?;

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

    // Validate that apiVersion is present
    if value.get("apiVersion").and_then(|v| v.as_str()).is_none() {
        return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": "apiVersion is required in YAML"}))).into_response());
    }

    let is_cluster_scoped = CLUSTER_SCOPED_KINDS.contains(&kind);

    // For namespaced resources, resolve namespace
    let namespace = if is_cluster_scoped {
        String::new() // not used for cluster-scoped
    } else {
        let ns = req.namespace.as_deref().unwrap_or("default");
        // Validate that YAML namespace matches request namespace (if specified in YAML)
        if let Some(yaml_ns) = value.get("metadata").and_then(|m| m.get("namespace")).and_then(|n| n.as_str()) {
            if yaml_ns != ns {
                return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": format!("YAML namespace '{}' does not match request namespace '{}'", yaml_ns, ns)}))).into_response());
            }
        }
        ns.to_string()
    };

    let name = value
        .get("metadata")
        .and_then(|m| m.get("name"))
        .and_then(|n| n.as_str());
    let Some(name) = name else {
        return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": "metadata.name is required"}))).into_response());
    };

    let pp = PatchParams::apply("containerus");
    let patch = Patch::Apply(&value);

    let result = match kind {
        // Namespaced resources
        "Deployment" => apply_namespaced::<Deployment>(&client, &namespace, name, &pp, &patch).await,
        "StatefulSet" => apply_namespaced::<StatefulSet>(&client, &namespace, name, &pp, &patch).await,
        "DaemonSet" => apply_namespaced::<DaemonSet>(&client, &namespace, name, &pp, &patch).await,
        "Service" => apply_namespaced::<Service>(&client, &namespace, name, &pp, &patch).await,
        "Pod" => apply_namespaced::<Pod>(&client, &namespace, name, &pp, &patch).await,
        "Job" => apply_namespaced::<Job>(&client, &namespace, name, &pp, &patch).await,
        "CronJob" => apply_namespaced::<CronJob>(&client, &namespace, name, &pp, &patch).await,
        "ConfigMap" => apply_namespaced::<ConfigMap>(&client, &namespace, name, &pp, &patch).await,
        "Secret" => apply_namespaced::<Secret>(&client, &namespace, name, &pp, &patch).await,
        "Ingress" => apply_namespaced::<Ingress>(&client, &namespace, name, &pp, &patch).await,
        "PersistentVolumeClaim" => apply_namespaced::<PersistentVolumeClaim>(&client, &namespace, name, &pp, &patch).await,
        "NetworkPolicy" => apply_namespaced::<NetworkPolicy>(&client, &namespace, name, &pp, &patch).await,
        "ResourceQuota" => apply_namespaced::<ResourceQuota>(&client, &namespace, name, &pp, &patch).await,
        "LimitRange" => apply_namespaced::<LimitRange>(&client, &namespace, name, &pp, &patch).await,
        "ServiceAccount" => apply_namespaced::<ServiceAccount>(&client, &namespace, name, &pp, &patch).await,
        "Role" => apply_namespaced::<K8sRole>(&client, &namespace, name, &pp, &patch).await,
        "RoleBinding" => apply_namespaced::<RoleBinding>(&client, &namespace, name, &pp, &patch).await,
        "HorizontalPodAutoscaler" => apply_namespaced::<HorizontalPodAutoscaler>(&client, &namespace, name, &pp, &patch).await,
        "PodDisruptionBudget" => apply_namespaced::<PodDisruptionBudget>(&client, &namespace, name, &pp, &patch).await,
        // Cluster-scoped resources
        "Namespace" => apply_cluster_scoped::<Namespace>(&client, name, &pp, &patch).await,
        "PersistentVolume" => apply_cluster_scoped::<PersistentVolume>(&client, name, &pp, &patch).await,
        "StorageClass" => apply_cluster_scoped::<StorageClass>(&client, name, &pp, &patch).await,
        "ClusterRole" => apply_cluster_scoped::<ClusterRole>(&client, name, &pp, &patch).await,
        "ClusterRoleBinding" => apply_cluster_scoped::<ClusterRoleBinding>(&client, name, &pp, &patch).await,
        "IngressClass" => apply_cluster_scoped::<IngressClass>(&client, name, &pp, &patch).await,
        _ => {
            return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": format!("Unsupported resource kind: {kind}")}))).into_response());
        }
    };

    match result {
        Ok(()) => Ok(Json(json!({"status": "applied", "kind": kind})).into_response()),
        Err(e) => Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Apply failed: {e}")}))).into_response()),
    }
}

async fn apply_namespaced<T>(
    client: &kube::Client,
    namespace: &str,
    name: &str,
    pp: &PatchParams,
    patch: &Patch<&serde_json::Value>,
) -> Result<(), String>
where
    T: kube::Resource<Scope = k8s_openapi::NamespaceResourceScope, DynamicType = ()>
        + Clone
        + serde::de::DeserializeOwned
        + serde::Serialize
        + std::fmt::Debug,
{
    let api: Api<T> = Api::namespaced(client.clone(), namespace);
    api.patch(name, pp, patch).await.map(|_| ()).map_err(|e| e.to_string())
}

async fn apply_cluster_scoped<T>(
    client: &kube::Client,
    name: &str,
    pp: &PatchParams,
    patch: &Patch<&serde_json::Value>,
) -> Result<(), String>
where
    T: kube::Resource<Scope = k8s_openapi::ClusterResourceScope, DynamicType = ()>
        + Clone
        + serde::de::DeserializeOwned
        + serde::Serialize
        + std::fmt::Debug,
{
    let api: Api<T> = Api::all(client.clone());
    api.patch(name, pp, patch).await.map(|_| ()).map_err(|e| e.to_string())
}
