use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use dashmap::DashMap;
use sqlx::PgPool;
use tokio::sync::Mutex;
use uuid::Uuid;

use containerus_core::executor::CommandResult;
use containerus_core::models::container::ContainerRuntime;
use containerus_core::models::credentials::JumpHostCredentials;
use containerus_core::models::error::ContainerError;
use containerus_core::models::system::{
    ConnectionType, ContainerSystem, SshAuthMethod, SshConfig, SystemId,
};
use containerus_core::ssh::SshClient;

use crate::db::models::SystemRow;
use crate::vault::ServerVault;

/// Composite key for per-user, per-system SSH connections.
#[derive(Debug, Clone, Copy, Hash, Eq, PartialEq)]
struct ConnectionKey {
    user_id: Uuid,
    system_id: Uuid,
}

/// Metadata stored alongside each SSH connection.
struct ConnectionEntry {
    client: Arc<Mutex<SshClient>>,
}

/// Server-side connection manager with two tiers of SSH connections:
///
/// - **Shared connections** (one per system): Used for API queries that return
///   the same data for all users — container listings, images, volumes, networks,
///   system info, and metrics. Keyed by `system_id` only.
///
/// - **Per-user connections** (one per user per system): Used for operations that
///   need user isolation — terminal PTY sessions, port-forward tunnels, and file
///   operations. Keyed by `(user_id, system_id)`.
#[derive(Clone)]
pub struct ConnectionManager {
    /// Per-user connections for terminal, tunnel, and file operations.
    user_connections: Arc<DashMap<ConnectionKey, ConnectionEntry>>,
    /// Shared system connections for API queries (containers, images, etc.).
    shared_connections: Arc<DashMap<Uuid, ConnectionEntry>>,
    vault: ServerVault,
}

impl ConnectionManager {
    pub fn new(vault: ServerVault) -> Self {
        Self {
            user_connections: Arc::new(DashMap::new()),
            shared_connections: Arc::new(DashMap::new()),
            vault,
        }
    }

    // ========================================================================
    // SSH client creation (shared logic)
    // ========================================================================

    /// Fetch credentials from the vault and create an SSH client for the given system.
    async fn create_ssh_client(
        &self,
        db: &PgPool,
        system: &SystemRow,
    ) -> Result<SshClient, ContainerError> {
        let password = self
            .vault
            .get_credential(db, system.id, "password", None)
            .await
            .map_err(|e| ContainerError::CredentialError(e.to_string()))?;

        let passphrase = self
            .vault
            .get_credential(db, system.id, "passphrase", None)
            .await
            .map_err(|e| ContainerError::CredentialError(e.to_string()))?;

        let private_key = self
            .vault
            .get_credential(db, system.id, "private_key", None)
            .await
            .map_err(|e| ContainerError::CredentialError(e.to_string()))?;

        let container_system = system_row_to_container_system(system);

        // TODO: fetch jump host creds from vault when jump host support is needed
        let jump_host_creds: HashMap<String, JumpHostCredentials> = HashMap::new();

        let client = if let Some(ssh_config) = &container_system.ssh_config {
            if let Some(ref jump_hosts) = ssh_config.proxy_jump {
                if !jump_hosts.is_empty() {
                    tracing::info!(
                        "Connecting via ProxyJump ({} hop(s)) to system {}",
                        jump_hosts.len(),
                        system.id
                    );
                    SshClient::connect_via_jump(
                        &container_system,
                        jump_hosts,
                        password.as_deref(),
                        passphrase.as_deref(),
                        private_key.as_deref(),
                        &jump_host_creds,
                    )
                    .await?
                } else {
                    SshClient::connect(
                        &container_system,
                        password.as_deref(),
                        passphrase.as_deref(),
                        private_key.as_deref(),
                    )
                    .await?
                }
            } else if let Some(ref proxy_command) = ssh_config.proxy_command {
                tracing::info!(
                    "Connecting via ProxyCommand to system {}",
                    system.id
                );
                SshClient::connect_via_proxy_command(
                    &container_system,
                    proxy_command,
                    password.as_deref(),
                    passphrase.as_deref(),
                    private_key.as_deref(),
                )
                .await?
            } else {
                SshClient::connect(
                    &container_system,
                    password.as_deref(),
                    passphrase.as_deref(),
                    private_key.as_deref(),
                )
                .await?
            }
        } else {
            SshClient::connect(
                &container_system,
                password.as_deref(),
                passphrase.as_deref(),
                private_key.as_deref(),
            )
            .await?
        };

        Ok(client)
    }

    // ========================================================================
    // Shared connections (one per system — for API queries)
    // ========================================================================

