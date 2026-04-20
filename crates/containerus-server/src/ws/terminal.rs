use std::net::SocketAddr;

use axum::{
    extract::{
        connect_info::ConnectInfo,
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    http::StatusCode,
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use russh::ChannelMsg;
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use containerus_core::models::container::ContainerRuntime;
use containerus_core::runtime::CommandBuilder;

use crate::audit::{log_event, log_permission_denied, AuditCaller, AuditEvent};
use crate::auth::jwt::decode_access_token;
use crate::auth::middleware::container_acl_resource_id;
use crate::auth::resolver::{self, ResolverInput};
use crate::db::models::SystemRow;
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/terminal/{system_id}", get(ws_terminal))
}

/// WebSocket terminal proxy handler.
/// Authenticates via first WebSocket message (not query parameter) to avoid token in logs.
///
/// Protocol:
/// - Client sends text: {"type":"auth","token":"JWT..."} (MUST be first message)
/// - Client sends text: {"type":"start","cols":80,"rows":24,"shell":"/bin/bash","containerId":"..."}
/// - Client sends binary: raw terminal input
/// - Client sends text: {"type":"resize","cols":N,"rows":N}
/// - Client sends text: {"type":"ping"}
/// - Server sends text: {"type":"connected","sessionId":"uuid"}
/// - Server sends binary: raw terminal output
/// - Server sends text: {"type":"error","message":"..."} / {"type":"pong"}
async fn ws_terminal(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Path(system_id): Path<Uuid>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> impl IntoResponse {
    let client_ip = Some(addr.ip().to_string());
    // Accept WebSocket upgrade unconditionally — auth happens inside the session
    ws.on_upgrade(move |socket| {
        handle_terminal_session(socket, state, system_id, client_ip)
    })
}

/// Message from client to start a PTY session.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartMessage {
    cols: Option<u32>,
    rows: Option<u32>,
    shell: Option<String>,
    container_id: Option<String>,
    /// Container runtime override (e.g., "docker", "podman", "apple").
    /// When provided, uses this instead of the system's primary_runtime.
    runtime: Option<String>,
}

impl StartMessage {
    fn validated_cols(&self) -> u32 {
        self.cols.unwrap_or(80).clamp(1, 500)
    }
    fn validated_rows(&self) -> u32 {
        self.rows.unwrap_or(24).clamp(1, 500)
    }
}

fn parse_runtime(s: &str) -> Option<ContainerRuntime> {
    match s {
        "docker" => Some(ContainerRuntime::Docker),
        "podman" => Some(ContainerRuntime::Podman),
        "apple" => Some(ContainerRuntime::Apple),
        _ => None,
    }
}

const ALLOWED_SHELLS: &[&str] = &["/bin/sh", "/bin/bash", "/bin/zsh", "/bin/ash", "/bin/fish"];

/// Validate that a container ID only contains safe characters.
fn is_valid_container_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 256
        && s.chars()
            .all(|c| c.is_alphanumeric() || c == '_' || c == '-' || c == '.')
}

/// CON-117: container-scoped `containers.exec` enforcement for the WebSocket
/// terminal. Runs only when `enforce_acls = true`; the legacy role-only path
/// in `wait_for_auth` remains the single source of truth when the flag is
/// off. Returns `Err(())` if any layer denies (or a DB load failed); caller
/// closes the session with `"Insufficient permissions"` and the helper
/// writes the `rbac.permission_denied` audit row itself so the audit shape
/// matches the REST handlers.
async fn enforce_container_exec_acl(
    state: &AppState,
    caller: &AuditCaller,
    user_id: Uuid,
    project_id: Uuid,
    environment_id: Uuid,
    system_id: Uuid,
    container_runtime_id: &str,
) -> Result<(), ()> {
    let container_resource_id = container_acl_resource_id(system_id, container_runtime_id);

    let container_view = match resolver::load_resource_acl_view(
        &state.db,
        user_id,
        project_id,
        "container",
        container_resource_id,
    )
    .await
    {
        Ok(v) => v,
        Err(e) => {
            tracing::error!("Failed to load container ACL for ws exec: {e}");
            return Err(());
        }
    };

    let system_view = match resolver::load_resource_acl_view(
        &state.db,
        user_id,
        project_id,
        "system",
        system_id,
    )
    .await
    {
        Ok(v) => v,
        Err(e) => {
            tracing::error!("Failed to load system ACL for ws exec: {e}");
            return Err(());
        }
    };

    // Getting here implies wait_for_auth already validated role-based
    // `containers.exec` (or the caller is a company admin, in which case
    // wait_for_auth skipped the role check and we treat them as bypassing
    // the ACL stack the same way). Seed the resolver's role set with the
    // single permission under test so a container/system ACL that neither
    // denies nor allows falls through to an allow instead of a spurious
    // default-deny.
    let mut role_permissions = std::collections::HashSet::new();
    role_permissions.insert("containers.exec".to_string());

    let input = ResolverInput {
        is_company_admin: false,
        role_permissions: &role_permissions,
        container_acl: container_view.as_ref(),
        resource_acl: system_view.as_ref(),
        env_override: None,
    };

    let resolved = resolver::resolve(&input, "containers.exec");
    if resolved.is_allowed() {
        Ok(())
    } else {
        let (resource_type, resource_id) = match resolved.reason {
            resolver::DecisionReason::ContainerAclDeny
            | resolver::DecisionReason::ContainerAclAllow => {
                ("container", container_runtime_id.to_owned())
            }
            _ => ("system", system_id.to_string()),
        };
        log_permission_denied(
            &state.db,
            caller,
            Some(project_id),
            Some(environment_id),
            resource_type,
            Some(&resource_id),
            "containers.exec",
            resolved.reason.as_str(),
        )
        .await;
        Err(())
    }
}

