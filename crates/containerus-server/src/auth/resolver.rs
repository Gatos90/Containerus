//! Permission resolution with deny > allow precedence.
//!
//! Eight-step precedence (CON-62 plan §2 / CON-63; extended for CON-117):
//! 1. Company admin → allow
//! 2. Container-scoped `resource_acls.denied_permissions` → deny (most specific)
//! 3. Container-scoped `resource_acls.extra_permissions` → allow
//! 4. System/cluster/environment-scoped `resource_acls.denied_permissions` → deny
//! 5. System/cluster/environment-scoped `resource_acls.extra_permissions` → allow
//! 6. Environment-level role overrides (deny, then allow) — scaffolded here; table lands in CON-62c
//! 7. Project-level role grants (`project_members.role_id` → `role_permissions`)
//! 8. Default → deny
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
    /// Extract string arrays from the raw JSONB columns.
    ///
    /// Fail-closed (CON-76): a malformed `denied_permissions` must never silently
    /// collapse into "no denies" — that turns a deny row into a deny bypass. We
    /// reject any row whose `denied_permissions` or `extra_permissions` is not a
    /// JSON array of strings. Callers convert this into an HTTP 500 so the request
    /// is denied instead of evaluated against a half-parsed ACL.
    pub fn from_row(row: &ResourceAcl) -> Result<Self, AclParseError> {
        Ok(Self {
            extra_permissions: parse_permission_array(&row.extra_permissions, "extra_permissions", row.id)?,
            denied_permissions: parse_permission_array(&row.denied_permissions, "denied_permissions", row.id)?,
        })
    }
}

/// Parse failure for a `resource_acls` JSONB column. Surfaced to callers as a
/// fail-closed signal: a malformed ACL row cannot be evaluated safely, so the
/// request must be rejected rather than silently treated as "no ACL entries".
#[derive(Debug, thiserror::Error)]
#[error("resource_acls row {row_id}: column `{field}` is not a JSON array of strings")]
pub struct AclParseError {
    pub row_id: Uuid,
    pub field: &'static str,
}

/// Combined error for [`load_resource_acl_view`] — either the database failed
/// or a row's JSONB columns were malformed. Both branches should become HTTP 500.
#[derive(Debug, thiserror::Error)]
pub enum AclLoadError {
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    #[error(transparent)]
    Parse(#[from] AclParseError),
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
    /// Container-scoped ACL (resource_type = "container"). Most specific layer;
    /// a deny here wins over every lower layer including the system/resource ACL.
    /// CON-117: set by `require_for_container`; `None` for non-container flows.
    pub container_acl: Option<&'a ResourceAclView>,
    /// System/cluster/environment-scoped ACL (resource_type in `system`,
    /// `cluster`, `environment`). The historical "resource" layer.
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
    /// Container-scoped ACL denied (CON-117). More specific than
    /// `ResourceAclDeny` — set only when the deny came from a
    /// `resource_type='container'` row.
    ContainerAclDeny,
    /// Container-scoped ACL granted the permission (CON-117).
    ContainerAclAllow,
    ResourceAclDeny,
    ResourceAclAllow,
    EnvOverrideDeny,
    EnvOverrideAllow,
    RoleGrant,
    Default,
}

impl DecisionReason {
    /// Stable snake_case identifier — kept in sync with the serde
    /// `rename_all = "snake_case"` representation so audit-log readers and
    /// JSON consumers see the same string. Used by the auth middleware to
    /// stamp the resolver's verdict onto `rbac.permission_denied` audit rows
    /// (CON-80) without dragging serde into the audit module.
    pub fn as_str(self) -> &'static str {
        match self {
            DecisionReason::CompanyAdmin => "company_admin",
            DecisionReason::ContainerAclDeny => "container_acl_deny",
            DecisionReason::ContainerAclAllow => "container_acl_allow",
            DecisionReason::ResourceAclDeny => "resource_acl_deny",
            DecisionReason::ResourceAclAllow => "resource_acl_allow",
            DecisionReason::EnvOverrideDeny => "env_override_deny",
            DecisionReason::EnvOverrideAllow => "env_override_allow",
            DecisionReason::RoleGrant => "role_grant",
            DecisionReason::Default => "default",
        }
    }
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

