use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    response::IntoResponse,
    routing::get,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use kube::{
    api::Api,
    runtime::watcher::{self, Event as WatcherEvent},
};
use k8s_openapi::api::{
    apps::v1::{DaemonSet, Deployment, ReplicaSet, StatefulSet},
    autoscaling::v2::HorizontalPodAutoscaler,
    batch::v1::{CronJob, Job},
    core::v1::{
        ConfigMap, Endpoints, PersistentVolumeClaim, Pod, ResourceQuota, Secret, Service,
        ServiceAccount,
    },
    networking::v1::{Ingress, NetworkPolicy},
    policy::v1::PodDisruptionBudget,
    rbac::v1::{Role as K8sRole, RoleBinding},
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::auth::jwt::decode_access_token;
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/k8s-watch/{cluster_id}", get(ws_k8s_watch))
}

async fn ws_k8s_watch(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Path(cluster_id): Path<Uuid>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_k8s_watch_session(socket, state, cluster_id))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubscribeMessage {
    namespace: String,
    kinds: Vec<String>,
}

async fn handle_k8s_watch_session(socket: WebSocket, state: AppState, cluster_id: Uuid) {
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Phase 1: Auth
    let _claims = match tokio::time::timeout(
        std::time::Duration::from_secs(30),
        wait_for_auth(&mut ws_sender, &mut ws_receiver, &state, cluster_id),
    )
    .await
    {
        Ok(Ok(c)) => c,
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

    // Phase 2: Wait for subscribe message
    let sub_msg = match tokio::time::timeout(
        std::time::Duration::from_secs(30),
        wait_for_subscribe(&mut ws_sender, &mut ws_receiver),
    )
    .await
    {
        Ok(Some(msg)) => msg,
        Ok(None) => return,
        Err(_) => {
            let _ = ws_sender
                .send(Message::Text(
                    json!({"type": "error", "message": "Timed out waiting for subscribe message"})
                        .to_string()
                        .into(),
                ))
                .await;
            return;
        }
    };

    // Get kube client
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

    let _ = ws_sender
        .send(Message::Text(
            json!({"type": "subscribed", "namespace": &sub_msg.namespace, "kinds": &sub_msg.kinds})
                .to_string()
                .into(),
        ))
        .await;

    tracing::info!(
        "K8s watch session started: cluster={} namespace={} kinds={:?}",
        cluster_id,
        sub_msg.namespace,
        sub_msg.kinds
    );

    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(512);
    // Use a watch channel as cancellation signal (true = cancelled)
    let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);

    // Spawn a watcher task for each requested kind
    for kind in &sub_msg.kinds {
        let tx = tx.clone();
        let client = client.clone();
        let ns = sub_msg.namespace.clone();
        let kind = kind.clone();
        let cancel_rx = cancel_rx.clone();

        tokio::spawn(async move {
            match kind.as_str() {
                "pods" => watch_resource::<Pod>(&client, &ns, &kind, tx, cancel_rx).await,
                "deployments" => watch_resource::<Deployment>(&client, &ns, &kind, tx, cancel_rx).await,
                "services" => watch_resource::<Service>(&client, &ns, &kind, tx, cancel_rx).await,
                "statefulsets" => watch_resource::<StatefulSet>(&client, &ns, &kind, tx, cancel_rx).await,
                "daemonsets" => watch_resource::<DaemonSet>(&client, &ns, &kind, tx, cancel_rx).await,
                "replicasets" => watch_resource::<ReplicaSet>(&client, &ns, &kind, tx, cancel_rx).await,
                "jobs" => watch_resource::<Job>(&client, &ns, &kind, tx, cancel_rx).await,
                "cronjobs" => watch_resource::<CronJob>(&client, &ns, &kind, tx, cancel_rx).await,
                "configmaps" => watch_resource::<ConfigMap>(&client, &ns, &kind, tx, cancel_rx).await,
                "secrets" => watch_resource::<Secret>(&client, &ns, &kind, tx, cancel_rx).await,
                "ingresses" => watch_resource::<Ingress>(&client, &ns, &kind, tx, cancel_rx).await,
                "pvcs" => watch_resource::<PersistentVolumeClaim>(&client, &ns, &kind, tx, cancel_rx).await,
                "networkpolicies" => watch_resource::<NetworkPolicy>(&client, &ns, &kind, tx, cancel_rx).await,
                "resourcequotas" => watch_resource::<ResourceQuota>(&client, &ns, &kind, tx, cancel_rx).await,
                "serviceaccounts" => watch_resource::<ServiceAccount>(&client, &ns, &kind, tx, cancel_rx).await,
                "roles" => watch_resource::<K8sRole>(&client, &ns, &kind, tx, cancel_rx).await,
                "rolebindings" => watch_resource::<RoleBinding>(&client, &ns, &kind, tx, cancel_rx).await,
                "horizontalpodautoscalers" => watch_resource::<HorizontalPodAutoscaler>(&client, &ns, &kind, tx, cancel_rx).await,
                "poddisruptionbudgets" => watch_resource::<PodDisruptionBudget>(&client, &ns, &kind, tx, cancel_rx).await,
                "endpoints" => watch_resource::<Endpoints>(&client, &ns, &kind, tx, cancel_rx).await,
                _ => {
                    tracing::warn!("Unknown watch kind: {}", kind);
                }
            }
        });
    }

    drop(tx); // Drop our own sender so rx completes when all watchers finish

    // Forward events to WebSocket, while handling incoming control messages
    loop {
        tokio::select! {
            Some(event_json) = rx.recv() => {
                if ws_sender.send(Message::Text(event_json.into())).await.is_err() {
                    break;
                }
            }
            msg = ws_receiver.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        let text_str: &str = &text;
                        if let Ok(ctrl) = serde_json::from_str::<serde_json::Value>(text_str) {
                            match ctrl.get("type").and_then(|t| t.as_str()) {
                                Some("ping") => {
                                    let _ = ws_sender.send(Message::Text(
                                        json!({"type": "pong"}).to_string().into(),
                                    )).await;
                                }
                                Some("close") => break,
                                _ => {}
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => continue,
                }
            }
            else => break,
        }
    }

    let _ = cancel_tx.send(true);
    tracing::info!(
        "K8s watch session ended: cluster={} namespace={}",
        cluster_id,
        sub_msg.namespace
    );
}

