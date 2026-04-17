use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use kube::{
    api::{Api, DeleteParams, DynamicObject, ListParams, Patch, PatchParams},
    discovery::{self, ApiResource, Scope},
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::auth::middleware::AuthUser;
use crate::AppState;

use super::common::{get_kube_client, get_verified_cluster, verify_cluster_access, ResourceQuery};

/// Built-in resource kinds that are already handled by resources.rs — excluded from CRD discovery.
const BUILTIN_KINDS: &[&str] = &[
    "Pod", "Service", "ConfigMap", "Secret", "Namespace", "Node", "Event",
    "PersistentVolumeClaim", "PersistentVolume", "Deployment", "StatefulSet",
    "DaemonSet", "ReplicaSet", "Job", "CronJob", "Ingress", "IngressClass",
    "NetworkPolicy", "ResourceQuota", "LimitRange", "ServiceAccount",
    "Role", "RoleBinding", "ClusterRole", "ClusterRoleBinding",
    "HorizontalPodAutoscaler", "PodDisruptionBudget", "Endpoints",
    "StorageClass",
    // Common built-in kinds that aren't in resources.rs but shouldn't show as CRDs
    "Binding", "ComponentStatus", "APIService", "Lease", "EndpointSlice",
    "ControllerRevision", "TokenReview", "SubjectAccessReview",
    "SelfSubjectAccessReview", "SelfSubjectRulesReview", "LocalSubjectAccessReview",
    "CertificateSigningRequest", "MutatingWebhookConfiguration",
    "ValidatingWebhookConfiguration", "ValidatingAdmissionPolicy",
    "ValidatingAdmissionPolicyBinding", "CustomResourceDefinition",
    "PriorityClass", "CSIDriver", "CSINode", "CSIStorageCapacity",
    "VolumeAttachment", "FlowSchema", "PriorityLevelConfiguration",
    "RuntimeClass", "PodTemplate",
];

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/{id}/discovery", get(discover_api_resources))
        .route(
            "/{id}/custom/{group}/{version}/{plural}",
            get(list_custom_resources),
        )
        .route(
            "/{id}/custom/{group}/{version}/{plural}/{name}",
            get(get_custom_resource).delete(delete_custom_resource),
        )
        .route(
            "/{id}/custom/{group}/{version}/{plural}/apply",
            post(apply_custom_resource),
        )
}

// ============================================================================
// Discovery — list all API resources (filtered to CRDs)
// ============================================================================

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiResourceInfo {
    group: String,
    version: String,
    kind: String,
    plural: String,
    scope: String, // "Namespaced" or "Cluster"
}

async fn discover_api_resources(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    let cluster = get_verified_cluster(&state, id).await?;
    verify_cluster_access(&state, &auth.claims, &cluster, "clusters.view").await?;

    let client = get_kube_client(&state, &cluster).await?;

    let discovery = match discovery::Discovery::new(client)
        .run()
        .await
    {
        Ok(d) => d,
        Err(e) => {
            return Ok((
                StatusCode::BAD_GATEWAY,
                Json(json!({"error": format!("Discovery failed: {e}")})),
            )
                .into_response());
        }
    };

    let mut resources: Vec<ApiResourceInfo> = Vec::new();

    for group in discovery.groups() {
        for (ar, caps) in group.recommended_resources() {
            // Skip built-in resource types
            if BUILTIN_KINDS.contains(&ar.kind.as_str()) {
                continue;
            }

            resources.push(ApiResourceInfo {
                group: ar.group.clone(),
                version: ar.version.clone(),
                kind: ar.kind.clone(),
                plural: ar.plural.clone(),
                scope: match caps.scope {
                    Scope::Cluster => "Cluster".to_string(),
                    Scope::Namespaced => "Namespaced".to_string(),
                },
            });
        }
    }

    Ok(Json(resources).into_response())
}

// ============================================================================
// List custom resources
// ============================================================================

async fn list_custom_resources(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((id, group, version, plural)): Path<(Uuid, String, String, String)>,
    Query(params): Query<ResourceQuery>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    let cluster = get_verified_cluster(&state, id).await?;
    verify_cluster_access(&state, &auth.claims, &cluster, "clusters.view").await?;

    let client = get_kube_client(&state, &cluster).await?;

    let ar = ApiResource {
        group: group.clone(),
        version: version.clone(),
        kind: String::new(), // not needed for list
        plural: plural.clone(),
        api_version: if group.is_empty() {
            version.clone()
        } else {
            format!("{group}/{version}")
        },
    };

    let mut lp = ListParams::default();
    if let Some(ref labels) = params.label_selector {
        lp = lp.labels(labels);
    }
    if let Some(ref fields) = params.field_selector {
        lp = lp.fields(fields);
    }

    let api: Api<DynamicObject> = if let Some(ref ns) = params.namespace {
        Api::namespaced_with(client, ns, &ar)
    } else {
        Api::all_with(client, &ar)
    };

    match api.list(&lp).await {
        Ok(list) => {
            let items: Vec<serde_json::Value> = list
                .items
                .into_iter()
                .filter_map(|obj| serde_json::to_value(obj).ok())
                .collect();
            Ok(Json(items).into_response())
        }
        Err(e) => Ok((
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": format!("Failed to list: {e}")})),
        )
            .into_response()),
    }
}

