use dashmap::DashMap;
use futures_util::{SinkExt, StreamExt};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tokio_tungstenite::tungstenite::Message;
use tokio_util::sync::CancellationToken;

use crate::models::error::ContainerError;
use crate::models::port_forward::{PortForward, PortForwardStatus};

/// Manages port forwards for backend (server-connected) systems.
/// Each forward binds a local TCP port and tunnels traffic through a WebSocket
/// to the backend server, which in turn relays it via SSH direct-tcpip.
pub struct BackendPortForwardManager {
    forwards: DashMap<String, BackendForwardEntry>,
    /// Serializes start_forward calls to prevent TOCTOU races on duplicate checks
    start_lock: tokio::sync::Mutex<()>,
}

#[derive(Clone)]
struct BackendForwardEntry {
    forward: PortForward,
    #[allow(dead_code)]
    shutdown_tx: broadcast::Sender<()>,
    cancel_token: CancellationToken,
}

impl BackendPortForwardManager {
    pub fn new() -> Self {
        Self {
            forwards: DashMap::new(),
            start_lock: tokio::sync::Mutex::new(()),
        }
    }

    /// Start a new backend port forward.
    /// Binds a local TCP port and tunnels each connection through WebSocket.
    pub async fn start_forward(
        &self,
        system_id: String,
        container_id: String,
        container_port: u16,
        local_port: Option<u16>,
        remote_host: String,
        remote_port: u16,
        protocol: String,
        ws_url: String,
        token: String,
    ) -> Result<PortForward, ContainerError> {
        // Hold lock to prevent TOCTOU race between duplicate check and insert
        let _guard = self.start_lock.lock().await;

        if self.is_port_forwarded(&container_id, container_port) {
            return Err(ContainerError::Internal(format!(
                "Port {} is already forwarded for container {}",
                container_port, container_id
            )));
        }

        // Bind local TCP port
        let listener = if let Some(port) = local_port {
            let mut bound = None;
            let max_attempts = ((u16::MAX - port).saturating_add(1) as usize).min(20);
            let mut last_port = port;
            for offset in 0..max_attempts {
                let try_port = port.saturating_add(offset as u16);
                last_port = try_port;
                match TcpListener::bind(format!("127.0.0.1:{}", try_port)).await {
                    Ok(l) => {
                        if offset > 0 {
                            tracing::info!(
                                "Port {} was taken, bound to {} instead",
                                port, try_port
                            );
                        }
                        bound = Some(l);
                        break;
                    }
                    Err(_) if offset < max_attempts - 1 => continue,
                    Err(e) => {
                        return Err(ContainerError::Internal(format!(
                            "Failed to bind to ports {}-{}: {}",
                            port, last_port, e
                        )));
                    }
                }
            }
            bound.ok_or_else(|| ContainerError::Internal("Failed to bind to any port".to_string()))?
        } else {
            TcpListener::bind("127.0.0.1:0")
                .await
                .map_err(|e| ContainerError::Internal(format!("Failed to bind to port: {}", e)))?
        };

        let actual_local_port = listener
            .local_addr()
            .map_err(|e| ContainerError::Internal(format!("Failed to get local address: {}", e)))?
            .port();

        let forward = PortForward::new(
            system_id,
            container_id,
            container_port,
            actual_local_port,
            remote_host.clone(),
            remote_port,
            protocol,
        );

        let (shutdown_tx, shutdown_rx) = broadcast::channel(1);
        let cancel_token = CancellationToken::new();

        self.forwards.insert(
            forward.id.clone(),
            BackendForwardEntry {
                forward: forward.clone(),
                shutdown_tx,
                cancel_token: cancel_token.clone(),
            },
        );

        // Spawn listener task
        let forward_id = forward.id.clone();
        let forwards = self.forwards.clone();

        tokio::spawn(async move {
            Self::run_listener(
                listener,
                ws_url,
                token,
                remote_host,
                remote_port,
                forward_id.clone(),
                shutdown_rx,
                cancel_token,
            )
            .await;

            // Remove the forward entry when listener stops
            forwards.remove(&forward_id);
        });

        Ok(forward)
    }

