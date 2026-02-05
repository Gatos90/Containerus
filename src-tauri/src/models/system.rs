use serde::{Deserialize, Serialize};
use std::collections::HashSet;

use crate::models::container::ContainerRuntime;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct SystemId(pub String);

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionType {
    Local,
    Remote,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Connected,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SshAuthMethod {
    Password,
    PublicKey,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfig {
    pub username: String,
    pub port: u16,
    pub auth_method: SshAuthMethod,
    pub private_key_path: Option<String>,
    /// PEM-encoded private key content (for mobile/imported keys)
    pub private_key_content: Option<String>,
    pub connection_timeout: u64,
    /// ProxyCommand for tunneling through an external command
    #[serde(default)]
    pub proxy_command: Option<String>,
    /// ProxyJump hosts for multi-hop SSH connections
    #[serde(default)]
    pub proxy_jump: Option<Vec<JumpHost>>,
    /// Reference to the original SSH config host name (if imported from ~/.ssh/config)
    #[serde(default)]
    pub ssh_config_host: Option<String>,
}

/// Configuration for a jump host in a ProxyJump chain
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpHost {
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub identity_file: Option<String>,
}

impl Default for SshConfig {
    fn default() -> Self {
        Self {
            username: String::new(),
            port: 22,
            auth_method: SshAuthMethod::Password,
            private_key_path: None,
            private_key_content: None,
            connection_timeout: 30,
            proxy_command: None,
            proxy_jump: None,
            ssh_config_host: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerSystem {
    pub id: SystemId,
    pub name: String,
    pub hostname: String,
    pub connection_type: ConnectionType,
    pub primary_runtime: ContainerRuntime,
    pub available_runtimes: HashSet<ContainerRuntime>,
    pub ssh_config: Option<SshConfig>,
    pub auto_connect: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemHealth {
    pub is_healthy: bool,
    pub container_count: i32,
    pub running_count: i32,
    pub stopped_count: i32,
    pub last_checked: chrono::DateTime<chrono::Utc>,
    pub response_time_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfo {
    pub os: String,
    pub architecture: String,
    pub runtime_version: String,
    pub kernel_version: Option<String>,
}

/// OS type for the connected system
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum OsType {
    Linux,
    Macos,
    Windows,
    Unknown,
}

/// Live system metrics (CPU, memory, load) for real-time monitoring
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSystemMetrics {
    /// System ID this metrics belong to
    pub system_id: String,
    /// Unix timestamp in milliseconds
    pub timestamp: i64,
    /// Current CPU usage percentage (0-100)
    pub cpu_usage_percent: f32,
    /// Current memory usage percentage (0-100)
    pub memory_usage_percent: f32,
    /// Memory currently used (e.g., "8.5G")
    pub memory_used: Option<String>,
    /// Total memory (e.g., "16G")
    pub memory_total: Option<String>,
    /// Load average: 1m, 5m, 15m (Unix only)
    pub load_average: Option<[f32; 3]>,
    /// Swap usage percentage (0-100)
    pub swap_usage_percent: Option<f32>,
}

/// Extended system information with user permissions and hardware stats
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtendedSystemInfo {
    /// SSH username or local user
    pub username: String,
    /// Is the user root/admin?
    pub is_root: bool,
    /// Can the user sudo/elevate without password?
    pub can_sudo: bool,
    /// Operating system type
    pub os_type: OsType,
    /// Linux distribution or OS version (e.g., "Ubuntu 22.04", "macOS 15.0", "Windows 11")
    pub distro: Option<String>,
    /// System hostname
    pub hostname: Option<String>,
    /// Number of CPU cores
    pub cpu_count: Option<u32>,
    /// Total memory (formatted string, e.g., "16GB")
    pub total_memory: Option<String>,
    /// Disk usage percentage
    pub disk_usage_percent: Option<u8>,
    /// System uptime (formatted string, e.g., "5 days, 3 hours")
    pub uptime: Option<String>,
    /// Number of running containers
    pub running_containers: Option<u32>,
    /// Total number of containers
    pub total_containers: Option<u32>,
    /// Total number of images
    pub total_images: Option<u32>,
    /// Container runtime version (e.g., "Docker 24.0.5")
    pub runtime_version: Option<String>,
}
