use serde_json::Value as JsonValue;
use sqlx::PgPool;
use uuid::Uuid;

/// Log an action to the audit trail.
pub async fn log_action(
    db: &PgPool,
    project_id: Option<Uuid>,
    user_id: Option<Uuid>,
    action: &str,
    resource_type: &str,
    resource_id: Option<&str>,
    details: Option<JsonValue>,
    ip_address: Option<&str>,
    environment_id: Option<Uuid>,
) {
    let result = sqlx::query(
        r#"
        INSERT INTO audit_log (project_id, user_id, action, resource_type, resource_id, details, ip_address, environment_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
    )
    .bind(project_id)
    .bind(user_id)
    .bind(action)
    .bind(resource_type)
    .bind(resource_id)
    .bind(details)
    .bind(ip_address)
    .bind(environment_id)
    .execute(db)
    .await;

    if let Err(e) = result {
        tracing::error!(
            error = %e,
            action = action,
            resource_type = resource_type,
            resource_id = ?resource_id,
            "Failed to write audit log"
        );
    }
}

/// Convenience helper for system-related audit events.
pub async fn log_system_action(
    db: &PgPool,
    project_id: Uuid,
    user_id: Uuid,
    action: &str,
    system_id: Uuid,
    details: Option<JsonValue>,
    environment_id: Option<Uuid>,
) {
    log_action(
        db,
        Some(project_id),
        Some(user_id),
        action,
        "system",
        Some(&system_id.to_string()),
        details,
        None,
        environment_id,
    )
    .await;
}

/// Convenience helper for container-related audit events.
pub async fn log_container_action(
    db: &PgPool,
    project_id: Uuid,
    user_id: Uuid,
    action: &str,
    system_id: Uuid,
    container_id: &str,
    environment_id: Option<Uuid>,
) {
    log_action(
        db,
        Some(project_id),
        Some(user_id),
        action,
        "container",
        Some(container_id),
        Some(serde_json::json!({"systemId": system_id.to_string()})),
        None,
        environment_id,
    )
    .await;
}

/// Convenience helper for member-related audit events.
pub async fn log_member_action(
    db: &PgPool,
    project_id: Uuid,
    user_id: Uuid,
    action: &str,
    target_user_id: Uuid,
    details: Option<JsonValue>,
) {
    log_action(
        db,
        Some(project_id),
        Some(user_id),
        action,
        "member",
        Some(&target_user_id.to_string()),
        details,
        None,
        None,
    )
    .await;
}
