//! CON-137: token ownership check against `users.is_active`.
//!
//! Covers the acceptance path: a token minted before deactivation stops
//! verifying after the middleware re-reads `is_active`. Requires a real
//! Postgres reachable via `TEST_DATABASE_URL`; skips when unset (or panics
//! when `REQUIRE_DB=1`) per the existing harness convention.

mod common;

use axum::http::{Method, StatusCode};
use common::{call, skip_without_db, TestHarness};

const SESSIONS_URI: &str = "/api/sessions";

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn active_user_passes_auth_gate_on_sessions_endpoint() {
    let Some(h) = TestHarness::try_new(false).await else {
        skip_without_db("active_user_passes_auth_gate_on_sessions_endpoint");
        return;
    };

    let user_id = h.create_user("con137-active").await;
    h.grant_company_admin(user_id).await;
    let token = h.login_as(user_id, true).await;

    let (status, _) = call(&h.router, Method::GET, SESSIONS_URI, Some(&token), None).await;

    // An active user must clear the auth gate. The handler runs to a 2xx
    // (or at worst a non-auth status); what it must not be is 401.
    assert_ne!(
        status,
        StatusCode::UNAUTHORIZED,
        "active user was rejected at the auth middleware"
    );

    h.cleanup().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn deactivated_user_token_is_rejected_once_cache_is_invalidated() {
    let Some(h) = TestHarness::try_new(false).await else {
        skip_without_db("deactivated_user_token_is_rejected_once_cache_is_invalidated");
        return;
    };

    let user_id = h.create_user("con137-deactivate").await;
    h.grant_company_admin(user_id).await;
    let token = h.login_as(user_id, true).await;

    // Prime the `UserActiveCache` + confirm the token works pre-deactivation.
    let (before_status, _) =
        call(&h.router, Method::GET, SESSIONS_URI, Some(&token), None).await;
    assert_ne!(
        before_status,
        StatusCode::UNAUTHORIZED,
        "precondition: active user's token must verify before deactivation"
    );

    // Deactivate in-DB. On its own this would be invisible to the middleware
    // because of the TTL cache, which is exactly the window CON-137 closes.
    sqlx::query("UPDATE users SET is_active = false WHERE id = $1")
        .bind(user_id)
        .execute(&h.db)
        .await
        .expect("flip is_active to false");

    // The deactivate-user handler MUST call `invalidate` so the next request
    // re-reads from the DB instead of waiting out the TTL. We do it
    // explicitly here to pin that contract.
    h.state.user_active_cache.invalidate(user_id);

    let (after_status, _) =
        call(&h.router, Method::GET, SESSIONS_URI, Some(&token), None).await;
    assert_eq!(
        after_status,
        StatusCode::UNAUTHORIZED,
        "deactivated user's token must be rejected as unauthorized"
    );

    h.cleanup().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ws_verifier_rejects_deactivated_user_same_as_http_extractor() {
    // Acceptance 4: WebSocket terminal + port-forward auth paths share the
    // HTTP verify middleware. This test invokes the shared helper directly
    // (the same function the four WS handlers call on their auth frame) so a
    // future refactor can't silently skip the `is_active` check for WS.
    use containerus_server::auth::middleware::{
        verify_access_token_active, VerifyTokenError,
    };

    let Some(h) = TestHarness::try_new(false).await else {
        skip_without_db("ws_verifier_rejects_deactivated_user_same_as_http_extractor");
        return;
    };

    let user_id = h.create_user("con137-ws-verify").await;
    h.grant_company_admin(user_id).await;
    let token = h.login_as(user_id, true).await;

    // Active user clears the verifier.
    verify_access_token_active(&h.state, &token)
        .await
        .expect("active user must pass WS auth verifier");

    // Flip `is_active` and invalidate the cache so the next call re-reads.
    sqlx::query("UPDATE users SET is_active = false WHERE id = $1")
        .bind(user_id)
        .execute(&h.db)
        .await
        .expect("flip is_active to false");
    h.state.user_active_cache.invalidate(user_id);

    match verify_access_token_active(&h.state, &token).await {
        Err(VerifyTokenError::UserDeactivated) => {}
        other => panic!(
            "expected VerifyTokenError::UserDeactivated after deactivation, got {other:?}"
        ),
    }

    h.cleanup().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ttl_expiry_causes_stale_active_entry_to_be_re_fetched() {
    let Some(h) = TestHarness::try_new(false).await else {
        skip_without_db("ttl_expiry_causes_stale_active_entry_to_be_re_fetched");
        return;
    };

    // Rebuild the harness's auth cache with a zero TTL so every request
    // forces a DB re-read. In production the TTL bounds the post-deactivation
    // access window; this test asserts the fall-through path works too, so
    // the system stays correct even when the deactivate handler forgets to
    // invalidate (defense in depth vs. the deactivation endpoint).
    use std::time::Duration;
    let zero_ttl_cache =
        containerus_server::auth::middleware::UserActiveCache::with_ttl(Duration::from_millis(0));
    // Swap the cache on the live state before the first request. `AppState`
    // is Clone but shares Arcs internally; this is a test-only construction
    // where we rebuild the router off a fresh state to pin the new cache.
    let mut state = h.state.clone();
    state.user_active_cache = zero_ttl_cache;
    let auth_limiter = containerus_server::rate_limit::RateLimiter::new(
        10_000,
        Duration::from_secs(60),
    );
    let router = containerus_server::build_app(state.clone(), auth_limiter);

    let user_id = h.create_user("con137-ttl").await;
    h.grant_company_admin(user_id).await;
    let token = h.login_as(user_id, true).await;

    // First request primes the (zero-TTL) cache entry.
    let (status, _) = call(&router, Method::GET, SESSIONS_URI, Some(&token), None).await;
    assert_ne!(status, StatusCode::UNAUTHORIZED);

    // Flip `is_active` but do NOT call `invalidate`. With a 0ms TTL every
    // cached entry is considered stale immediately, so the next request
    // re-reads the DB and sees the deactivation.
    sqlx::query("UPDATE users SET is_active = false WHERE id = $1")
        .bind(user_id)
        .execute(&h.db)
        .await
        .expect("flip is_active to false");

    let (status_after, _) =
        call(&router, Method::GET, SESSIONS_URI, Some(&token), None).await;
    assert_eq!(
        status_after,
        StatusCode::UNAUTHORIZED,
        "expired cache entry must trigger a DB re-read and reject the deactivated user"
    );

    h.cleanup().await;
}
