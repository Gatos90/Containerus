//! CON-129 — integration tests for pending-invite endpoints
//! (`GET/POST/DELETE /api/projects/{id}/invites*`).
//!
//! Covers acceptance from the ticket:
//!   * GET returns a `PendingInvite[]` populated by invites whose email has
//!     no matching user
//!   * Resend bumps `invited_at` and writes an `invite.resend` audit row
//!   * Revoke deletes the row, future resend/revoke for the same id 404
//!   * Wrong project scoping yields 404 (never leaks cross-project invites)
//!   * Permission gate: `projects.members.view` for GET, `.manage` for
//!     POST/DELETE
//!
//! Skips when `TEST_DATABASE_URL` is not set (see `common::TestHarness`).

#![allow(clippy::uninlined_format_args)]

mod common;

use axum::http::{Method, StatusCode};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use uuid::Uuid;

use common::{TestHarness, ROLE_PROJECT_ADMIN, ROLE_VIEWER};

/// Drive `POST /members/invite` against an unknown email so the server
/// creates a `project_invites` row (CON-129 fallback). Returns the invite id.
async fn seed_pending_invite(
    h: &TestHarness,
    project_id: Uuid,
    token: &str,
    email: &str,
) -> Uuid {
    let (status, body) = common::call(
        &h.router,
        Method::POST,
        &format!("/api/projects/{project_id}/members/invite"),
        Some(token),
        Some(json!({ "email": email, "roleId": ROLE_VIEWER.to_string() })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "seed pending invite: body={}",
        String::from_utf8_lossy(&body)
    );
    let parsed: Value = serde_json::from_slice(&body).expect("parse invite response");
    parsed["inviteId"]
        .as_str()
        .expect("inviteId present for pending-invite path")
        .parse()
        .expect("parse invite uuid")
}

#[tokio::test]
async fn list_invites_returns_pending_rows_for_unknown_emails() {
    let Some(h) = TestHarness::try_new(false).await else {
        common::skip_without_db("list_invites_returns_pending_rows_for_unknown_emails");
        return;
    };

    let project_id = h.create_project("invites-list").await;
    let admin = h.create_user("invites-admin").await;
    h.add_member(project_id, admin, ROLE_PROJECT_ADMIN).await;
    let token = h.login_as(admin, false).await;

    let email_a = format!("pending-a-{}@test.local", Uuid::new_v4());
    let email_b = format!("pending-b-{}@test.local", Uuid::new_v4());
    let invite_a = seed_pending_invite(&h, project_id, &token, &email_a).await;
    let invite_b = seed_pending_invite(&h, project_id, &token, &email_b).await;

    let (status, body) = common::call(
        &h.router,
        Method::GET,
        &format!("/api/projects/{project_id}/invites"),
        Some(&token),
        None,
    )
    .await;

    assert_eq!(
        status,
        StatusCode::OK,
        "body={}",
        String::from_utf8_lossy(&body)
    );
    let parsed: Value = serde_json::from_slice(&body).expect("parse invites");
    let arr = parsed.as_array().expect("invites is an array");
    assert_eq!(arr.len(), 2, "both pending invites visible");

    let ids: Vec<String> = arr
        .iter()
        .map(|v| v["id"].as_str().unwrap().to_string())
        .collect();
    assert!(ids.contains(&invite_a.to_string()));
    assert!(ids.contains(&invite_b.to_string()));

    for invite in arr {
        assert!(invite["email"].is_string());
        assert_eq!(invite["roleId"].as_str().unwrap(), ROLE_VIEWER.to_string());
        assert_eq!(invite["roleName"].as_str().unwrap(), "Viewer");
        assert!(invite["invitedAt"].is_string());
        assert_eq!(
            invite["invitedBy"].as_str().unwrap(),
            admin.to_string(),
            "invitedBy wired to the caller's user id"
        );
    }

    h.cleanup().await;
}

#[tokio::test]
async fn list_invites_forbidden_without_members_view() {
    let Some(h) = TestHarness::try_new(false).await else {
        common::skip_without_db("list_invites_forbidden_without_members_view");
        return;
    };

    let project_id = h.create_project("invites-forbidden").await;
    // Project member but no membership → no permissions at all.
    let outsider = h.create_user("invites-outsider").await;
    let token = h.login_as(outsider, false).await;

    let (status, _body) = common::call(
        &h.router,
        Method::GET,
        &format!("/api/projects/{project_id}/invites"),
        Some(&token),
        None,
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN);
    h.cleanup().await;
}

#[tokio::test]
async fn resend_invite_bumps_invited_at_and_logs_audit() {
    let Some(h) = TestHarness::try_new(false).await else {
        common::skip_without_db("resend_invite_bumps_invited_at_and_logs_audit");
        return;
    };

    let project_id = h.create_project("invites-resend").await;
    let admin = h.create_user("invites-admin").await;
    h.add_member(project_id, admin, ROLE_PROJECT_ADMIN).await;
    let token = h.login_as(admin, false).await;

    let email = format!("resend-{}@test.local", Uuid::new_v4());
    let invite_id = seed_pending_invite(&h, project_id, &token, &email).await;

    let before: DateTime<Utc> =
        sqlx::query_scalar("SELECT invited_at FROM project_invites WHERE id = $1")
            .bind(invite_id)
            .fetch_one(&h.db)
            .await
            .expect("read invited_at before resend");

    // Small pause so `now()` bumps past the seed timestamp even on fast hardware.
    tokio::time::sleep(std::time::Duration::from_millis(10)).await;

    let (status, body) = common::call(
        &h.router,
        Method::POST,
        &format!("/api/projects/{project_id}/invites/{invite_id}/resend"),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::NO_CONTENT,
        "body={}",
        String::from_utf8_lossy(&body)
    );
    assert!(body.is_empty(), "204 has no body");

    let after: DateTime<Utc> =
        sqlx::query_scalar("SELECT invited_at FROM project_invites WHERE id = $1")
            .bind(invite_id)
            .fetch_one(&h.db)
            .await
            .expect("read invited_at after resend");
    assert!(after > before, "resend must bump invited_at");

    let audit_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log
          WHERE project_id = $1 AND action = 'invite.resend' AND resource_id = $2",
    )
    .bind(project_id)
    .bind(invite_id.to_string())
    .fetch_one(&h.db)
    .await
    .expect("count resend audit");
    assert_eq!(audit_count, 1, "exactly one invite.resend audit row");

    h.cleanup().await;
}

