//! CON-119 — integration tests for the admin user deactivation endpoint.
//!
//! Covers the acceptance matrix from the ticket: admin flip flows through
//! to refresh revocation, self-deactivation is refused with 400, non-admin
//! callers are rejected, and the login/refresh paths already enforce
//! `is_active` so a disabled user cannot keep working past the flip. Tests
//! skip when `TEST_DATABASE_URL` is unset, matching the rest of the
//! `containerus-server` integration suite.

#![allow(clippy::uninlined_format_args)]

mod common;

use axum::http::{Method, StatusCode};
use serde_json::json;

use common::TestHarness;

fn password_hash(plain: &str) -> String {
    containerus_server::auth::password::hash_password(plain).expect("hash password")
}

async fn seed_user_with_password(
    h: &TestHarness,
    label: &str,
    plain: &str,
) -> (uuid::Uuid, String) {
    let email = format!("{label}-{}@test.local", uuid::Uuid::new_v4());
    let hash = password_hash(plain);
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
async fn admin_deactivate_flips_is_active_and_revokes_sessions() {
    let Some(h) = TestHarness::try_new(false).await else {
        eprintln!("SKIP admin_deactivate_flips_is_active_and_revokes_sessions: no TEST_DATABASE_URL");
        return;
    };

    let (target_uid, _) = seed_user_with_password(&h, "deact-target", "pw12345678").await;

    // Two refresh tokens to prove "revoke all sessions" isn't a one-row fluke.
    for _ in 0..2 {
        sqlx::query(
            "INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
             VALUES ($1, $2, now() + interval '7 days')",
        )
        .bind(target_uid)
        .bind(uuid::Uuid::new_v4().to_string())
        .execute(&h.db)
        .await
        .expect("seed refresh token");
    }

    // Seed a fake MFA enrollment so we can prove it is wiped.
    sqlx::query(
        "INSERT INTO user_mfa (user_id, method, secret_encrypted, secret_nonce, enabled_at)
         VALUES ($1, 'totp', '\\x00', '\\x00', now())",
    )
    .bind(target_uid)
    .execute(&h.db)
    .await
    .expect("seed mfa");
    sqlx::query(
        "INSERT INTO mfa_backup_codes (user_id, code_hash)
         VALUES ($1, 'bc-hash')",
    )
    .bind(target_uid)
    .execute(&h.db)
    .await
    .expect("seed backup code");

    let admin_uid = h.create_user("deact-admin").await;
    h.grant_company_admin(admin_uid).await;
    let admin_token = h.login_as(admin_uid, true).await;

    let uri = format!("/api/admin/users/{target_uid}");
    let (status, body) = common::call(
        &h.router,
        Method::PATCH,
        &uri,
        Some(&admin_token),
        Some(json!({ "isActive": false })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "body={}", String::from_utf8_lossy(&body));
    let resp: serde_json::Value = serde_json::from_slice(&body).expect("json");
    assert_eq!(resp["id"], json!(target_uid.to_string()));
    assert_eq!(resp["isActive"], json!(false));
    assert!(resp.get("passwordHash").is_none(), "password hash must not leak");

    // `is_active` flipped in the row.
    let is_active: bool = sqlx::query_scalar("SELECT is_active FROM users WHERE id = $1")
        .bind(target_uid)
        .fetch_one(&h.db)
        .await
        .expect("read is_active");
    assert!(!is_active);

    // Every refresh token revoked.
    let sessions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM refresh_tokens WHERE user_id = $1")
        .bind(target_uid)
        .fetch_one(&h.db)
        .await
        .expect("count sessions");
    assert_eq!(sessions, 0);

    // MFA wiped — both the secret and the backup codes.
    let mfa_rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM user_mfa WHERE user_id = $1")
        .bind(target_uid)
        .fetch_one(&h.db)
        .await
        .expect("count mfa");
    assert_eq!(mfa_rows, 0);
    let backup_rows: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM mfa_backup_codes WHERE user_id = $1")
            .bind(target_uid)
            .fetch_one(&h.db)
            .await
            .expect("count backup");
    assert_eq!(backup_rows, 0);

    // Audit event emitted with the matching action name.
    let audit: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log
          WHERE action = 'user.deactivate'
            AND resource_type = 'user'
            AND resource_id = $1",
    )
    .bind(target_uid.to_string())
    .fetch_one(&h.db)
    .await
    .expect("count audit");
    assert_eq!(audit, 1);

    h.cleanup().await;
}

#[tokio::test]
async fn admin_cannot_deactivate_self() {
    let Some(h) = TestHarness::try_new(false).await else {
        eprintln!("SKIP admin_cannot_deactivate_self: no TEST_DATABASE_URL");
        return;
    };

    let admin_uid = h.create_user("self-deact").await;
    h.grant_company_admin(admin_uid).await;
    let admin_token = h.login_as(admin_uid, true).await;

    let uri = format!("/api/admin/users/{admin_uid}");
    let (status, body) = common::call(
        &h.router,
        Method::PATCH,
        &uri,
        Some(&admin_token),
        Some(json!({ "isActive": false })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "body={}", String::from_utf8_lossy(&body));

    let is_active: bool = sqlx::query_scalar("SELECT is_active FROM users WHERE id = $1")
        .bind(admin_uid)
        .fetch_one(&h.db)
        .await
        .expect("read is_active");
    assert!(is_active, "self-deactivation must not have landed");

    h.cleanup().await;
}

#[tokio::test]
async fn non_admin_cannot_deactivate_users() {
    let Some(h) = TestHarness::try_new(false).await else {
        eprintln!("SKIP non_admin_cannot_deactivate_users: no TEST_DATABASE_URL");
        return;
    };

    let (target_uid, _) = seed_user_with_password(&h, "deact-target", "pw12345678").await;
    let non_admin_uid = h.create_user("non-admin").await;
    let token = h.login_as(non_admin_uid, false).await;

    let uri = format!("/api/admin/users/{target_uid}");
    let (status, _) = common::call(
        &h.router,
        Method::PATCH,
        &uri,
        Some(&token),
        Some(json!({ "isActive": false })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let is_active: bool = sqlx::query_scalar("SELECT is_active FROM users WHERE id = $1")
        .bind(target_uid)
        .fetch_one(&h.db)
        .await
        .expect("read is_active");
    assert!(is_active);

    h.cleanup().await;
}

#[tokio::test]
async fn refresh_rejects_deactivated_user() {
    // Regression guard: the login + refresh paths already filter
    // `is_active = true`; this test pins that behaviour so future edits to
    // the refresh query can't silently regress the deactivation contract.
    let Some(h) = TestHarness::try_new(false).await else {
        eprintln!("SKIP refresh_rejects_deactivated_user: no TEST_DATABASE_URL");
        return;
    };

    let (target_uid, _email) = seed_user_with_password(&h, "refresh-gate", "pw12345678").await;

    // Mint a raw refresh token for this user and persist its hash so
    // /auth/refresh can find it.
    let (refresh_token, refresh_jti) = containerus_server::auth::jwt::create_refresh_token(
        target_uid,
        common::JWT_SECRET,
        604_800,
    )
    .expect("mint refresh token");
    let token_hash = {
        use sha2::{Digest, Sha256};
        format!("{:x}", Sha256::digest(refresh_jti.as_bytes()))
    };
    sqlx::query(
        "INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + interval '7 days')",
    )
    .bind(target_uid)
    .bind(&token_hash)
    .execute(&h.db)
    .await
    .expect("seed refresh token");

    // Flip the user inactive directly — we're testing the refresh gate, not
    // the admin endpoint, and the endpoint has its own tests above.
    sqlx::query("UPDATE users SET is_active = false WHERE id = $1")
        .bind(target_uid)
        .execute(&h.db)
        .await
        .expect("disable user");

    let (status, body) = common::call(
        &h.router,
        Method::POST,
        "/api/auth/refresh",
        None,
        Some(json!({ "refreshToken": refresh_token })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNAUTHORIZED,
        "deactivated user must not be able to refresh; body={}",
        String::from_utf8_lossy(&body)
    );

    h.cleanup().await;
}

#[tokio::test]
async fn admin_reactivate_restores_is_active() {
    let Some(h) = TestHarness::try_new(false).await else {
        eprintln!("SKIP admin_reactivate_restores_is_active: no TEST_DATABASE_URL");
        return;
    };

    let (target_uid, _) = seed_user_with_password(&h, "reactivate", "pw12345678").await;
    sqlx::query("UPDATE users SET is_active = false WHERE id = $1")
        .bind(target_uid)
        .execute(&h.db)
        .await
        .expect("seed inactive");

    let admin_uid = h.create_user("react-admin").await;
    h.grant_company_admin(admin_uid).await;
    let admin_token = h.login_as(admin_uid, true).await;

    let uri = format!("/api/admin/users/{target_uid}");
    let (status, body) = common::call(
        &h.router,
        Method::PATCH,
        &uri,
        Some(&admin_token),
        Some(json!({ "isActive": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "body={}", String::from_utf8_lossy(&body));

    let is_active: bool = sqlx::query_scalar("SELECT is_active FROM users WHERE id = $1")
        .bind(target_uid)
        .fetch_one(&h.db)
        .await
        .expect("read is_active");
    assert!(is_active);

    let audit: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log
          WHERE action = 'user.reactivate'
            AND resource_type = 'user'
            AND resource_id = $1",
    )
    .bind(target_uid.to_string())
    .fetch_one(&h.db)
    .await
    .expect("count audit");
    assert_eq!(audit, 1);

    h.cleanup().await;
}
