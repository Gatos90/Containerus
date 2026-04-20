//! CON-72: Built-in-role × endpoint 200/403 matrix + resource_acls
//! deny/allow precedence tests.
//!
//! Requires a real Postgres reachable via `TEST_DATABASE_URL`. When the env
//! var is unset each test skips — unless `REQUIRE_DB=1`, which flips the
//! skip into a panic so a broken Postgres service in CI can't ship as
//! "green with zero assertions".
//!
//! Matrix coverage is intentionally **representative**, not exhaustive:
//! one permission per category (`projects`, `audit`, `systems`, `containers`,
//! `images`, `files`) plus targeted rows that distinguish every built-in
//! role from every other — operator vs developer (`files.write`) and
//! developer vs viewer (`containers.start`, `images.pull`). Exhaustive
//! per-endpoint migration of the remaining ~25 `.require()` call sites is
//! tracked separately (CON-73 for handler migration, CON-8x for the full
//! per-endpoint matrix once those migrations land).
//!
//! Precedence suite: `ProjectScoped::require_for_resource` and
//! `SystemScoped::require_for_system` directly, in both flag-on and flag-off
//! states, plus handler-driven assertions (`handler_acl_deny_*`, CON-77)
//! proving the full HTTP path honors ACL rows.

mod common;

use axum::http::{Method, StatusCode};
use common::{
    call, Expect, TestHarness, ROLE_DEVELOPER, ROLE_OPERATOR, ROLE_PROJECT_ADMIN, ROLE_VIEWER,
};

/// An endpoint cell in the matrix.
struct Endpoint {
    method: Method,
    /// Formatter producing the concrete URI given `(project_id, system_id)`.
    uri: fn(uuid::Uuid, uuid::Uuid) -> String,
    label: &'static str,
    /// The permission key the gate checks. Used to derive expected allow/deny
    /// per role from the built-in seed — no hand-maintained parallel table.
    permission: &'static str,
    /// Optional JSON body for POST/PUT rows. None for GET/DELETE.
    body: Option<fn() -> serde_json::Value>,
}

fn endpoints() -> Vec<Endpoint> {
    vec![
        // projects category — ProjectScoped
        Endpoint {
            method: Method::GET,
            uri: |p, _| format!("/api/projects/{p}"),
            label: "GET /projects/{id}",
            permission: "projects.view",
            body: None,
        },
        Endpoint {
            method: Method::GET,
            uri: |p, _| format!("/api/projects/{p}/members"),
            label: "GET /projects/{id}/members",
            permission: "projects.members.view",
            body: None,
        },
        Endpoint {
            method: Method::GET,
            uri: |p, _| format!("/api/projects/{p}/audit"),
            label: "GET /projects/{id}/audit",
            permission: "audit.view",
            body: None,
        },
        Endpoint {
            method: Method::DELETE,
            uri: |p, _| format!("/api/projects/{p}"),
            label: "DELETE /projects/{id}",
            permission: "projects.edit",
            body: None,
        },
        // systems category — SystemScoped
        Endpoint {
            method: Method::GET,
            uri: |_, s| format!("/api/systems/{s}"),
            label: "GET /systems/{id}",
            permission: "systems.view",
            body: None,
        },
        Endpoint {
            method: Method::DELETE,
            uri: |_, s| format!("/api/systems/{s}"),
            label: "DELETE /systems/{id}",
            permission: "systems.delete",
            body: None,
        },
        // containers category — developer allow, viewer deny (test-sensitivity row)
        Endpoint {
            method: Method::POST,
            uri: |_, s| format!("/api/systems/{s}/containers/dummy/action"),
            label: "POST /systems/{id}/containers/{ctr}/action",
            permission: "containers.start",
            body: Some(|| serde_json::json!({"action": "start", "runtime": "docker"})),
        },
        // CON-121: per-container metrics endpoint — every built-in role has
        // it via the default grant in migration 0012, so non-members and the
        // company-admin edge rows are what the matrix actually exercises.
        Endpoint {
            method: Method::GET,
            uri: |_, s| format!("/api/systems/{s}/containers/dummy/metrics?window=1h"),
            label: "GET /systems/{id}/containers/{ctr}/metrics",
            permission: "containers.metrics.view",
            body: None,
        },
        // images category — developer allow, viewer deny
        Endpoint {
            method: Method::POST,
            uri: |_, s| format!("/api/systems/{s}/images/pull"),
            label: "POST /systems/{id}/images/pull",
            permission: "images.pull",
            body: Some(|| serde_json::json!({"image": "alpine:latest", "runtime": "docker"})),
        },
        // files category — operator allow, developer+viewer deny (operator vs developer row)
        Endpoint {
            method: Method::POST,
            uri: |_, s| format!("/api/systems/{s}/files/write"),
            label: "POST /systems/{id}/files/write",
            permission: "files.write",
            body: Some(|| serde_json::json!({"path": "/tmp/matrix-test", "content": "x"})),
        },
    ]
}

