//! CON-122: end-to-end scope-isolation test for `/api/ws/permissions`.
//!
//! The acceptance criterion for CON-122 is that a permission-invalidation
//! event published for user A MUST NOT reach a different user's WS
//! session. The unit test in `ws/events.rs` proves this at the bus
//! layer; this integration test exercises the full path — real TCP
//! socket, real WebSocket upgrade, real JWT handshake, real
//! `AppState.permission_events` — so a future regression in the relay
//! loop or the subscription wiring is caught.
//!
//! Skip policy matches the other DB-backed integration tests: without
//! `TEST_DATABASE_URL` we short-circuit with a skip message (or panic
//! under `REQUIRE_DB=1`).

mod common;

use std::time::Duration;

use common::ws_harness::ensure_isolated_home;
use common::{skip_without_db, TestHarness};

use containerus_server::ws::events::{InvalidationScope, PermissionEvent};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::Message;

/// Open a permissions-WS session against `url`, perform the first-message
/// auth handshake, and wait for the server's `{"type":"connected"}`
/// acknowledgement before returning the open socket.
async fn open_authed(
    url: &str,
    token: &str,
) -> tokio_tungstenite::WebSocketStream<
    tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
> {
    let (mut ws, _) = tokio_tungstenite::connect_async(url)
        .await
        .expect("ws connect");

    ws.send(Message::Text(
        json!({ "type": "auth", "token": token }).to_string().into(),
    ))
    .await
    .expect("send auth");

    // Drain frames until we see "connected" or the stream gives up.
    let ack = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match ws.next().await {
                Some(Ok(Message::Text(text))) => {
                    let v: Value = serde_json::from_str(&text).expect("parse json");
                    if v.get("type").and_then(|t| t.as_str()) == Some("connected") {
                        break;
                    }
                }
                Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => continue,
                Some(Ok(_)) => continue,
                Some(Err(e)) => panic!("ws recv error before connected: {e}"),
                None => panic!("ws closed before connected ack"),
            }
        }
    })
    .await;
    ack.expect("timed out waiting for connected ack");
    ws
}

#[tokio::test]
async fn permissions_ws_event_is_scoped_to_target_user() {
    let Some(h) = TestHarness::try_new(false).await else {
        skip_without_db("permissions_ws_event_is_scoped_to_target_user");
        return;
    };
    ensure_isolated_home();

    let user_a = h.create_user("ws-perm-a").await;
    let user_b = h.create_user("ws-perm-b").await;
    let token_a = h.token_for(user_a, vec![], false);
    let token_b = h.token_for(user_b, vec![], false);

    let state = h.state.clone();
    let running = h.spawn_server().await;
    let url = running.ws_url("/api/ws/permissions");

    let mut ws_a = open_authed(&url, &token_a).await;
    let mut ws_b = open_authed(&url, &token_b).await;

    // Publish directly via the bus — same code path the API handlers
    // call, but without having to stand up member/role fixtures. The
    // property under test here is scoping in the WS route + bus, not
    // which emit sites fire.
    state.permission_events.publish(
        user_a,
        PermissionEvent::invalidated(InvalidationScope::Role, None),
    );

    // User A must receive the event promptly.
    let a_frame = tokio::time::timeout(Duration::from_secs(2), ws_a.next())
        .await
        .expect("A did not receive event in time")
        .expect("ws_a closed unexpectedly")
        .expect("ws_a error");
    let a_text = match a_frame {
        Message::Text(t) => t.to_string(),
        other => panic!("expected text frame, got {other:?}"),
    };
    let a_value: Value = serde_json::from_str(&a_text).expect("parse A frame");
    assert_eq!(
        a_value.get("type").and_then(|v| v.as_str()),
        Some("permissions.invalidated"),
        "A frame: {a_text}"
    );
    assert_eq!(
        a_value.get("scope").and_then(|v| v.as_str()),
        Some("role"),
        "A frame: {a_text}"
    );

    // User B must NOT receive anything within a comfortable window.
    // 500ms is well past the ~5-10ms local broadcast latency seen for
    // user A above, so any leakage would show here.
    let leaked = tokio::time::timeout(Duration::from_millis(500), ws_b.next()).await;
    match leaked {
        Err(_) => { /* timeout = no frame leaked, which is the expected outcome */ }
        Ok(Some(Ok(Message::Ping(_)))) | Ok(Some(Ok(Message::Pong(_)))) => {
            // Control frames are not events; still a pass.
        }
        Ok(other) => panic!("event leaked to unrelated user B: {other:?}"),
    }

    // Clean shutdown so the server task doesn't log spurious errors.
    let _ = ws_a.close(None).await;
    let _ = ws_b.close(None).await;
    running.cleanup().await;
}
