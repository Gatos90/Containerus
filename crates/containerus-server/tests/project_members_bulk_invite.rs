//! CON-120 — integration tests for `POST /api/projects/{id}/members/invite-bulk`.
//!
//! Covers the acceptance criteria from the ticket:
//!   * 200 on full success, 207 on partial
//!   * duplicate emails in the payload reported once, not double-invited
//!   * per-invite audit rows survive alongside the bulk-level audit row
//!
//! Skips automatically when `TEST_DATABASE_URL` is not set — matches the rest
//! of the suite.

#![allow(clippy::uninlined_format_args)]

mod common;

use axum::http::{Method, StatusCode};
use serde_json::{json, Value};
use uuid::Uuid;

use common::{TestHarness, ROLE_PROJECT_ADMIN};

async fn seed_named_user(h: &TestHarness, email: &str) -> Uuid {
    sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO users (email, password_hash, display_name, auth_provider)
         VALUES ($1, 'x', $2, 'local')
         RETURNING id",
    )
    .bind(email)
    .bind(email)
    .fetch_one(&h.db)
    .await
    .expect("seed named user")
}

#[tokio::test]
async fn bulk_invite_full_success_returns_200() {
    let Some(h) = TestHarness::try_new(false).await else {
        eprintln!("SKIP bulk_invite_full_success_returns_200: no TEST_DATABASE_URL");
        return;
    };

    let project_id = h.create_project("bulk-ok").await;
    let admin = h.create_user("bulk-admin").await;
    h.add_member(project_id, admin, ROLE_PROJECT_ADMIN).await;
    let token = h.login_as(admin, false).await;

    let alice_email = format!("alice-{}@test.local", Uuid::new_v4());
    let bob_email = format!("bob-{}@test.local", Uuid::new_v4());
    seed_named_user(&h, &alice_email).await;
    seed_named_user(&h, &bob_email).await;

    let (status, body) = common::call(
        &h.router,
        Method::POST,
        &format!("/api/projects/{project_id}/members/invite-bulk"),
        Some(&token),
        Some(json!({
            "invites": [
                { "email": alice_email, "roleId": ROLE_PROJECT_ADMIN.to_string() },
                { "email": bob_email, "roleId": ROLE_PROJECT_ADMIN.to_string() },
            ]
        })),
    )
    .await;

    assert_eq!(status, StatusCode::OK, "body={}", String::from_utf8_lossy(&body));
    let parsed: Value = serde_json::from_slice(&body).expect("parse bulk response");
    assert_eq!(parsed["invited"].as_array().unwrap().len(), 2);
    assert!(parsed["skipped"].as_array().unwrap().is_empty());
    assert!(parsed["errored"].as_array().unwrap().is_empty());

    // Per-invite audit rows + one bulk-level audit row must all be present.
    let per_invite: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE project_id = $1 AND action = 'member.invite'",
    )
    .bind(project_id)
    .fetch_one(&h.db)
    .await
    .expect("count per-invite audits");
    assert_eq!(per_invite, 2, "one audit row per invited member");

    let bulk_row: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE project_id = $1 AND action = 'project.invite.bulk'",
    )
    .bind(project_id)
    .fetch_one(&h.db)
    .await
    .expect("count bulk audit");
    assert_eq!(bulk_row, 1, "exactly one bulk-level audit row");

    h.cleanup().await;
}

#[tokio::test]
async fn bulk_invite_partial_returns_207_and_dedupes_payload() {
    let Some(h) = TestHarness::try_new(false).await else {
        eprintln!("SKIP bulk_invite_partial_returns_207_and_dedupes_payload: no TEST_DATABASE_URL");
        return;
    };

    let project_id = h.create_project("bulk-partial").await;
    let admin = h.create_user("bulk-admin-p").await;
    h.add_member(project_id, admin, ROLE_PROJECT_ADMIN).await;
    let token = h.login_as(admin, false).await;

    let carol_email = format!("carol-{}@test.local", Uuid::new_v4());
    seed_named_user(&h, &carol_email).await;
    let unknown_email = format!("nobody-{}@test.local", Uuid::new_v4());

    let (status, body) = common::call(
        &h.router,
        Method::POST,
        &format!("/api/projects/{project_id}/members/invite-bulk"),
        Some(&token),
        Some(json!({
            "invites": [
                { "email": carol_email, "roleId": ROLE_PROJECT_ADMIN.to_string() },
                // Duplicate of carol — must be reported once in `skipped`,
                // not inserted a second time.
                { "email": carol_email, "roleId": ROLE_PROJECT_ADMIN.to_string() },
                // Unknown user — goes to `errored` with reason `unknown_user`.
                { "email": unknown_email, "roleId": ROLE_PROJECT_ADMIN.to_string() },
                // Malformed email — goes to `errored` with reason `invalid_email`.
                { "email": "not-an-email", "roleId": ROLE_PROJECT_ADMIN.to_string() },
            ]
        })),
    )
    .await;

    assert_eq!(
        status,
        StatusCode::MULTI_STATUS,
        "body={}",
        String::from_utf8_lossy(&body)
    );
    let parsed: Value = serde_json::from_slice(&body).expect("parse bulk response");
    assert_eq!(parsed["invited"].as_array().unwrap().len(), 1);
    let skipped = parsed["skipped"].as_array().unwrap();
    assert_eq!(skipped.len(), 1);
    assert_eq!(skipped[0]["reason"], "duplicate_in_payload");
    let errored = parsed["errored"].as_array().unwrap();
    assert_eq!(errored.len(), 2);
    let reasons: Vec<&str> = errored.iter().map(|e| e["reason"].as_str().unwrap()).collect();
    assert!(reasons.contains(&"unknown_user"));
    assert!(reasons.contains(&"invalid_email"));

    // Exactly one project_members row was inserted for carol despite the
    // duplicate payload entry.
    let carol_members: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM project_members pm
         JOIN users u ON u.id = pm.user_id
         WHERE pm.project_id = $1 AND u.email = $2",
    )
    .bind(project_id)
    .bind(&carol_email)
    .fetch_one(&h.db)
    .await
    .expect("count carol memberships");
    assert_eq!(carol_members, 1);

    h.cleanup().await;
}

#[tokio::test]
async fn bulk_invite_rejects_oversize_payload() {
    let Some(h) = TestHarness::try_new(false).await else {
        eprintln!("SKIP bulk_invite_rejects_oversize_payload: no TEST_DATABASE_URL");
        return;
    };

    let project_id = h.create_project("bulk-oversize").await;
    let admin = h.create_user("bulk-admin-o").await;
    h.add_member(project_id, admin, ROLE_PROJECT_ADMIN).await;
    let token = h.login_as(admin, false).await;

    let invites: Vec<Value> = (0..101)
        .map(|i| {
            json!({
                "email": format!("u{i}-{}@test.local", Uuid::new_v4()),
                "roleId": ROLE_PROJECT_ADMIN.to_string(),
            })
        })
        .collect();

    let (status, _body) = common::call(
        &h.router,
        Method::POST,
        &format!("/api/projects/{project_id}/members/invite-bulk"),
        Some(&token),
        Some(json!({ "invites": invites })),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);

    h.cleanup().await;
}
