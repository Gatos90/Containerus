//! CON-85: End-to-end audit-row coverage for the WebSocket terminal and
//! tunnel handlers.
//!
//! Each test drives the real handler through `ws://…` over a loopback TCP
//! socket so that `ConnectInfo<SocketAddr>` is populated and the audit rows
//! carry a non-null `ip_address`. An in-process russh mock (see
//! `tests/common/mock_ssh.rs`) replaces the upstream SSH server so no
//! real remote host is needed.
//!
//! Skip policy matches `rbac_matrix.rs`: without `TEST_DATABASE_URL` the
//! test prints a skip message (or panics under `REQUIRE_DB=1`).

mod common;

use std::time::Duration;

use common::{skip_without_db, TestHarness, ROLE_PROJECT_ADMIN};
use common::mock_kube::MockKubeServer;
use common::mock_ssh::MockSshServer;
use common::ws_harness::{ensure_isolated_home, poll_audit_row};

use containerus_core::ssh::known_hosts;
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use sqlx::Row;
use tokio_tungstenite::tungstenite::Message;
use uuid::Uuid;

/// Seed a system row pointing at the mock SSH host:port and store the
/// password credential in the vault.
async fn seed_ssh_system(
    h: &TestHarness,
    environment_id: Uuid,
    created_by: Uuid,
    host: &str,
    port: u16,
    password: &str,
) -> Uuid {
    let system_id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO systems (environment_id, name, hostname, port, username,
             primary_runtime, available_runtimes, auth_method, is_active, created_by)
         VALUES ($1, $2, $3, $4, 'testuser', 'docker', '[\"docker\"]',
             'password', true, $5)
         RETURNING id",
    )
    .bind(environment_id)
    .bind(format!("mock-{}", Uuid::new_v4().simple()))
    .bind(host)
    .bind(port as i32)
    .bind(created_by)
    .fetch_one(&h.db)
    .await
    .expect("insert system");

    h.state
        .vault
        .store_credential(&h.db, system_id, "password", password, None)
        .await
        .expect("store password credential");

    system_id
}

/// Connect a raw `tokio-tungstenite` WebSocket to the harness.
async fn connect_ws(
    url: &str,
) -> tokio_tungstenite::WebSocketStream<
    tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
> {
    let (ws, _resp) = tokio_tungstenite::connect_async(url)
        .await
        .expect("ws connect");
    ws
}

