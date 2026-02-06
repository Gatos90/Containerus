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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::system::SystemId;
    use chrono::Utc;

    fn make_container(status: ContainerStatus) -> Container {
        Container {
            id: ContainerId("abc123def456789012345678".to_string()),
            name: "web-server".to_string(),
            image: "nginx:latest".to_string(),
            status,
            runtime: ContainerRuntime::Docker,
            system_id: SystemId("sys-1".to_string()),
            created_at: Utc::now(),
            ports: vec![],
            environment_variables: std::collections::HashMap::new(),
            volumes: vec![],
            network_settings: NetworkSettings {
                networks: std::collections::HashMap::new(),
                port_bindings: vec![],
            },
            resource_limits: ResourceLimits::default(),
            labels: std::collections::HashMap::new(),
            restart_policy: RestartPolicy::default(),
            health_check: None,
            state: ContainerState::default(),
            config: ContainerConfig::default(),
            host_config: HostConfigExtras::default(),
        }
    }

    #[test]
    fn test_short_id() {
        let container = make_container(ContainerStatus::Running);
        assert_eq!(container.short_id(), "abc123def456");
    }

    #[test]
    fn test_display_name_with_name() {
        let container = make_container(ContainerStatus::Running);
        assert_eq!(container.display_name(), "web-server");
    }

    #[test]
    fn test_display_name_without_name() {
        let mut container = make_container(ContainerStatus::Running);
        container.name = String::new();
        assert_eq!(container.display_name(), "abc123def456");
    }

    #[test]
    fn test_is_running() {
        assert!(make_container(ContainerStatus::Running).is_running());
        assert!(!make_container(ContainerStatus::Exited).is_running());
        assert!(!make_container(ContainerStatus::Paused).is_running());
        assert!(!make_container(ContainerStatus::Created).is_running());
        assert!(!make_container(ContainerStatus::Dead).is_running());
    }

    #[test]
    fn test_available_actions_running() {
        let actions = make_container(ContainerStatus::Running).available_actions();
        assert_eq!(actions, vec![ContainerAction::Stop, ContainerAction::Restart, ContainerAction::Pause]);
    }

    #[test]
    fn test_available_actions_exited() {
        let actions = make_container(ContainerStatus::Exited).available_actions();
        assert_eq!(actions, vec![ContainerAction::Start, ContainerAction::Remove]);
    }

    #[test]
    fn test_available_actions_paused() {
        let actions = make_container(ContainerStatus::Paused).available_actions();
        assert_eq!(actions, vec![ContainerAction::Unpause, ContainerAction::Stop]);
    }

    #[test]
    fn test_available_actions_created() {
        let actions = make_container(ContainerStatus::Created).available_actions();
        assert_eq!(actions, vec![ContainerAction::Start, ContainerAction::Remove]);
    }

    #[test]
    fn test_available_actions_dead() {
        let actions = make_container(ContainerStatus::Dead).available_actions();
        assert_eq!(actions, vec![ContainerAction::Start, ContainerAction::Remove]);
    }

    #[test]
    fn test_available_actions_restarting() {
        let actions = make_container(ContainerStatus::Restarting).available_actions();
        assert_eq!(actions, vec![ContainerAction::Stop]);
    }

    #[test]
    fn test_available_actions_removing() {
        let actions = make_container(ContainerStatus::Removing).available_actions();
        assert!(actions.is_empty());
    }

    #[test]
    fn test_container_status_serialization() {
        let json = serde_json::to_string(&ContainerStatus::Running).unwrap();
        assert_eq!(json, "\"running\"");

        let status: ContainerStatus = serde_json::from_str("\"exited\"").unwrap();
        assert_eq!(status, ContainerStatus::Exited);
    }

    #[test]
    fn test_container_runtime_serialization() {
        let json = serde_json::to_string(&ContainerRuntime::Docker).unwrap();
        assert_eq!(json, "\"docker\"");

        let json = serde_json::to_string(&ContainerRuntime::Podman).unwrap();
        assert_eq!(json, "\"podman\"");

        let json = serde_json::to_string(&ContainerRuntime::Apple).unwrap();
        assert_eq!(json, "\"apple\"");
    }

    #[test]
    fn test_container_action_serialization() {
        let json = serde_json::to_string(&ContainerAction::Start).unwrap();
        assert_eq!(json, "\"start\"");

        let action: ContainerAction = serde_json::from_str("\"stop\"").unwrap();
        assert_eq!(action, ContainerAction::Stop);
    }

    #[test]
    fn test_restart_policy_default() {
        let rp = RestartPolicy::default();
        assert_eq!(rp.name, "no");
        assert_eq!(rp.maximum_retry_count, 0);
    }

    #[test]
    fn test_resource_limits_default() {
        let rl = ResourceLimits::default();
        assert!(rl.memory.is_none());
        assert!(rl.cpu_shares.is_none());
        assert!(rl.cpu_quota.is_none());
        assert!(rl.cpu_period.is_none());
    }

    #[test]
    fn test_container_details_from_container() {
        let container = make_container(ContainerStatus::Running);
        let details = ContainerDetails::from(&container);
        assert_eq!(details.restart_policy.name, container.restart_policy.name);
        assert_eq!(details.resource_limits.memory, container.resource_limits.memory);
    }

    /// Verifies that `PortMapping` serializes to JSON using camelCase field names and includes numeric port values.
    ///
    /// This test checks that the serialized JSON contains the `hostIp` key (camelCase) and the host port value.
    ///
    /// # Examples
    ///
    /// ```
    /// let pm = PortMapping {
    ///     host_ip: "0.0.0.0".to_string(),
    ///     host_port: 8080,
    ///     container_port: 80,
    ///     protocol: "tcp".to_string(),
    /// };
    /// let json = serde_json::to_string(&pm).unwrap();
    /// assert!(json.contains("hostIp"));
    /// assert!(json.contains("8080"));
    /// ```
    fn test_port_mapping_serialization() {
        let pm = PortMapping {
            host_ip: "0.0.0.0".to_string(),
            host_port: 8080,
            container_port: 80,
            protocol: "tcp".to_string(),
        };
        let json = serde_json::to_string(&pm).unwrap();
        assert!(json.contains("hostIp")); // camelCase
        assert!(json.contains("8080"));
    }
}

impl From<&Container> for ContainerDetails {
    /// Creates a ContainerDetails by copying full-detail fields from a Container.
    ///
    /// Copies the detailed inspection fields (environment_variables, volumes,
    /// network_settings, resource_limits, labels, restart_policy, health_check,
    /// state, config, host_config) from the provided `Container` into a new
    /// `ContainerDetails`.
    ///
    /// # Examples
    ///
    /// ```no_run
    /// // Given a `Container` value `c`:
    /// let details = ContainerDetails::from(&c);
    /// // `details` now contains the detailed fields from `c`.
    /// ```
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