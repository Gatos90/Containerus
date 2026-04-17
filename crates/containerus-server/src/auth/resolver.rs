//! Permission resolution with deny > allow precedence.
//!
//! Six-step precedence (CON-62 plan §2 / CON-63):
//! 1. Company admin → allow
//! 2. `resource_acls.denied_permissions` at resource scope → deny (wins over everything below)
//! 3. `resource_acls.extra_permissions` at resource scope → allow
//! 4. Environment-level overrides (deny, then allow) — scaffolded here; table lands in CON-62c
//! 5. Project-level role grants (`project_members.role_id` → `role_permissions`)
//! 6. Default → deny
//!
//! The resolver is intentionally pure: callers assemble a [`ResolverInput`] from the
//! JWT, the `PermissionCache`, and (optionally) a [`ResourceAclView`] loaded from
//! `resource_acls`, then ask whether a single permission key is granted.
//! Keeping it pure makes the precedence table-testable without a live database.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::models::ResourceAcl;

/// Per-resource ACL overrides as consumed by the resolver.
/// Normalised from the stored `resource_acls` row (extra_permissions / denied_permissions
/// are `JSONB` arrays of permission keys in the database).
#[derive(Debug, Default, Clone)]
pub struct ResourceAclView {
    pub extra_permissions: HashSet<String>,
    pub denied_permissions: HashSet<String>,
}

impl ResourceAclView {
    /// Extract string arrays from the raw JSONB columns. Unknown shapes are tolerated
    /// (non-string entries are dropped) so a malformed row can never blow up the resolver.
    pub fn from_row(row: &ResourceAcl) -> Self {
        Self {
            extra_permissions: json_array_to_string_set(&row.extra_permissions),
            denied_permissions: json_array_to_string_set(&row.denied_permissions),
        }
    }
}

/// Environment-level per-user overrides. Populated once CON-62c ships the
/// `environment_role_overrides` table; today the loader always returns `None`
/// and the resolver simply skips this layer.
#[derive(Debug, Default, Clone)]
pub struct EnvOverrideView {
    pub extra_permissions: HashSet<String>,
    pub denied_permissions: HashSet<String>,
}

/// Everything the resolver needs for a single permission decision.
/// Borrowed rather than owned so the caller can assemble it from existing
/// in-memory structures without cloning the project-role permission set.
#[derive(Debug)]
pub struct ResolverInput<'a> {
    pub is_company_admin: bool,
    pub role_permissions: &'a HashSet<String>,
    pub resource_acl: Option<&'a ResourceAclView>,
    pub env_override: Option<&'a EnvOverrideView>,
}

/// Outcome of a permission check. We keep the variant list tiny on purpose —
/// handlers just need "did it pass or not" plus a reason for audit/log messages.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Decision {
    Allow,
    Deny,
}

impl Decision {
    pub fn is_allowed(self) -> bool {
        matches!(self, Decision::Allow)
    }
}

/// Which precedence layer produced the decision. Useful for audit emission and
/// for debugging "why did this fail" in the admin UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DecisionReason {
    CompanyAdmin,
    ResourceAclDeny,
    ResourceAclAllow,
    EnvOverrideDeny,
    EnvOverrideAllow,
    RoleGrant,
    Default,
}

/// Full resolver output: the decision plus which layer won.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResolvedPermission {
    pub decision: Decision,
    pub reason: DecisionReason,
}

impl ResolvedPermission {
    pub fn is_allowed(self) -> bool {
        self.decision.is_allowed()
    }
}

