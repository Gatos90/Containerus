use axum::http::StatusCode;
use axum::Json;
use kube::Client;
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::db::models::ClusterRow;
use crate::AppState;

// ============================================================================
// Request types
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateClusterRequest {
    pub name: Option<String>,
    /// Full kubeconfig YAML content (replaces existing)
    pub kubeconfig: Option<String>,
    /// Optional context name within the kubeconfig
    pub context_name: Option<String>,
}

impl std::fmt::Debug for UpdateClusterRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("UpdateClusterRequest")
            .field("name", &self.name)
            .field("kubeconfig", &self.kubeconfig.as_ref().map(|_| "[REDACTED]"))
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
    pub namespace: Option<String>,
    pub yaml: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceQuery {
    pub namespace: Option<String>,
    pub label_selector: Option<String>,
    pub field_selector: Option<String>,
}

// ============================================================================
// Shared helpers
// ============================================================================

pub type ApiError = (StatusCode, Json<serde_json::Value>);

/// Look up a cluster by ID (no project/environment filter).
pub async fn get_verified_cluster(
    state: &AppState,
    cluster_id: Uuid,
) -> Result<ClusterRow, ApiError> {
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
pub async fn verify_cluster_access(
    state: &AppState,
    claims: &crate::auth::jwt::AccessClaims,
    cluster: &ClusterRow,
    required_permission: &str,
) -> Result<(), ApiError> {
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

pub async fn get_kube_client(
    state: &AppState,
    cluster: &ClusterRow,
) -> Result<Client, ApiError> {
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

pub fn format_age(created: Option<chrono::DateTime<chrono::Utc>>) -> String {
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
