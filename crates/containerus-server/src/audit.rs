use serde_json::Value as JsonValue;
use sqlx::PgPool;
use uuid::Uuid;

/// Who performed the audited action.
///
/// `User` covers interactive human sessions, `ApiToken` will be set by the
/// service-account / CI-bot auth path (CON-62g), and `System` is for
/// server-initiated work with no authenticated caller (seeds, background
/// reconciliation). The database column is a constrained string so new
/// variants need both a Rust change and a migration.
#[derive(Debug, Clone, Copy)]
pub enum AuditActor {
    User,
    ApiToken,
    System,
}

impl AuditActor {
    pub fn as_str(self) -> &'static str {
        match self {
            AuditActor::User => "user",
            AuditActor::ApiToken => "api_token",
            AuditActor::System => "system",
        }
    }
}

/// Resolved caller context for an audit entry. Built once per request (by
/// the auth extractors or a WS handler that has read `ConnectInfo`) and
/// passed into every emission. Carrying IP on the caller object is the
/// mechanism that makes "no more `None` for IP" mechanical: if you have an
/// `AuditCaller`, you have the IP.
#[derive(Debug, Clone)]
pub struct AuditCaller {
    pub actor: AuditActor,
    pub user_id: Option<Uuid>,
    pub ip_address: Option<String>,
}

impl AuditCaller {
    pub fn user(user_id: Uuid, ip: Option<String>) -> Self {
        Self { actor: AuditActor::User, user_id: Some(user_id), ip_address: ip }
    }

    pub fn system() -> Self {
        Self { actor: AuditActor::System, user_id: None, ip_address: None }
    }
}

/// Full audit event; callers build this and hand it to [`log_event`].
#[derive(Debug, Clone)]
pub struct AuditEvent<'a> {
    pub caller: &'a AuditCaller,
    pub project_id: Option<Uuid>,
    pub environment_id: Option<Uuid>,
    pub action: &'a str,
    pub resource_type: &'a str,
    pub resource_id: Option<&'a str>,
    pub details: Option<JsonValue>,
}

/// Insert a single audit_log row. Prefer this over the legacy [`log_action`]
/// helpers for new code — it forces the caller to name their actor kind and
/// plumb the client IP through.
pub async fn log_event(db: &PgPool, ev: AuditEvent<'_>) {
    let result = sqlx::query(
        r#"
        INSERT INTO audit_log (
            project_id, user_id, action, resource_type, resource_id,
            details, ip_address, environment_id, actor_type
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        "#,
    )
    .bind(ev.project_id)
    .bind(ev.caller.user_id)
    .bind(ev.action)
    .bind(ev.resource_type)
    .bind(ev.resource_id)
    .bind(ev.details)
    .bind(ev.caller.ip_address.as_deref())
    .bind(ev.environment_id)
    .bind(ev.caller.actor.as_str())
    .execute(db)
    .await;

    if let Err(e) = result {
        tracing::error!(
            error = %e,
            action = ev.action,
            resource_type = ev.resource_type,
            resource_id = ?ev.resource_id,
            "Failed to write audit log"
        );
    }
}

/// Log an action to the audit trail.
///
/// Retained as a thin wrapper over [`log_event`] while existing call sites
/// migrate to the new API. New code should build an [`AuditCaller`] from the
/// auth extractor (which carries the client IP) and call [`log_event`]
/// directly.
#[allow(clippy::too_many_arguments)]
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
    let caller = AuditCaller {
        actor: if user_id.is_some() { AuditActor::User } else { AuditActor::System },
        user_id,
        ip_address: ip_address.map(|s| s.to_string()),
    };
    log_event(
        db,
        AuditEvent {
            caller: &caller,
            project_id,
            environment_id,
            action,
            resource_type,
            resource_id,
            details,
        },
    )
    .await;
}

/// Convenience helper for system-related audit events.
pub async fn log_system_action(
    db: &PgPool,
    project_id: Uuid,
    caller: &AuditCaller,
    action: &str,
    system_id: Uuid,
    details: Option<JsonValue>,
    environment_id: Option<Uuid>,
) {
    log_event(
        db,
        AuditEvent {
            caller,
            project_id: Some(project_id),
            environment_id,
            action,
            resource_type: "system",
            resource_id: Some(&system_id.to_string()),
            details,
        },
    )
    .await;
}

/// Convenience helper for container-related audit events.
pub async fn log_container_action(
    db: &PgPool,
    project_id: Uuid,
    caller: &AuditCaller,
    action: &str,
    system_id: Uuid,
    container_id: &str,
    environment_id: Option<Uuid>,
) {
    log_event(
        db,
        AuditEvent {
            caller,
            project_id: Some(project_id),
            environment_id,
            action,
            resource_type: "container",
            resource_id: Some(container_id),
            details: Some(serde_json::json!({"systemId": system_id.to_string()})),
        },
    )
    .await;
}

/// Convenience helper for member-related audit events.
pub async fn log_member_action(
    db: &PgPool,
    project_id: Uuid,
    caller: &AuditCaller,
    action: &str,
    target_user_id: Uuid,
    details: Option<JsonValue>,
) {
    log_event(
        db,
        AuditEvent {
            caller,
            project_id: Some(project_id),
            environment_id: None,
            action,
            resource_type: "member",
            resource_id: Some(&target_user_id.to_string()),
            details,
        },
    )
    .await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audit_actor_str_values_match_db_check_constraint() {
        assert_eq!(AuditActor::User.as_str(), "user");
        assert_eq!(AuditActor::ApiToken.as_str(), "api_token");
        assert_eq!(AuditActor::System.as_str(), "system");
    }

    #[test]
    fn audit_caller_user_carries_ip() {
        let uid = Uuid::new_v4();
        let c = AuditCaller::user(uid, Some("203.0.113.7".into()));
        assert_eq!(c.user_id, Some(uid));
        assert_eq!(c.ip_address.as_deref(), Some("203.0.113.7"));
        assert_eq!(c.actor.as_str(), "user");
    }

    #[test]
    fn audit_caller_system_has_no_user_or_ip() {
        let c = AuditCaller::system();
        assert!(c.user_id.is_none());
        assert!(c.ip_address.is_none());
        assert_eq!(c.actor.as_str(), "system");
    }
}