    /// Run the TCP listener, accepting connections and spawning tunnel tasks.
    async fn run_listener(
        listener: TcpListener,
        ws_url: String,
        token: String,
        remote_host: String,
        remote_port: u16,
        forward_id: String,
        mut shutdown_rx: broadcast::Receiver<()>,
        cancel_token: CancellationToken,
    ) {
        tracing::info!(
            "Backend port forward {} listening on {}",
            forward_id,
            listener.local_addr().map(|a| a.to_string()).unwrap_or_else(|_| "unknown".into())
        );

        loop {
            tokio::select! {
                result = listener.accept() => {
                    match result {
                        Ok((socket, addr)) => {
                            tracing::debug!(
                                "Accepted connection from {} for backend forward {}",
                                addr, forward_id
                            );
                            let ws_url = ws_url.clone();
                            let token = token.clone();
                            let host = remote_host.clone();
                            let port = remote_port;
                            let token_clone = cancel_token.clone();

                            tokio::spawn(async move {
                                if let Err(e) = Self::handle_connection(
                                    socket, &ws_url, &token, &host, port, token_clone,
                                ).await {
                                    tracing::error!("Backend tunnel connection error: {}", e);
                                }
                            });
                        }
                        Err(e) => {
                            tracing::error!("Accept error: {}", e);
                        }
                    }
                }
                _ = shutdown_rx.recv() => {
                    tracing::info!("Backend port forward {} shutting down", forward_id);
                    break;
                }
                _ = cancel_token.cancelled() => {
                    tracing::info!("Backend port forward {} cancelled", forward_id);
                    break;
                }
            }
        }
    }

    /// Handle a single TCP connection by tunneling it through WebSocket.
    async fn handle_connection(
        tcp_stream: tokio::net::TcpStream,
        ws_url: &str,
        token: &str,
        host: &str,
        port: u16,
        cancel_token: CancellationToken,
    ) -> Result<(), ContainerError> {
        let (ws_stream, _) = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            tokio_tungstenite::connect_async(ws_url),
        )
            .await
            .map_err(|_| ContainerError::Internal("WebSocket connection timed out".into()))?
            .map_err(|e| {
                ContainerError::Internal(format!("WebSocket connection failed: {}", e))
            })?;

        let (mut ws_sender, mut ws_receiver) = ws_stream.split();

        // Authenticate via first message (avoids token in URL/logs)
        let auth_msg = serde_json::json!({
            "type": "auth",
            "token": token,
            "host": host,
            "port": port
        });
        ws_sender
            .send(Message::Text(auth_msg.to_string().into()))
            .await
            .map_err(|e| {
                ContainerError::Internal(format!("Failed to send auth message: {}", e))
            })?;