/// Handle the WebSocket terminal session with real PTY streaming.
/// Authentication is performed via the first WebSocket message.
async fn handle_terminal_session(
    socket: WebSocket,
    state: AppState,
    system_id: Uuid,
    client_ip: Option<String>,
) {
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Phase 1: Wait for auth message (with timeout)
    let (user_id, runtime_str, project_id, environment_id) = match tokio::time::timeout(
        std::time::Duration::from_secs(30),
        wait_for_auth(&mut ws_sender, &mut ws_receiver, &state, system_id),
    )
    .await
    {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => return, // Error already sent via WebSocket
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

    let caller = AuditCaller::user(user_id, client_ip.clone());
    let system_id_str = system_id.to_string();
    log_event(
        &state.db,
        AuditEvent {
            caller: &caller,
            project_id: Some(project_id),
            environment_id: Some(environment_id),
            action: "ws.terminal.open",
            resource_type: "system",
            resource_id: Some(&system_id_str),
            details: None,
        },
    )
    .await;

    // Phase 2: Wait for start message (with timeout)
    let start_msg = match tokio::time::timeout(
        std::time::Duration::from_secs(30),
        wait_for_start(&mut ws_sender, &mut ws_receiver),
    )
    .await
    {
        Ok(Some(msg)) => msg,
        Ok(None) => return, // Client closed or error sent
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

    // Proceed with PTY setup (moved from the old inline loop)
    run_terminal_pty(
        ws_sender,
        ws_receiver,
        state.clone(),
        user_id,
        system_id,
        project_id,
        environment_id,
        caller.clone(),
        runtime_str,
        start_msg,
    )
    .await;

    // Emit session close audit
    log_event(
        &state.db,
        AuditEvent {
            caller: &caller,
            project_id: Some(project_id),
            environment_id: Some(environment_id),
            action: "ws.terminal.close",
            resource_type: "system",
            resource_id: Some(&system_id_str),
            details: None,
        },
    )
    .await;
}

/// Wait for the auth message and validate credentials.
async fn wait_for_auth(
    ws_sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    ws_receiver: &mut futures_util::stream::SplitStream<WebSocket>,
    state: &AppState,
    system_id: Uuid,
) -> Result<(Uuid, String, Uuid, Uuid), ()> {
    // Returns (user_id, primary_runtime, project_id, environment_id)
    loop {
        match ws_receiver.next().await {
            Some(Ok(Message::Text(text))) => {
                let text_str: &str = &text;
                if let Ok(ctrl) = serde_json::from_str::<serde_json::Value>(text_str) {
                    if ctrl.get("type").and_then(|t| t.as_str()) == Some("ping") {
                        let _ = ws_sender
                            .send(Message::Text(json!({"type": "pong"}).to_string().into()))
                            .await;
                        continue;
                    }
                    if ctrl.get("type").and_then(|t| t.as_str()) == Some("auth") {
                        let token = match ctrl.get("token").and_then(|t| t.as_str()) {
                            Some(t) => t,
                            None => {
                                let _ = ws_sender
                                    .send(Message::Text(
                                        json!({"type": "error", "message": "Missing token in auth message"})
                                            .to_string()
                                            .into(),
                                    ))
                                    .await;
                                return Err(());
                            }
                        };

                        let claims = match decode_access_token(token, &state.config.jwt_secret) {
                            Ok(c) => c,
                            Err(_) => {
                                let _ = ws_sender
                                    .send(Message::Text(
                                        json!({"type": "error", "message": "Invalid or expired token"})
                                            .to_string()
                                            .into(),
                                    ))
                                    .await;
                                return Err(());
                            }
                        };

                        // Look up the system by ID
                        let system = match sqlx::query_as::<_, SystemRow>(
                            "SELECT * FROM systems WHERE id = $1",
                        )
                        .bind(system_id)
                        .fetch_optional(&state.db)
                        .await
                        {
                            Ok(Some(s)) => s,
                            Ok(None) => {
                                let _ = ws_sender
                                    .send(Message::Text(
                                        json!({"type": "error", "message": "System not found"})
                                            .to_string()
                                            .into(),
                                    ))
                                    .await;
                                return Err(());
                            }
                            Err(e) => {
                                tracing::error!("Database error: {e}");
                                let _ = ws_sender
                                    .send(Message::Text(
                                        json!({"type": "error", "message": "Database error"})
                                            .to_string()
                                            .into(),
                                    ))
                                    .await;
                                return Err(());
                            }
                        };

                        // Look up the environment to get the project_id
                        let environment_id = system.environment_id;
                        let project_id: Uuid = match sqlx::query_scalar(
                            "SELECT project_id FROM environments WHERE id = $1",
                        )
                        .bind(environment_id)
                        .fetch_optional(&state.db)
                        .await
                        {
                            Ok(Some(pid)) => pid,
                            Ok(None) => {
                                let _ = ws_sender
                                    .send(Message::Text(
                                        json!({"type": "error", "message": "Environment not found"})
                                            .to_string()
                                            .into(),
                                    ))
                                    .await;
                                return Err(());
                            }
                            Err(e) => {
                                tracing::error!("Database error looking up environment: {e}");
                                let _ = ws_sender
                                    .send(Message::Text(
                                        json!({"type": "error", "message": "Database error"})
                                            .to_string()
                                            .into(),
                                    ))
                                    .await;
                                return Err(());
                            }
                        };

                        // Check containers.exec permission via role in JWT
                        if !claims.is_company_admin {
                            match claims.role_for_project(&project_id) {
                                Some(role_id) => {
                                    let perms = state.permission_cache.get_permissions(&role_id);
                                    if !perms.contains("containers.exec") {
                                        let _ = ws_sender
                                            .send(Message::Text(
                                                json!({"type": "error", "message": "Insufficient permissions"})
                                                    .to_string()
                                                    .into(),
                                            ))
                                            .await;
                                        return Err(());
                                    }
                                }
                                None => {
                                    let _ = ws_sender
                                        .send(Message::Text(
                                            json!({"type": "error", "message": "Not a member of this project"})
                                                .to_string()
                                                .into(),
                                        ))
                                        .await;
                                    return Err(());
                                }
                            }
                        }

                        // Ensure connected for this user (connect is idempotent)
                        if let Err(e) = state.connections.connect(&state.db, claims.sub, &system).await {
                            tracing::error!("Failed to connect to system {}: {}", system_id, e);
                            let _ = ws_sender
                                .send(Message::Text(
                                    json!({"type": "error", "message": "Cannot connect to system"})
                                        .to_string()
                                        .into(),
                                ))
                                .await;
                            return Err(());
                        }

                        tracing::info!(
                            "WebSocket terminal: user={} system={}",
                            claims.sub,
                            system_id
                        );

                        return Ok((claims.sub, system.primary_runtime.clone(), project_id, environment_id));
                    }
                }
            }
            Some(Ok(Message::Close(_))) | None => return Err(()),
            _ => continue,
        }
    }
}

/// Wait for the start message to initialize the PTY.
async fn wait_for_start(
    ws_sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    ws_receiver: &mut futures_util::stream::SplitStream<WebSocket>,
) -> Option<StartMessage> {
    loop {
        match ws_receiver.next().await {
            Some(Ok(Message::Text(text))) => {
                let text_str: &str = &text;
                if let Ok(ctrl) = serde_json::from_str::<serde_json::Value>(text_str) {
                    if ctrl.get("type").and_then(|t| t.as_str()) == Some("ping") {
                        let _ = ws_sender
                            .send(Message::Text(json!({"type": "pong"}).to_string().into()))
                            .await;
                        continue;
                    }
                    if ctrl.get("type").and_then(|t| t.as_str()) == Some("start") {
                        match serde_json::from_value::<StartMessage>(ctrl) {
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

/// Run the actual PTY session after auth and start messages are received.
async fn run_terminal_pty(
    mut ws_sender: futures_util::stream::SplitSink<WebSocket, Message>,
    mut ws_receiver: futures_util::stream::SplitStream<WebSocket>,
    state: AppState,
    user_id: Uuid,
    system_id: Uuid,
    project_id: Uuid,
    environment_id: Uuid,
    caller: AuditCaller,
    runtime_str: String,
    start_msg: StartMessage,
) {
    let cols = start_msg.validated_cols();
    let rows = start_msg.validated_rows();

    // Shell validation: reject disallowed shells, use default when not specified
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

    // Build the command: either exec into container or just a shell
    let command = if let Some(ref container_id) = start_msg.container_id {
        if !is_valid_container_id(container_id) {
            let _ = ws_sender
                .send(Message::Text(
                    json!({"type": "error", "message": "Invalid container_id"})
                        .to_string()
                        .into(),
                ))
                .await;
            return;
        }
        // CON-117: container-scoped ACL enforcement for exec. The pre-start
        // auth check (wait_for_auth) only confirmed a role grant — it could
        // not see `container_id` yet. Now that we have it, layer the
        // container + system ACLs on top and fail closed if the composite
        // resolution denies. This is where an `rbac.permission_denied` row
        // with `resource_type = "container"` gets written.
        if state.config.enforce_acls
            && enforce_container_exec_acl(
                &state,
                &caller,
                user_id,
                project_id,
                environment_id,
                system_id,
                container_id,
            )
            .await
            .is_err()
        {
            let _ = ws_sender
                .send(Message::Text(
                    json!({"type": "error", "message": "Insufficient permissions"})
                        .to_string()
                        .into(),
                ))
                .await;
            return;
        }
        // Use the container's runtime if provided, otherwise fall back to the system's primary
        let effective_runtime_str = start_msg.runtime.as_deref().unwrap_or(&runtime_str);
        let runtime = match parse_runtime(effective_runtime_str) {
            Some(r) => r,
            None => {
                let _ = ws_sender
                    .send(Message::Text(
                        json!({"type": "error", "message": format!("Unknown runtime: {}", effective_runtime_str)})
                            .to_string()
                            .into(),
                    ))
                    .await;
                return;
            }
        };
        Some(CommandBuilder::exec_terminal(runtime, container_id, &shell))
    } else {
        Some(shell)
    };

    // Get SSH client and open PTY channel
    let client = match state.connections.get_client(user_id, system_id) {
        Some(c) => c,
        None => {
            let _ = ws_sender
                .send(Message::Text(
                    json!({"type": "error", "message": "System not connected"})
                        .to_string()
                        .into(),
                ))
                .await;
            return;
        }
    };

    let mut client_guard = client.lock().await;
    let mut channel = match client_guard
        .open_pty_channel_raw(cols, rows, command.as_deref())
        .await
    {
        Ok(ch) => ch,
        Err(e) => {
            drop(client_guard);
            let _ = ws_sender
                .send(Message::Text(
                    json!({"type": "error", "message": format!("Failed to open PTY: {e}")})
                        .to_string()
                        .into(),
                ))
                .await;
            return;
        }
    };
    drop(client_guard);

    let session_id = Uuid::new_v4().to_string();
    tracing::info!("PTY session started: {} for system {}", session_id, system_id);

    // Send connected confirmation
    let _ = ws_sender
        .send(Message::Text(
            json!({"type": "connected", "sessionId": &session_id})
                .to_string()
                .into(),
        ))
        .await;

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

    // Main I/O loop
    loop {
        tokio::select! {
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { data }) => {
                        if ws_write_tx.send(Message::Binary(data.to_vec().into())).await.is_err() {
                            break;
                        }
                    }
                    Some(ChannelMsg::Eof) | None => {
                        break;
                    }
                    _ => {}
                }
            }
            ws_msg = ws_receiver.next() => {
                match ws_msg {
                    Some(Ok(Message::Binary(data))) => {
                        if channel.data(&data[..]).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Text(text))) => {
                        let text_str: &str = &text;
                        if let Ok(ctrl) = serde_json::from_str::<serde_json::Value>(text_str) {
                            match ctrl.get("type").and_then(|t| t.as_str()) {
                                Some("resize") => {
                                    let c = ctrl.get("cols").and_then(|v| v.as_u64()).unwrap_or(80).clamp(1, 500) as u32;
                                    let r = ctrl.get("rows").and_then(|v| v.as_u64()).unwrap_or(24).clamp(1, 500) as u32;
                                    let _ = channel.window_change(c, r, 0, 0).await;
                                }
                                Some("ping") => {
                                    let _ = ws_write_tx
                                        .send(Message::Text(json!({"type": "pong"}).to_string().into()))
                                        .await;
                                }
                                Some("close") => {
                                    let _ = channel.close().await;
                                    break;
                                }
                                Some(unknown) => {
                                    tracing::warn!("Unknown control message type: {}", unknown);
                                }
                                None => {
                                    // No type field — forward as raw terminal input
                                    if channel.data(text_str.as_bytes()).await.is_err() {
                                        break;
                                    }
                                }
                            }
                        } else {
                            if channel.data(text_str.as_bytes()).await.is_err() {
                                break;
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        let _ = channel.close().await;
                        break;
                    }
                    _ => {}
                }
            }
        }
    }

    drop(ws_write_tx);
    let _ = write_task.await;
    tracing::info!("PTY session ended: {} for system {}", session_id, system_id);
}
