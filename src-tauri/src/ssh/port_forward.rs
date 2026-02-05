use dashmap::DashMap;
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tokio_util::sync::CancellationToken;

use crate::models::error::ContainerError;
use crate::models::port_forward::{PortForward, PortForwardStatus};

/// Manages active port forwards
pub struct PortForwardManager {
    /// Active port forwards indexed by forward ID
    forwards: DashMap<String, PortForwardEntry>,
}

#[derive(Clone)]
struct PortForwardEntry {
    forward: PortForward,
    /// Channel to signal listener shutdown
    shutdown_tx: broadcast::Sender<()>,
    /// Token to cancel all active connection tasks
    cancel_token: CancellationToken,
}

impl PortForwardManager {
    pub fn new() -> Self {
        Self {
            forwards: DashMap::new(),
        }
    }

    /// Start a new port forward
    /// For remote systems: creates SSH tunnel
    /// For local systems: just registers the mapping (ports already accessible)
    pub async fn start_forward(
        &self,
        system_id: String,
        container_id: String,
        container_port: u16,
        local_port: Option<u16>,
        remote_host: String,
        remote_port: u16,
        protocol: String,
        is_local_system: bool,
    ) -> Result<PortForward, ContainerError> {
        // Check if this port is already forwarded - prevent duplicates
        if self.is_port_forwarded(&container_id, container_port) {
            return Err(ContainerError::Internal(format!(
                "Port {} is already forwarded for container {}",
                container_port, container_id
            )));
        }

        // For local systems, no tunnel needed - just track the mapping
        if is_local_system {
            let forward = PortForward::new(
                system_id,
                container_id,
                container_port,
                remote_port, // Use the host port directly
                remote_host,
                remote_port,
                protocol,
            );

            let (shutdown_tx, _) = broadcast::channel(1);
            let cancel_token = CancellationToken::new();
            self.forwards.insert(
                forward.id.clone(),
                PortForwardEntry {
                    forward: forward.clone(),
                    shutdown_tx,
                    cancel_token,
                },
            );

            return Ok(forward);
        }

        // For remote systems, create actual TCP tunnel
        let listener = if let Some(port) = local_port {
            // Try requested port, then increment up to 20 times if taken
            let mut bound = None;
            for offset in 0..20u16 {
                let try_port = port.saturating_add(offset);
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
                    Err(_) if offset < 19 => continue,
                    Err(e) => {
                        return Err(ContainerError::Internal(format!(
                            "Failed to bind to ports {}-{}: {}",
                            port, try_port, e
                        )));
                    }
                }
            }
            bound.unwrap()
        } else {
            // Auto-assign port
            TcpListener::bind("127.0.0.1:0")
                .await
                .map_err(|e| ContainerError::Internal(format!("Failed to bind to port: {}", e)))?
        };

        let actual_local_port = listener
            .local_addr()
            .map_err(|e| ContainerError::Internal(format!("Failed to get local address: {}", e)))?
            .port();

        let forward = PortForward::new(
            system_id.clone(),
            container_id,
            container_port,
            actual_local_port,
            remote_host.clone(),
            remote_port,
            protocol,
        );

        let (shutdown_tx, _) = broadcast::channel(1);
        let shutdown_rx = shutdown_tx.subscribe();
        let cancel_token = CancellationToken::new();

        // Store the forward
        self.forwards.insert(
            forward.id.clone(),
            PortForwardEntry {
                forward: forward.clone(),
                shutdown_tx,
                cancel_token: cancel_token.clone(),
            },
        );

        // Spawn the listener task
        let forward_id = forward.id.clone();
        let forwards = self.forwards.clone();

        tokio::spawn(async move {
            Self::run_listener(
                listener,
                system_id,
                remote_host,
                remote_port,
                forward_id.clone(),
                shutdown_rx,
                cancel_token,
            )
            .await;

            // Update status when listener stops
            if let Some(mut entry) = forwards.get_mut(&forward_id) {
                entry.forward.status = PortForwardStatus::Stopped;
            }
        });