/// Built-in role → permission set, derived from migration 0001. Kept short:
/// we only list the permissions the matrix probes so the expectations table
/// stays inspectable.
fn role_perms(role: uuid::Uuid) -> &'static [&'static str] {
    if role == ROLE_PROJECT_ADMIN {
        &[
            "projects.view",
            "projects.members.view",
            "audit.view",
            "projects.edit",
            "systems.view",
            "systems.delete",
            "containers.start",
            "containers.metrics.view",
            "images.pull",
            "files.write",
        ]
    } else if role == ROLE_OPERATOR {
        &[
            "projects.view",
            "projects.members.view",
            "audit.view",
            "systems.view",
            "systems.delete",
            "containers.start",
            "containers.metrics.view",
            "images.pull",
            "files.write",
        ]
    } else if role == ROLE_DEVELOPER {
        &[
            "projects.view",
            "projects.members.view",
            "audit.view",
            "systems.view",
            "containers.start",
            "containers.metrics.view",
            "images.pull",
        ]
    } else if role == ROLE_VIEWER {
        &[
            "projects.view",
            "projects.members.view",
            "audit.view",
            "systems.view",
            "containers.metrics.view",
        ]
    } else {
        &[]
    }
}

fn expected(role: uuid::Uuid, ep: &Endpoint) -> Expect {
    if role_perms(role).contains(&ep.permission) {
        Expect::Allow
    } else {
        Expect::Deny
    }
}

#[tokio::test]
async fn role_endpoint_matrix_enforce_off() {
    let Some(h) = TestHarness::try_new(false).await else {
        common::skip_without_db("role_endpoint_matrix_enforce_off");
        return;
    };

    run_matrix(&h).await;
    h.cleanup().await;
}

#[tokio::test]
async fn role_endpoint_matrix_enforce_on() {
    // The matrix uses plain `.require()` in every handler today (CON-73
    // migrates them to the ACL-aware methods). Running the same matrix with
    // the flag on proves the flag itself does not alter legacy handler
    // semantics — i.e. flipping the flag is non-breaking before the
    // handler-level migration happens.
    let Some(h) = TestHarness::try_new(true).await else {
        common::skip_without_db("role_endpoint_matrix_enforce_on");
        return;
    };

    run_matrix(&h).await;
    h.cleanup().await;
}

