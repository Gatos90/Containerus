use std::net::SocketAddr;

use axum::{
    extract::{
        connect_info::ConnectInfo,
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    response::IntoResponse,
    routing::get,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use k8s_openapi::api::core::v1::Pod;
use kube::api::{Api, AttachParams, TerminalSize};
use serde::Deserialize;
use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use uuid::Uuid;

use crate::audit::{log_event, AuditCaller, AuditEvent};
use crate::auth::middleware::verify_access_token_active;
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/k8s-exec/{cluster_id}", get(ws_k8s_exec))
}

async fn ws_k8s_exec(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Path(cluster_id): Path<Uuid>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> impl IntoResponse {
    let client_ip = Some(addr.ip().to_string());
    ws.on_upgrade(move |socket| handle_k8s_exec_session(socket, state, cluster_id, client_ip))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecStartMessage {
    namespace: String,
    pod: String,
    container: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
    shell: Option<String>,
}

const ALLOWED_SHELLS: &[&str] = &["/bin/sh", "/bin/bash", "/bin/zsh", "/bin/ash", "/bin/fish"];

async fn handle_k8s_exec_session(socket: WebSocket, state: AppState, cluster_id: Uuid, client_ip: Option<String>) {
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Phase 1: Wait for auth message
    let user_claims = match tokio::time::timeout(
        std::time::Duration::from_secs(30),
        wait_for_auth(&mut ws_sender, &mut ws_receiver, &state, cluster_id),
    )
    .await
    {
        Ok(Ok(claims)) => claims,
        Ok(Err(_)) => return,
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

    // Phase 2: Wait for start message
    let start_msg = match tokio::time::timeout(
        std::time::Duration::from_secs(30),
        wait_for_start(&mut ws_sender, &mut ws_receiver),
    )
    .await
    {
        Ok(Some(msg)) => msg,
        Ok(None) => return,
        Err(_) => {
            let _ = ws_sender
                .send(Message::Text(
                    json!({"type": "error", "message": "Timed out waiting for start message"})
                        .to_string()
                        .into(),
                ))
                .await;
            return;
        }
    };

    // Validate shell
    let shell = match start_msg.shell {
        Some(ref s) if ALLOWED_SHELLS.contains(&s.as_str()) => s.clone(),
        Some(ref s) => {
            let _ = ws_sender
                .send(Message::Text(
                    json!({"type": "error", "message": format!("Shell '{}' is not allowed", s)})
                        .to_string()
                        .into(),
                ))
                .await;
            return;
        }
        None => "/bin/sh".to_string(),
    };

    // Get kube client for the cluster
    let cluster = match crate::api::clusters::common::get_verified_cluster(&state, cluster_id).await
    {
        Ok(c) => c,
        Err(_) => {
            let _ = ws_sender
                .send(Message::Text(
                    json!({"type": "error", "message": "Cluster not found"})
                        .to_string()
                        .into(),
                ))
                .await;
            return;
        }
    };

    let client = match state.k8s.get_client(&cluster).await {
        Ok(c) => c,
        Err(e) => {
            let _ = ws_sender
                .send(Message::Text(
                    json!({"type": "error", "message": format!("Cannot connect to cluster: {e}")})
                        .to_string()
                        .into(),
                ))
                .await;
            return;
        }
    };

    // Start exec
    let pods: Api<Pod> = Api::namespaced(client, &start_msg.namespace);
    let mut ap = AttachParams::interactive_tty();
    ap.stdin = true;
    ap.stdout = true;
    ap.stderr = false; // stderr must be false when tty is true (kube-rs constraint)
    ap.tty = true;
    if let Some(ref container) = start_msg.container {
        ap.container = Some(container.clone());
    }

    let mut attached = match pods.exec(&start_msg.pod, vec![&shell], &ap).await {
        Ok(a) => a,
        Err(e) => {
            let _ = ws_sender
                .send(Message::Text(
                    json!({"type": "error", "message": format!("Failed to exec into pod: {e}")})
                        .to_string()
                        .into(),
                ))
                .await;
            return;
        }
    };

    let session_id = Uuid::new_v4().to_string();
    tracing::info!(
        "K8s exec session started: {} cluster={} pod={}/{}",
        session_id,
        cluster_id,
        start_msg.namespace,
        start_msg.pod
    );

    let caller = AuditCaller::user(user_claims.sub, client_ip.clone());
    let cluster_id_str = cluster_id.to_string();
    let session_details = serde_json::json!({
        "namespace": &start_msg.namespace,
        "pod": &start_msg.pod,
        "container": start_msg.container.as_deref(),
        "session_id": &session_id,
    });
    log_event(
        &state.db,
        AuditEvent {
            caller: &caller,
            project_id: None,
            environment_id: None,
            action: "ws.k8s_exec.open",
            resource_type: "cluster",
            resource_id: Some(&cluster_id_str),
            details: Some(session_details.clone()),
        },
    )
    .await;

    let _ = ws_sender
        .send(Message::Text(
            json!({"type": "connected", "sessionId": &session_id})
                .to_string()
                .into(),
        ))
        .await;

    // Extract streams from AttachedProcess
    let mut stdin = match attached.stdin() {
        Some(s) => s,
        None => {
            let _ = ws_sender
                .send(Message::Text(
                    json!({"type": "error", "message": "Failed to attach stdin"})
                        .to_string()
                        .into(),
                ))
                .await;
            return;
        }
    };
    let mut stdout = match attached.stdout() {
        Some(s) => s,
        None => {
            let _ = ws_sender
                .send(Message::Text(
                    json!({"type": "error", "message": "Failed to attach stdout"})
                        .to_string()
                        .into(),
                ))
                .await;
            return;
        }
    };
    let mut resize_sender = attached.terminal_size();

    // Send initial terminal size from start message
    if let Some(ref mut sender) = resize_sender {
        let cols = start_msg.cols.unwrap_or(80);
        let rows = start_msg.rows.unwrap_or(24);
        let _ = sender.send(TerminalSize { width: cols, height: rows }).await;
    }

    // Bidirectional streaming loop
    let (ws_write_tx, mut ws_write_rx) = tokio::sync::mpsc::channel::<Message>(256);

    let write_task = tokio::spawn(async move {
        while let Some(msg) = ws_write_rx.recv().await {
            if ws_sender.send(msg).await.is_err() {
                break;
            }
        }
        let _ = ws_sender.close().await;
    });

    // Read from stdout and send to WebSocket
    let ws_tx_clone = ws_write_tx.clone();
    let stdout_task = tokio::spawn(async move {
        let mut buf = vec![0u8; 4096];
        loop {
            match stdout.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    if ws_tx_clone
                        .send(Message::Binary(buf[..n].to_vec().into()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    // Read from WebSocket and write to stdin / handle control messages
    loop {
        match ws_receiver.next().await {
            Some(Ok(Message::Binary(data))) => {
                if stdin.write_all(&data).await.is_err() {
                    break;
                }
            }
            Some(Ok(Message::Text(text))) => {
                let text_str: &str = &text;
                if let Ok(ctrl) = serde_json::from_str::<serde_json::Value>(text_str) {
                    match ctrl.get("type").and_then(|t| t.as_str()) {
                        Some("resize") => {
                            let cols = ctrl
                                .get("cols")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(80)
                                .clamp(1, 500) as u16;
                            let rows = ctrl
                                .get("rows")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(24)
                                .clamp(1, 500) as u16;
                            if let Some(ref mut sender) = resize_sender {
                                let _ = sender
                                    .send(TerminalSize {
                                        width: cols,
                                        height: rows,
                                    })
                                    .await;
                            }
                        }
                        Some("ping") => {
                            let _ = ws_write_tx
                                .send(Message::Text(
                                    json!({"type": "pong"}).to_string().into(),
                                ))
                                .await;
                        }
                        Some("close") => break,
                        _ => {
                            // Forward as raw terminal input
                            if stdin.write_all(text_str.as_bytes()).await.is_err() {
                                break;
                            }
                        }
                    }
                } else if stdin.write_all(text_str.as_bytes()).await.is_err() {
                    break;
                }
            }
            Some(Ok(Message::Close(_))) | None => break,
            _ => continue,
        }
    }

    drop(ws_write_tx);
    stdout_task.abort();
    let _ = write_task.await;
    attached.abort();
    tracing::info!(
        "K8s exec session ended: {} cluster={} pod={}/{}",
        session_id,
        cluster_id,
        start_msg.namespace,
        start_msg.pod
    );

    log_event(
        &state.db,
        AuditEvent {
            caller: &caller,
            project_id: None,
            environment_id: None,
            action: "ws.k8s_exec.close",
            resource_type: "cluster",
            resource_id: Some(&cluster_id_str),
            details: Some(session_details),
        },
    )
    .await;
}

/// Wait for auth message, verify JWT, and check cluster access with clusters.exec permission.
async fn wait_for_auth(
    ws_sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    ws_receiver: &mut futures_util::stream::SplitStream<WebSocket>,
    state: &AppState,
    cluster_id: Uuid,
) -> Result<crate::auth::jwt::AccessClaims, ()> {
    loop {
        match ws_receiver.next().await {
            Some(Ok(Message::Text(text))) => {
                let text_str: &str = &text;
                if let Ok(ctrl) = serde_json::from_str::<serde_json::Value>(text_str) {
                    if ctrl.get("type").and_then(|t| t.as_str()) == Some("ping") {
                        let _ = ws_sender
                            .send(Message::Text(
                                json!({"type": "pong"}).to_string().into(),
                            ))
                            .await;
                        continue;
                    }
                    if ctrl.get("type").and_then(|t| t.as_str()) == Some("auth") {
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
                                return Err(());
                            }
                        };

                        let claims = match verify_access_token_active(state, token).await {
                            Ok(c) => c,
                            Err(err) => {
                                let _ = ws_sender
                                    .send(Message::Text(
                                        json!({"type": "error", "message": err.user_message()})
                                            .to_string()
                                            .into(),
                                    ))
                                    .await;
                                return Err(());
                            }
                        };

                        // Verify cluster access with clusters.exec permission
                        let cluster = match crate::api::clusters::common::get_verified_cluster(
                            state, cluster_id,
                        )
                        .await
                        {
                            Ok(c) => c,
                            Err(_) => {
                                let _ = ws_sender
                                    .send(Message::Text(
                                        json!({"type": "error", "message": "Cluster not found"})
                                            .to_string()
                                            .into(),
                                    ))
                                    .await;
                                return Err(());
                            }
                        };

                        if let Err(_) = crate::api::clusters::common::verify_cluster_access(
                            state,
                            &claims,
                            &cluster,
                            "clusters.exec",
                        )
                        .await
                        {
                            let _ = ws_sender
                                .send(Message::Text(
                                    json!({"type": "error", "message": "Insufficient permissions"})
                                        .to_string()
                                        .into(),
                                ))
                                .await;
                            return Err(());
                        }

                        tracing::info!(
                            "K8s exec WebSocket: user={} cluster={}",
                            claims.sub,
                            cluster_id
                        );

                        return Ok(claims);
                    }
                }
            }
            Some(Ok(Message::Close(_))) | None => return Err(()),
            _ => continue,
        }
    }
}

/// Wait for the start message with pod/container/shell info.
async fn wait_for_start(
    ws_sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    ws_receiver: &mut futures_util::stream::SplitStream<WebSocket>,
) -> Option<ExecStartMessage> {
    loop {
        match ws_receiver.next().await {
            Some(Ok(Message::Text(text))) => {
                let text_str: &str = &text;
                if let Ok(ctrl) = serde_json::from_str::<serde_json::Value>(text_str) {
                    if ctrl.get("type").and_then(|t| t.as_str()) == Some("ping") {
                        let _ = ws_sender
                            .send(Message::Text(
                                json!({"type": "pong"}).to_string().into(),
                            ))
                            .await;
                        continue;
                    }
                    if ctrl.get("type").and_then(|t| t.as_str()) == Some("start") {
                        match serde_json::from_value::<ExecStartMessage>(ctrl) {
                            Ok(msg) => return Some(msg),
                            Err(e) => {
                                let _ = ws_sender
                                    .send(Message::Text(
                                        json!({"type": "error", "message": format!("Invalid start message: {e}")})
                                            .to_string()
                                            .into(),
                                    ))
                                    .await;
                                return None;
                            }
                        }
                    }
                }
            }
            Some(Ok(Message::Close(_))) | None => return None,
            _ => continue,
        }
    }
}