    // 2a. Container-scoped deny — most specific layer; wins over every lower
    //     allow including a system-scoped allow (CON-117).
    if let Some(acl) = input.container_acl {
        if set_covers(&acl.denied_permissions, permission) {
            return ResolvedPermission { decision: Decision::Deny, reason: DecisionReason::ContainerAclDeny };
        }
    }

    // 2b. Container-scoped allow — beats system/env/role allows, but not a
    //     container deny above.
    if let Some(acl) = input.container_acl {
        if set_covers(&acl.extra_permissions, permission) {
            return ResolvedPermission { decision: Decision::Allow, reason: DecisionReason::ContainerAclAllow };
        }
    }

    // 3. System/cluster/environment-scoped deny — wins over every lower-precedence allow.
    if let Some(acl) = input.resource_acl {
        if set_covers(&acl.denied_permissions, permission) {
            return ResolvedPermission { decision: Decision::Deny, reason: DecisionReason::ResourceAclDeny };
        }
    }

    // 4. System/cluster/environment-scoped allow — beats env + role allows.
    if let Some(acl) = input.resource_acl {
        if set_covers(&acl.extra_permissions, permission) {
            return ResolvedPermission { decision: Decision::Allow, reason: DecisionReason::ResourceAclAllow };
        }
    }

    // 5. Environment-scoped override — deny wins over allow within the same layer.
    if let Some(env) = input.env_override {
        if set_covers(&env.denied_permissions, permission) {
            return ResolvedPermission { decision: Decision::Deny, reason: DecisionReason::EnvOverrideDeny };
        }
        if set_covers(&env.extra_permissions, permission) {
            return ResolvedPermission { decision: Decision::Allow, reason: DecisionReason::EnvOverrideAllow };
        }
    }

    // 7. Project-level role grants from `project_members.role_id` → `role_permissions`.
    if input.role_permissions.contains(permission) {
        return ResolvedPermission { decision: Decision::Allow, reason: DecisionReason::RoleGrant };
    }

    // 8. Default deny.
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
) -> Result<Option<ResourceAclView>, AclLoadError> {
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

    row.as_ref().map(ResourceAclView::from_row).transpose().map_err(Into::into)
}

/// Coarse permission keys that migration 0006 split into finer keys. A
/// `resource_acls` / env-override row written against the coarse key must keep
/// protecting (for denies) and granting (for extras) the split keys, otherwise
/// every pre-0006 per-resource deny on `containers.logs`, `systems.connect`,
/// etc. silently becomes a deny bypass once handlers migrate to the split
/// keys. The mapping mirrors the forward-grant SQL in migration 0006 exactly —
/// keep them in sync if either side grows.
const COARSE_SPLIT_MAP: &[(&str, &[&str])] = &[
    ("systems.connect",   &["systems.terminal.open", "systems.tunnel.open"]),
    ("containers.logs",   &["containers.logs.read", "containers.logs.follow"]),
    ("containers.manage", &["containers.pause"]),
    ("clusters.manage",   &["clusters.apply", "clusters.delete.workload", "clusters.watch"]),
    ("clusters.logs",     &["clusters.logs.stream"]),
];

/// Return true if `set` contains `permission` directly, or if it contains any
/// coarse key whose post-0006 split set includes `permission`. Used by the
/// resolver for both deny and allow lists so pre-existing ACLs that reference
/// the coarse key keep their original semantics after the split.
fn set_covers(set: &HashSet<String>, permission: &str) -> bool {
    if set.contains(permission) {
        return true;
    }
    for (coarse, splits) in COARSE_SPLIT_MAP {
        if splits.contains(&permission) && set.contains(*coarse) {
            return true;
        }
    }
    false
}

