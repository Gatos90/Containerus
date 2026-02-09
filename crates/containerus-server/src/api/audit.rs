use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::FromRow;
use uuid::Uuid;

use crate::auth::middleware::ProjectScoped;
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(list_audit_logs))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub action: Option<String>,
    pub resource_type: Option<String>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditLogEntry {
    pub id: Uuid,
    pub project_id: Option<Uuid>,
    pub user_id: Option<Uuid>,
    pub action: String,
    pub resource_type: String,
    pub resource_id: Option<String>,
    pub details: Option<serde_json::Value>,
    pub ip_address: Option<String>,
    pub environment_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

/// API response DTO that conditionally includes ip_address based on permissions.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuditLogResponse {
    pub id: Uuid,
    pub project_id: Option<Uuid>,
    pub user_id: Option<Uuid>,
    pub action: String,
    pub resource_type: String,
    pub resource_id: Option<String>,
    pub details: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ip_address: Option<String>,
    pub environment_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

impl AuditLogEntry {
    fn to_response(self, include_ip: bool) -> AuditLogResponse {
        AuditLogResponse {
            id: self.id,
            project_id: self.project_id,
            user_id: self.user_id,
            action: self.action,
            resource_type: self.resource_type,
            resource_id: self.resource_id,
            details: self.details,
            ip_address: if include_ip { self.ip_address } else { None },
            environment_id: self.environment_id,
            created_at: self.created_at,
        }
    }
}

/// List audit log entries for the project.
async fn list_audit_logs(
    user: ProjectScoped,
    State(state): State<AppState>,
    Query(query): Query<AuditQuery>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    user.require("audit.view").map_err(|_| (StatusCode::FORBIDDEN, Json(json!({"error": "Insufficient permissions"}))))?;

    let include_ip = user.permissions.has("audit.view_ip");

    let limit = query.limit.unwrap_or(50).clamp(1, 200);
    let offset = query.offset.unwrap_or(0).max(0);
    let project_id = user.project_id;

    // Build query dynamically to support combined filters
    let mut sql = String::from("SELECT * FROM audit_log WHERE project_id = $1");
    let mut param_idx: u32 = 2;

    if query.action.is_some() {
        sql.push_str(&format!(" AND action = ${param_idx}"));
        param_idx += 1;
    }
    if query.resource_type.is_some() {
        sql.push_str(&format!(" AND resource_type = ${param_idx}"));
        param_idx += 1;
    }

    sql.push_str(&format!(
        " ORDER BY created_at DESC LIMIT ${} OFFSET ${}",
        param_idx,
        param_idx + 1
    ));

    let mut db_query = sqlx::query_as::<_, AuditLogEntry>(&sql).bind(project_id);

    if let Some(ref action) = query.action {
        db_query = db_query.bind(action);
    }
    if let Some(ref resource_type) = query.resource_type {
        db_query = db_query.bind(resource_type);
    }

    db_query = db_query.bind(limit).bind(offset);

    let rows = db_query.fetch_all(&state.db).await;

    match rows {
        Ok(entries) => {
            let responses: Vec<AuditLogResponse> = entries
                .into_iter()
                .map(|e| e.to_response(include_ip))
                .collect();
            Ok(Json(json!(responses)).into_response())
        }
        Err(e) => {
            tracing::error!("Failed to fetch audit logs: {e}");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to fetch audit logs"})),
            ))
        }
    }
}
