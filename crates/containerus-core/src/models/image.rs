use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::models::container::ContainerRuntime;
use crate::models::system::SystemId;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerImage {
    pub id: String,
    pub name: String,
    pub tag: String,
    pub size: i64,
    pub created: Option<DateTime<Utc>>,
    pub repository: Option<String>,
    pub runtime: ContainerRuntime,
    pub system_id: SystemId,
    pub digest: Option<String>,
    pub architecture: Option<String>,
    pub os: Option<String>,
}

impl ContainerImage {
    pub fn full_name(&self) -> String {
        if self.tag.is_empty() || self.tag == "<none>" {
            self.name.clone()
        } else {
            format!("{}:{}", self.name, self.tag)
        }
    }

    pub fn size_human(&self) -> String {
        const KB: i64 = 1024;
        const MB: i64 = KB * 1024;
        const GB: i64 = MB * 1024;

        if self.size >= GB {
            format!("{:.2} GB", self.size as f64 / GB as f64)
        } else if self.size >= MB {
            format!("{:.2} MB", self.size as f64 / MB as f64)
        } else if self.size >= KB {
            format!("{:.2} KB", self.size as f64 / KB as f64)
        } else {
            format!("{} B", self.size)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::container::ContainerRuntime;
    use crate::models::system::SystemId;

    fn make_image(name: &str, tag: &str, size: i64) -> ContainerImage {
        ContainerImage {
            id: "sha256:abc123".to_string(),
            name: name.to_string(),
            tag: tag.to_string(),
            size,
            created: None,
            repository: None,
            runtime: ContainerRuntime::Docker,
            system_id: SystemId("sys-1".to_string()),
            digest: None,
            architecture: None,
            os: None,
        }
    }

    #[test]
    fn test_full_name_with_tag() {
        let img = make_image("nginx", "latest", 0);
        assert_eq!(img.full_name(), "nginx:latest");
    }

    #[test]
    fn test_full_name_with_none_tag() {
        let img = make_image("nginx", "<none>", 0);
        assert_eq!(img.full_name(), "nginx");
    }

    #[test]
    fn test_full_name_with_empty_tag() {
        let img = make_image("nginx", "", 0);
        assert_eq!(img.full_name(), "nginx");
    }

    #[test]
    fn test_full_name_with_version_tag() {
        let img = make_image("myapp", "v1.2.3", 0);
        assert_eq!(img.full_name(), "myapp:v1.2.3");
    }

    #[test]
    fn test_size_human_bytes() {
        let img = make_image("x", "y", 500);
        assert_eq!(img.size_human(), "500 B");
    }

    #[test]
    fn test_size_human_kilobytes() {
        let img = make_image("x", "y", 1024 * 5);
        assert_eq!(img.size_human(), "5.00 KB");
    }

    #[test]
    fn test_size_human_megabytes() {
        let img = make_image("x", "y", 1024 * 1024 * 150);
        assert_eq!(img.size_human(), "150.00 MB");
    }

    #[test]
    fn test_size_human_gigabytes() {
        let img = make_image("x", "y", 1024 * 1024 * 1024 * 2);
        assert_eq!(img.size_human(), "2.00 GB");
    }

    #[test]
    fn test_size_human_zero() {
        let img = make_image("x", "y", 0);
        assert_eq!(img.size_human(), "0 B");
    }

    #[test]
    fn test_image_serialization() {
        let img = make_image("nginx", "latest", 1024);
        let json = serde_json::to_string(&img).unwrap();
        assert!(json.contains("\"name\":\"nginx\""));
        assert!(json.contains("\"tag\":\"latest\""));

        let deserialized: ContainerImage = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.name, "nginx");
        assert_eq!(deserialized.tag, "latest");
        assert_eq!(deserialized.size, 1024);
    }
}
