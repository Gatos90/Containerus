//! Minimal in-process kube API server used by the WebSocket audit integration
//! tests for `k8s_exec` and `k8s_watch` (CON-86). The mock answers just enough
//! of the API surface that `kube::Client` and `Api<Pod>` handlers reach the
//! audit-emit sites:
//!
//! * `GET /api` / `GET /apis` / `GET /api/v1` — version discovery so a kube
//!   client built from the seeded kubeconfig is usable.
//! * `GET /api/v1/namespaces/{ns}/pods` — empty `PodList` for list calls
//!   issued by `kube::runtime::watcher` before it switches to a watch stream.
//! * `GET /api/v1/namespaces/{ns}/pods?watch=...` — long-poll stream that
//!   never emits events; the watcher task just idles while the test drives
//!   the WS handler.
//! * `GET /api/v1/namespaces/{ns}/pods/{name}/exec` — accepts a WebSocket
//!   upgrade using the `channel.k8s.io` subprotocol so `Api::exec()` returns
//!   `Ok(AttachedProcess)` and the handler emits `ws.k8s_exec.open` before
//!   the empty upstream stream makes it tear down.
//!
//! No TLS — the kubeconfig points at `http://127.0.0.1:PORT`.

#![allow(dead_code)]

use std::net::SocketAddr;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path,
    },
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use futures_util::StreamExt;
use serde_json::json;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

/// A running mock kube API-server bound on a random loopback port.
pub struct MockKubeServer {
    pub addr: SocketAddr,
    pub join: JoinHandle<std::io::Result<()>>,
}

impl MockKubeServer {
    /// Bind on `127.0.0.1:0` and spawn the axum event loop.
    pub async fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind mock kube listener");
        let addr = listener.local_addr().expect("local_addr");

        let app = Router::new()
            .route("/api", get(api_versions))
            .route("/api/v1", get(api_v1_resources))
            .route("/apis", get(apis))
            .route(
                "/api/v1/namespaces/{namespace}/pods",
                get(list_or_watch_pods),
            )
            .route(
                "/api/v1/namespaces/{namespace}/pods/{name}/exec",
                get(exec_upgrade),
            );

        let join = tokio::spawn(async move { axum::serve(listener, app).await });

        Self { addr, join }
    }

    /// Build a YAML kubeconfig that points at this mock server with no TLS
    /// and a static bearer token. Accepted by `kube::config::Kubeconfig` so
    /// `ClusterManager::get_client` succeeds without a real cluster.
    pub fn kubeconfig_yaml(&self) -> String {
        format!(
            "apiVersion: v1\n\
             kind: Config\n\
             clusters:\n\
             - name: mock\n  \
               cluster:\n    \
                 server: http://{addr}\n\
             contexts:\n\
             - name: mock\n  \
               context:\n    \
                 cluster: mock\n    \
                 user: mock\n\
             current-context: mock\n\
             users:\n\
             - name: mock\n  \
               user:\n    \
                 token: test-token\n",
            addr = self.addr
        )
    }
}

async fn api_versions() -> impl IntoResponse {
    Json(json!({
        "kind": "APIVersions",
        "versions": ["v1"],
        "serverAddressByClientCIDRs": [
            {"clientCIDR": "0.0.0.0/0", "serverAddress": "127.0.0.1"}
        ]
    }))
}

async fn apis() -> impl IntoResponse {
    Json(json!({
        "kind": "APIGroupList",
        "apiVersion": "v1",
        "groups": []
    }))
}

async fn api_v1_resources() -> impl IntoResponse {
    Json(json!({
        "kind": "APIResourceList",
        "groupVersion": "v1",
        "resources": [
            {
                "name": "pods",
                "singularName": "",
                "namespaced": true,
                "kind": "Pod",
                "verbs": ["get", "list", "watch", "create", "delete"]
            }
        ]
    }))
}

/// Serve an empty `PodList` for both list and watch calls. Watchers spawned
/// by the handler may error or reconnect against this shape, but the test
/// only asserts that the open/close audit rows appear — the watcher task's
/// outcome is deliberately irrelevant.
async fn list_or_watch_pods(Path(_namespace): Path<String>) -> Response {
    Json(json!({
        "kind": "PodList",
        "apiVersion": "v1",
        "metadata": { "resourceVersion": "1" },
        "items": []
    }))
    .into_response()
}

/// Accept the WebSocket upgrade `kube-rs` issues for `Api::exec()` and then
/// immediately close the socket. That is enough for `Api::exec()` to return
/// `Ok(AttachedProcess)` — the server handler emits `ws.k8s_exec.open`
/// before it tries to read/write, so the audit row lands even when the
/// upstream exec stream goes away right away.
async fn exec_upgrade(
    Path((_namespace, _name)): Path<(String, String)>,
    ws: WebSocketUpgrade,
) -> Response {
    ws.protocols([
        "v5.channel.k8s.io",
        "v4.channel.k8s.io",
        "v3.channel.k8s.io",
        "v2.channel.k8s.io",
        "channel.k8s.io",
    ])
    .on_upgrade(handle_exec_upgrade)
}

async fn handle_exec_upgrade(socket: WebSocket) {
    let (_sink, mut stream) = socket.split();
    // Drain anything the client sends until it closes the connection. We
    // never send stdout/stderr frames — the handler under test only needs
    // the upgrade itself to succeed.
    while let Some(msg) = stream.next().await {
        match msg {
            Ok(Message::Close(_)) | Err(_) => break,
            _ => continue,
        }
    }
}