        // Wait for connected confirmation (with timeout)
        let auth_response = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            ws_receiver.next(),
        )
            .await
            .map_err(|_| ContainerError::Internal("Timeout waiting for auth response".into()))?;
        match auth_response {
            Some(Ok(Message::Text(text))) => {
                if let Ok(msg) = serde_json::from_str::<serde_json::Value>(&text) {
                    if msg.get("type").and_then(|t| t.as_str()) == Some("error") {
                        let err_msg = msg.get("message").and_then(|m| m.as_str()).unwrap_or("Unknown error");
                        return Err(ContainerError::Internal(format!("Tunnel auth failed: {}", err_msg)));
                    }
                    // Explicitly verify we got a "connected" response
                    if msg.get("type").and_then(|t| t.as_str()) != Some("connected") {
                        return Err(ContainerError::Internal(format!(
                            "Unexpected auth response type: {:?}",
                            msg.get("type")
                        )));
                    }
                } else {
                    return Err(ContainerError::Internal("Invalid JSON in auth response".into()));
                }
            }
            Some(Err(e)) => {
                return Err(ContainerError::Internal(format!("WebSocket error during auth: {}", e)));
            }
            None => {
                return Err(ContainerError::Internal("WebSocket closed during auth".into()));
            }
            Some(Ok(msg)) => {
                return Err(ContainerError::Internal(format!(
                    "Unexpected message type during auth: {:?}",
                    msg
                )));
            }
        }
        let (mut tcp_reader, mut tcp_writer) = tcp_stream.into_split();

        let mut tcp_buf = vec![0u8; 8192];

        loop {
            tokio::select! {
                _ = cancel_token.cancelled() => {
                    tracing::debug!("Backend tunnel connection cancelled");
                    let _ = ws_sender.send(Message::Close(None)).await;
                    break;
                }
                // TCP -> WebSocket
                result = tcp_reader.read(&mut tcp_buf) => {
                    match result {
                        Ok(0) => {
                            let _ = ws_sender.send(Message::Close(None)).await;
                            break;
                        }
                        Ok(n) => {
                            if ws_sender.send(Message::Binary(tcp_buf[..n].to_vec().into())).await.is_err() {
                                break;
                            }
                        }
                        Err(e) => {
                            tracing::debug!("TCP read error: {}", e);
                            break;
                        }
                    }
                }
                // WebSocket -> TCP
                msg = ws_receiver.next() => {
                    match msg {
                        Some(Ok(Message::Binary(data))) => {
                            if tcp_writer.write_all(&data).await.is_err() {
                                break;
                            }
                        }
                        Some(Ok(Message::Close(_))) | None => {
                            let _ = tcp_writer.shutdown().await;
                            break;
                        }
                        Some(Ok(Message::Ping(data))) => {
                            let _ = ws_sender.send(Message::Pong(data)).await;
                        }
                        Some(Ok(Message::Text(text))) => {
                            tracing::debug!("Received unexpected text message during tunnel relay (len={})", text.len());
                        }
                        Some(Ok(Message::Pong(_))) => {
                            // Expected response to ping, ignore
                        }
                        Some(Err(_)) => {
                            break;
                        }
                        _ => {}
                    }
                }
            }
        }

        Ok(())
    }

    /// Stop a backend port forward.
    pub fn stop_forward(&self, forward_id: &str) -> Result<(), ContainerError> {
        if let Some((_, entry)) = self.forwards.remove(forward_id) {
            entry.cancel_token.cancel();
            match entry.shutdown_tx.send(()) {
                Ok(n) => {
                    tracing::info!(
                        "Stopped backend port forward {} (notified {} receivers)",
                        forward_id, n
                    );
                }
                Err(_) => {
                    tracing::warn!(
                        "Backend port forward {} listener already stopped",
                        forward_id
                    );
                }
            }
            Ok(())
        } else {
            Err(ContainerError::Internal(format!(
                "Backend port forward {} not found",
                forward_id
            )))
        }
    }

    /// List all backend port forwards, optionally filtered.
    pub fn list_forwards(
        &self,
        system_id: Option<&str>,
        container_id: Option<&str>,
    ) -> Vec<PortForward> {
        self.forwards
            .iter()
            .filter(|entry| {
                let f = &entry.forward;
                let system_match = system_id.map_or(true, |id| f.system_id == id);
                let container_match = container_id.map_or(true, |id| f.container_id == id);
                system_match && container_match
            })
            .map(|entry| entry.forward.clone())
            .collect()
    }

    /// Get a specific forward.
    pub fn get_forward(&self, forward_id: &str) -> Option<PortForward> {
        self.forwards.get(forward_id).map(|e| e.forward.clone())
    }

    /// Check if a port is already forwarded for a container.
    pub fn is_port_forwarded(&self, container_id: &str, container_port: u16) -> bool {
        self.forwards.iter().any(|entry| {
            entry.forward.container_id == container_id
                && entry.forward.container_port == container_port
                && entry.forward.status == PortForwardStatus::Active
        })
    }

    /// Clean up all forwards for a system.
    pub fn cleanup_system_forwards(&self, system_id: &str) {
        let to_remove: Vec<String> = self
            .forwards
            .iter()
            .filter(|e| e.forward.system_id == system_id)
            .map(|e| e.forward.id.clone())
            .collect();

        for id in to_remove {
            let _ = self.stop_forward(&id);
        }
    }
}

impl Default for BackendPortForwardManager {
    fn default() -> Self {
        Self::new()
    }
}
