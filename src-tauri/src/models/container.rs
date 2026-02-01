use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::models::system::SystemId;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct ContainerId(pub String);

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ContainerStatus {
    Running,
    Exited,
    Paused,
    Restarting,
    Removing,
    Dead,
    Created,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ContainerRuntime {
    Docker,
    Podman,
    Apple,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ContainerAction {
    Start,
    Stop,
    Restart,
    Pause,
    Unpause,
    Remove,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortMapping {
    pub host_ip: String,
    pub host_port: u16,
    pub container_port: u16,
    pub protocol: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Container {
    // Basic info
    pub id: ContainerId,
    pub name: String,
    pub image: String,
    pub status: ContainerStatus,
    pub runtime: ContainerRuntime,
    pub system_id: SystemId,
    pub created_at: DateTime<Utc>,
    pub ports: Vec<PortMapping>,

    // Full details (always populated from docker inspect)
    pub environment_variables: std::collections::HashMap<String, String>,
    pub volumes: Vec<VolumeMount>,
    pub network_settings: NetworkSettings,
    pub resource_limits: ResourceLimits,
    pub labels: std::collections::HashMap<String, String>,
    pub restart_policy: RestartPolicy,
    pub health_check: Option<HealthCheck>,
    pub state: ContainerState,
    pub config: ContainerConfig,
    pub host_config: HostConfigExtras,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeMount {
    pub source: String,
    pub destination: String,
    pub mode: String,
    pub read_write: bool,
    pub volume_name: Option<String>,
    pub mount_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInfo {
    pub ip_address: String,
    pub gateway: String,
    pub mac_address: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSettings {
    pub networks: std::collections::HashMap<String, NetworkInfo>,
    pub port_bindings: Vec<PortMapping>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ResourceLimits {
    pub memory: Option<i64>,
    pub cpu_shares: Option<i64>,
    pub cpu_quota: Option<i64>,
    pub cpu_period: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestartPolicy {
    pub name: String,
    pub maximum_retry_count: i32,
}

impl Default for RestartPolicy {
    fn default() -> Self {
        Self {
            name: "no".to_string(),
            maximum_retry_count: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthCheck {
    pub test: Vec<String>,
    pub interval: i64,
    pub timeout: i64,
    pub retries: i32,
    pub start_period: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ContainerState {
    pub pid: i64,
    pub exit_code: i32,
    pub error: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub health_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ContainerConfig {
    pub cmd: Option<Vec<String>>,
    pub entrypoint: Option<Vec<String>>,
    pub working_dir: Option<String>,
    pub user: Option<String>,
    pub hostname: Option<String>,
    pub domainname: Option<String>,
    pub tty: bool,
    pub stop_signal: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceMapping {
    pub host_path: String,
    pub container_path: String,
    pub permissions: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogConfig {
    pub log_type: String,
    pub config: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ulimit {
    pub name: String,
    pub soft: i64,
    pub hard: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HostConfigExtras {
    pub network_mode: Option<String>,
    pub privileged: bool,
    pub cap_add: Vec<String>,
    pub cap_drop: Vec<String>,
    pub devices: Vec<DeviceMapping>,
    pub shm_size: Option<i64>,
    pub log_config: Option<LogConfig>,
    pub security_opt: Vec<String>,
    pub ulimits: Vec<Ulimit>,
}

/// Backwards compatibility alias - ContainerDetails fields are now part of Container
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerDetails {
    pub environment_variables: std::collections::HashMap<String, String>,
    pub volumes: Vec<VolumeMount>,
    pub network_settings: NetworkSettings,
    pub resource_limits: ResourceLimits,
    pub labels: std::collections::HashMap<String, String>,
    pub restart_policy: RestartPolicy,
    pub health_check: Option<HealthCheck>,
    pub state: ContainerState,
    pub config: ContainerConfig,
    pub host_config: HostConfigExtras,
}

impl From<&Container> for ContainerDetails {
    fn from(c: &Container) -> Self {
        Self {
            environment_variables: c.environment_variables.clone(),
            volumes: c.volumes.clone(),
            network_settings: c.network_settings.clone(),
            resource_limits: c.resource_limits.clone(),
            labels: c.labels.clone(),
            restart_policy: c.restart_policy.clone(),
            health_check: c.health_check.clone(),
            state: c.state.clone(),
            config: c.config.clone(),
            host_config: c.host_config.clone(),
        }
    }
}

impl Container {
    pub fn short_id(&self) -> String {
        self.id.0.chars().take(12).collect()
    }

    pub fn display_name(&self) -> &str {
        if self.name.is_empty() {
            &self.id.0[..12.min(self.id.0.len())]
        } else {
            &self.name
        }
    }

    pub fn is_running(&self) -> bool {
        self.status == ContainerStatus::Running
    }

    pub fn available_actions(&self) -> Vec<ContainerAction> {
        match self.status {
            ContainerStatus::Running => vec![
                ContainerAction::Stop,
                ContainerAction::Restart,
                ContainerAction::Pause,
            ],
            ContainerStatus::Exited | ContainerStatus::Created | ContainerStatus::Dead => vec![
                ContainerAction::Start,
                ContainerAction::Remove,
            ],
            ContainerStatus::Paused => vec![ContainerAction::Unpause, ContainerAction::Stop],
            ContainerStatus::Restarting => vec![ContainerAction::Stop],
            ContainerStatus::Removing => vec![],
        }
    }
}