    /// Connect to a system using the shared connection, reusing if it already exists.
    pub async fn connect_shared(
        &self,
        db: &PgPool,
        system: &SystemRow,
    ) -> Result<(), ContainerError> {
        // Fast path: already connected
        if self.shared_connections.contains_key(&system.id) {
            return Ok(());
        }

        let client = self.create_ssh_client(db, system).await?;

        // Atomic check-and-insert to avoid race conditions
        match self.shared_connections.entry(system.id) {
            dashmap::mapref::entry::Entry::Occupied(_) => {
                // Another task connected while we were creating the client
                tracing::debug!("Discarding duplicate shared connection for system {}", system.id);
                return Ok(());
            }
            dashmap::mapref::entry::Entry::Vacant(entry) => {
                entry.insert(ConnectionEntry {
                    client: Arc::new(Mutex::new(client)),
                });
            }
        }

        tracing::info!(
            "Shared connection established to system {} ({})",
            system.name,
            system.id
        );

        Ok(())
    }

    /// Execute a command on the shared system connection.
    pub async fn execute_shared(
        &self,
        system_id: Uuid,
        command: &str,
    ) -> Result<CommandResult, ContainerError> {
        let entry = self
            .shared_connections
            .get(&system_id)
            .ok_or_else(|| {
                ContainerError::NotConnected(format!("system {system_id} (shared)"))
            })?;
        let client = entry.client.clone();
        drop(entry);

        let mut guard = client.lock().await;
        guard.execute(command).await
    }

    /// Check if a shared connection exists for a system.
    pub fn is_shared_connected(&self, system_id: Uuid) -> bool {
        self.shared_connections.contains_key(&system_id)
    }

    /// Drop the shared connection for a system.
    pub fn disconnect_shared(&self, system_id: Uuid) {
        if self.shared_connections.remove(&system_id).is_some() {
            tracing::info!("Disconnected shared connection for system {}", system_id);
        }
    }

    // ========================================================================
    // Per-user connections (for terminal, tunnel, file operations)
    // ========================================================================

    /// Connect a specific user to a system, reusing an existing connection if alive.
    pub async fn connect(
        &self,
        db: &PgPool,
        user_id: Uuid,
        system: &SystemRow,
    ) -> Result<(), ContainerError> {
        let key = ConnectionKey {
            user_id,
            system_id: system.id,
        };

        // Fast path: already connected
        if self.user_connections.contains_key(&key) {
            return Ok(());
        }

        let client = self.create_ssh_client(db, system).await?;

        // Atomic check-and-insert to avoid race conditions
        match self.user_connections.entry(key) {
            dashmap::mapref::entry::Entry::Occupied(_) => {
                // Another task connected while we were creating the client
                tracing::debug!("Discarding duplicate connection for user {} / system {}", user_id, system.id);
                return Ok(());
            }
            dashmap::mapref::entry::Entry::Vacant(entry) => {
                entry.insert(ConnectionEntry {
                    client: Arc::new(Mutex::new(client)),
                });
            }
        }

        tracing::info!(
            "User {} connected to system {} ({})",
            user_id,
            system.name,
            system.id
        );

        Ok(())
    }

    /// Execute a command on behalf of a specific user.
    pub async fn execute(
        &self,
        user_id: Uuid,
        system_id: Uuid,
        command: &str,
    ) -> Result<CommandResult, ContainerError> {
        let key = ConnectionKey {
            user_id,
            system_id,
        };

        let entry = self
            .user_connections
            .get(&key)
            .ok_or_else(|| {
                ContainerError::NotConnected(format!(
                    "user {user_id}, system {system_id}"
                ))
            })?;
        let client = entry.client.clone();
        drop(entry);

        let mut guard = client.lock().await;
        guard.execute(command).await
    }

    /// Check if a specific user is connected to a system.
    pub fn is_connected(&self, user_id: Uuid, system_id: Uuid) -> bool {
        self.user_connections.contains_key(&ConnectionKey {
            user_id,
            system_id,
        })
    }

    /// Check if a system has ANY connection (shared or per-user) — for status display.
    pub fn is_system_connected(&self, system_id: Uuid) -> bool {
        self.shared_connections.contains_key(&system_id)
            || self
                .user_connections
                .iter()
                .any(|entry| entry.key().system_id == system_id)
    }

    /// Get the SSH client for a specific user's connection (for terminal/tunnel sessions).
    pub fn get_client(
        &self,
        user_id: Uuid,
        system_id: Uuid,
    ) -> Option<Arc<Mutex<SshClient>>> {
        self.user_connections
            .get(&ConnectionKey {
                user_id,
                system_id,
            })
            .map(|entry| entry.client.clone())
    }