async fn run_matrix(h: &TestHarness) {
    let project_id = h.create_project("matrix").await;
    let environment_id = h.create_environment(project_id).await;

    // Roles under test.
    let roles = [
        ("project-admin", ROLE_PROJECT_ADMIN),
        ("operator", ROLE_OPERATOR),
        ("developer", ROLE_DEVELOPER),
        ("viewer", ROLE_VIEWER),
    ];

    // Seed one user per role with the matching membership.
    let mut users = Vec::with_capacity(roles.len());
    for (name, role_id) in &roles {
        let user = h.create_user(name).await;
        h.add_member(project_id, user, *role_id).await;
        users.push((*name, *role_id, user));
    }

    // A non-member and a company admin for the edge rows.
    let outsider = h.create_user("outsider").await;
    let company_admin = h.create_user("companyadmin").await;
    h.grant_company_admin(company_admin).await;

    let endpoints = endpoints();
    let mut failures: Vec<String> = Vec::new();

    // DELETE /projects and DELETE /systems actually mutate state when the
    // permission gate passes. Give every role its own fresh system so each
    // (role, endpoint) cell is independent — the matrix is about the gate,
    // not about sequencing side effects.
    for (role_name, role_id, user_id) in &users {
        let token = h.token_for(*user_id, vec![(project_id, *role_id)], false);
        let system_id = h.create_system(environment_id, *user_id).await;
        for ep in endpoints.iter() {
            let uri = (ep.uri)(project_id, system_id);
            let body = ep.body.map(|f| f());
            let (status, resp_body) =
                call(&h.router, ep.method.clone(), &uri, Some(&token), body).await;
            let want = expected(*role_id, ep);
            if !want.matches(status) {
                failures.push(format!(
                    "role={role_name} endpoint={} perm={} expected={:?} got={} body={}",
                    ep.label,
                    ep.permission,
                    want,
                    status,
                    String::from_utf8_lossy(&resp_body)
                ));
            }
        }
    }

    // Extra rows below (outsider / company-admin / no-token) use a shared
    // scratch system — they never expect Allow on DELETE /projects, so the
    // project itself survives the matrix.
    let scratch_system_id = h.create_system(environment_id, users[0].2).await;

    // Non-member: every project/system-scoped endpoint must 403 (or 404 for
    // project-scoped paths that can't be resolved). Our matrix uses an
    // existing project id so it's always 403 from NotProjectMember.
    let outsider_token = h.token_for(outsider, vec![], false);
    for ep in &endpoints {
        let uri = (ep.uri)(project_id, scratch_system_id);
        let body = ep.body.map(|f| f());
        let (status, _) = call(
            &h.router,
            ep.method.clone(),
            &uri,
            Some(&outsider_token),
            body,
        )
        .await;
        if status != StatusCode::FORBIDDEN && status != StatusCode::NOT_FOUND {
            failures.push(format!(
                "outsider endpoint={} expected 403/404 got={}",
                ep.label, status
            ));
        }
    }

    // Company admin: every endpoint must clear the permission gate. A
    // fresh system per iteration keeps DELETE idempotent.
    let admin_token = h.token_for(company_admin, vec![], true);
    for ep in &endpoints {
        let ep_system = h.create_system(environment_id, company_admin).await;
        let uri = (ep.uri)(project_id, ep_system);
        let body = ep.body.map(|f| f());
        let (status, resp_body) = call(
            &h.router,
            ep.method.clone(),
            &uri,
            Some(&admin_token),
            body,
        )
        .await;
        if !Expect::Allow.matches(status) {
            failures.push(format!(
                "company-admin endpoint={} expected Allow got={} body={}",
                ep.label,
                status,
                String::from_utf8_lossy(&resp_body)
            ));
        }
    }

    // Unauthenticated requests: every endpoint must 401.
    for ep in &endpoints {
        let uri = (ep.uri)(project_id, scratch_system_id);
        let body = ep.body.map(|f| f());
        let (status, _) = call(&h.router, ep.method.clone(), &uri, None, body).await;
        if status != StatusCode::UNAUTHORIZED {
            failures.push(format!(
                "no-token endpoint={} expected 401 got={}",
                ep.label, status
            ));
        }
    }

    assert!(
        failures.is_empty(),
        "role/endpoint matrix failures ({} total):\n  - {}",
        failures.len(),
        failures.join("\n  - ")
    );
}

/// Deny-beats-allow: a viewer has `projects.view`, but a resource-level
/// deny on the same project must strip that permission when enforcement is
/// on. Exercised via `ProjectScoped::require_for_resource` directly because
/// no handler has been migrated to that method yet (tracked: CON-73).
#[tokio::test]
async fn acl_deny_overrides_role_allow_flag_on() {
    let Some(h) = TestHarness::try_new(true).await else {
        common::skip_without_db("acl_deny_overrides_role_allow_flag_on");
        return;
    };
    run_deny_precedence(&h, true).await;
    h.cleanup().await;
}

/// Same setup, but with enforcement off — the ACL row must be ignored so
/// the viewer still sees `projects.view` pass.
#[tokio::test]
async fn acl_deny_is_ignored_when_flag_off() {
    let Some(h) = TestHarness::try_new(false).await else {
        common::skip_without_db("acl_deny_is_ignored_when_flag_off");
        return;
    };
    run_deny_precedence(&h, false).await;
    h.cleanup().await;
}