#[tokio::test]
async fn resend_invite_404_for_unknown_id() {
    let Some(h) = TestHarness::try_new(false).await else {
        common::skip_without_db("resend_invite_404_for_unknown_id");
        return;
    };

    let project_id = h.create_project("invites-resend-404").await;
    let admin = h.create_user("invites-admin").await;
    h.add_member(project_id, admin, ROLE_PROJECT_ADMIN).await;
    let token = h.login_as(admin, false).await;

    let bogus = Uuid::new_v4();
    let (status, _body) = common::call(
        &h.router,
        Method::POST,
        &format!("/api/projects/{project_id}/invites/{bogus}/resend"),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    h.cleanup().await;
}

#[tokio::test]
async fn resend_invite_404_when_invite_belongs_to_other_project() {
    let Some(h) = TestHarness::try_new(false).await else {
        common::skip_without_db("resend_invite_404_when_invite_belongs_to_other_project");
        return;
    };

    // Admin is admin on both projects so the 404 is strictly about scoping,
    // not permissions.
    let project_a = h.create_project("invites-proj-a").await;
    let project_b = h.create_project("invites-proj-b").await;
    let admin = h.create_user("invites-admin").await;
    h.add_member(project_a, admin, ROLE_PROJECT_ADMIN).await;
    h.add_member(project_b, admin, ROLE_PROJECT_ADMIN).await;
    let token = h.login_as(admin, false).await;

    let email = format!("cross-scope-{}@test.local", Uuid::new_v4());
    let invite_on_a = seed_pending_invite(&h, project_a, &token, &email).await;

    // Same invite id, but targeted at project_b — must 404 (not leak).
    let (status, _body) = common::call(
        &h.router,
        Method::POST,
        &format!("/api/projects/{project_b}/invites/{invite_on_a}/resend"),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // And the invite itself must still exist on project_a.
    let still_there: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM project_invites WHERE id = $1 AND project_id = $2",
    )
    .bind(invite_on_a)
    .bind(project_a)
    .fetch_one(&h.db)
    .await
    .expect("count invites");
    assert_eq!(still_there, 1);

    h.cleanup().await;
}

#[tokio::test]
async fn resend_invite_forbidden_without_members_manage() {
    let Some(h) = TestHarness::try_new(false).await else {
        common::skip_without_db("resend_invite_forbidden_without_members_manage");
        return;
    };

    let project_id = h.create_project("invites-resend-403").await;
    let admin = h.create_user("invites-admin").await;
    h.add_member(project_id, admin, ROLE_PROJECT_ADMIN).await;
    let admin_token = h.login_as(admin, false).await;

    let email = format!("manage-403-{}@test.local", Uuid::new_v4());
    let invite_id = seed_pending_invite(&h, project_id, &admin_token, &email).await;

    // Viewer can see invites but not manage them.
    let viewer = h.create_user("invites-viewer").await;
    h.add_member(project_id, viewer, ROLE_VIEWER).await;
    let viewer_token = h.login_as(viewer, false).await;

    let (status, _body) = common::call(
        &h.router,
        Method::POST,
        &format!("/api/projects/{project_id}/invites/{invite_id}/resend"),
        Some(&viewer_token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    h.cleanup().await;
}

#[tokio::test]
async fn revoke_invite_deletes_row_and_logs_audit() {
    let Some(h) = TestHarness::try_new(false).await else {
        common::skip_without_db("revoke_invite_deletes_row_and_logs_audit");
        return;
    };

    let project_id = h.create_project("invites-revoke").await;
    let admin = h.create_user("invites-admin").await;
    h.add_member(project_id, admin, ROLE_PROJECT_ADMIN).await;
    let token = h.login_as(admin, false).await;

    let email = format!("revoke-{}@test.local", Uuid::new_v4());
    let invite_id = seed_pending_invite(&h, project_id, &token, &email).await;

    let (status, body) = common::call(
        &h.router,
        Method::DELETE,
        &format!("/api/projects/{project_id}/invites/{invite_id}"),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::NO_CONTENT,
        "body={}",
        String::from_utf8_lossy(&body)
    );

    let remaining: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM project_invites WHERE id = $1")
            .bind(invite_id)
            .fetch_one(&h.db)
            .await
            .expect("count after revoke");
    assert_eq!(remaining, 0, "invite row deleted");

    let audit_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log
          WHERE project_id = $1 AND action = 'invite.revoke' AND resource_id = $2",
    )
    .bind(project_id)
    .bind(invite_id.to_string())
    .fetch_one(&h.db)
    .await
    .expect("count revoke audit");
    assert_eq!(audit_count, 1);

    // Subsequent resend / revoke on the same id is now 404.
    let (status, _body) = common::call(
        &h.router,
        Method::DELETE,
        &format!("/api/projects/{project_id}/invites/{invite_id}"),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    h.cleanup().await;
}

#[tokio::test]
async fn revoke_invite_forbidden_without_members_manage() {
    let Some(h) = TestHarness::try_new(false).await else {
        common::skip_without_db("revoke_invite_forbidden_without_members_manage");
        return;
    };

    let project_id = h.create_project("invites-revoke-403").await;
    let admin = h.create_user("invites-admin").await;
    h.add_member(project_id, admin, ROLE_PROJECT_ADMIN).await;
    let admin_token = h.login_as(admin, false).await;

    let email = format!("revoke-403-{}@test.local", Uuid::new_v4());
    let invite_id = seed_pending_invite(&h, project_id, &admin_token, &email).await;

    let viewer = h.create_user("invites-viewer").await;
    h.add_member(project_id, viewer, ROLE_VIEWER).await;
    let viewer_token = h.login_as(viewer, false).await;

    let (status, _body) = common::call(
        &h.router,
        Method::DELETE,
        &format!("/api/projects/{project_id}/invites/{invite_id}"),
        Some(&viewer_token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Row still intact.
    let remaining: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM project_invites WHERE id = $1")
            .bind(invite_id)
            .fetch_one(&h.db)
            .await
            .expect("count after blocked revoke");
    assert_eq!(remaining, 1);

    h.cleanup().await;
}

#[tokio::test]
async fn invite_member_unknown_email_conflicts_on_second_call() {
    let Some(h) = TestHarness::try_new(false).await else {
        common::skip_without_db("invite_member_unknown_email_conflicts_on_second_call");
        return;
    };

    let project_id = h.create_project("invites-duplicate").await;
    let admin = h.create_user("invites-admin").await;
    h.add_member(project_id, admin, ROLE_PROJECT_ADMIN).await;
    let token = h.login_as(admin, false).await;

    let email = format!("dup-{}@test.local", Uuid::new_v4());
    let _first = seed_pending_invite(&h, project_id, &token, &email).await;

    // Second invite to the same pending email on the same project must 409
    // (not silently create a duplicate row).
    let (status, _body) = common::call(
        &h.router,
        Method::POST,
        &format!("/api/projects/{project_id}/members/invite"),
        Some(&token),
        Some(json!({ "email": email, "roleId": ROLE_VIEWER.to_string() })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    h.cleanup().await;
}
