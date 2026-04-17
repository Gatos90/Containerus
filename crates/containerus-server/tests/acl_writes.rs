//! CON-78: `resource_acls` write-path tests for permission-key
//! normalisation and catalog validation.
//!
//! Exercises the `POST`/`PUT` handlers in `api/acls.rs` end-to-end through
//! the axum router so the normalised, de-duplicated keys that land in the
//! `extra_permissions` / `denied_permissions` JSONB columns are the exact
//! strings the resolver's `HashSet` lookup expects. Unknown keys must be
//! rejected with `400` so a typo can never silently produce a "no-op" deny.
//!
//! Requires `TEST_DATABASE_URL`; skips cleanly otherwise so `cargo test
//! -p containerus-server` stays green on developer machines without a DB.

mod common;

use axum::http::{Method, StatusCode};
use common::{call, TestHarness, ROLE_PROJECT_ADMIN};
use serde_json::{json, Value};
use uuid::Uuid;

/// Build a create-ACL request body for the given target resource.
fn create_body(
    user_id: Uuid,
    resource_id: Uuid,
    extra: Vec<&str>,
    denied: Vec<&str>,
) -> Value {
    json!({
        "userId": user_id,
        "resourceType": "system",
        "resourceId": resource_id,
        "roleId": Option::<Uuid>::None,
        "extraPermissions": extra,
        "deniedPermissions": denied,
    })
}

#[tokio::test]
async fn create_acl_normalizes_casing_and_whitespace() {
    let Some(h) = TestHarness::try_new(true).await else {
        common::skip_without_db("create_acl_normalizes_casing_and_whitespace");
        return;
    };

    let project_id = h.create_project("acl-norm").await;
    let admin = h.create_user("admin-norm").await;
    h.add_member(project_id, admin, ROLE_PROJECT_ADMIN).await;
    let environment_id = h.create_environment(project_id).await;
    let system_id = h.create_system(environment_id, admin).await;

    let target = h.create_user("target-norm").await;
    let token = h.login_as(admin, false).await;

    let body = create_body(
        target,
        system_id,
        vec![" Containers.Exec ", "containers.exec"],
        vec!["SYSTEMS.DELETE", "systems.delete "],
    );
    let uri = format!("/api/projects/{project_id}/acls/");
    let (status, bytes) =
        call(&h.router, Method::POST, &uri, Some(&token), Some(body)).await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "normalised keys must be accepted, got {status}: {}",
        String::from_utf8_lossy(&bytes)
    );

    let json: Value = serde_json::from_slice(&bytes).expect("parse response");
    let extra = json["extra_permissions"]
        .as_array()
        .expect("extra_permissions array");
    let denied = json["denied_permissions"]
        .as_array()
        .expect("denied_permissions array");

    assert_eq!(
        extra.iter().map(|v| v.as_str().unwrap()).collect::<Vec<_>>(),
        vec!["containers.exec"],
        "extra keys must be trimmed, lowercased, and de-duplicated",
    );
    assert_eq!(
        denied.iter().map(|v| v.as_str().unwrap()).collect::<Vec<_>>(),
        vec!["systems.delete"],
        "denied keys must be trimmed, lowercased, and de-duplicated",
    );

    h.cleanup().await;
}

#[tokio::test]
async fn create_acl_rejects_unknown_keys_with_400() {
    let Some(h) = TestHarness::try_new(true).await else {
        common::skip_without_db("create_acl_rejects_unknown_keys_with_400");
        return;
    };

    let project_id = h.create_project("acl-unknown").await;
    let admin = h.create_user("admin-unknown").await;
    h.add_member(project_id, admin, ROLE_PROJECT_ADMIN).await;
    let environment_id = h.create_environment(project_id).await;
    let system_id = h.create_system(environment_id, admin).await;
    let target = h.create_user("target-unknown").await;
    let token = h.login_as(admin, false).await;

    let body = create_body(
        target,
        system_id,
        vec!["systems.view"],
        vec!["systems.nuke-from-orbit"],
    );
    let uri = format!("/api/projects/{project_id}/acls/");
    let (status, bytes) =
        call(&h.router, Method::POST, &uri, Some(&token), Some(body)).await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "unknown denied key must 400, got {status}: {}",
        String::from_utf8_lossy(&bytes)
    );

    let json: Value = serde_json::from_slice(&bytes).expect("parse response");
    assert_eq!(json["field"], "deniedPermissions");
    let unknown = json["unknownKeys"].as_array().expect("unknownKeys array");
    assert_eq!(
        unknown.iter().map(|v| v.as_str().unwrap()).collect::<Vec<_>>(),
        vec!["systems.nuke-from-orbit"],
    );

    // Confirm no ACL row leaked through.
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM resource_acls WHERE project_id = $1",
    )
    .bind(project_id)
    .fetch_one(&h.db)
    .await
    .expect("count acls");
    assert_eq!(count, 0, "failed create must not persist a row");

    h.cleanup().await;
}

// CON-79: `resource_acls.role_id` is a silent no-op in the resolver. Any
// non-null value on create or update must be rejected so callers can't think
// they've installed a per-resource role overlay that never runs.