async fn run_deny_precedence(h: &TestHarness, flag_on: bool) {
    use containerus_server::auth::middleware::ProjectScoped;
    use containerus_server::auth::jwt::decode_access_token;
    use containerus_server::db::models::EffectivePermissions;

    let project_id = h.create_project("deny-precedence").await;
    let viewer = h.create_user("viewer-deny").await;
    h.add_member(project_id, viewer, ROLE_VIEWER).await;

    // ACL: deny projects.view for the viewer on this project (resource_type
    // = "system" is used as the scoping vehicle — the resolver is keyed on
    // (user, project, resource_type, resource_id)).
    let environment_id = h.create_environment(project_id).await;
    let system_id = h.create_system(environment_id, viewer).await;
    h.set_resource_acl(viewer, project_id, "system", system_id, &[], &["projects.view"])
        .await;

    let token = h.token_for(viewer, vec![(project_id, ROLE_VIEWER)], false);
    let claims = decode_access_token(&token, common::JWT_SECRET).expect("decode");

    let scoped = ProjectScoped {
        claims: claims.clone(),
        project_id,
        permissions: EffectivePermissions {
            permissions: h.state.permission_cache.get_permissions(&ROLE_VIEWER),
            is_company_admin: false,
        },
        client_ip: None,
    };

    let result = scoped
        .require_for_resource("projects.view", "system", system_id, &h.state)
        .await;

    if flag_on {
        assert!(
            result.is_err(),
            "with flag on, resource-level deny must override role allow for projects.view",
        );
    } else {
        assert!(
            result.is_ok(),
            "with flag off, the ACL deny row must be ignored and role grants apply",
        );
    }

    // Sanity: the viewer still doesn't have projects.edit — no ACL row here.
    let edit_result = scoped
        .require_for_resource("projects.edit", "system", system_id, &h.state)
        .await;
    assert!(
        edit_result.is_err(),
        "viewer lacks projects.edit regardless of flag state",
    );
}

/// Allow-from-ACL: a viewer doesn't have `systems.delete`, but an ACL
/// `extra_permissions` row on the target system must grant it when the
/// flag is on. The same row must be ignored when the flag is off.
#[tokio::test]
async fn acl_extra_grants_missing_perm_flag_on() {
    let Some(h) = TestHarness::try_new(true).await else {
        common::skip_without_db("acl_extra_grants_missing_perm_flag_on");
        return;
    };
    run_allow_precedence(&h, true).await;
    h.cleanup().await;
}

#[tokio::test]
async fn acl_extra_is_ignored_when_flag_off() {
    let Some(h) = TestHarness::try_new(false).await else {
        common::skip_without_db("acl_extra_is_ignored_when_flag_off");
        return;
    };
    run_allow_precedence(&h, false).await;
    h.cleanup().await;
}

async fn run_allow_precedence(h: &TestHarness, flag_on: bool) {
    use containerus_server::auth::jwt::decode_access_token;
    use containerus_server::auth::middleware::SystemScoped;
    use containerus_server::db::models::{EffectivePermissions, SystemRow};

    let project_id = h.create_project("allow-precedence").await;
    let viewer = h.create_user("viewer-allow").await;
    h.add_member(project_id, viewer, ROLE_VIEWER).await;

    let environment_id = h.create_environment(project_id).await;
    let system_id = h.create_system(environment_id, viewer).await;

    // Grant systems.delete via ACL extra_permissions only.
    h.set_resource_acl(viewer, project_id, "system", system_id, &["systems.delete"], &[])
        .await;

    let token = h.token_for(viewer, vec![(project_id, ROLE_VIEWER)], false);
    let claims = decode_access_token(&token, common::JWT_SECRET).expect("decode");

    // Load the SystemRow the extractor would fetch.
    let system: SystemRow = sqlx::query_as("SELECT * FROM systems WHERE id = $1")
        .bind(system_id)
        .fetch_one(&h.db)
        .await
        .expect("load system");

    let scoped = SystemScoped {
        claims,
        system,
        project_id,
        environment_id,
        permissions: EffectivePermissions {
            permissions: h.state.permission_cache.get_permissions(&ROLE_VIEWER),
            is_company_admin: false,
        },
        client_ip: None,
    };

    let result = scoped.require_for_system("systems.delete", &h.state).await;

    if flag_on {
        assert!(
            result.is_ok(),
            "with flag on, resource-level extra_permissions must grant systems.delete to viewer",
        );
    } else {
        assert!(
            result.is_err(),
            "with flag off, extra_permissions rows must be ignored",
        );
    }

    // Sanity: a perm that isn't in the role or the ACL is still denied.
    let nope = scoped
        .require_for_system("networks.delete", &h.state)
        .await;
    assert!(nope.is_err(), "networks.delete must remain denied for viewer");
}

