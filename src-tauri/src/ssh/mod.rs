pub mod client;
pub mod config;
pub mod known_hosts;
pub mod pool;
pub mod port_forward;

use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::executor::CommandResult;
use crate::keyring_store::JumpHostCredentials;
use crate::models::error::ContainerError;
use crate::models::system::ContainerSystem;

pub use client::SshClient;
pub use config::{has_ssh_config, list_hosts, list_hosts_multi, resolve_host, resolve_host_multi, resolve_jump_hosts, SshHostEntry};
pub use pool::SshConnectionPool;
pub use port_forward::PortForwardManager;

/// Global SSH connection pool
static SSH_POOL: Lazy<Arc<RwLock<SshConnectionPool>>> =
    Lazy::new(|| Arc::new(RwLock::new(SshConnectionPool::new())));

/// Get the global SSH connection pool
pub fn get_pool() -> Arc<RwLock<SshConnectionPool>> {
    SSH_POOL.clone()
}

/// Connect to a system via SSH
/// password: Optional password for authentication (used on mobile where keyring isn't available)
/// passphrase: Optional passphrase for SSH key authentication (used on mobile where keyring isn't available)
/// private_key_content: Optional PEM-encoded private key content (for mobile/imported keys)
/// jump_host_creds: Per-jump-host credentials keyed by "hostname:port"
pub async fn connect(
    system: &ContainerSystem,
    password: Option<&str>,
    passphrase: Option<&str>,
    private_key_content: Option<&str>,
    jump_host_creds: &HashMap<String, JumpHostCredentials>,
) -> Result<(), ContainerError> {
    let mut pool = SSH_POOL.write().await;
    pool.connect(system, password, passphrase, private_key_content, jump_host_creds).await
}

/// Disconnect from a system
pub async fn disconnect(system_id: &str) -> Result<(), ContainerError> {
    let mut pool = SSH_POOL.write().await;
    pool.disconnect(system_id).await
}

/// Check if connected to a system
pub async fn is_connected(system_id: &str) -> bool {
    let pool = SSH_POOL.read().await;
    pool.is_connected(system_id)
}

/// Execute a command on a remote system
pub async fn execute_on_system(
    system_id: &str,
    command: &str,
) -> Result<CommandResult, ContainerError> {
    let pool = SSH_POOL.read().await;
    pool.execute(system_id, command).await
}

/// Validate a connection by running a simple command
pub async fn validate_connection(system_id: &str) -> Result<bool, ContainerError> {
    let pool = SSH_POOL.read().await;
    pool.validate_connection(system_id).await
}
