use dashmap::DashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

use super::client::SshClient;
use crate::executor::CommandResult;
use crate::models::error::ContainerError;
use crate::models::system::ContainerSystem;

/// Configuration for the SSH connection pool
pub struct PoolConfig {
    /// How often to send keep-alive packets (default: 30 seconds)
    pub keep_alive_interval: Duration,
    /// Maximum idle time before disconnecting (default: 5 minutes)
    pub max_idle_time: Duration,
    /// Connection timeout (default: 30 seconds)
    pub connection_timeout: Duration,
}

impl Default for PoolConfig {
    fn default() -> Self {
        Self {
            keep_alive_interval: Duration::from_secs(30),
            max_idle_time: Duration::from_secs(300),
            connection_timeout: Duration::from_secs(30),
        }
    }
}

/// SSH connection pool managing multiple SSH connections
pub struct SshConnectionPool {
    connections: DashMap<String, Arc<Mutex<SshClient>>>,
    config: PoolConfig,
}

impl SshConnectionPool {
    pub fn new() -> Self {
        Self {
            connections: DashMap::new(),
            config: PoolConfig::default(),
        }
    }

    pub fn with_config(config: PoolConfig) -> Self {
        Self {
            connections: DashMap::new(),
            config,
        }
    }

    /// Connect to a system and add to the pool
    /// password: Optional password for authentication (used on mobile)
    /// passphrase: Optional passphrase for SSH key authentication (used on mobile)
    /// private_key_content: Optional PEM-encoded private key content (for mobile/imported keys)
    pub async fn connect(
        &mut self,
        system: &ContainerSystem,
        password: Option<&str>,
        passphrase: Option<&str>,
        private_key_content: Option<&str>,
    ) -> Result<(), ContainerError> {
        let system_id = system.id.0.clone();

        // Check if already connected
        if self.is_connected(&system_id) {
            tracing::debug!("Already connected to system {}", system_id);
            return Ok(());
        }

        // Create new connection - route through proxy methods if configured
        let client = if let Some(ssh_config) = &system.ssh_config {
            if let Some(ref jump_hosts) = ssh_config.proxy_jump {
                if !jump_hosts.is_empty() {
                    tracing::info!("Connecting via ProxyJump ({} hop(s)) for system {}", jump_hosts.len(), system_id);
                    SshClient::connect_via_jump(system, jump_hosts, password, passphrase, private_key_content).await?
                } else {
                    SshClient::connect(system, password, passphrase, private_key_content).await?
                }
            } else if let Some(ref proxy_command) = ssh_config.proxy_command {
                tracing::info!("Connecting via ProxyCommand for system {}", system_id);
                SshClient::connect_via_proxy_command(system, proxy_command, password, passphrase, private_key_content).await?
            } else {
                SshClient::connect(system, password, passphrase, private_key_content).await?
            }
        } else {
            SshClient::connect(system, password, passphrase, private_key_content).await?
        };

        self.connections
            .insert(system_id.clone(), Arc::new(Mutex::new(client)));

        tracing::info!("Added connection for system {} to pool", system_id);
        Ok(())
    }

    /// Disconnect from a system and remove from the pool
    pub async fn disconnect(&mut self, system_id: &str) -> Result<(), ContainerError> {
        if let Some((_, _client)) = self.connections.remove(system_id) {
            tracing::info!("Disconnected from system {}", system_id);
        }
        Ok(())
    }

    /// Check if connected to a system
    pub fn is_connected(&self, system_id: &str) -> bool {
        self.connections.contains_key(system_id)
    }

    /// Execute a command on a connected system
    pub async fn execute(
        &self,
        system_id: &str,
        command: &str,
    ) -> Result<CommandResult, ContainerError> {
        let client = self
            .connections
            .get(system_id)
            .ok_or_else(|| ContainerError::SystemNotFound(system_id.to_string()))?;

        let mut client_guard = client.lock().await;
        client_guard.execute(command).await
    }

    /// Validate a connection by running a simple command
    pub async fn validate_connection(&self, system_id: &str) -> Result<bool, ContainerError> {
        let client = self
            .connections
            .get(system_id)
            .ok_or_else(|| ContainerError::SystemNotFound(system_id.to_string()))?;

        let mut client_guard = client.lock().await;
        Ok(client_guard.is_alive().await)
    }

    /// Get the number of active connections
    pub fn connection_count(&self) -> usize {
        self.connections.len()
    }

    /// Get all connected system IDs
    pub fn connected_systems(&self) -> Vec<String> {
        self.connections
            .iter()
            .map(|entry| entry.key().clone())
            .collect()
    }

    /// Clean up idle connections
    pub async fn cleanup_idle_connections(&mut self) {
        let now = Instant::now();
        let max_idle = self.config.max_idle_time;

        let mut to_remove = Vec::new();

        for entry in self.connections.iter() {
            let client = entry.value().lock().await;
            if now.duration_since(client.last_used()) > max_idle {
                to_remove.push(entry.key().clone());
            }
        }

        for system_id in to_remove {
            self.connections.remove(&system_id);
            tracing::info!(
                "Removed idle connection for system {} (idle > {:?})",
                system_id,
                max_idle
            );
        }
    }

    /// Reconnect to a system if the connection is stale
    pub async fn ensure_connected(
        &mut self,
        system: &ContainerSystem,
        password: Option<&str>,
        passphrase: Option<&str>,
        private_key_content: Option<&str>,
    ) -> Result<(), ContainerError> {
        let system_id = &system.id.0;

        if let Some(client_ref) = self.connections.get(system_id) {
            let mut client = client_ref.lock().await;
            if client.is_alive().await {
                return Ok(());
            }
            // Connection is dead, remove it
            drop(client);
            self.connections.remove(system_id);
        }

        // Reconnect
        self.connect(system, password, passphrase, private_key_content).await
    }

    /// Get a reference to an SSH client by system ID
    /// Used for terminal sessions that need direct access to the client
    pub fn get_client(&self, system_id: &str) -> Option<Arc<Mutex<SshClient>>> {
        self.connections.get(system_id).map(|r| r.value().clone())
    }
}

impl Default for SshConnectionPool {
    fn default() -> Self {
        Self::new()
    }
}
