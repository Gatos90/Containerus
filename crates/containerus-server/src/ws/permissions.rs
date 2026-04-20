//! CON-122: WebSocket relay for `PermissionEventBus`.
//!
//! The client opens `/api/ws/permissions`, sends
//! `{"type":"auth","token":"JWT..."}` as the first message (same
//! handshake as `ws/terminal.rs` — keeps the token out of URL logs),
//! and from then on receives `{"type":"permissions.invalidated", ...}`
//! whenever an RBAC write affects the authenticated user.
//!
//! Subscription is strictly per `user_id` — the bus itself does the
//! routing, so this handler never sees events for other users. That
//! is the CON-122 scoping acceptance criterion.

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
    routing::get,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tokio::sync::broadcast;

use crate::auth::jwt::decode_access_token;
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/permissions", get(ws_permissions))
}

async fn ws_permissions(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_session(socket, state))
}

async fn handle_session(socket: WebSocket, state: AppState) {
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Phase 1: wait for auth message. Mirrors the first-message JWT
    // handshake used by ws/terminal.rs so the token never appears in
    // URLs, HTTP access logs, or Referer headers.
    let user_id = match tokio::time::timeout(
        std::time::Duration::from_secs(30),
        wait_for_auth(&mut ws_sender, &mut ws_receiver, &state),
    )
    .await
    {
        Ok(Some(uid)) => uid,
        Ok(None) => return,
        Err(_) => {
            let _ = ws_sender
                .send(Message::Text(
                    json!({"type": "error", "message": "Timed out waiting for authentication"})
                        .to_string()
                        .into(),
                ))
                .await;
            return;
        }
    };

    let mut rx = state.permission_events.subscribe(user_id);

    // Acknowledge so clients can resolve their "connecting" state and
    // start counting reconnect backoff from a known-good baseline.
    let _ = ws_sender
        .send(Message::Text(
            json!({"type": "connected"}).to_string().into(),
        ))
        .await;

    tracing::info!("permissions WS opened for user {user_id}");

    loop {
        tokio::select! {
            event = rx.recv() => {
                match event {
                    Ok(ev) => {
                        let body = match serde_json::to_string(&ev) {
                            Ok(s) => s,
                            Err(e) => {
                                tracing::error!("failed to serialize PermissionEvent: {e}");
                                continue;
                            }
                        };
                        if ws_sender.send(Message::Text(body.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        // If the client fell behind, tell it to do a
                        // full refetch — same behavior as receiving an
                        // event, so this is safe even if nothing was
                        // actually missed.
                        tracing::warn!("permissions WS lagged by {n} for user {user_id}");
                        let _ = ws_sender
                            .send(Message::Text(
                                json!({"type": "permissions.invalidated", "scope": "role"})
                                    .to_string()
                                    .into(),
                            ))
                            .await;
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            ws_msg = ws_receiver.next() => {
                match ws_msg {
                    Some(Ok(Message::Text(text))) => {
                        let text_str: &str = &text;
                        if let Ok(ctrl) = serde_json::from_str::<serde_json::Value>(text_str) {
                            if ctrl.get("type").and_then(|t| t.as_str()) == Some("ping") {
                                let _ = ws_sender
                                    .send(Message::Text(
                                        json!({"type": "pong"}).to_string().into(),
                                    ))
                                    .await;
                            }
                            // Any other client frame on this channel is
                            // ignored: the WS is one-directional from
                            // the server's perspective.
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }

    tracing::info!("permissions WS closed for user {user_id}");
}

/// First-message JWT handshake. Returns the authenticated `user_id` or
/// `None` on any auth failure / early close (error frame already sent).
async fn wait_for_auth(
    ws_sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    ws_receiver: &mut futures_util::stream::SplitStream<WebSocket>,
    state: &AppState,
) -> Option<uuid::Uuid> {
    loop {
        match ws_receiver.next().await {
            Some(Ok(Message::Text(text))) => {
                let text_str: &str = &text;
                let ctrl: serde_json::Value = match serde_json::from_str(text_str) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                match ctrl.get("type").and_then(|t| t.as_str()) {
                    Some("ping") => {
                        let _ = ws_sender
                            .send(Message::Text(json!({"type": "pong"}).to_string().into()))
                            .await;
                        continue;
                    }
                    Some("auth") => {
                        let token = match ctrl.get("token").and_then(|t| t.as_str()) {
                            Some(t) => t,
                            None => {
                                let _ = ws_sender
                                    .send(Message::Text(
                                        json!({"type": "error", "message": "Missing token"})
                                            .to_string()
                                            .into(),
                                    ))
                                    .await;
                                return None;
                            }
                        };

                        match decode_access_token(token, &state.config.jwt_secret) {
                            Ok(claims) => return Some(claims.sub),
                            Err(_) => {
                                let _ = ws_sender
                                    .send(Message::Text(
                                        json!({"type": "error", "message": "Invalid or expired token"})
                                            .to_string()
                                            .into(),
                                    ))
                                    .await;
                                return None;
                            }
                        }
                    }
                    _ => continue,
                }
            }
            Some(Ok(Message::Close(_))) | None => return None,
            _ => continue,
        }
    }
}
