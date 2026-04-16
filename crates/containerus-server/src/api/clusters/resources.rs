use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use k8s_openapi::api::{
    apps::v1::{DaemonSet, Deployment, ReplicaSet, StatefulSet},
    autoscaling::v2::HorizontalPodAutoscaler,
    batch::v1::{CronJob, Job},
    core::v1::{
        ConfigMap, Endpoints, Event, LimitRange, Namespace, Node, PersistentVolume,
        PersistentVolumeClaim, Pod, ResourceQuota, Secret, Service, ServiceAccount,
    },
    networking::v1::{Ingress, IngressClass, NetworkPolicy},
    policy::v1::PodDisruptionBudget,
    rbac::v1::{ClusterRole, ClusterRoleBinding, Role as K8sRole, RoleBinding},
    storage::v1::StorageClass,
};
use kube::api::{Api, DeleteParams, ListParams};
use serde_json::json;
use uuid::Uuid;

use crate::auth::middleware::AuthUser;
use crate::AppState;

use super::common::{get_kube_client, get_verified_cluster, verify_cluster_access, ApiError, ResourceQuery};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/{id}/resources/{kind}", get(list_resources))
        .route(
            "/{id}/resources/{kind}/{name}",
            get(get_resource).delete(delete_resource),
        )
}

// ============================================================================
// List resources
// ============================================================================

async fn list_resources(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((id, kind)): Path<(Uuid, String)>,
    Query(params): Query<ResourceQuery>,
) -> Result<axum::response::Response, ApiError> {
    let cluster = get_verified_cluster(&state, id).await?;
    verify_cluster_access(&state, &auth.claims, &cluster, "clusters.view").await?;

    let client = get_kube_client(&state, &cluster).await?;
    let ns = params.namespace.as_deref().unwrap_or("default");

    let json = match kind.as_str() {
        "pods" => list_namespaced::<Pod>(&client, ns, &params).await,
        "deployments" => list_namespaced::<Deployment>(&client, ns, &params).await,
        "statefulsets" => list_namespaced::<StatefulSet>(&client, ns, &params).await,
        "daemonsets" => list_namespaced::<DaemonSet>(&client, ns, &params).await,
        "replicasets" => list_namespaced::<ReplicaSet>(&client, ns, &params).await,
        "jobs" => list_namespaced::<Job>(&client, ns, &params).await,
        "cronjobs" => list_namespaced::<CronJob>(&client, ns, &params).await,
        "services" => list_namespaced::<Service>(&client, ns, &params).await,
        "configmaps" => list_namespaced::<ConfigMap>(&client, ns, &params).await,
        "secrets" => list_secrets(&client, ns, &params).await,
        "ingresses" => list_namespaced::<Ingress>(&client, ns, &params).await,
        "pvcs" => list_namespaced::<PersistentVolumeClaim>(&client, ns, &params).await,
        "events" => list_namespaced::<Event>(&client, ns, &params).await,
        "networkpolicies" => list_namespaced::<NetworkPolicy>(&client, ns, &params).await,
        "resourcequotas" => list_namespaced::<ResourceQuota>(&client, ns, &params).await,
        "limitranges" => list_namespaced::<LimitRange>(&client, ns, &params).await,
        "serviceaccounts" => list_namespaced::<ServiceAccount>(&client, ns, &params).await,
        "roles" => list_namespaced::<K8sRole>(&client, ns, &params).await,
        "rolebindings" => list_namespaced::<RoleBinding>(&client, ns, &params).await,
        "horizontalpodautoscalers" => list_namespaced::<HorizontalPodAutoscaler>(&client, ns, &params).await,
        "poddisruptionbudgets" => list_namespaced::<PodDisruptionBudget>(&client, ns, &params).await,
        "endpoints" => list_namespaced::<Endpoints>(&client, ns, &params).await,
        "namespaces" => list_cluster_scoped::<Namespace>(&client, &params).await,
        "nodes" => list_cluster_scoped::<Node>(&client, &params).await,
        "persistentvolumes" => list_cluster_scoped::<PersistentVolume>(&client, &params).await,
        "storageclasses" => list_cluster_scoped::<StorageClass>(&client, &params).await,
        "clusterroles" => list_cluster_scoped::<ClusterRole>(&client, &params).await,
        "clusterrolebindings" => list_cluster_scoped::<ClusterRoleBinding>(&client, &params).await,
        "ingressclasses" => list_cluster_scoped::<IngressClass>(&client, &params).await,
        _ => {
            return Ok((
                StatusCode::BAD_REQUEST,
                Json(json!({"error": format!("Unknown resource kind: {kind}")})),
            )
                .into_response());
        }
    };

    match json {
        Ok(val) => Ok(Json(val).into_response()),
        Err(e) => Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": e}))).into_response()),
    }
}

