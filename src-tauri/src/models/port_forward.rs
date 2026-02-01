use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Status of a port forward
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PortForwardStatus {
    Active,
    Stopped,
    Error,
}

/// Represents an active port forward/tunnel
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortForward {
    /// Unique identifier for this port forward
    pub id: String,
    /// System ID this forward belongs to
    pub system_id: String,
    /// Container ID being forwarded (optional, for tracking)
    pub container_id: String,
    /// Container port (for UI tracking/matching)
    pub container_port: u16,
    /// Local port to listen on
    pub local_port: u16,
    /// Remote host to forward to (container IP or 0.0.0.0)
    pub remote_host: String,
    /// Remote port to forward to (host port for SSH tunnel)
    pub remote_port: u16,
    /// Protocol (tcp/udp)
    pub protocol: String,
    /// Current status
    pub status: PortForwardStatus,
    /// When this forward was created
    pub created_at: String,
}

impl PortForward {
    /// Create a new port forward entry
    pub fn new(
        system_id: String,
        container_id: String,
        container_port: u16,
        local_port: u16,
        remote_host: String,
        remote_port: u16,
        protocol: String,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            system_id,
            container_id,
            container_port,
            local_port,
            remote_host,
            remote_port,
            protocol,
            status: PortForwardStatus::Active,
            created_at: chrono::Utc::now().to_rfc3339(),
        }
    }
}

/// Request to create a new port forward
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePortForwardRequest {
    pub system_id: String,
    pub container_id: String,
    /// Container port (for tracking/display purposes)
    pub container_port: u16,
    /// Host port on the remote machine (the port Docker listens on)
    pub host_port: u16,
    pub local_port: Option<u16>,
    pub protocol: Option<String>,
    /// Remote host - defaults to container IP or localhost
    pub remote_host: Option<String>,
}
