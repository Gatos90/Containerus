use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::models::container::ContainerRuntime;
use crate::models::system::SystemId;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Network {
    pub id: String,
    pub name: String,
    pub driver: String,
    pub scope: String,
    pub created_at: Option<DateTime<Utc>>,
    pub internal: bool,
    pub attachable: bool,
    pub labels: std::collections::HashMap<String, String>,
    pub runtime: ContainerRuntime,
    pub system_id: SystemId,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// Creates a sample `Network` populated with typical fields for tests.
    ///
    /// # Examples
    ///
    /// ```
    /// let net = make_network();
    /// assert_eq!(net.id, "net-abc123");
    /// assert_eq!(net.name, "my-network");
    /// assert_eq!(net.labels.get("env").map(String::as_str), Some("dev"));
    /// ```
    fn make_network() -> Network {
        Network {
            id: "net-abc123".to_string(),
            name: "my-network".to_string(),
            driver: "bridge".to_string(),
            scope: "local".to_string(),
            created_at: Some(chrono::Utc::now()),
            internal: false,
            attachable: true,
            labels: HashMap::from([("env".to_string(), "dev".to_string())]),
            runtime: ContainerRuntime::Docker,
            system_id: SystemId("sys-123".to_string()),
        }
    }

    /// Verifies that a `Network` serializes to JSON and deserializes back preserving core fields.
    ///
    /// # Examples
    ///
    /// ```
    /// let network = make_network();
    /// let json = serde_json::to_string(&network).unwrap();
    /// let deserialized: Network = serde_json::from_str(&json).unwrap();
    ///
    /// assert_eq!(deserialized.id, "net-abc123");
    /// assert_eq!(deserialized.name, "my-network");
    /// assert_eq!(deserialized.driver, "bridge");
    /// assert_eq!(deserialized.scope, "local");
    /// assert!(!deserialized.internal);
    /// assert!(deserialized.attachable);
    /// ```
    #[test]
    fn test_network_serialization_roundtrip() {
        let network = make_network();
        let json = serde_json::to_string(&network).unwrap();
        let deserialized: Network = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.id, "net-abc123");
        assert_eq!(deserialized.name, "my-network");
        assert_eq!(deserialized.driver, "bridge");
        assert_eq!(deserialized.scope, "local");
        assert!(!deserialized.internal);
        assert!(deserialized.attachable);
    }

    #[test]
    fn test_network_camel_case_serialization() {
        let network = make_network();
        let json = serde_json::to_string(&network).unwrap();

        assert!(json.contains("\"createdAt\""));
        assert!(json.contains("\"systemId\""));
        assert!(!json.contains("\"created_at\""));
        assert!(!json.contains("\"system_id\""));
    }

    #[test]
    fn test_network_internal_flag() {
        let mut network = make_network();
        network.internal = true;

        let json = serde_json::to_string(&network).unwrap();
        let deserialized: Network = serde_json::from_str(&json).unwrap();
        assert!(deserialized.internal);
    }

    /// Verifies that a `Network` with `created_at` set to `None` remains `None` after JSON round-trip.
    ///
    /// Serializes a `Network` where the `created_at` field is `None`, deserializes it, and asserts the
    /// deserialized value's `created_at` is still `None`.
    ///
    /// # Examples
    ///
    /// ```
    /// let mut network = make_network();
    /// network.created_at = None;
    /// let json = serde_json::to_string(&network).unwrap();
    /// let deserialized: Network = serde_json::from_str(&json).unwrap();
    /// assert!(deserialized.created_at.is_none());
    /// ```
    #[test]
    fn test_network_with_no_created_at() {
        let mut network = make_network();
        network.created_at = None;

        let json = serde_json::to_string(&network).unwrap();
        let deserialized: Network = serde_json::from_str(&json).unwrap();
        assert!(deserialized.created_at.is_none());
    }

    #[test]
    fn test_network_with_labels() {
        let mut network = make_network();
        network.labels.insert("team".to_string(), "backend".to_string());

        let json = serde_json::to_string(&network).unwrap();
        let deserialized: Network = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.labels.get("team").unwrap(), "backend");
    }

    #[test]
    fn test_network_clone() {
        let network = make_network();
        let cloned = network.clone();
        assert_eq!(cloned.id, network.id);
        assert_eq!(cloned.name, network.name);
    }

    #[test]
    fn test_network_debug() {
        let network = make_network();
        let debug = format!("{:?}", network);
        assert!(debug.contains("my-network"));
    }

    #[test]
    fn test_network_different_drivers() {
        for driver in &["bridge", "host", "overlay", "macvlan"] {
            let mut network = make_network();
            network.driver = driver.to_string();

            let json = serde_json::to_string(&network).unwrap();
            let deserialized: Network = serde_json::from_str(&json).unwrap();
            assert_eq!(deserialized.driver, *driver);
        }
    }

    #[test]
    fn test_network_different_scopes() {
        for scope in &["local", "global", "swarm"] {
            let mut network = make_network();
            network.scope = scope.to_string();

            let json = serde_json::to_string(&network).unwrap();
            let deserialized: Network = serde_json::from_str(&json).unwrap();
            assert_eq!(deserialized.scope, *scope);
        }
    }
}