#[tokio::test]
async fn terminal_open_close_emits_audit_with_ip() {
    let Some(h) = TestHarness::try_new(false).await else {
        skip_without_db("terminal_open_close_emits_audit_with_ip");
        return;
    };
    ensure_isolated_home();

    // Mock SSH first so the system row can point at its port.
    let ssh = MockSshServer::start("hunter2").await;
    known_hosts::add_host_key(&ssh.addr.ip().to_string(), ssh.addr.port(), &ssh.public_key)
        .expect("trust mock ssh host key");

    // Seed DB: project, environment, system + credentials, membership.
    let user_id = h.create_user("terminal-user").await;
    let project_id = h.create_project("ws-audit-term").await;
    let environment_id = h.create_environment(project_id).await;
    h.add_member(project_id, user_id, ROLE_PROJECT_ADMIN).await;
    let system_id = seed_ssh_system(
        &h,
        environment_id,
        user_id,
        &ssh.addr.ip().to_string(),
        ssh.addr.port(),
        &ssh.password,
    )
    .await;
    let token = h.login_as(user_id, false).await;

    // Boot the router on a loopback port so ConnectInfo is populated.
    let running = h.spawn_server().await;
    let url = running.ws_url(&format!("/api/ws/terminal/{system_id}"));
    let mut ws = connect_ws(&url).await;

    // Auth frame (JWT) then start frame (PTY dimensions). The handler will
    // SSH into the mock server during auth and emit `ws.terminal.open`.
    ws.send(Message::Text(
        json!({"type": "auth", "token": token}).to_string().into(),
    ))
    .await
    .expect("send auth");
    ws.send(Message::Text(
        json!({"type": "start", "cols": 80, "rows": 24}).to_string().into(),
    ))
    .await
    .expect("send start");

    // Wait for the {"type":"connected"} confirmation so the handler has
    // progressed past the PTY setup before we close. Tolerate noise.
    let mut saw_connected = false;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while !saw_connected && tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_secs(2), ws.next()).await {
            Ok(Some(Ok(Message::Text(t)))) => {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) {
                    if v.get("type").and_then(|s| s.as_str()) == Some("connected") {
                        saw_connected = true;
                        break;
                    }
                }
            }
            Ok(Some(Ok(_))) => continue,
            Ok(Some(Err(_))) | Ok(None) => break,
            Err(_) => break,
        }
    }
    assert!(saw_connected, "handler never emitted 'connected'");

    // Client-initiated close — the server reacts by writing the close audit.
    ws.close(None).await.ok();
    drop(ws);

    let resource_id = system_id.to_string();

    let open_row = poll_audit_row(&running.db, "ws.terminal.open", &resource_id).await;
    assert_eq!(open_row.get::<String, _>("resource_type"), "system");
    assert_eq!(
        open_row.get::<Option<Uuid>, _>("project_id"),
        Some(project_id),
        "terminal.open must tag project_id"
    );
    assert_eq!(
        open_row.get::<Option<Uuid>, _>("environment_id"),
        Some(environment_id),
        "terminal.open must tag environment_id"
    );
    assert_eq!(
        open_row.get::<Option<Uuid>, _>("user_id"),
        Some(user_id),
        "terminal.open must tag the authenticated user"
    );
    assert_eq!(open_row.get::<String, _>("actor_type"), "user");
    let ip = open_row.get::<Option<String>, _>("ip_address");
    assert!(
        matches!(ip.as_deref(), Some("127.0.0.1" | "::1")),
        "terminal.open must carry loopback client IP, got {ip:?}"
    );

    let close_row = poll_audit_row(&running.db, "ws.terminal.close", &resource_id).await;
    assert_eq!(close_row.get::<String, _>("resource_type"), "system");
    assert_eq!(
        close_row.get::<Option<Uuid>, _>("project_id"),
        Some(project_id)
    );
    let close_ip = close_row.get::<Option<String>, _>("ip_address");
    assert!(
        matches!(close_ip.as_deref(), Some("127.0.0.1" | "::1")),
        "terminal.close must carry loopback client IP, got {close_ip:?}"
    );

    running.cleanup().await;
    ssh.join.abort();
}