/// CON-77: handler-driven ACL enforcement.
///
/// Proves the full HTTP path — extractor → `SystemScoped::require_for_system`
/// → resolver → ACL table — fails closed on a deny row when the flag is on,
/// and keeps the role grant untouched when the flag is off. This is the
/// assertion CON-72's suite deferred ("no handlers have been migrated yet");
/// once CON-77 migrates `get_system` off plain `.require()`, the same
/// `GET /api/systems/{id}` request now consults the ACL table and the deny
/// row must override the viewer's role grant.
#[tokio::test]
async fn handler_acl_deny_blocks_systems_view_when_flag_on() {
    let Some(h) = TestHarness::try_new(true).await else {
        common::skip_without_db("handler_acl_deny_blocks_systems_view_when_flag_on");
        return;
    };
    run_handler_deny(&h, true).await;
    h.cleanup().await;
}

#[tokio::test]
async fn handler_acl_deny_is_ignored_when_flag_off() {
    let Some(h) = TestHarness::try_new(false).await else {
        common::skip_without_db("handler_acl_deny_is_ignored_when_flag_off");
        return;
    };
    run_handler_deny(&h, false).await;
    h.cleanup().await;
}

async fn run_handler_deny(h: &TestHarness, flag_on: bool) {
    let project_id = h.create_project("handler-deny").await;
    let viewer = h.create_user("viewer-handler-deny").await;
    h.add_member(project_id, viewer, ROLE_VIEWER).await;

    let environment_id = h.create_environment(project_id).await;
    let system_id = h.create_system(environment_id, viewer).await;

    // Deny `systems.view` on this specific system for the viewer. The role
    // still grants `systems.view` project-wide — the ACL row must override
    // it when enforcement is on.
    h.set_resource_acl(viewer, project_id, "system", system_id, &[], &["systems.view"])
        .await;

    let token = h.token_for(viewer, vec![(project_id, ROLE_VIEWER)], false);
    let uri = format!("/api/systems/{system_id}");
    let (status, body) = call(&h.router, Method::GET, &uri, Some(&token), None).await;

    if flag_on {
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "flag on: handler must honor the deny ACL. body={}",
            String::from_utf8_lossy(&body)
        );
    } else {
        assert_eq!(
            status,
            StatusCode::OK,
            "flag off: the deny ACL must be ignored so the role grant still passes. body={}",
            String::from_utf8_lossy(&body)
        );
    }

    // Second system on the same project, no ACL row — the viewer must still
    // be allowed either way. Proves the deny is scoped to the specific
    // resource, not the whole role grant.
    let unscoped_system = h.create_system(environment_id, viewer).await;
    let uri2 = format!("/api/systems/{unscoped_system}");
    let (status2, body2) = call(&h.router, Method::GET, &uri2, Some(&token), None).await;
    assert_eq!(
        status2,
        StatusCode::OK,
        "sibling system without an ACL row must remain readable. body={}",
        String::from_utf8_lossy(&body2)
    );
}

