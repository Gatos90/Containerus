//! CON-118 — integration tests for password change + reset endpoints.
//!
//! Covers the happy path (change with correct current password, reset via
//! admin-issue → confirm) and the critical negatives (wrong current
//! password, expired/used token, enumeration-proof 200, generic 200 on
//! unknown email). Tests skip automatically when `TEST_DATABASE_URL` is
//! not set — matches the convention of the rest of this suite.

#![allow(clippy::uninlined_format_args)]

mod common;

use axum::http::{Method, StatusCode};
use serde_json::json;
use sqlx::Row;

use common::TestHarness;

fn password_hash(plain: &str) -> String {
    // Use the production hasher so the confirm/login paths see a real
    // Argon2id hash and can't accidentally pass with the `'x'` sentinel.
    containerus_server::auth::password::hash_password(plain).expect("hash password")
}

async fn seed_user_with_password(
    h: &TestHarness,
    label: &str,
    plain_password: &str,
) -> (uuid::Uuid, String) {
    let email = format!("{label}-{}@test.local", uuid::Uuid::new_v4());
    let hash = password_hash(plain_password);
    let uid: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO users (email, password_hash, display_name, auth_provider)
         VALUES ($1, $2, $3, 'local')
         RETURNING id",
    )
    .bind(&email)
    .bind(&hash)
    .bind(label)
    .fetch_one(&h.db)
    .await
    .expect("seed user");
    (uid, email)
}

#[tokio::test]
async fn change_rotates_password_and_revokes_refresh_tokens() {
    let Some(h) = TestHarness::try_new(false).await else {
        eprintln!("SKIP change_rotates_password_and_revokes_refresh_tokens: no TEST_DATABASE_URL");
        return;
    };

    let (uid, _email) = seed_user_with_password(&h, "pw-change", "old-password-123").await;

    // Two refresh tokens — simulates "signed in on two devices".
    for _ in 0..2 {
        sqlx::query(
            "INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
             VALUES ($1, $2, now() + interval '7 days')",
        )
        .bind(uid)
        .bind(uuid::Uuid::new_v4().to_string())
        .execute(&h.db)
        .await
        .expect("seed refresh token");
    }

    let token = h.login_as(uid, false).await;

    let (status, body) = common::call(
        &h.router,
        Method::POST,
        "/api/auth/password/change",
        Some(&token),
        Some(json!({
            "currentPassword": "old-password-123",
            "newPassword": "brand-new-password-456",
        })),
    )
    .await;

    assert_eq!(status, StatusCode::NO_CONTENT, "body={}", String::from_utf8_lossy(&body));

    // Every refresh token for this user must be gone.
    let remaining: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM refresh_tokens WHERE user_id = $1")
            .bind(uid)
            .fetch_one(&h.db)
            .await
            .expect("count refresh");
    assert_eq!(remaining, 0, "refresh tokens must be revoked on password change");

    // The new password must verify, the old one must not.
    let stored: String = sqlx::query_scalar("SELECT password_hash FROM users WHERE id = $1")
        .bind(uid)
        .fetch_one(&h.db)
        .await
        .expect("read hash");
    assert!(containerus_server::auth::password::verify_password("brand-new-password-456", &stored).unwrap());
    assert!(!containerus_server::auth::password::verify_password("old-password-123", &stored).unwrap());

    // Audit row was emitted.
    let audit_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE action = 'user.password.change' AND user_id = $1",
    )
    .bind(uid)
    .fetch_one(&h.db)
    .await
    .expect("count audit");
    assert!(audit_count >= 1, "expected audit row for user.password.change");

    h.cleanup().await;
}

