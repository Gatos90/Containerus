use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use containerus_rbac_macros::require_permissions;
use serde_json::json;
use uuid::Uuid;

use crate::auth::middleware::{AuthUser, ProjectScoped};
use crate::db::models::{ClusterResponse, ClusterRow};
use crate::k8s::manager::K8sError;
use crate::AppState;

use super::common::{get_verified_cluster, verify_cluster_access, CreateClusterRequest, UpdateClusterRequest};

/// Routes for single-cluster operations (get, update, delete, test).
pub fn single_cluster_router() -> Router<AppState> {
    Router::new()
        .route("/{id}", get(get_cluster).put(update_cluster).delete(delete_cluster))
        .route("/{id}/test", post(test_cluster))
}

/// Routes for listing/creating clusters within an environment.
pub fn environment_router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_clusters).post(create_cluster))
}

// ============================================================================
// Handlers — environment-scoped (list / create)
// ============================================================================

#[require_permissions("clusters.view")]
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

#[require_permissions("clusters.create")]
async fn create_cluster(
    user: ProjectScoped,
    State(state): State<AppState>,
    Path((_pid, environment_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<CreateClusterRequest>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    user.require("clusters.create").map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;

    let name = req.name.trim();
    if name.is_empty() || name.len() > 255 {
        return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": "Cluster name must be 1-255 characters"}))).into_response());
    }
    if req.kubeconfig.trim().is_empty() {
        return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": "kubeconfig is required"}))).into_response());
    }

    match state
        .k8s
        .store_cluster(
            &state.db,
            environment_id,
            name,
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
// Handlers — single-cluster operations
// ============================================================================

#[require_permissions("clusters.view")]
async fn get_cluster(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    let cluster = get_verified_cluster(&state, id).await?;
    verify_cluster_access(&state, &auth.claims, &cluster, "clusters.view").await?;
    Ok(Json(json!(ClusterResponse::from(cluster))).into_response())
}

#[require_permissions("clusters.edit")]
async fn update_cluster(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateClusterRequest>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    let cluster = get_verified_cluster(&state, id).await?;
    verify_cluster_access(&state, &auth.claims, &cluster, "clusters.edit").await?;

    if let Some(ref name) = req.name {
        let name = name.trim();
        if name.is_empty() || name.len() > 255 {
            return Ok((StatusCode::BAD_REQUEST, Json(json!({"error": "Cluster name must be 1-255 characters"}))).into_response());
        }
    }

    match state
        .k8s
        .update_cluster(
            &state.db,
            id,
            req.name.as_deref(),
            req.kubeconfig.as_deref(),
            req.context_name.as_ref().map(|c| Some(c.as_str())),
        )
        .await
    {
        Ok(row) => Ok(Json(json!(ClusterResponse::from(row))).into_response()),
        Err(e) => {
            tracing::error!("Failed to update cluster: {e}");
            Ok((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": format!("Failed to update cluster: {e}")}))).into_response())
        }
    }
}

#[require_permissions("clusters.delete")]
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

#[require_permissions("clusters.view")]
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
