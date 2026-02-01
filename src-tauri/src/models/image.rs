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
