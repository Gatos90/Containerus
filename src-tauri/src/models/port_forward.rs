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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_port_forward_new() {
        let pf = PortForward::new(
            "sys-1".to_string(),
            "container-1".to_string(),
            80,
            8080,
            "127.0.0.1".to_string(),
            80,
            "tcp".to_string(),
        );

        assert!(!pf.id.is_empty());
        assert_eq!(pf.system_id, "sys-1");
        assert_eq!(pf.container_id, "container-1");
        assert_eq!(pf.container_port, 80);
        assert_eq!(pf.local_port, 8080);
        assert_eq!(pf.remote_host, "127.0.0.1");
        assert_eq!(pf.remote_port, 80);
        assert_eq!(pf.protocol, "tcp");
        assert_eq!(pf.status, PortForwardStatus::Active);
        assert!(!pf.created_at.is_empty());
    }

    #[test]
    fn test_port_forward_unique_ids() {
        let pf1 = PortForward::new("s".into(), "c".into(), 80, 8080, "h".into(), 80, "tcp".into());
        let pf2 = PortForward::new("s".into(), "c".into(), 80, 8080, "h".into(), 80, "tcp".into());
        assert_ne!(pf1.id, pf2.id);
    }

    #[test]
    fn test_port_forward_status_serialization() {
        let json = serde_json::to_string(&PortForwardStatus::Active).unwrap();
        assert_eq!(json, "\"active\"");

        let json = serde_json::to_string(&PortForwardStatus::Stopped).unwrap();
        assert_eq!(json, "\"stopped\"");

        let json = serde_json::to_string(&PortForwardStatus::Error).unwrap();
        assert_eq!(json, "\"error\"");

        let status: PortForwardStatus = serde_json::from_str("\"active\"").unwrap();
        assert_eq!(status, PortForwardStatus::Active);
    }

    #[test]
    fn test_port_forward_serialization() {
        let pf = PortForward::new("s".into(), "c".into(), 80, 8080, "localhost".into(), 80, "tcp".into());
        let json = serde_json::to_string(&pf).unwrap();
        assert!(json.contains("localPort")); // camelCase
        assert!(json.contains("8080"));

        let deserialized: PortForward = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.local_port, 8080);
        assert_eq!(deserialized.container_port, 80);
    }
}
