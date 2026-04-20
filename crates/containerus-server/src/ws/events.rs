//! CON-122: real-time permission-cache invalidation bus.
//!
//! Per-user in-process broadcast channels. RBAC writes (role, project
//! member, resource_acl) publish a `PermissionEvent` scoped to the
//! affected user(s); connected WS sessions relay it to the client so
//! the in-memory permission cache flushes and `/auth/me` is refetched
//! without a manual page refresh.
//!
//! The bus is deliberately per-process — a later multi-replica rollout
//! would swap the backing channel for Redis pub/sub, but handlers
//! interact only with the published API here.

use dashmap::DashMap;
use serde::Serialize;
use sqlx::PgPool;
use std::sync::Arc;
use tokio::sync::broadcast;
use uuid::Uuid;

/// Scope of a permission invalidation. Clients use this as a hint for
/// UX (e.g. which banner to dismiss) but MUST always refetch `/auth/me`
/// regardless — the event is only an invalidation signal.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InvalidationScope {
    /// A role definition or its permission set changed.
    Role,
    /// A project membership (add/remove/change role) changed.
    Member,
    /// A resource ACL row for the user changed.
    Acl,
}

/// One invalidation signal delivered to a single user's subscribers.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PermissionEvent {
    #[serde(rename = "permissions.invalidated")]
    Invalidated {
        scope: InvalidationScope,
        /// Optional project hint when the change is project-scoped.
        #[serde(rename = "projectId", skip_serializing_if = "Option::is_none")]
        project_id: Option<Uuid>,
    },
}

impl PermissionEvent {
    pub fn invalidated(scope: InvalidationScope, project_id: Option<Uuid>) -> Self {
        Self::Invalidated { scope, project_id }
    }
}

/// Per-user broadcast channel capacity. Bursts of RBAC edits are rare;
/// clients only need the *most recent* signal to know their cache is
/// stale, so a small buffer with `Lagged` tolerance is fine.
const CHANNEL_CAPACITY: usize = 16;

/// Fanout of permission events to connected WS clients.
///
/// `channels` maps `user_id -> broadcast::Sender`. A sender with zero
/// receivers is left in the map until the next publish call cleans it
/// up; that avoids thrashing the map when a user briefly disconnects.
#[derive(Clone)]
pub struct PermissionEventBus {
    channels: Arc<DashMap<Uuid, broadcast::Sender<PermissionEvent>>>,
}

impl PermissionEventBus {
    pub fn new() -> Self {
        Self {
            channels: Arc::new(DashMap::new()),
        }
    }

    /// Open (or reuse) a subscription for `user_id`.
    pub fn subscribe(&self, user_id: Uuid) -> broadcast::Receiver<PermissionEvent> {
        let entry = self
            .channels
            .entry(user_id)
            .or_insert_with(|| broadcast::channel(CHANNEL_CAPACITY).0);
        entry.subscribe()
    }

    /// Publish an event to `user_id`. No-op when no one is subscribed.
    pub fn publish(&self, user_id: Uuid, event: PermissionEvent) {
        if let Some(tx) = self.channels.get(&user_id) {
            // `send` errors only when the channel has zero live
            // receivers; drop the stale entry so the map doesn't grow
            // unbounded for churned-out sessions.
            if tx.send(event).is_err() {
                drop(tx);
                self.channels.remove(&user_id);
            }
        }
    }

    /// Publish to every user currently holding the given role via
    /// `project_members.role_id`. Used by role and role-permission
    /// writes, which affect every member assigned to the role.
    pub async fn publish_for_role(
        &self,
        db: &PgPool,
        role_id: Uuid,
        scope: InvalidationScope,
    ) {
        let rows: Result<Vec<(Uuid, Uuid)>, _> = sqlx::query_as(
            r#"
            SELECT user_id, project_id
            FROM project_members
            WHERE role_id = $1
            "#,
        )
        .bind(role_id)
        .fetch_all(db)
        .await;

        match rows {
            Ok(rows) => {
                for (user_id, project_id) in rows {
                    self.publish(
                        user_id,
                        PermissionEvent::invalidated(scope, Some(project_id)),
                    );
                }
            }
            Err(e) => {
                tracing::warn!(
                    "permission event fanout: failed to resolve users for role {role_id}: {e}"
                );
            }
        }
    }
}

impl Default for PermissionEventBus {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn scoped_publish_does_not_leak_to_other_users() {
        let bus = PermissionEventBus::new();
        let user_a = Uuid::new_v4();
        let user_b = Uuid::new_v4();

        let mut rx_a = bus.subscribe(user_a);
        let mut rx_b = bus.subscribe(user_b);

        bus.publish(
            user_a,
            PermissionEvent::invalidated(InvalidationScope::Role, None),
        );

        // A receives the event.
        let ev = tokio::time::timeout(std::time::Duration::from_millis(50), rx_a.recv())
            .await
            .expect("A should receive")
            .expect("event");
        match ev {
            PermissionEvent::Invalidated { .. } => {}
        }

        // B must NOT receive anything — this is the CON-122 scoping
        // acceptance criterion.
        let leaked =
            tokio::time::timeout(std::time::Duration::from_millis(50), rx_b.recv()).await;
        assert!(leaked.is_err(), "event leaked to unrelated user");
    }

    #[test]
    fn event_serializes_with_expected_shape() {
        let pid = Uuid::nil();
        let ev = PermissionEvent::invalidated(InvalidationScope::Acl, Some(pid));
        let s = serde_json::to_string(&ev).expect("serialize");
        assert!(s.contains("\"type\":\"permissions.invalidated\""));
        assert!(s.contains("\"scope\":\"acl\""));
        assert!(s.contains("\"projectId\""));
    }
}
