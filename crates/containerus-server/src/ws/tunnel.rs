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
use russh::ChannelMsg;
use serde_json::json;
use uuid::Uuid;

use crate::audit::{log_event, AuditCaller, AuditEvent};
use crate::auth::jwt::decode_access_token;
use crate::auth::resolver::{self, ResolverInput};
use crate::db::models::SystemRow;
use crate::AppState;

/// Check whether an IPv4 address is in a blocked range.
fn is_blocked_ipv4(ip: std::net::Ipv4Addr) -> bool {
    let octets = ip.octets();
    // 127.0.0.0/8 loopback
    octets[0] == 127
        // 10.0.0.0/8
        || octets[0] == 10
        // 172.16.0.0/12
        || (octets[0] == 172 && (16..=31).contains(&octets[1]))
        // 192.168.0.0/16
        || (octets[0] == 192 && octets[1] == 168)
        // 169.254.0.0/16 link-local
        || (octets[0] == 169 && octets[1] == 254)
        // 0.0.0.0/8
        || octets[0] == 0
        // 100.64.0.0/10 — Carrier-grade NAT (RFC 6598)
        || (octets[0] == 100 && (64..=127).contains(&octets[1]))
        // 192.0.0.0/24 — IETF protocol assignments
        || (octets[0] == 192 && octets[1] == 0 && octets[2] == 0)
        // 224.0.0.0/4 — Multicast
        || (224..=239).contains(&octets[0])
        // 240.0.0.0/4 — Reserved (includes broadcast 255.255.255.255)
        || octets[0] >= 240
}

/// Check whether an IPv6 address is in a blocked range.
fn is_blocked_ipv6(ip: std::net::Ipv6Addr) -> bool {
    // Loopback (::1)
    if ip.is_loopback() {
        return true;
    }
    // Unspecified (::)
    if ip.is_unspecified() {
        return true;
    }
    // Link-local fe80::/10
    if (ip.segments()[0] & 0xffc0) == 0xfe80 {
        return true;
    }
    // Unique local fc00::/7
    if (ip.segments()[0] & 0xfe00) == 0xfc00 {
        return true;
    }
    // 6to4 addresses (2002::/16) — extract embedded IPv4 from segments 1-2
    if ip.segments()[0] == 0x2002 {
        let embedded_ipv4 = std::net::Ipv4Addr::new(
            (ip.segments()[1] >> 8) as u8,
            ip.segments()[1] as u8,
            (ip.segments()[2] >> 8) as u8,
            ip.segments()[2] as u8,
        );
        return is_blocked_ipv4(embedded_ipv4);
    }
    // Teredo addresses (2001:0000::/32) — block entirely as they embed arbitrary IPv4
    if ip.segments()[0] == 0x2001 && ip.segments()[1] == 0x0000 {
        return true;
    }
    // IPv4-mapped addresses (::ffff:x.x.x.x) — check the mapped v4 address
    if let Some(ipv4) = ip.to_ipv4_mapped() {
        return is_blocked_ipv4(ipv4);
    }
    // IPv4-compatible addresses (deprecated ::x.x.x.x where high 96 bits are zero)
    if let Some(ipv4) = ip.to_ipv4() {
        if ip.to_ipv4_mapped().is_none() {
            return is_blocked_ipv4(ipv4);
        }
    }
    false
}

/// Check whether a tunnel destination should be blocked to prevent SSRF attacks.
fn is_blocked_tunnel_destination(host: &str) -> bool {
    let host_lower = host.to_lowercase();

    // Block localhost variants and metadata hostnames
    if host_lower == "localhost"
        || host_lower == "metadata.google.internal"
        || host_lower == "metadata"
    {
        return true;
    }

    // Block cloud metadata IP
    if host_lower == "169.254.169.254" {
        return true;
    }

    // Check IPv4 addresses
    if let Ok(ip) = host.parse::<std::net::Ipv4Addr>() {
        return is_blocked_ipv4(ip);
    }

    // Check IPv6 addresses (including bracket-stripped)
    let ipv6_str = host_lower.trim_start_matches('[').trim_end_matches(']');
    if let Ok(ip) = ipv6_str.parse::<std::net::Ipv6Addr>() {
        return is_blocked_ipv6(ip);
    }

    false
}

