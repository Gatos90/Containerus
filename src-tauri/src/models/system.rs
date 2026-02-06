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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::container::ContainerRuntime;

    #[test]
    fn test_system_id_creation() {
        let id = SystemId("test-123".to_string());
        assert_eq!(id.0, "test-123");
    }

    #[test]
    fn test_connection_type_serialization() {
        let json = serde_json::to_string(&ConnectionType::Local).unwrap();
        assert_eq!(json, "\"local\"");

        let json = serde_json::to_string(&ConnectionType::Remote).unwrap();
        assert_eq!(json, "\"remote\"");

        let ct: ConnectionType = serde_json::from_str("\"local\"").unwrap();
        assert_eq!(ct, ConnectionType::Local);
    }

    #[test]
    fn test_connection_state_serialization() {
        let json = serde_json::to_string(&ConnectionState::Connected).unwrap();
        assert_eq!(json, "\"connected\"");

        let state: ConnectionState = serde_json::from_str("\"disconnected\"").unwrap();
        assert_eq!(state, ConnectionState::Disconnected);
    }

    #[test]
    fn test_ssh_auth_method_serialization() {
        let json = serde_json::to_string(&SshAuthMethod::Password).unwrap();
        assert_eq!(json, "\"password\"");

        let method: SshAuthMethod = serde_json::from_str("\"publicKey\"").unwrap();
        assert_eq!(method, SshAuthMethod::PublicKey);
    }

    #[test]
    fn test_ssh_config_default() {
        let config = SshConfig::default();
        assert_eq!(config.username, "");
        assert_eq!(config.port, 22);
        assert_eq!(config.auth_method, SshAuthMethod::Password);
        assert!(config.private_key_path.is_none());
        assert!(config.private_key_content.is_none());
        assert_eq!(config.connection_timeout, 30);
        assert!(config.proxy_command.is_none());
        assert!(config.proxy_jump.is_none());
        assert!(config.ssh_config_host.is_none());
    }

    #[test]
    fn test_os_type_serialization() {
        let json = serde_json::to_string(&OsType::Linux).unwrap();
        assert_eq!(json, "\"linux\"");

        let json = serde_json::to_string(&OsType::Macos).unwrap();
        assert_eq!(json, "\"macos\"");

        let os: OsType = serde_json::from_str("\"windows\"").unwrap();
        assert_eq!(os, OsType::Windows);
    }

    #[test]
    fn test_container_system_serialization() {
        let system = ContainerSystem {
            id: SystemId("sys-1".to_string()),
            name: "My Server".to_string(),
            hostname: "192.168.1.100".to_string(),
            connection_type: ConnectionType::Remote,
            primary_runtime: ContainerRuntime::Docker,
            available_runtimes: HashSet::from([ContainerRuntime::Docker, ContainerRuntime::Podman]),
            ssh_config: Some(SshConfig {
                username: "admin".to_string(),
                port: 2222,
                ..SshConfig::default()
            }),
            auto_connect: true,
        };

        let json = serde_json::to_string(&system).unwrap();
        assert!(json.contains("My Server"));
        assert!(json.contains("192.168.1.100"));

        let deserialized: ContainerSystem = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.name, "My Server");
        assert_eq!(deserialized.hostname, "192.168.1.100");
        assert!(deserialized.auto_connect);
        assert!(deserialized.available_runtimes.contains(&ContainerRuntime::Docker));
    }

    #[test]
    fn test_jump_host_serialization() {
        let jump = JumpHost {
            hostname: "bastion.example.com".to_string(),
            port: 22,
            username: "jump-user".to_string(),
            identity_file: Some("/home/user/.ssh/id_rsa".to_string()),
        };

        let json = serde_json::to_string(&jump).unwrap();
        assert!(json.contains("bastion.example.com"));

        let deserialized: JumpHost = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.hostname, "bastion.example.com");
        assert_eq!(deserialized.username, "jump-user");
    }

    #[test]
    fn test_live_system_metrics_serialization() {
        let metrics = LiveSystemMetrics {
            system_id: "sys-1".to_string(),
            timestamp: 1700000000000,
            cpu_usage_percent: 45.5,
            memory_usage_percent: 72.3,
            memory_used: Some("8.5G".to_string()),
            memory_total: Some("16G".to_string()),
            load_average: Some([1.5, 2.0, 1.8]),
            swap_usage_percent: Some(10.0),
        };

        let json = serde_json::to_string(&metrics).unwrap();
        let deserialized: LiveSystemMetrics = serde_json::from_str(&json).unwrap();
        assert!((deserialized.cpu_usage_percent - 45.5).abs() < f32::EPSILON);
        assert_eq!(deserialized.memory_used.as_deref(), Some("8.5G"));
    }
}