// ============================================================================
// Get single resource
// ============================================================================

async fn get_resource(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((id, kind, name)): Path<(Uuid, String, String)>,
    Query(params): Query<ResourceQuery>,
) -> Result<axum::response::Response, ApiError> {
    let cluster = get_verified_cluster(&state, id).await?;
    verify_cluster_access(&state, &auth.claims, &cluster, "clusters.view").await?;

    let client = get_kube_client(&state, &cluster).await?;
    let ns = params.namespace.as_deref().unwrap_or("default");

    let json = match kind.as_str() {
        "pods" => get_namespaced::<Pod>(&client, ns, &name).await,
        "deployments" => get_namespaced::<Deployment>(&client, ns, &name).await,
        "statefulsets" => get_namespaced::<StatefulSet>(&client, ns, &name).await,
        "daemonsets" => get_namespaced::<DaemonSet>(&client, ns, &name).await,
        "replicasets" => get_namespaced::<ReplicaSet>(&client, ns, &name).await,
        "jobs" => get_namespaced::<Job>(&client, ns, &name).await,
        "cronjobs" => get_namespaced::<CronJob>(&client, ns, &name).await,
        "services" => get_namespaced::<Service>(&client, ns, &name).await,
        "configmaps" => get_namespaced::<ConfigMap>(&client, ns, &name).await,
        "secrets" => get_secret(&client, ns, &name).await,
        "ingresses" => get_namespaced::<Ingress>(&client, ns, &name).await,
        "pvcs" => get_namespaced::<PersistentVolumeClaim>(&client, ns, &name).await,
        "events" => get_namespaced::<Event>(&client, ns, &name).await,
        "networkpolicies" => get_namespaced::<NetworkPolicy>(&client, ns, &name).await,
        "resourcequotas" => get_namespaced::<ResourceQuota>(&client, ns, &name).await,
        "limitranges" => get_namespaced::<LimitRange>(&client, ns, &name).await,
        "serviceaccounts" => get_namespaced::<ServiceAccount>(&client, ns, &name).await,
        "roles" => get_namespaced::<K8sRole>(&client, ns, &name).await,
        "rolebindings" => get_namespaced::<RoleBinding>(&client, ns, &name).await,
        "horizontalpodautoscalers" => get_namespaced::<HorizontalPodAutoscaler>(&client, ns, &name).await,
        "poddisruptionbudgets" => get_namespaced::<PodDisruptionBudget>(&client, ns, &name).await,
        "endpoints" => get_namespaced::<Endpoints>(&client, ns, &name).await,
        "namespaces" => get_cluster_scoped::<Namespace>(&client, &name).await,
        "nodes" => get_cluster_scoped::<Node>(&client, &name).await,
        "persistentvolumes" => get_cluster_scoped::<PersistentVolume>(&client, &name).await,
        "storageclasses" => get_cluster_scoped::<StorageClass>(&client, &name).await,
        "clusterroles" => get_cluster_scoped::<ClusterRole>(&client, &name).await,
        "clusterrolebindings" => get_cluster_scoped::<ClusterRoleBinding>(&client, &name).await,
        "ingressclasses" => get_cluster_scoped::<IngressClass>(&client, &name).await,
        _ => {
            return Ok((
                StatusCode::BAD_REQUEST,
                Json(json!({"error": format!("Unknown resource kind: {kind}")})),
            )
                .into_response());
        }
    };

    match json {
        Ok(val) => Ok(Json(val).into_response()),
        Err(e) => Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": e}))).into_response()),
    }
}

// ============================================================================
// Delete resource
// ============================================================================