async fn watch_resource<K>(
    client: &kube::Client,
    namespace: &str,
    kind: &str,
    tx: tokio::sync::mpsc::Sender<String>,
    mut cancel_rx: tokio::sync::watch::Receiver<bool>,
) where
    K: kube::Resource<Scope = k8s_openapi::NamespaceResourceScope>
        + Clone
        + std::fmt::Debug
        + serde::de::DeserializeOwned
        + serde::Serialize
        + Send
        + 'static,
    <K as kube::Resource>::DynamicType: Default,
{
    let api: Api<K> = Api::namespaced(client.clone(), namespace);
    let mut stream = watcher::watcher(api, watcher::Config::default().any_semantic()).boxed();

    loop {
        tokio::select! {
            Ok(()) = cancel_rx.changed() => {
                if *cancel_rx.borrow() { break; }
            }
            event = stream.next() => {
                match event {
                    Some(Ok(WatcherEvent::Apply(resource))) => {
                        let json_val = match serde_json::to_value(&resource) {
                            Ok(v) => v,
                            Err(_) => continue,
                        };
                        let msg = json!({
                            "type": "event",
                            "eventType": "MODIFIED",
                            "kind": kind,
                            "resource": json_val,
                        });
                        if tx.send(msg.to_string()).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(WatcherEvent::Delete(resource))) => {
                        let json_val = match serde_json::to_value(&resource) {
                            Ok(v) => v,
                            Err(_) => continue,
                        };
                        let msg = json!({
                            "type": "event",
                            "eventType": "DELETED",
                            "kind": kind,
                            "resource": json_val,
                        });
                        if tx.send(msg.to_string()).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(WatcherEvent::Init | WatcherEvent::InitApply(_) | WatcherEvent::InitDone)) => {
                        // Initial list events — skip (client already has initial data)
                    }
                    Some(Err(e)) => {
                        tracing::warn!("Watch error for {}: {}", kind, e);
                        // kube-rs watcher will auto-retry
                    }
                    None => break,
                }
            }
        }
    }
}

/// Wait for auth message, verify JWT, and check cluster access.
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

                        // Verify cluster access
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
                            "clusters.view",
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

                        return Ok(claims);
                    }
                }
            }
            Some(Ok(Message::Close(_))) | None => return Err(()),
            _ => continue,
        }
    }
}

/// Wait for subscribe message with namespace and kinds.
async fn wait_for_subscribe(
    ws_sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    ws_receiver: &mut futures_util::stream::SplitStream<WebSocket>,
) -> Option<SubscribeMessage> {
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
                    if ctrl.get("type").and_then(|t| t.as_str()) == Some("subscribe") {
                        match serde_json::from_value::<SubscribeMessage>(ctrl) {
                            Ok(msg) => return Some(msg),
                            Err(e) => {
                                let _ = ws_sender
                                    .send(Message::Text(
                                        json!({"type": "error", "message": format!("Invalid subscribe message: {e}")})
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