#[tokio::test]
async fn tunnel_open_close_emits_audit_with_host_port() {
    let Some(h) = TestHarness::try_new(false).await else {
        skip_without_db("tunnel_open_close_emits_audit_with_host_port");
        return;
    };
    ensure_isolated_home();

    let ssh = MockSshServer::start("hunter2").await;
    known_hosts::add_host_key(&ssh.addr.ip().to_string(), ssh.addr.port(), &ssh.public_key)
        .expect("trust mock ssh host key");

    let user_id = h.create_user("tunnel-user").await;
    let project_id = h.create_project("ws-audit-tun").await;
    let environment_id = h.create_environment(project_id).await;
    h.add_member(project_id, user_id, ROLE_PROJECT_ADMIN).await;
    let system_id = seed_ssh_system(
        &h,
        environment_id,
        user_id,
        &ssh.addr.ip().to_string(),
        ssh.addr.port(),
        &ssh.password,
    )
    .await;
    let token = h.login_as(user_id, false).await;

    let running = h.spawn_server().await;
    let url = running.ws_url(&format!("/api/ws/tunnel/{system_id}"));
    let mut ws = connect_ws(&url).await;

    // The tunnel destination must clear the SSRF check (is_blocked_tunnel_destination)
    // and survive `resolve_and_check`. Literal public IP avoids DNS.
    let remote_host = "93.184.216.34";
    let remote_port: u16 = 80;

    ws.send(Message::Text(
        json!({
            "type": "auth",
            "token": token,
            "host": remote_host,
            "port": remote_port,
        })
        .to_string()
        .into(),
    ))
    .await
    .expect("send auth");

    let mut saw_connected = false;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while !saw_connected && tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_secs(2), ws.next()).await {
            Ok(Some(Ok(Message::Text(t)))) => {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) {
                    if v.get("type").and_then(|s| s.as_str()) == Some("connected") {
                        saw_connected = true;
                        break;
                    }
                }
            }
            Ok(Some(Ok(_))) => continue,
            Ok(Some(Err(_))) | Ok(None) => break,
            Err(_) => break,
        }
    }
    assert!(saw_connected, "tunnel handler never emitted 'connected'");

    ws.close(None).await.ok();
    drop(ws);

    let resource_id = system_id.to_string();

    let open_row = poll_audit_row(&running.db, "ws.tunnel.open", &resource_id).await;
    assert_eq!(open_row.get::<String, _>("resource_type"), "system");
    assert_eq!(
        open_row.get::<Option<Uuid>, _>("project_id"),
        Some(project_id)
    );
    assert_eq!(
        open_row.get::<Option<Uuid>, _>("environment_id"),
        Some(environment_id)
    );
    let ip = open_row.get::<Option<String>, _>("ip_address");
    assert!(
        matches!(ip.as_deref(), Some("127.0.0.1" | "::1")),
        "tunnel.open must carry loopback client IP, got {ip:?}"
    );
    let details: serde_json::Value = open_row.get("details");
    assert_eq!(
        details.get("remote_host").and_then(|v| v.as_str()),
        Some(remote_host),
        "tunnel.open details must echo remote_host"
    );
    assert_eq!(
        details.get("remote_port").and_then(|v| v.as_u64()),
        Some(u64::from(remote_port)),
        "tunnel.open details must echo remote_port"
    );

    let close_row = poll_audit_row(&running.db, "ws.tunnel.close", &resource_id).await;
    assert_eq!(close_row.get::<String, _>("resource_type"), "system");
    let close_details: serde_json::Value = close_row.get("details");
    assert_eq!(
        close_details.get("remote_host").and_then(|v| v.as_str()),
        Some(remote_host),
    );
    assert_eq!(
        close_details.get("remote_port").and_then(|v| v.as_u64()),
        Some(u64::from(remote_port)),
    );

    running.cleanup().await;
    ssh.join.abort();
}

/// Seed a clusters row pointing at `kube` with an encrypted kubeconfig.
async fn seed_k8s_cluster(
    h: &TestHarness,
    environment_id: Uuid,
    created_by: Uuid,
    kube: &MockKubeServer,
) -> Uuid {
    let row = h
        .state
        .k8s
        .store_cluster(
            &h.db,
            environment_id,
            &format!("mock-cluster-{}", Uuid::new_v4().simple()),
            &kube.kubeconfig_yaml(),
            Some("mock"),
            created_by,
        )
        .await
        .expect("store mock cluster");
    row.id
}