async fn delete_resource(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((id, kind, name)): Path<(Uuid, String, String)>,
    Query(params): Query<ResourceQuery>,
) -> Result<axum::response::Response, ApiError> {
    let cluster = get_verified_cluster(&state, id).await?;
    verify_cluster_access(&state, &auth.claims, &cluster, "clusters.delete").await?;

    let client = get_kube_client(&state, &cluster).await?;
    let ns = params.namespace.as_deref().unwrap_or("default");

    let result = match kind.as_str() {
        "pods" => delete_namespaced::<Pod>(&client, ns, &name).await,
        "deployments" => delete_namespaced::<Deployment>(&client, ns, &name).await,
        "statefulsets" => delete_namespaced::<StatefulSet>(&client, ns, &name).await,
        "daemonsets" => delete_namespaced::<DaemonSet>(&client, ns, &name).await,
        "replicasets" => delete_namespaced::<ReplicaSet>(&client, ns, &name).await,
        "jobs" => delete_namespaced::<Job>(&client, ns, &name).await,
        "cronjobs" => delete_namespaced::<CronJob>(&client, ns, &name).await,
        "services" => delete_namespaced::<Service>(&client, ns, &name).await,
        "configmaps" => delete_namespaced::<ConfigMap>(&client, ns, &name).await,
        "secrets" => delete_namespaced::<Secret>(&client, ns, &name).await,
        "ingresses" => delete_namespaced::<Ingress>(&client, ns, &name).await,
        "pvcs" => delete_namespaced::<PersistentVolumeClaim>(&client, ns, &name).await,
        "networkpolicies" => delete_namespaced::<NetworkPolicy>(&client, ns, &name).await,
        "resourcequotas" => delete_namespaced::<ResourceQuota>(&client, ns, &name).await,
        "limitranges" => delete_namespaced::<LimitRange>(&client, ns, &name).await,
        "serviceaccounts" => delete_namespaced::<ServiceAccount>(&client, ns, &name).await,
        "roles" => delete_namespaced::<K8sRole>(&client, ns, &name).await,
        "rolebindings" => delete_namespaced::<RoleBinding>(&client, ns, &name).await,
        "horizontalpodautoscalers" => delete_namespaced::<HorizontalPodAutoscaler>(&client, ns, &name).await,
        "poddisruptionbudgets" => delete_namespaced::<PodDisruptionBudget>(&client, ns, &name).await,
        "endpoints" => delete_namespaced::<Endpoints>(&client, ns, &name).await,
        "namespaces" => delete_cluster_scoped::<Namespace>(&client, &name).await,
        "persistentvolumes" => delete_cluster_scoped::<PersistentVolume>(&client, &name).await,
        "storageclasses" => delete_cluster_scoped::<StorageClass>(&client, &name).await,
        "clusterroles" => delete_cluster_scoped::<ClusterRole>(&client, &name).await,
        "clusterrolebindings" => delete_cluster_scoped::<ClusterRoleBinding>(&client, &name).await,
        "ingressclasses" => delete_cluster_scoped::<IngressClass>(&client, &name).await,
        _ => {
            return Ok((
                StatusCode::BAD_REQUEST,
                Json(json!({"error": format!("Unknown resource kind: {kind}")})),
            )
                .into_response());
        }
    };

    match result {
        Ok(()) => Ok(Json(json!({"status": "deleted", "kind": kind, "name": name})).into_response()),
        Err(e) => Ok((StatusCode::BAD_GATEWAY, Json(json!({"error": e}))).into_response()),
    }
}

// ============================================================================
// Generic helpers — powered by kube-rs Api<T>
// ============================================================================

async fn list_namespaced<T>(
    client: &kube::Client,
    ns: &str,
    params: &ResourceQuery,
) -> Result<serde_json::Value, String>
where
    T: kube::Resource<Scope = k8s_openapi::NamespaceResourceScope, DynamicType = ()>
        + Clone
        + serde::de::DeserializeOwned
        + serde::Serialize
        + std::fmt::Debug,
{
    let api: Api<T> = Api::namespaced(client.clone(), ns);
    let mut lp = ListParams::default();
    if let Some(ref labels) = params.label_selector {
        lp = lp.labels(labels);
    }
    if let Some(ref fields) = params.field_selector {
        lp = lp.fields(fields);
    }
    let list = api.list(&lp).await.map_err(|e| e.to_string())?;
    serde_json::to_value(list.items).map_err(|e| e.to_string())
}