#[tokio::test]
async fn create_acl_rejects_non_null_role_id_with_400() {
    let Some(h) = TestHarness::try_new(true).await else {
        common::skip_without_db("create_acl_rejects_non_null_role_id_with_400");
        return;
    };

    let project_id = h.create_project("acl-role-id-create").await;
    let admin = h.create_user("admin-role-id-create").await;
    h.add_member(project_id, admin, ROLE_PROJECT_ADMIN).await;
    let environment_id = h.create_environment(project_id).await;
    let system_id = h.create_system(environment_id, admin).await;
    let target = h.create_user("target-role-id-create").await;
    let token = h.login_as(admin, false).await;

    let body = json!({
        "userId": target,
        "resourceType": "system",
        "resourceId": system_id,
        "roleId": ROLE_PROJECT_ADMIN,
        "extraPermissions": ["systems.view"],
        "deniedPermissions": [],
    });
    let uri = format!("/api/projects/{project_id}/acls/");
    let (status, bytes) =
        call(&h.router, Method::POST, &uri, Some(&token), Some(body)).await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "non-null roleId must 400, got {status}: {}",
        String::from_utf8_lossy(&bytes)
    );

    let json: Value = serde_json::from_slice(&bytes).expect("parse response");
    assert_eq!(json["field"], "roleId");

    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM resource_acls WHERE project_id = $1",
    )
    .bind(project_id)
    .fetch_one(&h.db)
    .await
    .expect("count acls");
    assert_eq!(count, 0, "rejected create must not persist a row");

    h.cleanup().await;
}

#[tokio::test]
async fn update_acl_rejects_non_null_role_id_with_400() {
    let Some(h) = TestHarness::try_new(true).await else {
        common::skip_without_db("update_acl_rejects_non_null_role_id_with_400");
        return;
    };

    let project_id = h.create_project("acl-role-id-update").await;
    let admin = h.create_user("admin-role-id-update").await;
    h.add_member(project_id, admin, ROLE_PROJECT_ADMIN).await;
    let environment_id = h.create_environment(project_id).await;
    let system_id = h.create_system(environment_id, admin).await;
    let target = h.create_user("target-role-id-update").await;
    let token = h.login_as(admin, false).await;

    h.set_resource_acl(target, project_id, "system", system_id, &["systems.view"], &[])
        .await;
    let acl_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM resource_acls
         WHERE user_id = $1 AND project_id = $2 AND resource_type = 'system'
               AND resource_id = $3",
    )
    .bind(target)
    .bind(project_id)
    .bind(system_id)
    .fetch_one(&h.db)
    .await
    .expect("fetch seeded acl id");

    let body = json!({ "roleId": ROLE_PROJECT_ADMIN });
    let uri = format!("/api/projects/{project_id}/acls/{acl_id}");
    let (status, bytes) =
        call(&h.router, Method::PUT, &uri, Some(&token), Some(body)).await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "non-null roleId must 400, got {status}: {}",
        String::from_utf8_lossy(&bytes)
    );

    let json: Value = serde_json::from_slice(&bytes).expect("parse response");
    assert_eq!(json["field"], "roleId");

    // Seeded row must still show roleId as NULL — the rejected update may not
    // install a silently-ignored overlay.
    let row_role_id: Option<Uuid> =
        sqlx::query_scalar("SELECT role_id FROM resource_acls WHERE id = $1")
            .bind(acl_id)
            .fetch_one(&h.db)
            .await
            .expect("fetch role_id");
    assert!(row_role_id.is_none(), "role_id must remain NULL after rejected update");

    h.cleanup().await;
}

#[tokio::test]
async fn update_acl_rejects_unknown_keys_with_400() {
    let Some(h) = TestHarness::try_new(true).await else {
        common::skip_without_db("update_acl_rejects_unknown_keys_with_400");
        return;
    };

    let project_id = h.create_project("acl-update").await;
    let admin = h.create_user("admin-update").await;
    h.add_member(project_id, admin, ROLE_PROJECT_ADMIN).await;
    let environment_id = h.create_environment(project_id).await;
    let system_id = h.create_system(environment_id, admin).await;
    let target = h.create_user("target-update").await;
    let token = h.login_as(admin, false).await;

    // Seed a clean ACL row first so the update path has something to modify.
    h.set_resource_acl(target, project_id, "system", system_id, &["systems.view"], &[])
        .await;
    let acl_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM resource_acls
         WHERE user_id = $1 AND project_id = $2 AND resource_type = 'system'
               AND resource_id = $3",
    )
    .bind(target)
    .bind(project_id)
    .bind(system_id)
    .fetch_one(&h.db)
    .await
    .expect("fetch seeded acl id");

    let body = json!({
        "extraPermissions": ["typo.permission"],
    });
    let uri = format!("/api/projects/{project_id}/acls/{acl_id}");
    let (status, _) =
        call(&h.router, Method::PUT, &uri, Some(&token), Some(body)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Seeded row must be untouched.
    let row_extra: Value = sqlx::query_scalar(
        "SELECT extra_permissions FROM resource_acls WHERE id = $1",
    )
    .bind(acl_id)
    .fetch_one(&h.db)
    .await
    .expect("fetch extra_permissions");
    assert_eq!(row_extra, json!(["systems.view"]));

    h.cleanup().await;
}