// ============================================================================
// Get single custom resource
// ============================================================================

async fn get_custom_resource(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((id, group, version, plural, name)): Path<(Uuid, String, String, String, String)>,
    Query(params): Query<ResourceQuery>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    let cluster = get_verified_cluster(&state, id).await?;
    verify_cluster_access(&state, &auth.claims, &cluster, "clusters.view").await?;

    let client = get_kube_client(&state, &cluster).await?;

    let ar = ApiResource {
        group: group.clone(),
        version: version.clone(),
        kind: String::new(),
        plural: plural.clone(),
        api_version: if group.is_empty() {
            version.clone()
        } else {
            format!("{group}/{version}")
        },
    };

    let api: Api<DynamicObject> = if let Some(ref ns) = params.namespace {
        Api::namespaced_with(client, ns, &ar)
    } else {
        Api::all_with(client, &ar)
    };

    match api.get(&name).await {
        Ok(obj) => match serde_json::to_value(obj) {
            Ok(val) => Ok(Json(val).into_response()),
            Err(e) => Ok((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": format!("Serialization error: {e}")})),
            )
                .into_response()),
        },
        Err(e) => Ok((
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": format!("Failed to get: {e}")})),
        )
            .into_response()),
    }
}

// ============================================================================
// Delete custom resource
// ============================================================================

async fn delete_custom_resource(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((id, group, version, plural, name)): Path<(Uuid, String, String, String, String)>,
    Query(params): Query<ResourceQuery>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    let cluster = get_verified_cluster(&state, id).await?;
    verify_cluster_access(&state, &auth.claims, &cluster, "clusters.delete.workload").await?;

    let client = get_kube_client(&state, &cluster).await?;

    let ar = ApiResource {
        group: group.clone(),
        version: version.clone(),
        kind: String::new(),
        plural: plural.clone(),
        api_version: if group.is_empty() {
            version.clone()
        } else {
            format!("{group}/{version}")
        },
    };

    let api: Api<DynamicObject> = if let Some(ref ns) = params.namespace {
        Api::namespaced_with(client, ns, &ar)
    } else {
        Api::all_with(client, &ar)
    };

    match api.delete(&name, &DeleteParams::default()).await {
        Ok(_) => Ok(Json(json!({"status": "deleted", "name": name})).into_response()),
        Err(e) => Ok((
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": format!("Failed to delete: {e}")})),
        )
            .into_response()),
    }
}

// ============================================================================
// Apply (create/update) custom resource
// ============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApplyCustomResourceRequest {
    namespace: Option<String>,
    yaml: String,
}

async fn apply_custom_resource(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((id, group, version, plural)): Path<(Uuid, String, String, String)>,
    Json(req): Json<ApplyCustomResourceRequest>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    let cluster = get_verified_cluster(&state, id).await?;
    verify_cluster_access(&state, &auth.claims, &cluster, "clusters.apply").await?;

    let client = get_kube_client(&state, &cluster).await?;

    let value: serde_json::Value = match serde_yaml::from_str(&req.yaml) {
        Ok(v) => v,
        Err(e) => {
            return Ok((
                StatusCode::BAD_REQUEST,
                Json(json!({"error": format!("Invalid YAML: {e}")})),
            )
                .into_response());
        }
    };

    let name = value
        .get("metadata")
        .and_then(|m| m.get("name"))
        .and_then(|n| n.as_str());
    let Some(name) = name else {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "metadata.name is required"})),
        )
            .into_response());
    };

    let ar = ApiResource {
        group: group.clone(),
        version: version.clone(),
        kind: value
            .get("kind")
            .and_then(|k| k.as_str())
            .unwrap_or("")
            .to_string(),
        plural: plural.clone(),
        api_version: if group.is_empty() {
            version.clone()
        } else {
            format!("{group}/{version}")
        },
    };

    let api: Api<DynamicObject> = if let Some(ref ns) = req.namespace {
        Api::namespaced_with(client, ns, &ar)
    } else {
        Api::all_with(client, &ar)
    };

    let pp = PatchParams::apply("containerus");
    let patch = Patch::Apply(&value);

    match api.patch(name, &pp, &patch).await {
        Ok(_) => Ok(Json(json!({"status": "applied", "name": name})).into_response()),
        Err(e) => Ok((
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": format!("Apply failed: {e}")})),
        )
            .into_response()),
    }
}