    /// Disconnect a specific user from a system.
    pub async fn disconnect_user(
        &self,
        user_id: Uuid,
        system_id: Uuid,
    ) -> Result<(), ContainerError> {
        let key = ConnectionKey {
            user_id,
            system_id,
        };
        if self.user_connections.remove(&key).is_some() {
            tracing::info!(
                "Disconnected user {} from system {}",
                user_id,
                system_id
            );
        }
        Ok(())
    }

    /// Disconnect ALL connections (shared + per-user) from a system.
    pub async fn disconnect_system(&self, system_id: Uuid) -> Result<(), ContainerError> {
        self.shared_connections.remove(&system_id);
        self.user_connections
            .retain(|key, _| key.system_id != system_id);
        tracing::info!("Disconnected all connections from system {}", system_id);
        Ok(())
    }

    /// Disconnect all per-user connections for a user (e.g., on logout).
    pub async fn disconnect_all_for_user(&self, user_id: Uuid) -> Result<(), ContainerError> {
        self.user_connections
            .retain(|key, _| key.user_id != user_id);
        tracing::info!("Disconnected all connections for user {}", user_id);
        Ok(())
    }

    /// Get the total number of active connections (shared + per-user).
    pub fn total_connections(&self) -> usize {
        self.shared_connections.len() + self.user_connections.len()
    }

    /// Remove connections that have been idle longer than `max_idle`.
    pub async fn cleanup_idle(&self, max_idle: Duration) {
        let now = Instant::now();
        let mut removed = 0usize;

        // Clean up idle shared connections
        let mut shared_to_remove = Vec::new();
        for entry in self.shared_connections.iter() {
            let client = entry.value().client.lock().await;
            if now.duration_since(client.last_used()) > max_idle {
                shared_to_remove.push(*entry.key());
            }
        }
        for key in &shared_to_remove {
            self.shared_connections.remove(key);
            tracing::info!(
                "Removed idle shared connection for system {} (idle > {:?})",
                key,
                max_idle
            );
        }
        removed += shared_to_remove.len();

        // Clean up idle per-user connections
        let mut user_to_remove = Vec::new();
        for entry in self.user_connections.iter() {
            let client = entry.value().client.lock().await;
            if now.duration_since(client.last_used()) > max_idle {
                user_to_remove.push(*entry.key());
            }
        }
        for key in &user_to_remove {
            self.user_connections.remove(key);
            tracing::info!(
                "Removed idle connection for user {} / system {} (idle > {:?})",
                key.user_id,
                key.system_id,
                max_idle
            );
        }
        removed += user_to_remove.len();

        if removed > 0 {
            tracing::info!(
                "Cleaned up {} idle connection(s), {} remaining",
                removed,
                self.total_connections()
            );
        }
    }
}

/// Convert a database SystemRow to the core ContainerSystem model.
pub fn system_row_to_container_system(row: &SystemRow) -> ContainerSystem {
    let runtime = match row.primary_runtime.as_str() {
        "docker" => ContainerRuntime::Docker,
        "podman" => ContainerRuntime::Podman,
        "apple" => ContainerRuntime::Apple,
        _ => ContainerRuntime::Docker,
    };

    let available: std::collections::HashSet<ContainerRuntime> = row
        .available_runtimes
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .filter_map(|s| match s {
                    "docker" => Some(ContainerRuntime::Docker),
                    "podman" => Some(ContainerRuntime::Podman),
                    "apple" => Some(ContainerRuntime::Apple),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_else(|| [runtime].into_iter().collect());

    let auth_method = match row.auth_method.as_str() {
        "publicKey" => SshAuthMethod::PublicKey,
        _ => SshAuthMethod::Password,
    };

    ContainerSystem {
        id: SystemId(row.id.to_string()),
        name: row.name.clone(),
        hostname: row.hostname.clone(),
        connection_type: ConnectionType::Remote,
        primary_runtime: runtime,
        available_runtimes: available,
        ssh_config: Some(SshConfig {
            username: row.username.clone(),
            port: match u16::try_from(row.port) {
                Ok(p) => p,
                Err(_) => {
                    tracing::warn!(system_id = %row.id, invalid_port = row.port, "Invalid port value, defaulting to 22");
                    22
                }
            },
            auth_method,
            private_key_path: None,
            private_key_content: None,
            connection_timeout: 30,
            proxy_command: row
                .ssh_options
                .as_ref()
                .and_then(|o| o.get("proxy_command"))
                .and_then(|v| v.as_str())
                .map(String::from),
            proxy_jump: None, // TODO: parse from ssh_options
            ssh_config_host: None,
        }),
        auto_connect: false,
    }
}