/// Resolve a hostname and check if any resolved address is blocked (DNS rebinding protection).
/// Returns the resolved IP string if safe, or None if blocked.
/// By returning the resolved IP, callers can use it directly to avoid TOCTOU DNS rebinding.
async fn resolve_and_check(host: &str, port: u16) -> Result<String, &'static str> {
    // If it's already an IP literal, return as-is (already checked synchronously)
    if host.parse::<std::net::IpAddr>().is_ok() {
        return Ok(host.to_string());
    }
    // Resolve the hostname and check ALL addresses
    match tokio::net::lookup_host(format!("{}:{}", host, port)).await {
        Ok(addrs) => {
            let all_addrs: Vec<_> = addrs.collect();
            if all_addrs.is_empty() {
                return Err("DNS resolution returned no addresses");
            }
            for addr in &all_addrs {
                match addr.ip() {
                    std::net::IpAddr::V4(v4) if is_blocked_ipv4(v4) => {
                        return Err("Tunnel destination resolves to a blocked address");
                    }
                    std::net::IpAddr::V6(v6) if is_blocked_ipv6(v6) => {
                        return Err("Tunnel destination resolves to a blocked address");
                    }
                    _ => {}
                }
            }
            Ok(all_addrs[0].ip().to_string())
        }
        Err(_) => Err("DNS resolution failed"), // Block on DNS failure to prevent SSRF bypass
    }
}

pub fn router() -> Router<AppState> {
    Router::new().route("/tunnel/{system_id}", get(ws_tunnel))
}

