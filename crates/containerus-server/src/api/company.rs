use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::audit::log_action;
use crate::auth::middleware::AuthUser;
use crate::db::models::Company;
use crate::AppState;

// ============================================================================
// Company Router — /api/company
// ============================================================================

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(get_company).put(update_company))
        .route("/admins", get(list_admins).post(add_admin))
        .route("/admins/{user_id}", delete(remove_admin))
}

// ============================================================================
// Request / Response types
// ============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCompanyRequest {
    pub name: String,
    pub slug: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddAdminRequest {
    pub user_id: Uuid,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanyAdminResponse {
    pub user_id: Uuid,
    pub email: String,
    pub display_name: String,
    pub granted_at: chrono::DateTime<chrono::Utc>,
}

// We need FromRow for the query_as macro
impl<'r> sqlx::FromRow<'r, sqlx::postgres::PgRow> for CompanyAdminResponse {
    fn from_row(row: &'r sqlx::postgres::PgRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;
        Ok(Self {
            user_id: row.try_get("user_id")?,
            email: row.try_get("email")?,
            display_name: row.try_get("display_name")?,
            granted_at: row.try_get("granted_at")?,
        })
    }
}

// ============================================================================
// Handlers
// ============================================================================

/// Get the company info (singleton row).
async fn get_company(
    State(state): State<AppState>,
    _auth: AuthUser,
) -> Result<Json<Company>, (StatusCode, Json<Value>)> {
    let company = sqlx::query_as::<_, Company>(
        "SELECT * FROM company LIMIT 1",
    )
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to fetch company: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({ "error": "Company not configured" }))))?;

    Ok(Json(company))
}

/// Update the company info. Requires company admin.
async fn update_company(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<UpdateCompanyRequest>,
) -> Result<Json<Company>, (StatusCode, Json<Value>)> {
    if !auth.claims.is_company_admin {
        return Err((StatusCode::FORBIDDEN, Json(json!({ "error": "Company admin required" }))));
    }

    if req.name.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "Company name is required" }))));
    }
    let slug = req.slug.trim();
    if slug.is_empty()
        || slug.len() > 64
        || !slug.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        || slug.starts_with('-')
        || slug.ends_with('-')
    {
        return Err((StatusCode::BAD_REQUEST, Json(json!({
            "error": "Slug must be 1-64 characters, lowercase alphanumeric and hyphens only, no leading/trailing hyphens"
        }))));
    }

    let company = sqlx::query_as::<_, Company>(
        r#"
        UPDATE company SET name = $1, slug = $2, updated_at = now()
        WHERE id = (SELECT id FROM company LIMIT 1)
        RETURNING *
        "#,
    )
    .bind(req.name.trim())
    .bind(slug)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to update company: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({ "error": "Company not configured" }))))?;

    log_action(&state.db, None, Some(auth.claims.sub), "company.update", "company", Some(&company.id.to_string()), Some(json!({"name": &company.name, "slug": &company.slug})), None, None).await;

    Ok(Json(company))
}

/// List all company admins. Requires company admin.
async fn list_admins(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<CompanyAdminResponse>>, (StatusCode, Json<Value>)> {
    if !auth.claims.is_company_admin {
        return Err((StatusCode::FORBIDDEN, Json(json!({ "error": "Company admin required" }))));
    }

    let admins = sqlx::query_as::<_, CompanyAdminResponse>(
        r#"
        SELECT ca.user_id, u.email, u.display_name, ca.granted_at
        FROM company_admins ca
        JOIN users u ON u.id = ca.user_id
        ORDER BY ca.granted_at
        "#,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to list company admins: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?;

    Ok(Json(admins))
}

/// Add a user as a company admin. Requires company admin.
async fn add_admin(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<AddAdminRequest>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    if !auth.claims.is_company_admin {
        return Err((StatusCode::FORBIDDEN, Json(json!({ "error": "Company admin required" }))));
    }

    // Verify the target user exists
    let user_exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM users WHERE id = $1 AND is_active = true)",
    )
    .bind(req.user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to check user existence: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?;

    if !user_exists {
        return Err((StatusCode::NOT_FOUND, Json(json!({ "error": "User not found" }))));
    }

    sqlx::query(
        "INSERT INTO company_admins (user_id, granted_by) VALUES ($1, $2)",
    )
    .bind(req.user_id)
    .bind(auth.claims.sub)
    .execute(&state.db)
    .await
    .map_err(|e| {
        if let Some(db_err) = e.as_database_error() {
            if db_err.is_unique_violation() {
                return (StatusCode::CONFLICT, Json(json!({ "error": "User is already a company admin" })));
            }
        }
        tracing::error!("Failed to add company admin: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?;

    log_action(&state.db, None, Some(auth.claims.sub), "admin.add", "company_admin", Some(&req.user_id.to_string()), None, None, None).await;

    Ok((StatusCode::CREATED, Json(json!({ "message": "Admin added successfully" }))))
}

/// Remove a company admin. Cannot remove yourself. At least one admin must remain.
/// Requires company admin.
async fn remove_admin(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(user_id): Path<Uuid>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if !auth.claims.is_company_admin {
        return Err((StatusCode::FORBIDDEN, Json(json!({ "error": "Company admin required" }))));
    }

    // Cannot remove yourself
    if user_id == auth.claims.sub {
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "Cannot remove yourself as company admin" }))));
    }

    // Use a transaction with row locking to prevent concurrent removals from leaving zero admins
    let mut tx = state.db.begin().await.map_err(|e| {
        tracing::error!("Failed to start transaction: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?;

    // Lock all admin rows and count them
    let admin_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM company_admins FOR UPDATE"
    )
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to count admins: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?;

    // Check if the target is actually an admin
    let is_admin: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM company_admins WHERE user_id = $1)",
    )
    .bind(user_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to check admin status: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?;

    if !is_admin {
        return Err((StatusCode::NOT_FOUND, Json(json!({ "error": "User is not a company admin" }))));
    }

    if admin_count <= 1 {
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "Cannot remove the last company admin" }))));
    }

    sqlx::query("DELETE FROM company_admins WHERE user_id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Failed to remove company admin: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
        })?;

    tx.commit().await.map_err(|e| {
        tracing::error!("Failed to commit admin removal: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal server error" })))
    })?;

    log_action(&state.db, None, Some(auth.claims.sub), "admin.remove", "company_admin", Some(&user_id.to_string()), None, None, None).await;

    Ok(Json(json!({ "message": "Admin removed successfully" })))
}
