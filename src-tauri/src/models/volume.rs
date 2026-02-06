use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::models::container::ContainerRuntime;
use crate::models::system::SystemId;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Volume {
    pub name: String,
    pub driver: String,
    pub mountpoint: String,
    pub created_at: Option<DateTime<Utc>>,
    pub labels: std::collections::HashMap<String, String>,
    pub options: std::collections::HashMap<String, String>,
    pub runtime: ContainerRuntime,
    pub system_id: SystemId,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn make_volume() -> Volume {
        Volume {
            name: "my-volume".to_string(),
            driver: "local".to_string(),
            mountpoint: "/var/lib/docker/volumes/my-volume/_data".to_string(),
            created_at: Some(chrono::Utc::now()),
            labels: HashMap::from([("env".to_string(), "prod".to_string())]),
            options: HashMap::new(),
            runtime: ContainerRuntime::Docker,
            system_id: SystemId("sys-123".to_string()),
        }
    }

    #[test]
    fn test_volume_serialization_roundtrip() {
        let volume = make_volume();
        let json = serde_json::to_string(&volume).unwrap();
        let deserialized: Volume = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.name, "my-volume");
        assert_eq!(deserialized.driver, "local");
        assert_eq!(deserialized.runtime, ContainerRuntime::Docker);
        assert_eq!(deserialized.system_id, SystemId("sys-123".to_string()));
    }

    #[test]
    fn test_volume_camel_case_serialization() {
        let volume = make_volume();
        let json = serde_json::to_string(&volume).unwrap();

        assert!(json.contains("\"createdAt\""));
        assert!(json.contains("\"systemId\""));
        assert!(!json.contains("\"created_at\""));
        assert!(!json.contains("\"system_id\""));
    }

    #[test]
    fn test_volume_with_no_created_at() {
        let mut volume = make_volume();
        volume.created_at = None;

        let json = serde_json::to_string(&volume).unwrap();
        let deserialized: Volume = serde_json::from_str(&json).unwrap();

        assert!(deserialized.created_at.is_none());
    }

    #[test]
    fn test_volume_with_labels_and_options() {
        let mut volume = make_volume();
        volume.labels.insert("app".to_string(), "web".to_string());
        volume.options.insert("type".to_string(), "nfs".to_string());

        let json = serde_json::to_string(&volume).unwrap();
        let deserialized: Volume = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.labels.get("app").unwrap(), "web");
        assert_eq!(deserialized.options.get("type").unwrap(), "nfs");
    }

    #[test]
    fn test_volume_clone() {
        let volume = make_volume();
        let cloned = volume.clone();

        assert_eq!(cloned.name, volume.name);
        assert_eq!(cloned.driver, volume.driver);
    }

    #[test]
    fn test_volume_debug() {
        let volume = make_volume();
        let debug = format!("{:?}", volume);
        assert!(debug.contains("my-volume"));
    }

    #[test]
    fn test_volume_podman_runtime() {
        let mut volume = make_volume();
        volume.runtime = ContainerRuntime::Podman;

        let json = serde_json::to_string(&volume).unwrap();
        assert!(json.contains("\"podman\""));
    }

    #[test]
    fn test_volume_empty_labels() {
        let mut volume = make_volume();
        volume.labels = HashMap::new();

        let json = serde_json::to_string(&volume).unwrap();
        let deserialized: Volume = serde_json::from_str(&json).unwrap();
        assert!(deserialized.labels.is_empty());
    }
}