/// Resolve a single permission key against the layered precedence rules.
///
/// The six-step order mirrors the plan exactly. Each step either returns
/// (short-circuits) or falls through to the next. The function is pure and
/// deterministic, which keeps the behaviour easy to pin down in tests.
pub fn resolve(input: &ResolverInput<'_>, permission: &str) -> ResolvedPermission {
    // 1. Company admins bypass the per-resource layers entirely. This preserves
    //    the previous semantics; the plan calls this rule "(unchanged)".
    if input.is_company_admin {
        return ResolvedPermission { decision: Decision::Allow, reason: DecisionReason::CompanyAdmin };
    }

    // 2. Resource-scoped deny — wins over every lower-precedence allow.
    if let Some(acl) = input.resource_acl {
        if acl.denied_permissions.contains(permission) {
            return ResolvedPermission { decision: Decision::Deny, reason: DecisionReason::ResourceAclDeny };
        }
    }

    // 3. Resource-scoped allow — beats env + role allows, but not a resource deny above.
    if let Some(acl) = input.resource_acl {
        if acl.extra_permissions.contains(permission) {
            return ResolvedPermission { decision: Decision::Allow, reason: DecisionReason::ResourceAclAllow };
        }
    }

    // 4. Environment-scoped override — deny wins over allow within the same layer.
    if let Some(env) = input.env_override {
        if env.denied_permissions.contains(permission) {
            return ResolvedPermission { decision: Decision::Deny, reason: DecisionReason::EnvOverrideDeny };
        }
        if env.extra_permissions.contains(permission) {
            return ResolvedPermission { decision: Decision::Allow, reason: DecisionReason::EnvOverrideAllow };
        }
    }

    // 5. Project-level role grants from `project_members.role_id` → `role_permissions`.
    if input.role_permissions.contains(permission) {
        return ResolvedPermission { decision: Decision::Allow, reason: DecisionReason::RoleGrant };
    }

    // 6. Default deny.
    ResolvedPermission { decision: Decision::Deny, reason: DecisionReason::Default }
}

/// Load the (at most one) `resource_acls` row for the given user + resource.
/// Returns `None` if no ACL row exists. Callers should then construct a
/// [`ResolverInput`] with `resource_acl = None`.
///
/// `resource_type` must be one of the CHECK-constrained strings in `resource_acls`
/// (`system`, `cluster`, `environment`). We don't enforce that in Rust; the DB does.
pub async fn load_resource_acl_view(
    db: &PgPool,
    user_id: Uuid,
    project_id: Uuid,
    resource_type: &str,
    resource_id: Uuid,
) -> Result<Option<ResourceAclView>, sqlx::Error> {
    let row = sqlx::query_as::<_, ResourceAcl>(
        r#"
        SELECT * FROM resource_acls
        WHERE user_id = $1 AND project_id = $2
          AND resource_type = $3 AND resource_id = $4
        "#,
    )
    .bind(user_id)
    .bind(project_id)
    .bind(resource_type)
    .bind(resource_id)
    .fetch_optional(db)
    .await?;

    Ok(row.as_ref().map(ResourceAclView::from_row))
}