#[tokio::test]
async fn k8s_exec_open_close_emits_audit_with_ip() {
    let Some(h) = TestHarness::try_new(false).await else {
        skip_without_db("k8s_exec_open_close_emits_audit_with_ip");
        return;
    };

    let kube = MockKubeServer::start().await;
    let user_id = h.create_user("k8s-exec-user").await;
    let project_id = h.create_project("ws-audit-k8s-exec").await;
    let environment_id = h.create_environment(project_id).await;
    h.add_member(project_id, user_id, ROLE_PROJECT_ADMIN).await;
    let cluster_id = seed_k8s_cluster(&h, environment_id, user_id, &kube).await;
    let token = h.login_as(user_id, false).await;

    let running = h.spawn_server().await;
    let url = running.ws_url(&format!("/api/ws/k8s-exec/{cluster_id}"));
    let mut ws = connect_ws(&url).await;

    // Auth then start. The handler validates the shell, verifies cluster
    // access, and calls `Api::exec()` against the mock kube server. The open
    // audit row is emitted as soon as the upgrade succeeds — regardless of
    // whether the upstream exec stream goes on to produce data.
    ws.send(Message::Text(
        json!({"type": "auth", "token": token}).to_string().into(),
    ))
    .await
    .expect("send auth");
    ws.send(Message::Text(
        json!({
            "type": "start",
            "namespace": "default",
            "pod": "mock-pod",
            "shell": "/bin/sh",
            "cols": 80,
            "rows": 24,
        })
        .to_string()
        .into(),
    ))
    .await
    .expect("send start");

    // Wait for the handler's "connected" confirmation — that guarantees it
    // has passed the `pods.exec().await` call and logged the open audit.
    let mut saw_connected = false;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while !saw_connected && tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_secs(2), ws.next()).await {
            Ok(Some(Ok(Message::Text(t)))) => {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) {
                    if v.get("type").and_then(|s| s.as_str()) == Some("connected") {
                        saw_connected = true;
                        break;
                    }
                }
            }
            Ok(Some(Ok(_))) => continue,
            Ok(Some(Err(_))) | Ok(None) => break,
            Err(_) => break,
        }
    }
    assert!(saw_connected, "k8s_exec handler never emitted 'connected'");

    ws.close(None).await.ok();
    drop(ws);

    let resource_id = cluster_id.to_string();

    let open_row = poll_audit_row(&running.db, "ws.k8s_exec.open", &resource_id).await;
    assert_eq!(
        open_row.get::<String, _>("resource_type"),
        "cluster",
        "k8s_exec.open must tag resource_type=cluster"
    );
    assert_eq!(
        open_row.get::<Option<Uuid>, _>("user_id"),
        Some(user_id),
        "k8s_exec.open must tag the authenticated user"
    );
    assert_eq!(open_row.get::<String, _>("actor_type"), "user");
    let open_ip = open_row.get::<Option<String>, _>("ip_address");
    assert!(
        matches!(open_ip.as_deref(), Some("127.0.0.1" | "::1")),
        "k8s_exec.open must carry loopback client IP, got {open_ip:?}"
    );
    let open_details: serde_json::Value = open_row.get("details");
    assert_eq!(
        open_details.get("namespace").and_then(|v| v.as_str()),
        Some("default"),
        "k8s_exec.open details must echo namespace"
    );
    assert_eq!(
        open_details.get("pod").and_then(|v| v.as_str()),
        Some("mock-pod"),
        "k8s_exec.open details must echo pod name"
    );

    let close_row = poll_audit_row(&running.db, "ws.k8s_exec.close", &resource_id).await;
    assert_eq!(close_row.get::<String, _>("resource_type"), "cluster");
    let close_ip = close_row.get::<Option<String>, _>("ip_address");
    assert!(
        matches!(close_ip.as_deref(), Some("127.0.0.1" | "::1")),
        "k8s_exec.close must carry loopback client IP, got {close_ip:?}"
    );

    running.cleanup().await;
    kube.join.abort();
}

