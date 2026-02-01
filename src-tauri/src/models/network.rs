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