/// Company admins short-circuit the resolver — even when both the ACL says
/// deny AND the flag is on, the caller still passes. This is the "impossible
/// to lock yourself out" invariant and it applies across both scopes.
#[tokio::test]
async fn company_admin_short_circuits_acl_deny() {
    let Some(h) = TestHarness::try_new(true).await else {
        common::skip_without_db("company_admin_short_circuits_acl_deny");
        return;
    };

    use containerus_server::auth::jwt::decode_access_token;
    use containerus_server::auth::middleware::ProjectScoped;
    use containerus_server::db::models::EffectivePermissions;

    let project_id = h.create_project("super-admin").await;
    let admin = h.create_user("super-admin").await;
    h.grant_company_admin(admin).await;

    let environment_id = h.create_environment(project_id).await;
    let system_id = h.create_system(environment_id, admin).await;

    // Even with a hard deny row in place, the admin must still be allowed.
    h.set_resource_acl(admin, project_id, "system", system_id, &[], &["projects.view"])
        .await;

    let token = h.token_for(admin, vec![], true);
    let claims = decode_access_token(&token, common::JWT_SECRET).expect("decode");

    let scoped = ProjectScoped {
        claims,
        project_id,
        permissions: EffectivePermissions {
            permissions: Default::default(),
            is_company_admin: true,
        },
        client_ip: None,
    };

    let r = scoped
        .require_for_resource("projects.view", "system", system_id, &h.state)
        .await;
    assert!(r.is_ok(), "company admin must bypass ACL deny");

    h.cleanup().await;
}

/// CON-80: a deny via the resource ACL must surface in `audit_log` as an
/// `rbac.permission_denied` row whose `details.reason` matches the resolver's
/// `DecisionReason::ResourceAclDeny`. This is what the audit dashboard reads
/// to tell an ACL deny apart from a missing role grant during incident
/// response.
#[tokio::test]
async fn require_for_system_acl_deny_emits_audit_with_reason() {
    let Some(h) = TestHarness::try_new(true).await else {
        common::skip_without_db("require_for_system_acl_deny_emits_audit_with_reason");
        return;
    };

    use containerus_server::auth::jwt::decode_access_token;
    use containerus_server::auth::middleware::SystemScoped;
    use containerus_server::db::models::{EffectivePermissions, SystemRow};

    let project_id = h.create_project("audit-deny-acl").await;
    let viewer = h.create_user("viewer-audit-acl").await;
    h.add_member(project_id, viewer, ROLE_VIEWER).await;

    let environment_id = h.create_environment(project_id).await;
    let system_id = h.create_system(environment_id, viewer).await;

    h.set_resource_acl(viewer, project_id, "system", system_id, &[], &["systems.view"])
        .await;

    let token = h.token_for(viewer, vec![(project_id, ROLE_VIEWER)], false);
    let claims = decode_access_token(&token, common::JWT_SECRET).expect("decode");
    let system: SystemRow = sqlx::query_as("SELECT * FROM systems WHERE id = $1")
        .bind(system_id)
        .fetch_one(&h.db)
        .await
        .expect("load system");

    let scoped = SystemScoped {
        claims,
        system,
        project_id,
        environment_id,
        permissions: EffectivePermissions {
            permissions: h.state.permission_cache.get_permissions(&ROLE_VIEWER),
            is_company_admin: false,
        },
        client_ip: Some("203.0.113.42".into()),
    };

    let result = scoped.require_for_system("systems.view", &h.state).await;
    assert!(result.is_err(), "ACL deny must reject the request");

    let row: (Option<uuid::Uuid>, Option<uuid::Uuid>, String, String, Option<String>, serde_json::Value, Option<String>) =
        sqlx::query_as(
            "SELECT project_id, environment_id, action, resource_type, resource_id, details, ip_address
             FROM audit_log
             WHERE action = 'rbac.permission_denied'
               AND resource_type = 'system'
               AND resource_id = $1
             ORDER BY created_at DESC
             LIMIT 1",
        )
        .bind(system_id.to_string())
        .fetch_one(&h.db)
        .await
        .expect("audit row written");

    let (project, env, action, resource_type, resource_id, details, ip) = row;
    assert_eq!(project, Some(project_id));
    assert_eq!(env, Some(environment_id));
    assert_eq!(action, "rbac.permission_denied");
    assert_eq!(resource_type, "system");
    assert_eq!(resource_id.as_deref(), Some(system_id.to_string().as_str()));
    assert_eq!(ip.as_deref(), Some("203.0.113.42"));
    assert_eq!(details["permission"], serde_json::json!("systems.view"));
    assert_eq!(details["reason"], serde_json::json!("resource_acl_deny"));

    h.cleanup().await;
}