#[tokio::test]
async fn k8s_watch_open_close_emits_audit_with_ip_and_details() {
    let Some(h) = TestHarness::try_new(false).await else {
        skip_without_db("k8s_watch_open_close_emits_audit_with_ip_and_details");
        return;
    };

    let kube = MockKubeServer::start().await;
    let user_id = h.create_user("k8s-watch-user").await;
    let project_id = h.create_project("ws-audit-k8s-watch").await;
    let environment_id = h.create_environment(project_id).await;
    h.add_member(project_id, user_id, ROLE_PROJECT_ADMIN).await;
    let cluster_id = seed_k8s_cluster(&h, environment_id, user_id, &kube).await;
    let token = h.login_as(user_id, false).await;

    let running = h.spawn_server().await;
    let url = running.ws_url(&format!("/api/ws/k8s-watch/{cluster_id}"));
    let mut ws = connect_ws(&url).await;

    // Auth, then subscribe for two kinds in the `default` namespace. The
    // watcher tasks spawn against the mock kube server but never emit
    // events — the test only cares about the open/close audit rows.
    ws.send(Message::Text(
        json!({"type": "auth", "token": token}).to_string().into(),
    ))
    .await
    .expect("send auth");
    ws.send(Message::Text(
        json!({
            "type": "subscribe",
            "namespace": "default",
            "kinds": ["pods", "services"],
        })
        .to_string()
        .into(),
    ))
    .await
    .expect("send subscribe");

    // Wait for `subscribed` so the handler has definitely passed the
    // open-audit emission before we close the WebSocket.
    let mut saw_subscribed = false;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while !saw_subscribed && tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_secs(2), ws.next()).await {
            Ok(Some(Ok(Message::Text(t)))) => {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) {
                    if v.get("type").and_then(|s| s.as_str()) == Some("subscribed") {
                        saw_subscribed = true;
                        break;
                    }
                }
            }
            Ok(Some(Ok(_))) => continue,
            Ok(Some(Err(_))) | Ok(None) => break,
            Err(_) => break,
        }
    }
    assert!(
        saw_subscribed,
        "k8s_watch handler never emitted 'subscribed'"
    );

    ws.close(None).await.ok();
    drop(ws);

    let resource_id = cluster_id.to_string();

    let open_row = poll_audit_row(&running.db, "ws.k8s_watch.open", &resource_id).await;
    assert_eq!(
        open_row.get::<String, _>("resource_type"),
        "cluster",
        "k8s_watch.open must tag resource_type=cluster"
    );
    assert_eq!(
        open_row.get::<Option<Uuid>, _>("user_id"),
        Some(user_id),
        "k8s_watch.open must tag the authenticated user"
    );
    assert_eq!(open_row.get::<String, _>("actor_type"), "user");
    let open_ip = open_row.get::<Option<String>, _>("ip_address");
    assert!(
        matches!(open_ip.as_deref(), Some("127.0.0.1" | "::1")),
        "k8s_watch.open must carry loopback client IP, got {open_ip:?}"
    );
    let open_details: serde_json::Value = open_row.get("details");
    assert_eq!(
        open_details.get("namespace").and_then(|v| v.as_str()),
        Some("default"),
        "k8s_watch.open details must echo subscribe namespace"
    );
    let kinds = open_details
        .get("kinds")
        .and_then(|v| v.as_array())
        .expect("k8s_watch.open details must include kinds array");
    let kind_strs: Vec<&str> = kinds.iter().filter_map(|v| v.as_str()).collect();
    assert_eq!(
        kind_strs,
        vec!["pods", "services"],
        "k8s_watch.open details must echo subscribe kinds in order"
    );

    let close_row = poll_audit_row(&running.db, "ws.k8s_watch.close", &resource_id).await;
    assert_eq!(close_row.get::<String, _>("resource_type"), "cluster");
    let close_ip = close_row.get::<Option<String>, _>("ip_address");
    assert!(
        matches!(close_ip.as_deref(), Some("127.0.0.1" | "::1")),
        "k8s_watch.close must carry loopback client IP, got {close_ip:?}"
    );
    let close_details: serde_json::Value = close_row.get("details");
    assert_eq!(
        close_details.get("namespace").and_then(|v| v.as_str()),
        Some("default"),
        "k8s_watch.close details must echo subscribe namespace"
    );

    running.cleanup().await;
    kube.join.abort();
}