/// WebSocket tunnel endpoint for port forwarding.
/// Establishes a raw binary relay: WebSocket <-> SSH direct-tcpip channel.
/// Each WebSocket connection maps to one SSH channel (one TCP connection).
///
/// Protocol:
/// - Client sends text: {"type":"auth","token":"JWT...","host":"remote-host","port":8080} (MUST be first message)
/// - Server sends text: {"type":"connected"} on success
/// - Then raw binary relay: WebSocket <-> SSH direct-tcpip channel
async fn ws_tunnel(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Path(system_id): Path<Uuid>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> impl IntoResponse {
    let client_ip = Some(addr.ip().to_string());
    // Accept WebSocket upgrade unconditionally — auth happens inside the session
    ws.on_upgrade(move |socket| handle_tunnel_auth(socket, state, system_id, client_ip))
}

/// Handle the WebSocket tunnel: authenticate via first message, then relay.
async fn handle_tunnel_auth(
    socket: WebSocket,
    state: AppState,
    system_id: Uuid,
    client_ip: Option<String>,
) {
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Wait for auth message (with timeout)
    let (user_id, remote_host, remote_port, project_id, environment_id) = match tokio::time::timeout(
        std::time::Duration::from_secs(30),
        wait_for_tunnel_auth(&mut ws_sender, &mut ws_receiver, &state, system_id),
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
    let dest_details = serde_json::json!({
        "remote_host": &remote_host,
        "remote_port": remote_port,
    });
    log_event(
        &state.db,
        AuditEvent {
            caller: &caller,
            project_id: Some(project_id),
            environment_id: Some(environment_id),
            action: "ws.tunnel.open",
            resource_type: "system",
            resource_id: Some(&system_id_str),
            details: Some(dest_details.clone()),
        },
    )
    .await;

    // Send connected confirmation
    let _ = ws_sender
        .send(Message::Text(
            json!({"type": "connected"}).to_string().into(),
        ))
        .await;

    run_tunnel_relay(ws_sender, ws_receiver, state.clone(), user_id, system_id, remote_host, remote_port).await;

    log_event(
        &state.db,
        AuditEvent {
            caller: &caller,
            project_id: Some(project_id),
            environment_id: Some(environment_id),
            action: "ws.tunnel.close",
            resource_type: "system",
            resource_id: Some(&system_id_str),
            details: Some(dest_details),
        },
    )
    .await;
}

/// Wait for the auth message containing token, host, and port.
async fn wait_for_tunnel_auth(
    ws_sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    ws_receiver: &mut futures_util::stream::SplitStream<WebSocket>,
    state: &AppState,
    system_id: Uuid,
) -> Result<(Uuid, String, u16, Uuid, Uuid), ()> {
    // Returns (user_id, resolved_host, remote_port, project_id, environment_id)
    let mut message_count: u32 = 0;
    const MAX_PRE_AUTH_MESSAGES: u32 = 5;
    loop {
        message_count += 1;
        if message_count > MAX_PRE_AUTH_MESSAGES {
            let _ = ws_sender
                .send(Message::Text(
                    json!({"type": "error", "message": "Too many messages before authentication"})
                        .to_string()
                        .into(),
                ))
                .await;
            return Err(());
        }
        match ws_receiver.next().await {
            Some(Ok(Message::Text(text))) => {
                let text_str: &str = &text;
                if let Ok(ctrl) = serde_json::from_str::<serde_json::Value>(text_str) {
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

                        let environment_id = system.environment_id;
                        let project_id: Option<Uuid> = match sqlx::query_scalar(
                            "SELECT project_id FROM environments WHERE id = $1",
                        )
                        .bind(environment_id)
                        .fetch_optional(&state.db)
                        .await
                        {
                            Ok(id) => id,
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

                        let project_id = match project_id {
                            Some(id) => id,
                            None => {
                                let _ = ws_sender
                                    .send(Message::Text(
                                        json!({"type": "error", "message": "Environment not found"})
                                            .to_string()
                                            .into(),
                                    ))
                                    .await;
                                return Err(());
                            }
                        };

                        // Check systems.tunnel.open permission via role in JWT,
                        // with per-resource ACL overrides applied when the
                        // CONTAINERUS_ENFORCE_ACLS flag is on (CON-73).
                        if !claims.is_company_admin {
                            let role_id = match claims.role_for_project(&project_id) {
                                Some(id) => id,
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
                            };
                            let role_perms = state.permission_cache.get_permissions(&role_id);

                            let acl_view = if state.config.enforce_acls {
                                match resolver::load_resource_acl_view(
                                    &state.db,
                                    claims.sub,
                                    project_id,
                                    "system",
                                    system_id,
                                )
                                .await
                                {
                                    Ok(v) => v,
                                    Err(e) => {
                                        tracing::error!("Failed to load resource ACL for system {system_id}: {e}");
                                        let _ = ws_sender
                                            .send(Message::Text(
                                                json!({"type": "error", "message": "Internal server error"})
                                                    .to_string()
                                                    .into(),
                                            ))
                                            .await;
                                        return Err(());
                                    }
                                }
                            } else {
                                None
                            };

                            let input = ResolverInput {
                                is_company_admin: false,
                                role_permissions: &role_perms,
                                container_acl: None,
                                resource_acl: acl_view.as_ref(),
                                env_override: None,
                            };
                            if !resolver::resolve(&input, "systems.tunnel.open").is_allowed() {
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

                        // Extract host and port from the auth message
                        let remote_host = match ctrl.get("host").and_then(|h| h.as_str()) {
                            Some(h) if !h.is_empty() => h.to_string(),
                            _ => {
                                let _ = ws_sender
                                    .send(Message::Text(
                                        json!({"type": "error", "message": "Missing 'host' in auth message"})
                                            .to_string()
                                            .into(),
                                    ))
                                    .await;
                                return Err(());
                            }
                        };

                        let remote_port = match ctrl.get("port").and_then(|p| p.as_u64()) {
                            Some(p) if p > 0 && p <= 65535 => p as u16,
                            _ => {
                                let _ = ws_sender
                                    .send(Message::Text(
                                        json!({"type": "error", "message": "Missing or invalid 'port' in auth message"})
                                            .to_string()
                                            .into(),
                                    ))
                                    .await;
                                return Err(());
                            }
                        };

                        // SSRF protection
                        if is_blocked_tunnel_destination(&remote_host) {
                            let _ = ws_sender
                                .send(Message::Text(
                                    json!({"type": "error", "message": "Tunnel destination is not allowed"})
                                        .to_string()
                                        .into(),
                                ))
                                .await;
                            return Err(());
                        }

                        // DNS rebinding protection: resolve once and use the IP for the tunnel
                        let resolved_host = match resolve_and_check(&remote_host, remote_port).await {
                            Ok(ip) => ip,
                            Err(msg) => {
                                let _ = ws_sender
                                    .send(Message::Text(
                                        json!({"type": "error", "message": msg})
                                            .to_string()
                                            .into(),
                                    ))
                                    .await;
                                return Err(());
                            }
                        };

                        // Ensure connected for this user (connect is idempotent)
                        if let Err(e) = state.connections.connect(&state.db, claims.sub, &system).await {
                            tracing::error!("Cannot connect to system {}: {e}", system_id);
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
                            "WebSocket tunnel: user={} system={} -> {}:{} (resolved: {})",
                            claims.sub,
                            system_id,
                            remote_host,
                            remote_port,
                            resolved_host
                        );

                        return Ok((claims.sub, resolved_host, remote_port, project_id, environment_id));
                    }
                }
            }
            Some(Ok(Message::Close(_))) | None => return Err(()),
            _ => continue,
        }
    }
}

/// Run the actual tunnel relay after authentication.
async fn run_tunnel_relay(
    mut ws_sender: futures_util::stream::SplitSink<WebSocket, Message>,
    mut ws_receiver: futures_util::stream::SplitStream<WebSocket>,
    state: AppState,
    user_id: Uuid,
    system_id: Uuid,
    remote_host: String,
    remote_port: u16,
) {
    // Get SSH client and open direct-tcpip channel
    let client = match state.connections.get_client(user_id, system_id) {
        Some(c) => c,
        None => {
            tracing::error!("Tunnel: system {} not connected", system_id);
            let _ = ws_sender.send(Message::Text(
                json!({"type": "error", "message": "System disconnected"}).to_string().into()
            )).await;
            return;
        }
    };

    let mut client_guard = client.lock().await;
    let mut channel = match client_guard.open_direct_tcpip(&remote_host, remote_port).await {
        Ok(ch) => ch,
        Err(e) => {
            tracing::error!("Tunnel: failed to open direct-tcpip to {}:{}: {}", remote_host, remote_port, e);
            let _ = ws_sender.send(Message::Text(
                json!({"type": "error", "message": "Failed to open tunnel to destination"}).to_string().into()
            )).await;
            return;
        }
    };
    drop(client_guard);

    // Use a channel to send messages to WebSocket (avoids split borrow issues)
    let (ws_write_tx, mut ws_write_rx) = tokio::sync::mpsc::channel::<Message>(256);

    let write_task = tokio::spawn(async move {
        while let Some(msg) = ws_write_rx.recv().await {
            if ws_sender.send(msg).await.is_err() {
                break;
            }
        }
        let _ = ws_sender.close().await;
    });

    // Bidirectional relay loop
    loop {
        tokio::select! {
            // SSH channel -> WebSocket
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
            // WebSocket -> SSH channel
            ws_msg = ws_receiver.next() => {
                match ws_msg {
                    Some(Ok(Message::Binary(data))) => {
                        if channel.data(&data[..]).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Text(text))) => {
                        // Forward text as binary data
                        if channel.data(text.as_bytes()).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        let _ = channel.eof().await;
                        break;
                    }
                    Some(Ok(Message::Ping(data))) => {
                        let _ = ws_write_tx.send(Message::Pong(data)).await;
                    }
                    Some(Err(_)) => {
                        break;
                    }
                    _ => {}
                }
            }
        }
    }

    drop(ws_write_tx);
    let _ = write_task.await;
    tracing::info!(
        "Tunnel session ended: system={} -> {}:{}",
        system_id,
        remote_host,
        remote_port
    );
}