fn json_array_to_string_set(value: &JsonValue) -> HashSet<String> {
    match value {
        JsonValue::Array(items) => items
            .iter()
            .filter_map(|v| v.as_str().map(str::to_owned))
            .collect(),
        _ => HashSet::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn perms(keys: &[&str]) -> HashSet<String> {
        keys.iter().map(|s| s.to_string()).collect()
    }

    fn acl(extra: &[&str], denied: &[&str]) -> ResourceAclView {
        ResourceAclView {
            extra_permissions: perms(extra),
            denied_permissions: perms(denied),
        }
    }

    fn env(extra: &[&str], denied: &[&str]) -> EnvOverrideView {
        EnvOverrideView {
            extra_permissions: perms(extra),
            denied_permissions: perms(denied),
        }
    }

    // ---------- Step 1: company admin ----------

    #[test]
    fn company_admin_always_allowed_with_no_role_perms() {
        let role = HashSet::new();
        let input = ResolverInput {
            is_company_admin: true,
            role_permissions: &role,
            resource_acl: None,
            env_override: None,
        };
        let r = resolve(&input, "containers.exec");
        assert_eq!(r.decision, Decision::Allow);
        assert_eq!(r.reason, DecisionReason::CompanyAdmin);
    }

    #[test]
    fn company_admin_bypasses_resource_deny() {
        // Plan §2: company admins explicitly keep their unchanged semantics.
        let role = HashSet::new();
        let acl_row = acl(&[], &["containers.exec"]);
        let input = ResolverInput {
            is_company_admin: true,
            role_permissions: &role,
            resource_acl: Some(&acl_row),
            env_override: None,
        };
        let r = resolve(&input, "containers.exec");
        assert_eq!(r.decision, Decision::Allow);
        assert_eq!(r.reason, DecisionReason::CompanyAdmin);
    }

    // ---------- Step 2: resource-scoped deny ----------

    #[test]
    fn resource_deny_wins_over_role_grant() {
        let role = perms(&["containers.exec"]);
        let acl_row = acl(&[], &["containers.exec"]);
        let input = ResolverInput {
            is_company_admin: false,
            role_permissions: &role,
            resource_acl: Some(&acl_row),
            env_override: None,
        };
        let r = resolve(&input, "containers.exec");
        assert_eq!(r.decision, Decision::Deny);
        assert_eq!(r.reason, DecisionReason::ResourceAclDeny);
    }

    #[test]
    fn resource_deny_wins_over_env_allow() {
        let role = HashSet::new();
        let acl_row = acl(&[], &["containers.exec"]);
        let env_row = env(&["containers.exec"], &[]);
        let input = ResolverInput {
            is_company_admin: false,
            role_permissions: &role,
            resource_acl: Some(&acl_row),
            env_override: Some(&env_row),
        };
        let r = resolve(&input, "containers.exec");
        assert_eq!(r.decision, Decision::Deny);
        assert_eq!(r.reason, DecisionReason::ResourceAclDeny);
    }

    // ---------- Step 3: resource-scoped allow ----------

    #[test]
    fn resource_allow_grants_when_role_lacks_it() {
        let role = HashSet::new();
        let acl_row = acl(&["containers.exec"], &[]);
        let input = ResolverInput {
            is_company_admin: false,
            role_permissions: &role,
            resource_acl: Some(&acl_row),
            env_override: None,
        };
        let r = resolve(&input, "containers.exec");
        assert_eq!(r.decision, Decision::Allow);
        assert_eq!(r.reason, DecisionReason::ResourceAclAllow);
    }

    // ---------- Step 4: environment override ----------

    #[test]
    fn env_deny_wins_over_role_grant() {
        let role = perms(&["containers.exec"]);
        let env_row = env(&[], &["containers.exec"]);
        let input = ResolverInput {
            is_company_admin: false,
            role_permissions: &role,
            resource_acl: None,
            env_override: Some(&env_row),
        };
        let r = resolve(&input, "containers.exec");
        assert_eq!(r.decision, Decision::Deny);
        assert_eq!(r.reason, DecisionReason::EnvOverrideDeny);
    }

    #[test]
    fn env_allow_grants_when_role_lacks_it() {
        let role = HashSet::new();
        let env_row = env(&["containers.exec"], &[]);
        let input = ResolverInput {
            is_company_admin: false,
            role_permissions: &role,
            resource_acl: None,
            env_override: Some(&env_row),
        };
        let r = resolve(&input, "containers.exec");
        assert_eq!(r.decision, Decision::Allow);
        assert_eq!(r.reason, DecisionReason::EnvOverrideAllow);
    }

    // ---------- Step 5: project role grant ----------

    #[test]
    fn role_grant_allows_without_overrides() {
        let role = perms(&["containers.view"]);
        let input = ResolverInput {
            is_company_admin: false,
            role_permissions: &role,
            resource_acl: None,
            env_override: None,
        };
        let r = resolve(&input, "containers.view");
        assert_eq!(r.decision, Decision::Allow);
        assert_eq!(r.reason, DecisionReason::RoleGrant);
    }

    // ---------- Step 6: default deny ----------

    #[test]
    fn default_denies_when_nothing_grants() {
        let role = perms(&["containers.view"]);
        let input = ResolverInput {
            is_company_admin: false,
            role_permissions: &role,
            resource_acl: None,
            env_override: None,
        };
        let r = resolve(&input, "containers.exec");
        assert_eq!(r.decision, Decision::Deny);
        assert_eq!(r.reason, DecisionReason::Default);
    }

    // ---------- Combined: layered precedence sanity checks ----------

    #[test]
    fn table_driven_precedence_matrix() {
        // Rows: (admin, acl_deny, acl_allow, env_deny, env_allow, role, expected)
        let perm = "containers.exec";
        let cases: &[(bool, bool, bool, bool, bool, bool, Decision, DecisionReason)] = &[
            (true,  false, false, false, false, false, Decision::Allow, DecisionReason::CompanyAdmin),
            (false, true,  true,  false, false, true,  Decision::Deny,  DecisionReason::ResourceAclDeny),
            (false, false, true,  true,  false, false, Decision::Allow, DecisionReason::ResourceAclAllow),
            (false, false, false, true,  true,  true,  Decision::Deny,  DecisionReason::EnvOverrideDeny),
            (false, false, false, false, true,  false, Decision::Allow, DecisionReason::EnvOverrideAllow),
            (false, false, false, false, false, true,  Decision::Allow, DecisionReason::RoleGrant),
            (false, false, false, false, false, false, Decision::Deny,  DecisionReason::Default),
        ];

        for (i, case) in cases.iter().enumerate() {
            let (admin, acl_deny, acl_allow, env_deny, env_allow, role_has, want_dec, want_reason) = *case;
            let role = if role_has { perms(&[perm]) } else { HashSet::new() };
            let single: [&str; 1] = [perm];
            let empty: [&str; 0] = [];
            let acl_allow_slice: &[&str] = if acl_allow { &single } else { &empty };
            let acl_deny_slice: &[&str] = if acl_deny { &single } else { &empty };
            let env_allow_slice: &[&str] = if env_allow { &single } else { &empty };
            let env_deny_slice: &[&str] = if env_deny { &single } else { &empty };
            let acl_row = if acl_deny || acl_allow {
                Some(acl(acl_allow_slice, acl_deny_slice))
            } else {
                None
            };
            let env_row = if env_deny || env_allow {
                Some(env(env_allow_slice, env_deny_slice))
            } else {
                None
            };
            let input = ResolverInput {
                is_company_admin: admin,
                role_permissions: &role,
                resource_acl: acl_row.as_ref(),
                env_override: env_row.as_ref(),
            };
            let r = resolve(&input, perm);
            assert_eq!(r.decision, want_dec, "case {i} decision");
            assert_eq!(r.reason, want_reason, "case {i} reason");
        }
    }

    // ---------- ResourceAclView::from_row ----------

    #[test]
    fn from_row_parses_json_arrays() {
        let row = ResourceAcl {
            id: Uuid::nil(),
            user_id: Uuid::nil(),
            project_id: Uuid::nil(),
            resource_type: "system".into(),
            resource_id: Uuid::nil(),
            role_id: None,
            extra_permissions: serde_json::json!(["containers.exec", "containers.logs.follow"]),
            denied_permissions: serde_json::json!(["systems.delete"]),
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        };
        let view = ResourceAclView::from_row(&row);
        assert!(view.extra_permissions.contains("containers.exec"));
        assert!(view.extra_permissions.contains("containers.logs.follow"));
        assert!(view.denied_permissions.contains("systems.delete"));
    }

    #[test]
    fn from_row_tolerates_non_array_json() {
        // A malformed row shouldn't crash the resolver — it should simply contribute nothing.
        let row = ResourceAcl {
            id: Uuid::nil(),
            user_id: Uuid::nil(),
            project_id: Uuid::nil(),
            resource_type: "system".into(),
            resource_id: Uuid::nil(),
            role_id: None,
            extra_permissions: serde_json::json!({"unexpected": "object"}),
            denied_permissions: serde_json::json!(42),
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        };
        let view = ResourceAclView::from_row(&row);
        assert!(view.extra_permissions.is_empty());
        assert!(view.denied_permissions.is_empty());
    }
}