#[tokio::test]
async fn change_rejects_wrong_current_password() {
    let Some(h) = TestHarness::try_new(false).await else {
        eprintln!("SKIP change_rejects_wrong_current_password: no TEST_DATABASE_URL");
        return;
    };

    let (uid, _email) = seed_user_with_password(&h, "pw-wrong", "right-password").await;
    let token = h.login_as(uid, false).await;

    let (status, _) = common::call(
        &h.router,
        Method::POST,
        "/api/auth/password/change",
        Some(&token),
        Some(json!({
            "currentPassword": "not-the-right-one",
            "newPassword": "brand-new-password-456",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    h.cleanup().await;
}

#[tokio::test]
async fn reset_request_always_returns_200_even_for_unknown_email() {
    let Some(h) = TestHarness::try_new(false).await else {
        eprintln!("SKIP reset_request_always_returns_200_even_for_unknown_email: no TEST_DATABASE_URL");
        return;
    };

    let (status, _body) = common::call(
        &h.router,
        Method::POST,
        "/api/auth/password/reset/request",
        None,
        Some(json!({ "email": "nobody@nowhere.test.local" })),
    )
    .await;
    // Enumeration guard — unknown emails look identical to known ones.
    assert_eq!(status, StatusCode::OK);

    h.cleanup().await;
}

#[tokio::test]
async fn admin_issue_then_confirm_rotates_password() {
    let Some(h) = TestHarness::try_new(false).await else {
        eprintln!("SKIP admin_issue_then_confirm_rotates_password: no TEST_DATABASE_URL");
        return;
    };

    // Target account with a real Argon2 hash so confirm can be verified.
    let (target_uid, target_email) =
        seed_user_with_password(&h, "pw-reset-target", "original-password").await;

    // Pre-seed a refresh token; confirm must wipe it.
    sqlx::query(
        "INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + interval '7 days')",
    )
    .bind(target_uid)
    .bind(uuid::Uuid::new_v4().to_string())
    .execute(&h.db)
    .await
    .expect("seed refresh token");

    // Admin user (company admin) calls /reset/issue.
    let admin_uid = h.create_user("pw-reset-admin").await;
    h.grant_company_admin(admin_uid).await;
    let admin_token = h.login_as(admin_uid, true).await;

    let (status, body) = common::call(
        &h.router,
        Method::POST,
        "/api/auth/password/reset/issue",
        Some(&admin_token),
        Some(json!({ "email": target_email })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "body={}", String::from_utf8_lossy(&body));
    let issued: serde_json::Value = serde_json::from_slice(&body).expect("json");
    let raw_token = issued["token"].as_str().expect("token in response").to_owned();

    // Confirm with the raw token — unauthenticated call.
    let (status, body) = common::call(
        &h.router,
        Method::POST,
        "/api/auth/password/reset/confirm",
        None,
        Some(json!({
            "token": raw_token,
            "newPassword": "post-reset-password",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT, "body={}", String::from_utf8_lossy(&body));

    // Password rotated to the new value.
    let stored: String = sqlx::query_scalar("SELECT password_hash FROM users WHERE id = $1")
        .bind(target_uid)
        .fetch_one(&h.db)
        .await
        .expect("read hash");
    assert!(containerus_server::auth::password::verify_password("post-reset-password", &stored).unwrap());
    assert!(!containerus_server::auth::password::verify_password("original-password", &stored).unwrap());

    // Refresh tokens wiped.
    let remaining: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM refresh_tokens WHERE user_id = $1")
            .bind(target_uid)
            .fetch_one(&h.db)
            .await
            .expect("count refresh");
    assert_eq!(remaining, 0);

    // Row marked used.
    let used_rows: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NOT NULL",
    )
    .bind(target_uid)
    .fetch_one(&h.db)
    .await
    .expect("count used");
    assert_eq!(used_rows, 1);

    h.cleanup().await;
}

#[tokio::test]
async fn reset_confirm_rejects_reused_token() {
    let Some(h) = TestHarness::try_new(false).await else {
        eprintln!("SKIP reset_confirm_rejects_reused_token: no TEST_DATABASE_URL");
        return;
    };

    let (target_uid, target_email) =
        seed_user_with_password(&h, "pw-reset-reuse", "original").await;
    let admin_uid = h.create_user("pw-reset-admin2").await;
    h.grant_company_admin(admin_uid).await;
    let admin_token = h.login_as(admin_uid, true).await;

    let (_, body) = common::call(
        &h.router,
        Method::POST,
        "/api/auth/password/reset/issue",
        Some(&admin_token),
        Some(json!({ "email": target_email })),
    )
    .await;
    let issued: serde_json::Value = serde_json::from_slice(&body).expect("json");
    let raw_token = issued["token"].as_str().expect("token").to_owned();

    // First confirm — succeeds.
    let (status1, _) = common::call(
        &h.router,
        Method::POST,
        "/api/auth/password/reset/confirm",
        None,
        Some(json!({ "token": raw_token, "newPassword": "first-new-password" })),
    )
    .await;
    assert_eq!(status1, StatusCode::NO_CONTENT);

    // Second confirm with the same token — must be rejected.
    let (status2, _) = common::call(
        &h.router,
        Method::POST,
        "/api/auth/password/reset/confirm",
        None,
        Some(json!({ "token": raw_token, "newPassword": "second-new-password" })),
    )
    .await;
    assert_eq!(status2, StatusCode::BAD_REQUEST);

    // Underlying password must still be the first reset (not the second).
    let row = sqlx::query("SELECT password_hash FROM users WHERE id = $1")
        .bind(target_uid)
        .fetch_one(&h.db)
        .await
        .expect("row");
    let stored: String = row.get("password_hash");
    assert!(containerus_server::auth::password::verify_password("first-new-password", &stored).unwrap());
    assert!(!containerus_server::auth::password::verify_password("second-new-password", &stored).unwrap());

    h.cleanup().await;
}

#[tokio::test]
async fn reset_issue_rejects_non_admin_caller() {
    let Some(h) = TestHarness::try_new(false).await else {
        eprintln!("SKIP reset_issue_rejects_non_admin_caller: no TEST_DATABASE_URL");
        return;
    };

    let (_target_uid, target_email) =
        seed_user_with_password(&h, "pw-iss-target", "secret").await;

    // Non-admin caller.
    let caller = h.create_user("pw-iss-caller").await;
    let caller_token = h.login_as(caller, false).await;

    let (status, _) = common::call(
        &h.router,
        Method::POST,
        "/api/auth/password/reset/issue",
        Some(&caller_token),
        Some(json!({ "email": target_email })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    h.cleanup().await;
}