fn parse_permission_array(
    value: &JsonValue,
    field: &'static str,
    row_id: Uuid,
) -> Result<HashSet<String>, AclParseError> {
    let items = value.as_array().ok_or(AclParseError { row_id, field })?;
    let mut set = HashSet::with_capacity(items.len());
    for item in items {
        let s = item.as_str().ok_or(AclParseError { row_id, field })?;
        set.insert(s.to_owned());
    }
    Ok(set)
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
            container_acl: None,
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
            container_acl: None,
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
            container_acl: None,
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
            container_acl: None,
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
            container_acl: None,
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
            container_acl: None,
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
            container_acl: None,
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
            container_acl: None,
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
            container_acl: None,
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
                container_acl: None,
                resource_acl: acl_row.as_ref(),
                env_override: env_row.as_ref(),
            };
            let r = resolve(&input, perm);
            assert_eq!(r.decision, want_dec, "case {i} decision");
            assert_eq!(r.reason, want_reason, "case {i} reason");
        }
    }

    // ---------- ResourceAclView::from_row ----------

    fn acl_row(extra: JsonValue, denied: JsonValue) -> ResourceAcl {
        ResourceAcl {
            id: Uuid::new_v4(),
            user_id: Uuid::nil(),
            project_id: Uuid::nil(),
            resource_type: "system".into(),
            resource_id: Uuid::nil(),
            system_id: None,
            role_id: None,
            extra_permissions: extra,
            denied_permissions: denied,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        }
    }

    #[test]
    fn from_row_parses_json_arrays() {
        let row = acl_row(
            serde_json::json!(["containers.exec", "containers.logs.follow"]),
            serde_json::json!(["systems.delete"]),
        );
        let view = ResourceAclView::from_row(&row).expect("valid ACL row parses");
        assert!(view.extra_permissions.contains("containers.exec"));
        assert!(view.extra_permissions.contains("containers.logs.follow"));
        assert!(view.denied_permissions.contains("systems.delete"));
    }

    // CON-76: a malformed JSONB deny column must fail closed. Silently treating
    // non-array/non-string content as "no denies" turns a deny row into a deny
    // bypass, which would defeat the whole point of resource_acls.

    #[test]
    fn from_row_rejects_non_array_denied_permissions() {
        let row = acl_row(serde_json::json!([]), serde_json::json!(42));
        let err = ResourceAclView::from_row(&row).expect_err("non-array denied must fail");
        assert_eq!(err.field, "denied_permissions");
        assert_eq!(err.row_id, row.id);
    }

    #[test]
    fn from_row_rejects_object_denied_permissions() {
        let row = acl_row(serde_json::json!([]), serde_json::json!({"systems.delete": true}));
        let err = ResourceAclView::from_row(&row).expect_err("object denied must fail");
        assert_eq!(err.field, "denied_permissions");
    }

    #[test]
    fn from_row_rejects_non_string_element_in_denied_permissions() {
        let row = acl_row(serde_json::json!([]), serde_json::json!(["systems.delete", 7]));
        let err = ResourceAclView::from_row(&row).expect_err("non-string element must fail");
        assert_eq!(err.field, "denied_permissions");
    }

    #[test]
    fn from_row_rejects_null_denied_permissions() {
        let row = acl_row(serde_json::json!([]), JsonValue::Null);
        let err = ResourceAclView::from_row(&row).expect_err("null denied must fail");
        assert_eq!(err.field, "denied_permissions");
    }

    #[test]
    fn from_row_rejects_malformed_extra_permissions() {
        // extra_permissions being malformed is also fail-closed: we can't trust
        // the row, so we refuse to evaluate it rather than partially honouring it.
        let row = acl_row(serde_json::json!({"unexpected": "object"}), serde_json::json!([]));
        let err = ResourceAclView::from_row(&row).expect_err("malformed extra must fail");
        assert_eq!(err.field, "extra_permissions");
    }

    // CON-80: the audit middleware stamps `DecisionReason::as_str()` onto
    // `rbac.permission_denied` rows. If that string ever drifts from the serde
    // snake_case rename, audit dashboards and JSON API consumers would disagree
    // on what a deny "reason" looks like. Pin both representations together.
    #[test]
    fn decision_reason_as_str_matches_serde_snake_case() {
        let reasons = [
            DecisionReason::CompanyAdmin,
            DecisionReason::ResourceAclDeny,
            DecisionReason::ResourceAclAllow,
            DecisionReason::EnvOverrideDeny,
            DecisionReason::EnvOverrideAllow,
            DecisionReason::RoleGrant,
            DecisionReason::Default,
        ];
        for r in reasons {
            let serde_str = serde_json::to_value(r)
                .expect("serialize DecisionReason")
                .as_str()
                .expect("DecisionReason serializes to a JSON string")
                .to_owned();
            assert_eq!(serde_str, r.as_str(), "drift between serde and as_str for {r:?}");
        }
    }

    // CON-74: migration 0006 splits compound permission keys. Pre-0006
    // `resource_acls` rows that deny (or extra-grant) a coarse key must keep
    // covering the new split keys, otherwise a tenant who denied
    // `containers.logs` at resource scope would have that deny bypassed as
    // soon as handlers move to `containers.logs.read` / `containers.logs.follow`.

    #[test]
    fn resource_deny_on_coarse_key_blocks_split_key() {
        let role = perms(&["containers.logs.read"]);
        let acl_row = acl(&[], &["containers.logs"]);
        let input = ResolverInput {
            is_company_admin: false,
            role_permissions: &role,
            container_acl: None,
            resource_acl: Some(&acl_row),
            env_override: None,
        };
        let r = resolve(&input, "containers.logs.read");
        assert_eq!(r.decision, Decision::Deny);
        assert_eq!(r.reason, DecisionReason::ResourceAclDeny);

        let r = resolve(&input, "containers.logs.follow");
        assert_eq!(r.decision, Decision::Deny);
        assert_eq!(r.reason, DecisionReason::ResourceAclDeny);
    }

    #[test]
    fn resource_deny_on_unsplit_key_does_not_leak_to_sibling() {
        // `systems.tunnel.allowlist.manage` is deliberately NOT in the
        // `systems.connect` split map (admin-only). A deny on `systems.connect`
        // should still cover `systems.terminal.open` + `systems.tunnel.open`
        // but not the admin-only key. This pins the split map.
        let role = perms(&["systems.tunnel.allowlist.manage"]);
        let acl_row = acl(&[], &["systems.connect"]);
        let input = ResolverInput {
            is_company_admin: false,
            role_permissions: &role,
            container_acl: None,
            resource_acl: Some(&acl_row),
            env_override: None,
        };
        let r = resolve(&input, "systems.tunnel.allowlist.manage");
        assert_eq!(r.decision, Decision::Allow);
        assert_eq!(r.reason, DecisionReason::RoleGrant);

        let r = resolve(&input, "systems.terminal.open");
        assert_eq!(r.decision, Decision::Deny);
        assert_eq!(r.reason, DecisionReason::ResourceAclDeny);
    }

    #[test]
    fn resource_extra_on_coarse_key_grants_split_keys() {
        // Symmetric to the deny case: a per-resource extra-grant on the coarse
        // key keeps granting the split capabilities after 0006, so tenants do
        // not need a data migration over `extra_permissions`.
        let role = HashSet::new();
        let acl_row = acl(&["clusters.logs"], &[]);
        let input = ResolverInput {
            is_company_admin: false,
            role_permissions: &role,
            container_acl: None,
            resource_acl: Some(&acl_row),
            env_override: None,
        };
        let r = resolve(&input, "clusters.logs.stream");
        assert_eq!(r.decision, Decision::Allow);
        assert_eq!(r.reason, DecisionReason::ResourceAclAllow);
    }

    #[test]
    fn env_deny_on_coarse_key_blocks_split_key() {
        let role = perms(&["clusters.delete.workload"]);
        let env_row = env(&[], &["clusters.manage"]);
        let input = ResolverInput {
            is_company_admin: false,
            role_permissions: &role,
            container_acl: None,
            resource_acl: None,
            env_override: Some(&env_row),
        };
        let r = resolve(&input, "clusters.delete.workload");
        assert_eq!(r.decision, Decision::Deny);
        assert_eq!(r.reason, DecisionReason::EnvOverrideDeny);

        // `clusters.watch` is also under the `clusters.manage` split post-0006.
        let r = resolve(&input, "clusters.watch");
        assert_eq!(r.decision, Decision::Deny);
        assert_eq!(r.reason, DecisionReason::EnvOverrideDeny);
    }

    #[test]
    fn coarse_deny_does_not_block_unrelated_permissions() {
        // A deny on `containers.logs` must not collaterally block
        // `containers.exec` or other containers.* keys that are not in its
        // split set.
        let role = perms(&["containers.exec"]);
        let acl_row = acl(&[], &["containers.logs"]);
        let input = ResolverInput {
            is_company_admin: false,
            role_permissions: &role,
            container_acl: None,
            resource_acl: Some(&acl_row),
            env_override: None,
        };
        let r = resolve(&input, "containers.exec");
        assert_eq!(r.decision, Decision::Allow);
        assert_eq!(r.reason, DecisionReason::RoleGrant);
    }

    // ---------- CON-117: container-scoped ACL layer ----------
    //
    // Container ACLs sit above the system/resource layer in the precedence
    // table. A deny at the container layer wins over a system-scoped allow,
    // and an allow at the container layer unblocks a permission even when
    // the role doesn't grant it — without leaking that grant to other
    // containers on the same system.

    #[test]
    fn container_deny_wins_over_role_grant() {
        let role = perms(&["containers.exec"]);
        let container = acl(&[], &["containers.exec"]);
        let input = ResolverInput {
            is_company_admin: false,
            role_permissions: &role,
            container_acl: Some(&container),
            resource_acl: None,
            env_override: None,
        };
        let r = resolve(&input, "containers.exec");
        assert_eq!(r.decision, Decision::Deny);
        assert_eq!(r.reason, DecisionReason::ContainerAclDeny);
    }

    #[test]
    fn container_deny_wins_over_system_allow() {
        // Acceptance criterion: a deny of `containers.delete` on a
        // container-scoped ACL blocks delete for that container even when a
        // system-scoped ACL allow would otherwise grant it.
        let role = HashSet::new();
        let container = acl(&[], &["containers.delete"]);
        let system = acl(&["containers.delete"], &[]);
        let input = ResolverInput {
            is_company_admin: false,
            role_permissions: &role,
            container_acl: Some(&container),
            resource_acl: Some(&system),
            env_override: None,
        };
        let r = resolve(&input, "containers.delete");
        assert_eq!(r.decision, Decision::Deny);
        assert_eq!(r.reason, DecisionReason::ContainerAclDeny);
    }

    #[test]
    fn container_allow_grants_when_role_and_system_lack_it() {
        // Acceptance criterion: a grant of `containers.exec` on a
        // container-scoped ACL unblocks exec for that specific container,
        // even when the user's project role lacks it.
        let role = HashSet::new();
        let container = acl(&["containers.exec"], &[]);
        let input = ResolverInput {
            is_company_admin: false,
            role_permissions: &role,
            container_acl: Some(&container),
            resource_acl: None,
            env_override: None,
        };
        let r = resolve(&input, "containers.exec");
        assert_eq!(r.decision, Decision::Allow);
        assert_eq!(r.reason, DecisionReason::ContainerAclAllow);
    }

    #[test]
    fn container_allow_beats_system_deny_is_false_system_deny_wins_when_no_container_deny() {
        // A system-scoped deny still beats a bare role grant when the
        // container layer has no matching deny or allow entry.
        let role = perms(&["containers.exec"]);
        let container = acl(&[], &[]); // no entries for containers.exec
        let system = acl(&[], &["containers.exec"]);
        let input = ResolverInput {
            is_company_admin: false,
            role_permissions: &role,
            container_acl: Some(&container),
            resource_acl: Some(&system),
            env_override: None,
        };
        let r = resolve(&input, "containers.exec");
        assert_eq!(r.decision, Decision::Deny);
        assert_eq!(r.reason, DecisionReason::ResourceAclDeny);
    }

    #[test]
    fn container_allow_overrides_system_deny() {
        // Container-scoped allow is *more specific* than a system-scoped deny:
        // a deny on `containers.exec` at system scope should NOT be bypassed
        // simply because another container on that system has an allow, but
        // an allow on *this* container must unblock the permission. Matches
        // step 2b of the precedence table.
        let role = HashSet::new();
        let container = acl(&["containers.exec"], &[]);
        let system = acl(&[], &["containers.exec"]);
        let input = ResolverInput {
            is_company_admin: false,
            role_permissions: &role,
            container_acl: Some(&container),
            resource_acl: Some(&system),
            env_override: None,
        };
        let r = resolve(&input, "containers.exec");
        assert_eq!(r.decision, Decision::Allow);
        assert_eq!(r.reason, DecisionReason::ContainerAclAllow);
    }

    #[test]
    fn company_admin_bypasses_container_deny() {
        // Consistent with the existing system-scoped carve-out: company
        // admins ignore the entire ACL stack.
        let role = HashSet::new();
        let container = acl(&[], &["containers.exec"]);
        let input = ResolverInput {
            is_company_admin: true,
            role_permissions: &role,
            container_acl: Some(&container),
            resource_acl: None,
            env_override: None,
        };
        let r = resolve(&input, "containers.exec");
        assert_eq!(r.decision, Decision::Allow);
        assert_eq!(r.reason, DecisionReason::CompanyAdmin);
    }

    #[test]
    fn container_deny_on_coarse_key_blocks_split_key() {
        // CON-74: a container-scoped deny on the coarse `containers.logs`
        // key must keep covering the post-0006 split keys so tenants don't
        // silently lose the deny.
        let role = perms(&["containers.logs.read"]);
        let container = acl(&[], &["containers.logs"]);
        let input = ResolverInput {
            is_company_admin: false,
            role_permissions: &role,
            container_acl: Some(&container),
            resource_acl: None,
            env_override: None,
        };
        let r = resolve(&input, "containers.logs.read");
        assert_eq!(r.decision, Decision::Deny);
        assert_eq!(r.reason, DecisionReason::ContainerAclDeny);

        let r = resolve(&input, "containers.logs.follow");
        assert_eq!(r.decision, Decision::Deny);
        assert_eq!(r.reason, DecisionReason::ContainerAclDeny);
    }

    #[test]
    fn container_acl_empty_falls_through_to_system_layer() {
        // A container ACL row that exists but has no matching keys must fall
        // through to the system layer; it must not short-circuit either way.
        let role = HashSet::new();
        let container = acl(&[], &[]);
        let system = acl(&["containers.exec"], &[]);
        let input = ResolverInput {
            is_company_admin: false,
            role_permissions: &role,
            container_acl: Some(&container),
            resource_acl: Some(&system),
            env_override: None,
        };
        let r = resolve(&input, "containers.exec");
        assert_eq!(r.decision, Decision::Allow);
        assert_eq!(r.reason, DecisionReason::ResourceAclAllow);
    }

    #[test]
    fn from_row_accepts_empty_arrays() {
        let row = acl_row(serde_json::json!([]), serde_json::json!([]));
        let view = ResourceAclView::from_row(&row).expect("empty arrays are valid");
        assert!(view.extra_permissions.is_empty());
        assert!(view.denied_permissions.is_empty());
    }
}