async fn list_cluster_scoped<T>(
    client: &kube::Client,
    params: &ResourceQuery,
) -> Result<serde_json::Value, String>
where
    T: kube::Resource<Scope = k8s_openapi::ClusterResourceScope, DynamicType = ()>
        + Clone
        + serde::de::DeserializeOwned
        + serde::Serialize
        + std::fmt::Debug,
{
    let api: Api<T> = Api::all(client.clone());
    let mut lp = ListParams::default();
    if let Some(ref labels) = params.label_selector {
        lp = lp.labels(labels);
    }
    if let Some(ref fields) = params.field_selector {
        lp = lp.fields(fields);
    }
    let list = api.list(&lp).await.map_err(|e| e.to_string())?;
    serde_json::to_value(list.items).map_err(|e| e.to_string())
}

async fn get_namespaced<T>(
    client: &kube::Client,
    ns: &str,
    name: &str,
) -> Result<serde_json::Value, String>
where
    T: kube::Resource<Scope = k8s_openapi::NamespaceResourceScope, DynamicType = ()>
        + Clone
        + serde::de::DeserializeOwned
        + serde::Serialize
        + std::fmt::Debug,
{
    let api: Api<T> = Api::namespaced(client.clone(), ns);
    let resource = api.get(name).await.map_err(|e| e.to_string())?;
    serde_json::to_value(resource).map_err(|e| e.to_string())
}

async fn get_cluster_scoped<T>(
    client: &kube::Client,
    name: &str,
) -> Result<serde_json::Value, String>
where
    T: kube::Resource<Scope = k8s_openapi::ClusterResourceScope, DynamicType = ()>
        + Clone
        + serde::de::DeserializeOwned
        + serde::Serialize
        + std::fmt::Debug,
{
    let api: Api<T> = Api::all(client.clone());
    let resource = api.get(name).await.map_err(|e| e.to_string())?;
    serde_json::to_value(resource).map_err(|e| e.to_string())
}

async fn delete_namespaced<T>(
    client: &kube::Client,
    ns: &str,
    name: &str,
) -> Result<(), String>
where
    T: kube::Resource<Scope = k8s_openapi::NamespaceResourceScope, DynamicType = ()>
        + Clone
        + serde::de::DeserializeOwned
        + std::fmt::Debug,
{
    let api: Api<T> = Api::namespaced(client.clone(), ns);
    api.delete(name, &DeleteParams::default())
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

async fn delete_cluster_scoped<T>(
    client: &kube::Client,
    name: &str,
) -> Result<(), String>
where
    T: kube::Resource<Scope = k8s_openapi::ClusterResourceScope, DynamicType = ()>
        + Clone
        + serde::de::DeserializeOwned
        + std::fmt::Debug,
{
    let api: Api<T> = Api::all(client.clone());
    api.delete(name, &DeleteParams::default())
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// ============================================================================
// Secrets — mask .data values for security
// ============================================================================

async fn list_secrets(
    client: &kube::Client,
    ns: &str,
    params: &ResourceQuery,
) -> Result<serde_json::Value, String> {
    let api: Api<Secret> = Api::namespaced(client.clone(), ns);
    let mut lp = ListParams::default();
    if let Some(ref labels) = params.label_selector {
        lp = lp.labels(labels);
    }
    if let Some(ref fields) = params.field_selector {
        lp = lp.fields(fields);
    }
    let list = api.list(&lp).await.map_err(|e| e.to_string())?;
    let masked: Vec<serde_json::Value> = list
        .items
        .into_iter()
        .map(|s| mask_secret_data(s))
        .collect();
    serde_json::to_value(masked).map_err(|e| e.to_string())
}

async fn get_secret(
    client: &kube::Client,
    ns: &str,
    name: &str,
) -> Result<serde_json::Value, String> {
    let api: Api<Secret> = Api::namespaced(client.clone(), ns);
    let secret = api.get(name).await.map_err(|e| e.to_string())?;
    let masked = mask_secret_data(secret);
    serde_json::to_value(masked).map_err(|e| e.to_string())
}

fn mask_secret_data(mut secret: Secret) -> serde_json::Value {
    // Replace data values with "***" but keep keys visible
    if let Some(ref data) = secret.data {
        let masked: std::collections::BTreeMap<String, String> = data
            .keys()
            .map(|k| (k.clone(), "***".to_string()))
            .collect();
        secret.data = None;
        let mut val = serde_json::to_value(secret).unwrap_or_default();
        val["data"] = serde_json::to_value(masked).unwrap_or_default();
        val
    } else {
        serde_json::to_value(secret).unwrap_or_default()
    }
}