/// CON-80: a default-deny path (no role grant, no ACL row) must also emit
/// the `rbac.permission_denied` audit row, with `reason = "default"`. This
/// keeps the audit shape uniform whether the deny came from an ACL layer or
/// from the bottom of the precedence table.
#[tokio::test]
async fn require_for_resource_default_deny_emits_audit_with_reason() {
    let Some(h) = TestHarness::try_new(true).await else {
        common::skip_without_db("require_for_resource_default_deny_emits_audit_with_reason");
        return;
    };

    use containerus_server::auth::jwt::decode_access_token;
    use containerus_server::auth::middleware::ProjectScoped;
    use containerus_server::db::models::EffectivePermissions;

    let project_id = h.create_project("audit-deny-default").await;
    let viewer = h.create_user("viewer-audit-default").await;
    h.add_member(project_id, viewer, ROLE_VIEWER).await;
    let environment_id = h.create_environment(project_id).await;
    let system_id = h.create_system(environment_id, viewer).await;

    let token = h.token_for(viewer, vec![(project_id, ROLE_VIEWER)], false);
    let claims = decode_access_token(&token, common::JWT_SECRET).expect("decode");

    let scoped = ProjectScoped {
        claims,
        project_id,
        permissions: EffectivePermissions {
            permissions: h.state.permission_cache.get_permissions(&ROLE_VIEWER),
            is_company_admin: false,
        },
        client_ip: None,
    };

    // Viewer lacks `systems.delete` and there is no ACL row for it — must
    // hit the default-deny tail of the resolver.
    let result = scoped
        .require_for_resource("systems.delete", "system", system_id, &h.state)
        .await;
    assert!(result.is_err(), "default deny must reject the request");

    let (action, details): (String, serde_json::Value) = sqlx::query_as(
        "SELECT action, details FROM audit_log
         WHERE action = 'rbac.permission_denied'
           AND resource_type = 'system'
           AND resource_id = $1
         ORDER BY created_at DESC
         LIMIT 1",
    )
    .bind(system_id.to_string())
    .fetch_one(&h.db)
    .await
    .expect("audit row written");

    assert_eq!(action, "rbac.permission_denied");
    assert_eq!(details["permission"], serde_json::json!("systems.delete"));
    assert_eq!(details["reason"], serde_json::json!("default"));

    h.cleanup().await;
}

/// CON-80: an allow path must NOT write the deny audit row. Guards against a
/// regression that would flood `audit_log` with false 403 entries on every
/// successful authorized request.
#[tokio::test]
async fn require_for_system_allow_does_not_emit_deny_audit() {
    let Some(h) = TestHarness::try_new(true).await else {
        common::skip_without_db("require_for_system_allow_does_not_emit_deny_audit");
        return;
    };

    use containerus_server::auth::jwt::decode_access_token;
    use containerus_server::auth::middleware::SystemScoped;
    use containerus_server::db::models::{EffectivePermissions, SystemRow};

    let project_id = h.create_project("audit-allow").await;
    let viewer = h.create_user("viewer-audit-allow").await;
    h.add_member(project_id, viewer, ROLE_VIEWER).await;
    let environment_id = h.create_environment(project_id).await;
    let system_id = h.create_system(environment_id, viewer).await;

    let token = h.token_for(viewer, vec![(project_id, ROLE_VIEWER)], false);
    let claims = decode_access_token(&token, common::JWT_SECRET).expect("decode");
    let system: SystemRow = sqlx::query_as("SELECT * FROM systems WHERE id = $1")
        .bind(system_id)
        .fetch_one(&h.db)
        .await
        .expect("load system");

    let scoped = SystemScoped {
        claims,
        system,
        project_id,
        environment_id,
        permissions: EffectivePermissions {
            permissions: h.state.permission_cache.get_permissions(&ROLE_VIEWER),
            is_company_admin: false,
        },
        client_ip: None,
    };

    // Viewer role grants `systems.view` — must pass and write nothing to audit.
    scoped
        .require_for_system("systems.view", &h.state)
        .await
        .expect("viewer role grants systems.view");

    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE action = 'rbac.permission_denied'",
    )
    .fetch_one(&h.db)
    .await
    .expect("count deny audits");
    assert_eq!(count, 0, "an allow must not write a deny audit row");

    h.cleanup().await;
}