        Ok(forward)
    }

    /// Run the TCP listener and handle incoming connections
    async fn run_listener(
        listener: TcpListener,
        system_id: String,
        remote_host: String,
        remote_port: u16,
        forward_id: String,
        mut shutdown_rx: broadcast::Receiver<()>,
        cancel_token: CancellationToken,
    ) {
        tracing::info!(
            "Port forward {} listening on {}",
            forward_id,
            listener.local_addr().unwrap()
        );

        loop {
            tokio::select! {
                result = listener.accept() => {
                    match result {
                        Ok((socket, addr)) => {
                            tracing::debug!("Accepted connection from {} for forward {}", addr, forward_id);

                            let system_id = system_id.clone();
                            let remote_host = remote_host.clone();
                            let token = cancel_token.clone();

                            // Spawn a task to handle this connection
                            tokio::spawn(async move {
                                if let Err(e) = Self::handle_connection(
                                    socket,
                                    &system_id,
                                    &remote_host,
                                    remote_port,
                                    token,
                                ).await {
                                    tracing::error!("Connection handler error: {}", e);
                                }
                            });
                        }
                        Err(e) => {
                            tracing::error!("Accept error: {}", e);
                        }
                    }
                }
                _ = shutdown_rx.recv() => {
                    tracing::info!("Port forward {} shutting down", forward_id);
                    break;
                }
            }
        }
    }

    /// Handle a single incoming connection by forwarding through SSH
    async fn handle_connection(
        mut local_socket: tokio::net::TcpStream,
        system_id: &str,
        remote_host: &str,
        remote_port: u16,
        cancel_token: CancellationToken,
    ) -> Result<(), ContainerError> {
        use russh::ChannelMsg;
        use std::time::Duration;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::time::timeout;

        tracing::debug!(
            "[PORT_FWD] Handling connection to {}:{} via system {}",
            remote_host,
            remote_port,
            system_id
        );

        // Get client Arc WITHOUT holding pool lock during channel operations
        let client_arc = {
            let pool = super::get_pool();
            let pool_guard = pool.read().await;
            tracing::debug!("[PORT_FWD] Got pool lock");

            pool_guard.get_client(system_id).ok_or_else(|| {
                tracing::error!("[PORT_FWD] System not found: {}", system_id);
                ContainerError::SystemNotFound(system_id.to_string())
            })?
        }; // pool_guard dropped here - no deadlock risk!

        tracing::debug!("[PORT_FWD] Pool lock released, acquiring client lock");
        let client = client_arc.lock().await;
        tracing::debug!(
            "[PORT_FWD] Got client lock, opening direct-tcpip channel to {}:{}",
            remote_host,
            remote_port
        );

        // Open direct-tcpip channel WITH TIMEOUT
        // This is equivalent to: ssh -L local_port:remote_host:remote_port
        let mut channel = timeout(
            Duration::from_secs(10),
            client.session.channel_open_direct_tcpip(
                remote_host,
                remote_port as u32,
                "127.0.0.1", // originator address
                0,           // originator port (0 = ephemeral)
            ),
        )
        .await
        .map_err(|_| {
            tracing::error!(
                "[PORT_FWD] Timeout opening tunnel to {}:{}",
                remote_host,
                remote_port
            );
            ContainerError::NetworkTimeout(format!(
                "Timeout opening SSH tunnel to {}:{}",
                remote_host, remote_port
            ))
        })?
        .map_err(|e| {
            tracing::error!("[PORT_FWD] Failed to open direct-tcpip: {}", e);
            ContainerError::Internal(format!("Failed to open direct-tcpip channel: {}", e))
        })?;

        // Release client lock - channel is independent now
        drop(client);
        tracing::debug!("[PORT_FWD] Channel opened, starting data relay");

        // Split TCP socket for concurrent read/write
        let (mut tcp_reader, mut tcp_writer) = local_socket.split();

        // Manual bidirectional relay loop - avoids copy_bidirectional hanging issues
        let mut tcp_buf = vec![0u8; 8192];
        let mut bytes_from_client: u64 = 0;
        let mut bytes_from_server: u64 = 0;

        loop {
            tokio::select! {
                // Check for cancellation (port forward stopped)
                _ = cancel_token.cancelled() => {
                    tracing::debug!("[PORT_FWD] Connection cancelled by stop request");
                    // Close SSH channel gracefully
                    let _ = channel.eof().await;
                    break;
                }

                // Read from TCP socket (browser), write to SSH channel
                result = tcp_reader.read(&mut tcp_buf) => {
                    match result {
                        Ok(0) => {
                            // TCP client closed connection
                            tracing::debug!("[PORT_FWD] TCP client closed connection");
                            // Send EOF to SSH channel
                            let _ = channel.eof().await;
                            break;
                        }
                        Ok(n) => {
                            bytes_from_client += n as u64;
                            tracing::trace!("[PORT_FWD] TCP -> SSH: {} bytes", n);
                            if let Err(e) = channel.data(&tcp_buf[..n]).await {
                                tracing::error!("[PORT_FWD] Failed to send to SSH channel: {}", e);
                                break;
                            }
                        }
                        Err(e) => {
                            tracing::error!("[PORT_FWD] TCP read error: {}", e);
                            break;
                        }
                    }
                }

                // Read from SSH channel (remote server), write to TCP socket
                msg = channel.wait() => {
                    match msg {
                        Some(ChannelMsg::Data { data }) => {
                            bytes_from_server += data.len() as u64;
                            tracing::trace!("[PORT_FWD] SSH -> TCP: {} bytes", data.len());
                            if let Err(e) = tcp_writer.write_all(&data).await {
                                tracing::error!("[PORT_FWD] TCP write error: {}", e);
                                break;
                            }
                        }
                        Some(ChannelMsg::Eof) => {
                            tracing::debug!("[PORT_FWD] SSH channel received EOF");
                            // Shutdown TCP write side
                            let _ = tcp_writer.shutdown().await;
                            break;
                        }
                        Some(ChannelMsg::Close) => {
                            tracing::debug!("[PORT_FWD] SSH channel closed");
                            break;
                        }
                        Some(ChannelMsg::ExitStatus { exit_status }) => {
                            tracing::debug!("[PORT_FWD] SSH channel exit status: {}", exit_status);
                            break;
                        }
                        None => {
                            tracing::debug!("[PORT_FWD] SSH channel ended");
                            break;
                        }
                        _ => {
                            // Ignore other messages (WindowAdjust, etc.)
                        }
                    }
                }
            }
        }

        tracing::debug!(
            "[PORT_FWD] Connection completed: {} bytes from client, {} bytes from server",
            bytes_from_client,
            bytes_from_server
        );

        Ok(())
    }

    /// Stop a port forward
    pub fn stop_forward(&self, forward_id: &str) -> Result<(), ContainerError> {
        if let Some((_, entry)) = self.forwards.remove(forward_id) {
            // Cancel all active connection tasks FIRST
            // This causes all handle_connection() tasks to break out of their relay loops
            entry.cancel_token.cancel();

            // Then signal listener shutdown (to stop accepting new connections)
            match entry.shutdown_tx.send(()) {
                Ok(num_receivers) => {
                    tracing::info!(
                        "Stopped port forward {} (notified {} receivers, cancelled all connections)",
                        forward_id,
                        num_receivers
                    );
                }
                Err(_) => {
                    // No receivers - listener task may have already stopped
                    tracing::warn!(
                        "Port forward {} cancelled connections, but listener already stopped",
                        forward_id
                    );
                }
            }
            Ok(())
        } else {
            Err(ContainerError::Internal(format!(
                "Port forward {} not found",
                forward_id
            )))
        }
    }

    /// List all active port forwards
    pub fn list_forwards(&self, system_id: Option<&str>, container_id: Option<&str>) -> Vec<PortForward> {
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

    /// Get a specific port forward
    pub fn get_forward(&self, forward_id: &str) -> Option<PortForward> {
        self.forwards.get(forward_id).map(|e| e.forward.clone())
    }

    /// Check if a port is already forwarded for a container
    pub fn is_port_forwarded(&self, container_id: &str, container_port: u16) -> bool {
        self.forwards.iter().any(|entry| {
            entry.forward.container_id == container_id
                && entry.forward.container_port == container_port
                && entry.forward.status == PortForwardStatus::Active
        })
    }

    /// Clean up forwards for a disconnected system
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

impl Default for PortForwardManager {
    fn default() -> Self {
        Self::new()
    }
}

// Make forwards DashMap cloneable for spawned tasks
impl Clone for PortForwardManager {
    fn clone(&self) -> Self {
        // Note: This creates a new manager, not a shared reference
        // In practice, we use Arc<PortForwardManager> for sharing
        Self {
            forwards: DashMap::new(),
        }
    }
}
