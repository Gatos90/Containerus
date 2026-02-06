use chrono::{DateTime, NaiveDateTime, Utc};
use regex::Regex;
use serde_json::Value;
use std::collections::HashMap;

use crate::models::container::*;
use crate::models::error::ContainerError;
use crate::models::image::ContainerImage;
use crate::models::network::Network;
use crate::models::system::{ExtendedSystemInfo, LiveSystemMetrics, OsType, SystemId};
use crate::models::volume::Volume;

/// Parser for container runtime command output
pub struct OutputParser;

impl OutputParser {
    // ========================================================================
    // Container Parsing
    // ========================================================================

    /// Parse container list output from any runtime
    pub fn parse_container_list(
        output: &str,
        runtime: ContainerRuntime,
        system_id: &str,
    ) -> Result<Vec<Container>, ContainerError> {
        match runtime {
            ContainerRuntime::Docker | ContainerRuntime::Podman => {
                Self::parse_docker_container_list(output, runtime, system_id)
            }
            ContainerRuntime::Apple => Self::parse_apple_container_list(output, system_id),
        }
    }

    /// Parse Docker/Podman container list (JSON format)
    /// Handles both formats:
    /// - Docker/older Podman: one JSON object per line
    /// - Newer Podman (4.0+): JSON array containing all containers
    fn parse_docker_container_list(
        output: &str,
        runtime: ContainerRuntime,
        system_id: &str,
    ) -> Result<Vec<Container>, ContainerError> {
        let trimmed = output.trim();

        // Handle empty output
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }

        // Detect format: JSON array vs line-by-line objects
        if trimmed.starts_with('[') {
            // Newer Podman: JSON array format
            let json_array: Vec<Value> = serde_json::from_str(trimmed)
                .map_err(|e| ContainerError::ParseError(format!("Failed to parse JSON array: {}", e)))?;

            json_array
                .iter()
                .map(|json| Self::parse_container_from_json(json, runtime, system_id))
                .collect()
        } else {
            // Docker/older Podman: one JSON object per line
            let mut containers = Vec::new();
            for line in output.lines() {
                let line = line.trim();
                if line.is_empty() || !line.starts_with('{') {
                    continue;
                }

                let json: Value = serde_json::from_str(line)
                    .map_err(|e| ContainerError::ParseError(format!("Failed to parse JSON: {}", e)))?;

                containers.push(Self::parse_container_from_json(&json, runtime, system_id)?);
            }
            Ok(containers)
        }
    }

    /// Parse a single container from JSON object
    fn parse_container_from_json(
        json: &Value,
        runtime: ContainerRuntime,
        system_id: &str,
    ) -> Result<Container, ContainerError> {
        let id = json["ID"]
            .as_str()
            .or_else(|| json["Id"].as_str())
            .unwrap_or_default()
            .to_string();

        // Handle Names as either array (Docker) or string (Podman)
        let name = json["Names"]
            .as_array()
            .and_then(|arr| arr.first())
            .and_then(|v| v.as_str())
            .or_else(|| json["Names"].as_str())
            .unwrap_or_default()
            .trim_start_matches('/')
            .to_string();

        let image = json["Image"].as_str().unwrap_or_default().to_string();

        let status = Self::parse_status(
            json["State"]
                .as_str()
                .or_else(|| json["Status"].as_str())
                .unwrap_or_default(),
        );

        let created_str = json["CreatedAt"]
            .as_str()
            .or_else(|| json["Created"].as_str())
            .unwrap_or_default();
        let created_at = Self::parse_docker_date(created_str).unwrap_or_else(Utc::now);

        // Handle Ports field - can be string, null, or missing
        let ports_str = json["Ports"].as_str().unwrap_or_default();
        let ports = Self::parse_docker_ports(ports_str);

        Ok(Container {
            id: ContainerId(id),
            name,
            image,
            status,
            runtime,
            system_id: SystemId(system_id.to_string()),
            created_at,
            ports,
            // Default values for details - will be populated from inspect
            environment_variables: HashMap::new(),
            volumes: Vec::new(),
            network_settings: NetworkSettings {
                networks: HashMap::new(),
                port_bindings: Vec::new(),
            },
            resource_limits: ResourceLimits::default(),
            labels: HashMap::new(),
            restart_policy: RestartPolicy::default(),
            health_check: None,
            state: ContainerState::default(),
            config: ContainerConfig::default(),
            host_config: HostConfigExtras::default(),
        })
    }

    /// Parse Apple Container list (JSON array)
    fn parse_apple_container_list(
        output: &str,
        system_id: &str,
    ) -> Result<Vec<Container>, ContainerError> {
        let json: Vec<Value> = serde_json::from_str(output)
            .map_err(|e| ContainerError::ParseError(format!("Failed to parse JSON: {}", e)))?;

        let mut containers = Vec::new();

        for item in json {
            let config = &item["configuration"];

            let id = config["id"].as_str().unwrap_or_default().to_string();
            let name = config["hostname"]
                .as_str()
                .unwrap_or(&id[..12.min(id.len())])
                .to_string();
            let image = config["image"]["reference"]
                .as_str()
                .unwrap_or_default()
                .to_string();

            let status = Self::parse_apple_status(item["status"].as_str().unwrap_or_default());
            let ports = Self::parse_apple_ports(&config["publishedPorts"]);

            containers.push(Container {
                id: ContainerId(id),
                name,
                image,
                status,
                runtime: ContainerRuntime::Apple,
                system_id: SystemId(system_id.to_string()),
                created_at: Utc::now(), // Apple doesn't provide creation time in list
                ports,
                // Default values for details - will be populated from inspect
                environment_variables: HashMap::new(),
                volumes: Vec::new(),
                network_settings: NetworkSettings {
                    networks: HashMap::new(),
                    port_bindings: Vec::new(),
                },
                resource_limits: ResourceLimits::default(),
                labels: HashMap::new(),
                restart_policy: RestartPolicy::default(),
                health_check: None,
                state: ContainerState::default(),
                config: ContainerConfig::default(),
                host_config: HostConfigExtras::default(),
            });
        }

        Ok(containers)
    }

    /// Parse container status string to enum
    pub fn parse_status(status: &str) -> ContainerStatus {
        let lower = status.to_lowercase();
        if lower.contains("running") || lower.contains("up") {
            ContainerStatus::Running
        } else if lower.contains("exited") || lower.contains("stopped") {
            ContainerStatus::Exited
        } else if lower.contains("paused") {
            ContainerStatus::Paused
        } else if lower.contains("restarting") || lower.contains("starting") {
            ContainerStatus::Restarting
        } else if lower.contains("removing") {
            ContainerStatus::Removing
        } else if lower.contains("dead") || lower.contains("error") {
            ContainerStatus::Dead
        } else if lower.contains("created") {
            ContainerStatus::Created
        } else {
            ContainerStatus::Exited
        }
    }

    /// Parse Apple Container status
    fn parse_apple_status(status: &str) -> ContainerStatus {
        match status {
            "running" => ContainerStatus::Running,
            "stopped" => ContainerStatus::Exited,
            "paused" => ContainerStatus::Paused,
            "starting" => ContainerStatus::Restarting,
            "error" => ContainerStatus::Dead,
            _ => ContainerStatus::Exited,
        }
    }

    /// Parse Docker/Podman port string (e.g., "0.0.0.0:8080->80/tcp")
    fn parse_docker_ports(ports_str: &str) -> Vec<PortMapping> {
        let mut ports = Vec::new();
        let re = Regex::new(r"(?:(\d+\.\d+\.\d+\.\d+|:::?):)?(\d+)->(\d+)/(\w+)").unwrap();

        for cap in re.captures_iter(ports_str) {
            let host_ip = cap
                .get(1)
                .map(|m| m.as_str().trim_matches(':'))
                .unwrap_or("0.0.0.0")
                .to_string();

            if let (Ok(host_port), Ok(container_port)) =
                (cap[2].parse::<u16>(), cap[3].parse::<u16>())
            {
                ports.push(PortMapping {
                    host_ip,
                    host_port,
                    container_port,
                    protocol: cap[4].to_string(),
                });
            }
        }

        ports
    }

    /// Parse Apple Container ports
    fn parse_apple_ports(ports_value: &Value) -> Vec<PortMapping> {
        let mut ports = Vec::new();

        if let Some(arr) = ports_value.as_array() {
            for item in arr {
                let host_ip = item["hostIP"]
                    .as_str()
                    .or_else(|| item["hostIp"].as_str())
                    .unwrap_or("127.0.0.1")
                    .to_string();

                let host_port = item["hostPort"].as_u64().unwrap_or(0) as u16;
                let container_port = item["containerPort"].as_u64().unwrap_or(0) as u16;
                let protocol = item["protocol"].as_str().unwrap_or("tcp").to_string();

                if host_port > 0 && container_port > 0 {
                    ports.push(PortMapping {
                        host_ip,
                        host_port,
                        container_port,
                        protocol,
                    });
                }
            }
        }

        ports
    }

    /// Parse port bindings from docker inspect output (batch)
    /// Returns a map of container_id -> ports
    /// Handles both bridge networking (NetworkSettings.Ports) and host networking (Config.ExposedPorts)
    pub fn parse_port_bindings_from_inspect(output: &str) -> HashMap<String, Vec<PortMapping>> {
        let mut result = HashMap::new();

        // Docker inspect returns a JSON array
        let containers: Vec<Value> = match serde_json::from_str(output) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[DEBUG PARSER] Failed to parse JSON: {}", e);
                return result;
            }
        };

        eprintln!("[DEBUG PARSER] Parsed {} containers from inspect JSON", containers.len());

        for (idx, container) in containers.iter().enumerate() {
            // Get container ID
            let id = container["Id"]
                .as_str()
                .or_else(|| container["ID"].as_str())
                .unwrap_or_default()
                .to_string();

            let short_id = if id.len() >= 12 { &id[..12] } else { &id };
            eprintln!("[DEBUG PARSER] Container {}: id={}", idx, short_id);

            if id.is_empty() {
                continue;
            }

            let mut ports = Vec::new();

            // Check network mode - host networking stores ports differently
            let network_mode = container["HostConfig"]["NetworkMode"]
                .as_str()
                .unwrap_or("default");
            eprintln!("[DEBUG PARSER]   -> NetworkMode: {}", network_mode);

            if network_mode == "host" {
                // HOST NETWORKING: Get ports from Config.ExposedPorts
                // Format: { "7880/tcp": {}, "7881/udp": {} }
                let exposed_ports = &container["Config"]["ExposedPorts"];
                eprintln!("[DEBUG PARSER]   -> Config.ExposedPorts: {}", exposed_ports);

                if let Some(exposed_obj) = exposed_ports.as_object() {
                    for port_key in exposed_obj.keys() {
                        // port_key = "7880/tcp"
                        let parts: Vec<&str> = port_key.split('/').collect();
                        if parts.len() == 2 {
                            if let Ok(port) = parts[0].parse::<u16>() {
                                let protocol = parts[1].to_string();
                                // In host mode, host_port == container_port (bound directly)
                                ports.push(PortMapping {
                                    host_ip: "0.0.0.0".to_string(),
                                    host_port: port,
                                    container_port: port,
                                    protocol,
                                });
                                eprintln!("[DEBUG PARSER]     -> Host mode port: {}/{}", port, parts[1]);
                            }
                        }
                    }
                }
            } else {
                // BRIDGE/OTHER: Get ports from NetworkSettings.Ports
                // Format: { "80/tcp": [{"HostIp": "0.0.0.0", "HostPort": "8080"}] }
                let ports_value = &container["NetworkSettings"]["Ports"];
                eprintln!("[DEBUG PARSER]   -> NetworkSettings.Ports: {}", ports_value);

                if let Some(ports_obj) = ports_value.as_object() {
                    for (port_key, bindings) in ports_obj {
                        let parts: Vec<&str> = port_key.split('/').collect();
                        if parts.len() != 2 {
                            continue;
                        }

                        let container_port: u16 = match parts[0].parse() {
                            Ok(p) => p,
                            Err(_) => continue,
                        };
                        let protocol = parts[1].to_string();

                        // bindings is an array of { "HostIp": "0.0.0.0", "HostPort": "8080" }
                        // Can be null if port is exposed but not published
                        if let Some(binding_arr) = bindings.as_array() {
                            for binding in binding_arr {
                                let host_ip = binding["HostIp"]
                                    .as_str()
                                    .unwrap_or("0.0.0.0")
                                    .to_string();

                                let host_port: u16 = binding["HostPort"]
                                    .as_str()
                                    .and_then(|s| s.parse().ok())
                                    .unwrap_or(0);

                                if host_port > 0 {
                                    ports.push(PortMapping {
                                        host_ip,
                                        host_port,
                                        container_port,
                                        protocol: protocol.clone(),
                                    });
                                }
                            }
                        }
                    }
                }
            }

            eprintln!("[DEBUG PARSER]   -> Total ports: {}", ports.len());

            if !ports.is_empty() {
                result.insert(id, ports);
            }
        }

        eprintln!("[DEBUG PARSER] Final: {} containers with ports", result.len());
        result
    }

    /// Parse Docker date string
    fn parse_docker_date(date_str: &str) -> Option<DateTime<Utc>> {
        // First try RFC 3339 parsing (handles Z suffix correctly)
        if let Ok(dt) = DateTime::parse_from_rfc3339(date_str) {
            return Some(dt.with_timezone(&Utc));
        }

        // Fallback: Replace Z with +00:00 for other parsers
        let normalized = date_str.replace("Z", "+00:00");

        let formats = [
            "%Y-%m-%dT%H:%M:%S%.f%:z", // ISO 8601 with fractional seconds
            "%Y-%m-%dT%H:%M:%S%:z",    // Without fractional seconds
            "%Y-%m-%d %H:%M:%S %z",    // Space-separated with timezone
            "%Y-%m-%d %H:%M:%S",       // No timezone (NaiveDateTime)
        ];

        for fmt in formats {
            if let Ok(dt) = DateTime::parse_from_str(&normalized, fmt) {
                return Some(dt.with_timezone(&Utc));
            }
            if let Ok(dt) = NaiveDateTime::parse_from_str(&normalized, fmt) {
                return Some(DateTime::from_naive_utc_and_offset(dt, Utc));
            }
        }

        None
    }

    /// Parse full containers from batch docker inspect output
    /// Returns complete Container objects with all details populated
    pub fn parse_full_containers_from_inspect(
        output: &str,
        runtime: ContainerRuntime,
        system_id: &str,
    ) -> Result<Vec<Container>, ContainerError> {
        let containers: Vec<Value> = serde_json::from_str(output)
            .map_err(|e| ContainerError::ParseError(format!("Failed to parse inspect JSON: {}", e)))?;

        containers
            .iter()
            .map(|container| Self::parse_single_container_from_inspect(container, runtime, system_id))
            .collect()
    }

    /// Parse a single container from docker inspect JSON
    fn parse_single_container_from_inspect(
        container: &Value,
        runtime: ContainerRuntime,
        system_id: &str,
    ) -> Result<Container, ContainerError> {
        // Basic info
        let id = container["Id"]
            .as_str()
            .or_else(|| container["ID"].as_str())
            .unwrap_or_default()
            .to_string();

        let name = container["Name"]
            .as_str()
            .unwrap_or_default()
            .trim_start_matches('/')
            .to_string();

        let image = container["Config"]["Image"]
            .as_str()
            .unwrap_or_default()
            .to_string();

        // Parse status from State
        let state_json = &container["State"];
        let status = if state_json["Running"].as_bool().unwrap_or(false) {
            ContainerStatus::Running
        } else if state_json["Paused"].as_bool().unwrap_or(false) {
            ContainerStatus::Paused
        } else if state_json["Restarting"].as_bool().unwrap_or(false) {
            ContainerStatus::Restarting
        } else if state_json["Dead"].as_bool().unwrap_or(false) {
            ContainerStatus::Dead
        } else {
            // Check exit code for exited vs created
            let status_str = state_json["Status"].as_str().unwrap_or("exited");
            Self::parse_status(status_str)
        };

        // Parse created date
        let created_str = container["Created"].as_str().unwrap_or_default();
        let created_at = Self::parse_docker_date(created_str).unwrap_or_else(Utc::now);

        // Parse ports
        let ports = Self::parse_ports_from_inspect_container(container);

        // Parse environment variables
        let mut environment_variables = HashMap::new();
        if let Some(env_array) = container["Config"]["Env"].as_array() {
            for env in env_array {
                if let Some(env_str) = env.as_str() {
                    if let Some(pos) = env_str.find('=') {
                        let key = env_str[..pos].to_string();
                        let value = env_str[pos + 1..].to_string();
                        environment_variables.insert(key, value);
                    }
                }
            }
        }

        // Parse volumes/mounts
        let mut volumes = Vec::new();
        if let Some(mounts) = container["Mounts"].as_array() {
            for mount in mounts {
                volumes.push(VolumeMount {
                    source: mount["Source"].as_str().unwrap_or_default().to_string(),
                    destination: mount["Destination"].as_str().unwrap_or_default().to_string(),
                    mode: mount["Mode"].as_str().unwrap_or_default().to_string(),
                    read_write: mount["RW"].as_bool().unwrap_or(true),
                    volume_name: mount["Name"].as_str().map(String::from),
                    mount_type: mount["Type"].as_str().unwrap_or("bind").to_string(),
                });
            }
        }

        // Parse network settings
        let mut networks = HashMap::new();
        if let Some(nets) = container["NetworkSettings"]["Networks"].as_object() {
            for (net_name, config) in nets {
                networks.insert(
                    net_name.clone(),
                    NetworkInfo {
                        ip_address: config["IPAddress"].as_str().unwrap_or_default().to_string(),
                        gateway: config["Gateway"].as_str().unwrap_or_default().to_string(),
                        mac_address: config["MacAddress"].as_str().unwrap_or_default().to_string(),
                    },
                );
            }
        }

        let network_settings = NetworkSettings {
            networks,
            port_bindings: ports.clone(),
        };

        // Parse resource limits
        let host_config = &container["HostConfig"];
        let resource_limits = ResourceLimits {
            memory: host_config["Memory"].as_i64(),
            cpu_shares: host_config["CpuShares"].as_i64(),
            cpu_quota: host_config["CpuQuota"].as_i64(),
            cpu_period: host_config["CpuPeriod"].as_i64(),
        };

        // Parse restart policy
        let restart_policy = RestartPolicy {
            name: host_config["RestartPolicy"]["Name"]
                .as_str()
                .unwrap_or("no")
                .to_string(),
            maximum_retry_count: host_config["RestartPolicy"]["MaximumRetryCount"]
                .as_i64()
                .unwrap_or(0) as i32,
        };

        // Parse labels
        let mut labels = HashMap::new();
        if let Some(label_obj) = container["Config"]["Labels"].as_object() {
            for (key, value) in label_obj {
                if let Some(v) = value.as_str() {
                    labels.insert(key.clone(), v.to_string());
                }
            }
        }

        // Parse health check config
        let health_check = container["Config"]["Healthcheck"]
            .as_object()
            .map(|hc| HealthCheck {
                test: hc.get("Test")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default(),
                interval: hc.get("Interval").and_then(|v| v.as_i64()).unwrap_or(0),
                timeout: hc.get("Timeout").and_then(|v| v.as_i64()).unwrap_or(0),
                retries: hc.get("Retries").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
                start_period: hc.get("StartPeriod").and_then(|v| v.as_i64()).unwrap_or(0),
            });

        // Parse container state
        let state = ContainerState {
            pid: state_json["Pid"].as_i64().unwrap_or(0),
            exit_code: state_json["ExitCode"].as_i64().unwrap_or(0) as i32,
            error: state_json["Error"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(String::from),
            started_at: state_json["StartedAt"]
                .as_str()
                .filter(|s| !s.is_empty() && *s != "0001-01-01T00:00:00Z")
                .map(String::from),
            finished_at: state_json["FinishedAt"]
                .as_str()
                .filter(|s| !s.is_empty() && *s != "0001-01-01T00:00:00Z")
                .map(String::from),
            health_status: state_json["Health"]["Status"].as_str().map(String::from),
        };

        // Parse container config
        let config_json = &container["Config"];
        let config = ContainerConfig {
            cmd: config_json["Cmd"]
                .as_array()
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect()),
            entrypoint: config_json["Entrypoint"]
                .as_array()
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect()),
            working_dir: config_json["WorkingDir"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(String::from),
            user: config_json["User"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(String::from),
            hostname: config_json["Hostname"].as_str().map(String::from),
            domainname: config_json["Domainname"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(String::from),
            tty: config_json["Tty"].as_bool().unwrap_or(false),
            stop_signal: config_json["StopSignal"].as_str().map(String::from),
        };

        // Parse devices
        let devices = host_config["Devices"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|d| {
                        Some(DeviceMapping {
                            host_path: d["PathOnHost"].as_str()?.to_string(),
                            container_path: d["PathInContainer"].as_str()?.to_string(),
                            permissions: d["CgroupPermissions"].as_str().unwrap_or("rwm").to_string(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        // Parse log config
        let log_config = host_config["LogConfig"].as_object().map(|lc| {
            let mut config_map = HashMap::new();
            if let Some(cfg) = lc.get("Config").and_then(|c| c.as_object()) {
                for (key, value) in cfg {
                    if let Some(v) = value.as_str() {
                        config_map.insert(key.clone(), v.to_string());
                    }
                }
            }
            LogConfig {
                log_type: lc.get("Type").and_then(|t| t.as_str()).unwrap_or("json-file").to_string(),
                config: config_map,
            }
        });

        // Parse ulimits
        let ulimits = host_config["Ulimits"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|u| {
                        Some(Ulimit {
                            name: u["Name"].as_str()?.to_string(),
                            soft: u["Soft"].as_i64()?,
                            hard: u["Hard"].as_i64()?,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        // Parse extended host config
        let host_config_extras = HostConfigExtras {
            network_mode: host_config["NetworkMode"].as_str().map(String::from),
            privileged: host_config["Privileged"].as_bool().unwrap_or(false),
            cap_add: host_config["CapAdd"]
                .as_array()
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default(),
            cap_drop: host_config["CapDrop"]
                .as_array()
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default(),
            devices,
            shm_size: host_config["ShmSize"].as_i64(),
            log_config,
            security_opt: host_config["SecurityOpt"]
                .as_array()
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default(),
            ulimits,
        };

        Ok(Container {
            id: ContainerId(id),
            name,
            image,
            status,
            runtime,
            system_id: SystemId(system_id.to_string()),
            created_at,
            ports,
            environment_variables,
            volumes,
            network_settings,
            resource_limits,
            labels,
            restart_policy,
            health_check,
            state,
            config,
            host_config: host_config_extras,
        })
    }

    /// Parse ports from a single container's inspect JSON
    fn parse_ports_from_inspect_container(container: &Value) -> Vec<PortMapping> {
        let mut ports = Vec::new();

        // Check network mode - host networking stores ports differently
        let network_mode = container["HostConfig"]["NetworkMode"]
            .as_str()
            .unwrap_or("default");

        if network_mode == "host" {
            // HOST NETWORKING: Get ports from Config.ExposedPorts
            if let Some(exposed_obj) = container["Config"]["ExposedPorts"].as_object() {
                for port_key in exposed_obj.keys() {
                    let parts: Vec<&str> = port_key.split('/').collect();
                    if parts.len() == 2 {
                        if let Ok(port) = parts[0].parse::<u16>() {
                            let protocol = parts[1].to_string();
                            ports.push(PortMapping {
                                host_ip: "0.0.0.0".to_string(),
                                host_port: port,
                                container_port: port,
                                protocol,
                            });
                        }
                    }
                }
            }
        } else {
            // BRIDGE/OTHER: Get ports from NetworkSettings.Ports
            if let Some(ports_obj) = container["NetworkSettings"]["Ports"].as_object() {
                for (port_key, bindings) in ports_obj {
                    let parts: Vec<&str> = port_key.split('/').collect();
                    if parts.len() != 2 {
                        continue;
                    }

                    let container_port: u16 = match parts[0].parse() {
                        Ok(p) => p,
                        Err(_) => continue,
                    };
                    let protocol = parts[1].to_string();

                    if let Some(binding_arr) = bindings.as_array() {
                        for binding in binding_arr {
                            let host_ip = binding["HostIp"]
                                .as_str()
                                .unwrap_or("0.0.0.0")
                                .to_string();

                            let host_port: u16 = binding["HostPort"]
                                .as_str()
                                .and_then(|s| s.parse().ok())
                                .unwrap_or(0);

                            if host_port > 0 {
                                ports.push(PortMapping {
                                    host_ip,
                                    host_port,
                                    container_port,
                                    protocol: protocol.clone(),
                                });
                            }
                        }
                    }
                }
            }
        }

        // Deduplicate IPv4/IPv6 bindings for the same port
        // Docker returns both 0.0.0.0 and :: for each mapping; keep IPv4 only
        ports.sort_by(|a, b| a.container_port.cmp(&b.container_port));
        ports.dedup_by(|a, b| {
            a.container_port == b.container_port
                && a.host_port == b.host_port
                && a.protocol == b.protocol
        });

        ports
    }

    /// Parse container inspection output to get details
    pub fn parse_container_details(
        output: &str,
        runtime: ContainerRuntime,
    ) -> Result<ContainerDetails, ContainerError> {
        let json: Vec<Value> = serde_json::from_str(output)
            .map_err(|e| ContainerError::ParseError(format!("Failed to parse inspect JSON: {}", e)))?;

        let container = json
            .first()
            .ok_or_else(|| ContainerError::ParseError("Empty inspect result".to_string()))?;

        match runtime {
            ContainerRuntime::Docker | ContainerRuntime::Podman => {
                Self::parse_docker_container_details(container)
            }
            ContainerRuntime::Apple => Self::parse_apple_container_details(container),
        }
    }

    fn parse_docker_container_details(container: &Value) -> Result<ContainerDetails, ContainerError> {
        // Parse environment variables
        let mut env_vars = HashMap::new();
        if let Some(env_array) = container["Config"]["Env"].as_array() {
            for env in env_array {
                if let Some(env_str) = env.as_str() {
                    if let Some(pos) = env_str.find('=') {
                        let key = env_str[..pos].to_string();
                        let value = env_str[pos + 1..].to_string();
                        env_vars.insert(key, value);
                    }
                }
            }
        }

        // Parse volumes/mounts
        let mut volumes = Vec::new();
        if let Some(mounts) = container["Mounts"].as_array() {
            for mount in mounts {
                volumes.push(VolumeMount {
                    source: mount["Source"].as_str().unwrap_or_default().to_string(),
                    destination: mount["Destination"].as_str().unwrap_or_default().to_string(),
                    mode: mount["Mode"].as_str().unwrap_or_default().to_string(),
                    read_write: mount["RW"].as_bool().unwrap_or(true),
                    volume_name: mount["Name"].as_str().map(String::from),
                    mount_type: mount["Type"].as_str().unwrap_or("bind").to_string(),
                });
            }
        }

        // Parse network settings
        let mut networks = HashMap::new();
        if let Some(nets) = container["NetworkSettings"]["Networks"].as_object() {
            for (name, config) in nets {
                networks.insert(
                    name.clone(),
                    NetworkInfo {
                        ip_address: config["IPAddress"].as_str().unwrap_or_default().to_string(),
                        gateway: config["Gateway"].as_str().unwrap_or_default().to_string(),
                        mac_address: config["MacAddress"].as_str().unwrap_or_default().to_string(),
                    },
                );
            }
        }

        // Parse resource limits
        let host_config = &container["HostConfig"];
        let resource_limits = ResourceLimits {
            memory: host_config["Memory"].as_i64(),
            cpu_shares: host_config["CpuShares"].as_i64(),
            cpu_quota: host_config["CpuQuota"].as_i64(),
            cpu_period: host_config["CpuPeriod"].as_i64(),
        };

        // Parse restart policy
        let restart_policy = RestartPolicy {
            name: host_config["RestartPolicy"]["Name"]
                .as_str()
                .unwrap_or("no")
                .to_string(),
            maximum_retry_count: host_config["RestartPolicy"]["MaximumRetryCount"]
                .as_i64()
                .unwrap_or(0) as i32,
        };

        // Parse labels
        let mut labels = HashMap::new();
        if let Some(label_obj) = container["Config"]["Labels"].as_object() {
            for (key, value) in label_obj {
                if let Some(v) = value.as_str() {
                    labels.insert(key.clone(), v.to_string());
                }
            }
        }

        // Parse health check config
        let health_check = container["Config"]["Healthcheck"]
            .as_object()
            .map(|hc| HealthCheck {
                test: hc.get("Test")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default(),
                interval: hc.get("Interval").and_then(|v| v.as_i64()).unwrap_or(0),
                timeout: hc.get("Timeout").and_then(|v| v.as_i64()).unwrap_or(0),
                retries: hc.get("Retries").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
                start_period: hc.get("StartPeriod").and_then(|v| v.as_i64()).unwrap_or(0),
            });

        // Parse container state
        let state_json = &container["State"];
        let state = ContainerState {
            pid: state_json["Pid"].as_i64().unwrap_or(0),
            exit_code: state_json["ExitCode"].as_i64().unwrap_or(0) as i32,
            error: state_json["Error"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(String::from),
            started_at: state_json["StartedAt"]
                .as_str()
                .filter(|s| !s.is_empty() && *s != "0001-01-01T00:00:00Z")
                .map(String::from),
            finished_at: state_json["FinishedAt"]
                .as_str()
                .filter(|s| !s.is_empty() && *s != "0001-01-01T00:00:00Z")
                .map(String::from),
            health_status: state_json["Health"]["Status"].as_str().map(String::from),
        };

        // Parse container config
        let config_json = &container["Config"];
        let config = ContainerConfig {
            cmd: config_json["Cmd"]
                .as_array()
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect()),
            entrypoint: config_json["Entrypoint"]
                .as_array()
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect()),
            working_dir: config_json["WorkingDir"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(String::from),
            user: config_json["User"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(String::from),
            hostname: config_json["Hostname"].as_str().map(String::from),
            domainname: config_json["Domainname"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(String::from),
            tty: config_json["Tty"].as_bool().unwrap_or(false),
            stop_signal: config_json["StopSignal"].as_str().map(String::from),
        };

        // Parse devices
        let devices = host_config["Devices"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|d| {
                        Some(DeviceMapping {
                            host_path: d["PathOnHost"].as_str()?.to_string(),
                            container_path: d["PathInContainer"].as_str()?.to_string(),
                            permissions: d["CgroupPermissions"].as_str().unwrap_or("rwm").to_string(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        // Parse log config
        let log_config = host_config["LogConfig"].as_object().map(|lc| {
            let mut config_map = HashMap::new();
            if let Some(cfg) = lc["Config"].as_object() {
                for (key, value) in cfg {
                    if let Some(v) = value.as_str() {
                        config_map.insert(key.clone(), v.to_string());
                    }
                }
            }
            LogConfig {
                log_type: lc["Type"].as_str().unwrap_or("json-file").to_string(),
                config: config_map,
            }
        });

        // Parse ulimits
        let ulimits = host_config["Ulimits"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|u| {
                        Some(Ulimit {
                            name: u["Name"].as_str()?.to_string(),
                            soft: u["Soft"].as_i64()?,
                            hard: u["Hard"].as_i64()?,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        // Parse extended host config
        let host_config_extras = HostConfigExtras {
            network_mode: host_config["NetworkMode"].as_str().map(String::from),
            privileged: host_config["Privileged"].as_bool().unwrap_or(false),
            cap_add: host_config["CapAdd"]
                .as_array()
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default(),
            cap_drop: host_config["CapDrop"]
                .as_array()
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default(),
            devices,
            shm_size: host_config["ShmSize"].as_i64(),
            log_config,
            security_opt: host_config["SecurityOpt"]
                .as_array()
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default(),
            ulimits,
        };

        Ok(ContainerDetails {
            environment_variables: env_vars,
            volumes,
            network_settings: NetworkSettings {
                networks,
                port_bindings: Vec::new(),
            },
            resource_limits,
            labels,
            restart_policy,
            health_check,
            state,
            config,
            host_config: host_config_extras,
        })
    }

    fn parse_apple_container_details(container: &Value) -> Result<ContainerDetails, ContainerError> {
        let config = &container["configuration"];

        // Parse environment variables
        let mut env_vars = HashMap::new();
        if let Some(env_obj) = config["environment"].as_object() {
            for (key, value) in env_obj {
                if let Some(v) = value.as_str() {
                    env_vars.insert(key.clone(), v.to_string());
                }
            }
        }

        // Parse volumes
        let mut volumes = Vec::new();
        if let Some(mounts) = config["mounts"].as_array() {
            for mount in mounts {
                volumes.push(VolumeMount {
                    source: mount["source"].as_str().unwrap_or_default().to_string(),
                    destination: mount["destination"].as_str().unwrap_or_default().to_string(),
                    mode: "rw".to_string(),
                    read_write: !mount["readOnly"].as_bool().unwrap_or(false),
                    volume_name: None,
                    mount_type: "bind".to_string(),
                });
            }
        }

        // Parse labels
        let mut labels = HashMap::new();
        if let Some(label_obj) = config["labels"].as_object() {
            for (key, value) in label_obj {
                if let Some(v) = value.as_str() {
                    labels.insert(key.clone(), v.to_string());
                }
            }
        }

        // Parse Apple container config
        let container_config = ContainerConfig {
            cmd: config["command"]
                .as_array()
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect()),
            entrypoint: config["entrypoint"]
                .as_array()
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect()),
            working_dir: config["workingDirectory"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(String::from),
            user: config["user"].as_str().filter(|s| !s.is_empty()).map(String::from),
            hostname: config["hostname"].as_str().map(String::from),
            domainname: None,
            tty: config["tty"].as_bool().unwrap_or(false),
            stop_signal: None,
        };

        Ok(ContainerDetails {
            environment_variables: env_vars,
            volumes,
            network_settings: NetworkSettings {
                networks: HashMap::new(),
                port_bindings: Vec::new(),
            },
            resource_limits: ResourceLimits::default(),
            labels,
            restart_policy: RestartPolicy::default(),
            health_check: None,
            state: ContainerState::default(),
            config: container_config,
            host_config: HostConfigExtras::default(),
        })
    }

    // ========================================================================
    // Image Parsing
    // ========================================================================

    /// Parse image list output
    pub fn parse_image_list(
        output: &str,
        runtime: ContainerRuntime,
        system_id: &str,
    ) -> Result<Vec<ContainerImage>, ContainerError> {
        match runtime {
            ContainerRuntime::Docker | ContainerRuntime::Podman => {
                Self::parse_docker_image_list(output, runtime, system_id)
            }
            ContainerRuntime::Apple => Self::parse_apple_image_list(output, system_id),
        }
    }

    fn parse_docker_image_list(
        output: &str,
        runtime: ContainerRuntime,
        system_id: &str,
    ) -> Result<Vec<ContainerImage>, ContainerError> {
        let trimmed = output.trim();

        // Handle empty output
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }

        // Detect format: JSON array vs line-by-line objects
        if trimmed.starts_with('[') {
            // Newer Podman: JSON array format
            let json_array: Vec<Value> = serde_json::from_str(trimmed)
                .map_err(|e| ContainerError::ParseError(format!("Failed to parse JSON array: {}", e)))?;

            json_array
                .iter()
                .map(|json| Self::parse_image_from_json(json, runtime, system_id))
                .collect()
        } else {
            // Docker/older Podman: one JSON object per line
            let mut images = Vec::new();
            for line in output.lines() {
                let line = line.trim();
                if line.is_empty() || !line.starts_with('{') {
                    continue;
                }

                let json: Value = serde_json::from_str(line)
                    .map_err(|e| ContainerError::ParseError(format!("Failed to parse JSON: {}", e)))?;

                images.push(Self::parse_image_from_json(&json, runtime, system_id)?);
            }
            Ok(images)
        }
    }

    /// Parse a single image from JSON object
    fn parse_image_from_json(
        json: &Value,
        runtime: ContainerRuntime,
        system_id: &str,
    ) -> Result<ContainerImage, ContainerError> {
        let id = json["ID"]
            .as_str()
            .or_else(|| json["Id"].as_str())
            .unwrap_or_default()
            .to_string();

        let repository = json["Repository"]
            .as_str()
            .unwrap_or("<none>")
            .to_string();

        let tag = json["Tag"].as_str().unwrap_or("<none>").to_string();

        let size = json["Size"]
            .as_str()
            .and_then(|s| Self::parse_size_string(s))
            .or_else(|| json["Size"].as_i64())
            .unwrap_or(0);

        let created_str = json["CreatedAt"]
            .as_str()
            .or_else(|| json["Created"].as_str())
            .unwrap_or_default();
        let created = Self::parse_docker_date(created_str);

        Ok(ContainerImage {
            id,
            name: repository.clone(),
            tag,
            size,
            created,
            repository: Some(repository),
            runtime,
            system_id: SystemId(system_id.to_string()),
            digest: json["Digest"].as_str().map(String::from),
            architecture: None,
            os: None,
        })
    }

    fn parse_apple_image_list(
        output: &str,
        system_id: &str,
    ) -> Result<Vec<ContainerImage>, ContainerError> {
        let json: Vec<Value> = serde_json::from_str(output)
            .map_err(|e| ContainerError::ParseError(format!("Failed to parse JSON: {}", e)))?;

        let mut images = Vec::new();

        for item in json {
            let id = item["id"].as_str().unwrap_or_default().to_string();
            let reference = item["reference"].as_str().unwrap_or_default();

            let (name, tag) = if let Some(pos) = reference.rfind(':') {
                (reference[..pos].to_string(), reference[pos + 1..].to_string())
            } else {
                (reference.to_string(), "latest".to_string())
            };

            let size = item["size"].as_i64().unwrap_or(0);

            images.push(ContainerImage {
                id,
                name: name.clone(),
                tag,
                size,
                created: None,
                repository: Some(name),
                runtime: ContainerRuntime::Apple,
                system_id: SystemId(system_id.to_string()),
                digest: item["digest"].as_str().map(String::from),
                architecture: item["architecture"].as_str().map(String::from),
                os: item["os"].as_str().map(String::from),
            });
        }

        Ok(images)
    }

    /// Parse size string like "1.5GB" to bytes
    fn parse_size_string(s: &str) -> Option<i64> {
        let s = s.trim().to_uppercase();
        let re = Regex::new(r"^([\d.]+)\s*(B|KB|MB|GB|TB)?$").ok()?;
        let caps = re.captures(&s)?;

        let num: f64 = caps.get(1)?.as_str().parse().ok()?;
        let unit = caps.get(2).map(|m| m.as_str()).unwrap_or("B");

        let multiplier: i64 = match unit {
            "B" => 1,
            "KB" => 1024,
            "MB" => 1024 * 1024,
            "GB" => 1024 * 1024 * 1024,
            "TB" => 1024_i64 * 1024 * 1024 * 1024,
            _ => 1,
        };

        Some((num * multiplier as f64) as i64)
    }

    // ========================================================================
    // Volume Parsing
    // ========================================================================

    /// Parse volume list output
    /// Handles both formats:
    /// - Docker/older Podman: one JSON object per line
    /// - Newer Podman (4.0+): JSON array containing all volumes
    pub fn parse_volume_list(
        output: &str,
        runtime: ContainerRuntime,
        system_id: &str,
    ) -> Result<Vec<Volume>, ContainerError> {
        let trimmed = output.trim();

        // Handle empty output
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }

        // Detect format: JSON array vs line-by-line objects
        if trimmed.starts_with('[') {
            // Newer Podman: JSON array format
            let json_array: Vec<Value> = serde_json::from_str(trimmed)
                .map_err(|e| ContainerError::ParseError(format!("Failed to parse JSON array: {}", e)))?;

            json_array
                .iter()
                .map(|json| Self::parse_volume_from_json(json, runtime, system_id))
                .collect()
        } else {
            // Docker/older Podman: one JSON object per line
            let mut volumes = Vec::new();
            for line in output.lines() {
                let line = line.trim();
                if line.is_empty() || !line.starts_with('{') {
                    continue;
                }

                let json: Value = serde_json::from_str(line)
                    .map_err(|e| ContainerError::ParseError(format!("Failed to parse JSON: {}", e)))?;

                volumes.push(Self::parse_volume_from_json(&json, runtime, system_id)?);
            }
            Ok(volumes)
        }
    }

    /// Parse a single volume from JSON object
    fn parse_volume_from_json(
        json: &Value,
        runtime: ContainerRuntime,
        system_id: &str,
    ) -> Result<Volume, ContainerError> {
        let name = json["Name"]
            .as_str()
            .or_else(|| json["name"].as_str())
            .unwrap_or_default()
            .to_string();

        let driver = json["Driver"]
            .as_str()
            .or_else(|| json["driver"].as_str())
            .unwrap_or("local")
            .to_string();

        let mountpoint = json["Mountpoint"]
            .as_str()
            .or_else(|| json["mountpoint"].as_str())
            .unwrap_or_default()
            .to_string();

        let mut labels = HashMap::new();
        if let Some(label_obj) = json["Labels"].as_object() {
            for (key, value) in label_obj {
                if let Some(v) = value.as_str() {
                    labels.insert(key.clone(), v.to_string());
                }
            }
        }

        Ok(Volume {
            name,
            driver,
            mountpoint,
            created_at: None,
            labels,
            options: HashMap::new(),
            runtime,
            system_id: SystemId(system_id.to_string()),
        })
    }

    // ========================================================================
    // Network Parsing
    // ========================================================================

    /// Parse network list output
    /// Handles both formats:
    /// - Docker/older Podman: one JSON object per line
    /// - Newer Podman (4.0+): JSON array containing all networks
    pub fn parse_network_list(
        output: &str,
        runtime: ContainerRuntime,
        system_id: &str,
    ) -> Result<Vec<Network>, ContainerError> {
        let trimmed = output.trim();

        // Handle empty output
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }

        // Detect format: JSON array vs line-by-line objects
        if trimmed.starts_with('[') {
            // Newer Podman: JSON array format
            let json_array: Vec<Value> = serde_json::from_str(trimmed)
                .map_err(|e| ContainerError::ParseError(format!("Failed to parse JSON array: {}", e)))?;

            json_array
                .iter()
                .map(|json| Self::parse_network_from_json(json, runtime, system_id))
                .collect()
        } else {
            // Docker/older Podman: one JSON object per line
            let mut networks = Vec::new();
            for line in output.lines() {
                let line = line.trim();
                if line.is_empty() || !line.starts_with('{') {
                    continue;
                }

                let json: Value = serde_json::from_str(line)
                    .map_err(|e| ContainerError::ParseError(format!("Failed to parse JSON: {}", e)))?;

                networks.push(Self::parse_network_from_json(&json, runtime, system_id)?);
            }
            Ok(networks)
        }
    }

    /// Parse a single network from JSON object
    fn parse_network_from_json(
        json: &Value,
        runtime: ContainerRuntime,
        system_id: &str,
    ) -> Result<Network, ContainerError> {
        let id = json["ID"]
            .as_str()
            .or_else(|| json["id"].as_str())
            .unwrap_or_default()
            .to_string();

        let name = json["Name"]
            .as_str()
            .or_else(|| json["name"].as_str())
            .unwrap_or_default()
            .to_string();

        let driver = json["Driver"]
            .as_str()
            .or_else(|| json["driver"].as_str())
            .unwrap_or("bridge")
            .to_string();

        let scope = json["Scope"]
            .as_str()
            .or_else(|| json["scope"].as_str())
            .unwrap_or("local")
            .to_string();

        let mut labels = HashMap::new();
        if let Some(label_obj) = json["Labels"].as_object() {
            for (key, value) in label_obj {
                if let Some(v) = value.as_str() {
                    labels.insert(key.clone(), v.to_string());
                }
            }
        }

        Ok(Network {
            id,
            name,
            driver,
            scope,
            created_at: None,
            internal: json["Internal"].as_bool().unwrap_or(false),
            attachable: json["Attachable"].as_bool().unwrap_or(false),
            labels,
            runtime,
            system_id: SystemId(system_id.to_string()),
        })
    }

    // ========================================================================
    // Runtime Detection
    // ========================================================================

    /// Check if runtime is available from version command output
    pub fn parse_runtime_available(output: &str, runtime: ContainerRuntime) -> bool {
        let output_lower = output.to_lowercase();
        match runtime {
            ContainerRuntime::Docker => {
                output_lower.contains("docker version") || output_lower.contains("docker")
            }
            ContainerRuntime::Podman => {
                output_lower.contains("podman version") || output_lower.contains("podman")
            }
            ContainerRuntime::Apple => {
                output_lower.contains("container") || output_lower.contains("version")
            }
        }
    }

    // ========================================================================
    // Extended System Info Parsing
    // ========================================================================

    /// Parse the combined extended system info output
    /// The output contains sections delimited by ===SECTION_NAME===
    pub fn parse_extended_system_info(output: &str) -> ExtendedSystemInfo {
        let mut username = String::new();
        let mut is_root = false;
        let mut can_sudo = false;
        let mut os_type = OsType::Unknown;
        let mut distro: Option<String> = None;
        let mut hostname: Option<String> = None;
        let mut cpu_count: Option<u32> = None;
        let mut total_memory: Option<String> = None;
        let mut disk_usage_percent: Option<u8> = None;
        let mut uptime: Option<String> = None;
        let mut running_containers: Option<u32> = None;
        let mut total_containers: Option<u32> = None;
        let mut total_images: Option<u32> = None;
        let mut runtime_version: Option<String> = None;

        // Split output by section markers
        let sections: Vec<&str> = output.split("===").collect();

        for i in 0..sections.len() {
            let section = sections[i].trim();

            // Get the content after the section header (next element in the split)
            let content = if i + 1 < sections.len() {
                sections[i + 1].trim().lines().next().unwrap_or("").trim()
            } else {
                ""
            };

            match section {
                "USERNAME" => {
                    username = content.to_string();
                }
                "USERID" => {
                    is_root = content == "0";
                }
                "SUDO" => {
                    can_sudo = content.to_lowercase() == "yes";
                }
                "OSTYPE" => {
                    os_type = Self::parse_os_type(content);
                }
                "HOSTNAME" => {
                    if !content.is_empty() {
                        hostname = Some(content.to_string());
                    }
                }
                "DISTRO" => {
                    // The distro section may have multiple lines, get the full section
                    if i + 1 < sections.len() {
                        let full_section = sections[i + 1].trim();
                        distro = Self::parse_distro_info(full_section);
                    }
                }
                "CPUCOUNT" => {
                    cpu_count = content.parse().ok();
                }
                "MEMORY" => {
                    // Parse memory info from free -h output, macOS format, or Windows format
                    if i + 1 < sections.len() {
                        let mem_section = sections[i + 1].trim();
                        total_memory = Self::parse_memory_info(mem_section);
                    }
                }
                "DISK" => {
                    // Parse disk usage from df -h output or Windows format
                    if i + 1 < sections.len() {
                        let disk_section = sections[i + 1].trim();
                        disk_usage_percent = Self::parse_disk_usage(disk_section);
                    }
                }
                "UPTIME" => {
                    if !content.is_empty() && content != "unknown" {
                        uptime = Some(Self::format_uptime(content));
                    }
                }
                "CONTAINERS" => {
                    running_containers = content.trim().parse().ok();
                }
                "TOTALCONTAINERS" => {
                    total_containers = content.trim().parse().ok();
                }
                "IMAGES" => {
                    total_images = content.trim().parse().ok();
                }
                "RUNTIMEVERSION" => {
                    if !content.is_empty() {
                        runtime_version = Some(content.to_string());
                    }
                }
                _ => {}
            }
        }

        ExtendedSystemInfo {
            username,
            is_root,
            can_sudo,
            os_type,
            distro,
            hostname,
            cpu_count,
            total_memory,
            disk_usage_percent,
            uptime,
            running_containers,
            total_containers,
            total_images,
            runtime_version,
        }
    }

    /// Format uptime string for display
    fn format_uptime(raw: &str) -> String {
        let lower = raw.to_lowercase();
        // Remove "up " prefix if present
        let cleaned = lower.trim_start_matches("up ").trim();
        cleaned.to_string()
    }

    /// Parse OS type from uname -s output
    fn parse_os_type(output: &str) -> OsType {
        let lower = output.to_lowercase();
        if lower.contains("linux") {
            OsType::Linux
        } else if lower.contains("darwin") {
            OsType::Macos
        } else if lower.contains("windows") || lower.contains("mingw") || lower.contains("msys") {
            OsType::Windows
        } else {
            OsType::Unknown
        }
    }

    /// Parse distribution info from /etc/os-release or sw_vers
    fn parse_distro_info(output: &str) -> Option<String> {
        // Try to find PRETTY_NAME from /etc/os-release
        for line in output.lines() {
            if line.starts_with("PRETTY_NAME=") {
                let value = line.trim_start_matches("PRETTY_NAME=");
                let cleaned = value.trim_matches('"').trim_matches('\'');
                if !cleaned.is_empty() {
                    return Some(cleaned.to_string());
                }
            }
        }

        // Try macOS sw_vers format
        let mut product_name: Option<&str> = None;
        let mut product_version: Option<&str> = None;

        for line in output.lines() {
            if line.starts_with("ProductName:") {
                product_name = Some(line.trim_start_matches("ProductName:").trim());
            } else if line.starts_with("ProductVersion:") {
                product_version = Some(line.trim_start_matches("ProductVersion:").trim());
            }
        }

        if let (Some(name), Some(version)) = (product_name, product_version) {
            return Some(format!("{} {}", name, version));
        }

        // Fallback: try to get NAME from /etc/os-release
        for line in output.lines() {
            if line.starts_with("NAME=") {
                let value = line.trim_start_matches("NAME=");
                let cleaned = value.trim_matches('"').trim_matches('\'');
                if !cleaned.is_empty() && cleaned != "unknown" {
                    return Some(cleaned.to_string());
                }
            }
        }

        None
    }

    /// Parse memory info from free -h or macOS format
    fn parse_memory_info(line: &str) -> Option<String> {
        // Linux free -h format: "Mem:          15Gi       8.2Gi ..."
        if line.starts_with("Mem:") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                return Some(parts[1].to_string());
            }
        }

        // macOS format: just the number with G suffix (e.g., "16G")
        let trimmed = line.trim();
        if trimmed.ends_with('G') || trimmed.ends_with("Gi") {
            return Some(trimmed.to_string());
        }

        // Try parsing as raw number (bytes converted to GB)
        if let Ok(bytes) = trimmed.parse::<u64>() {
            let gb = bytes / 1024 / 1024 / 1024;
            return Some(format!("{}G", gb));
        }

        None
    }

    /// Parse disk usage percentage from df -h output line
    fn parse_disk_usage(line: &str) -> Option<u8> {
        // df -h output format: "Filesystem      Size  Used Avail Use% Mounted on"
        // Example: "/dev/sda1       100G   45G   55G  45% /"
        let parts: Vec<&str> = line.split_whitespace().collect();

        // Find the percentage field (usually 5th column, but can vary)
        for part in parts {
            if part.ends_with('%') {
                let num_str = part.trim_end_matches('%');
                if let Ok(pct) = num_str.parse::<u8>() {
                    return Some(pct);
                }
            }
        }

        None
    }

    // ========================================================================
    // Live Metrics Parsing
    // ========================================================================

    /// Parse live metrics output from Unix/Linux systems
    /// The output contains sections delimited by ===SECTION_NAME===
    pub fn parse_live_metrics(output: &str, system_id: &str) -> LiveSystemMetrics {
        let mut cpu_usage_percent: f32 = 0.0;
        let mut memory_usage_percent: f32 = 0.0;
        let mut memory_used: Option<String> = None;
        let mut memory_total: Option<String> = None;
        let mut load_average: Option<[f32; 3]> = None;
        let mut swap_usage_percent: Option<f32> = None;

        // Track CPU values for calculation
        let mut cpu_user: u64 = 0;
        let mut cpu_nice: u64 = 0;
        let mut cpu_system: u64 = 0;
        let mut cpu_idle: u64 = 0;
        let mut cpu_iowait: u64 = 0;
        let mut cpu_irq: u64 = 0;
        let mut cpu_softirq: u64 = 0;

        // Track memory values in KB
        let mut mem_total_kb: u64 = 0;
        let mut mem_available_kb: u64 = 0;
        let mut mem_free_kb: u64 = 0;
        let mut mem_buffers_kb: u64 = 0;
        let mut mem_cached_kb: u64 = 0;
        let mut swap_total_kb: u64 = 0;
        let mut swap_free_kb: u64 = 0;

        // macOS vm_stat page counts
        let mut macos_pages_free: u64 = 0;
        let mut macos_pages_active: u64 = 0;
        let mut macos_pages_inactive: u64 = 0;
        let mut macos_pages_speculative: u64 = 0;
        let mut macos_pages_wired: u64 = 0;
        let mut macos_total_bytes: u64 = 0;

        // Split output by section markers
        let sections: Vec<&str> = output.split("===").collect();

        for i in 0..sections.len() {
            let section = sections[i].trim();

            match section {
                "CPU" => {
                    // Get the content after the section header
                    if i + 1 < sections.len() {
                        let cpu_section = sections[i + 1].trim();
                        // Parse /proc/stat format: cpu user nice system idle iowait irq softirq
                        // Example: cpu  1234567 12345 234567 8901234 12345 0 1234 0 0 0
                        for line in cpu_section.lines() {
                            let line = line.trim();
                            if line.starts_with("cpu ") || line.starts_with("cpu\t") {
                                let parts: Vec<&str> = line.split_whitespace().collect();
                                if parts.len() >= 8 {
                                    cpu_user = parts[1].parse().unwrap_or(0);
                                    cpu_nice = parts[2].parse().unwrap_or(0);
                                    cpu_system = parts[3].parse().unwrap_or(0);
                                    cpu_idle = parts[4].parse().unwrap_or(0);
                                    cpu_iowait = parts[5].parse().unwrap_or(0);
                                    cpu_irq = parts[6].parse().unwrap_or(0);
                                    cpu_softirq = parts[7].parse().unwrap_or(0);
                                }
                            }
                            // macOS top format: CPU usage: 12.34% user, 5.67% sys, 81.99% idle
                            if line.contains("CPU usage:") {
                                if let Some(idle_pos) = line.find("% idle") {
                                    // Find the number before "% idle"
                                    let before_idle = &line[..idle_pos];
                                    if let Some(last_space) = before_idle.rfind(|c: char| c == ' ' || c == ',') {
                                        if let Ok(idle_pct) = before_idle[last_space + 1..].trim().parse::<f32>() {
                                            cpu_usage_percent = 100.0 - idle_pct;
                                        }
                                    }
                                }
                            }
                            // Windows: Just a number (CPU percentage)
                            if let Ok(pct) = line.parse::<f32>() {
                                cpu_usage_percent = pct;
                            }
                        }
                    }
                }
                "MEM" => {
                    if i + 1 < sections.len() {
                        let mem_section = sections[i + 1].trim();
                        for line in mem_section.lines() {
                            let line = line.trim();
                            // Linux /proc/meminfo format: MemTotal: 16384000 kB
                            if line.starts_with("MemTotal:") {
                                mem_total_kb = Self::parse_meminfo_value(line);
                            } else if line.starts_with("MemAvailable:") {
                                mem_available_kb = Self::parse_meminfo_value(line);
                            } else if line.starts_with("MemFree:") {
                                mem_free_kb = Self::parse_meminfo_value(line);
                            } else if line.starts_with("Buffers:") {
                                mem_buffers_kb = Self::parse_meminfo_value(line);
                            } else if line.starts_with("Cached:") {
                                mem_cached_kb = Self::parse_meminfo_value(line);
                            } else if line.starts_with("SwapTotal:") {
                                swap_total_kb = Self::parse_meminfo_value(line);
                            } else if line.starts_with("SwapFree:") {
                                swap_free_kb = Self::parse_meminfo_value(line);
                            }
                            // Windows format: "TotalKB FreeKB"
                            let parts: Vec<&str> = line.split_whitespace().collect();
                            if parts.len() == 2 {
                                if let (Ok(total), Ok(free)) = (parts[0].parse::<u64>(), parts[1].parse::<u64>()) {
                                    mem_total_kb = total;
                                    mem_available_kb = free;
                                }
                            }
                            // macOS vm_stat format: "Pages free:                 12345."
                            if line.starts_with("Pages free:") {
                                macos_pages_free = Self::parse_vm_stat_value(line);
                            } else if line.starts_with("Pages active:") {
                                macos_pages_active = Self::parse_vm_stat_value(line);
                            } else if line.starts_with("Pages inactive:") {
                                macos_pages_inactive = Self::parse_vm_stat_value(line);
                            } else if line.starts_with("Pages speculative:") {
                                macos_pages_speculative = Self::parse_vm_stat_value(line);
                            } else if line.starts_with("Pages wired down:") {
                                macos_pages_wired = Self::parse_vm_stat_value(line);
                            }
                            // macOS hw.memsize (total memory in bytes, typically a large number on its own line)
                            if let Ok(bytes) = line.parse::<u64>() {
                                if bytes > 1_000_000_000 {
                                    // > 1GB indicates this is hw.memsize
                                    macos_total_bytes = bytes;
                                }
                            }
                        }
                    }
                }
                "LOAD" => {
                    if i + 1 < sections.len() {
                        let load_section = sections[i + 1].trim();
                        for line in load_section.lines() {
                            let line = line.trim();
                            // Linux /proc/loadavg format: 1.23 0.98 0.76 1/234 12345
                            let parts: Vec<&str> = line.split_whitespace().collect();
                            if parts.len() >= 3 {
                                if let (Ok(l1), Ok(l5), Ok(l15)) = (
                                    parts[0].parse::<f32>(),
                                    parts[1].parse::<f32>(),
                                    parts[2].parse::<f32>(),
                                ) {
                                    load_average = Some([l1, l5, l15]);
                                }
                            }
                            // macOS sysctl format: { 1.23 0.98 0.76 }
                            if line.starts_with('{') {
                                let cleaned = line.trim_start_matches('{').trim_end_matches('}').trim();
                                let parts: Vec<&str> = cleaned.split_whitespace().collect();
                                if parts.len() >= 3 {
                                    if let (Ok(l1), Ok(l5), Ok(l15)) = (
                                        parts[0].parse::<f32>(),
                                        parts[1].parse::<f32>(),
                                        parts[2].parse::<f32>(),
                                    ) {
                                        load_average = Some([l1, l5, l15]);
                                    }
                                }
                            }
                        }
                    }
                }
                "SWAP" => {
                    // Windows swap format
                    if i + 1 < sections.len() {
                        let swap_section = sections[i + 1].trim();
                        for line in swap_section.lines() {
                            let parts: Vec<&str> = line.split_whitespace().collect();
                            if parts.len() == 2 {
                                if let (Ok(total), Ok(used)) = (parts[0].parse::<u64>(), parts[1].parse::<u64>()) {
                                    if total > 0 {
                                        swap_usage_percent = Some((used as f32 / total as f32) * 100.0);
                                    }
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        // Calculate CPU usage from /proc/stat values
        if cpu_idle > 0 || cpu_user > 0 {
            let total = cpu_user + cpu_nice + cpu_system + cpu_idle + cpu_iowait + cpu_irq + cpu_softirq;
            if total > 0 {
                let idle_total = cpu_idle + cpu_iowait;
                cpu_usage_percent = ((total - idle_total) as f32 / total as f32) * 100.0;
            }
        }

        // macOS memory calculation from vm_stat
        if macos_total_bytes > 0 {
            const PAGE_SIZE: u64 = 4096;
            mem_total_kb = macos_total_bytes / 1024;
            let used_pages = macos_pages_active + macos_pages_wired + macos_pages_speculative;
            let used_bytes = used_pages * PAGE_SIZE;
            mem_available_kb = (macos_total_bytes.saturating_sub(used_bytes)) / 1024;
        }

        // Calculate memory usage
        if mem_total_kb > 0 {
            // Use MemAvailable if available (more accurate), otherwise calculate from Free+Buffers+Cached
            let available = if mem_available_kb > 0 {
                mem_available_kb
            } else {
                mem_free_kb + mem_buffers_kb + mem_cached_kb
            };
            let used_kb = mem_total_kb.saturating_sub(available);
            memory_usage_percent = (used_kb as f32 / mem_total_kb as f32) * 100.0;
            memory_used = Some(Self::format_bytes(used_kb * 1024));
            memory_total = Some(Self::format_bytes(mem_total_kb * 1024));
        }

        // Calculate swap usage
        if swap_total_kb > 0 && swap_usage_percent.is_none() {
            let swap_used_kb = swap_total_kb.saturating_sub(swap_free_kb);
            swap_usage_percent = Some((swap_used_kb as f32 / swap_total_kb as f32) * 100.0);
        }

        LiveSystemMetrics {
            system_id: system_id.to_string(),
            timestamp: chrono::Utc::now().timestamp_millis(),
            cpu_usage_percent,
            memory_usage_percent,
            memory_used,
            memory_total,
            load_average,
            swap_usage_percent,
        }
    }

    /// Parse a meminfo line value (e.g., "MemTotal:       16384000 kB")
    fn parse_meminfo_value(line: &str) -> u64 {
        let parts: Vec<&str> = line.split(':').collect();
        if parts.len() >= 2 {
            let value_part = parts[1].trim();
            let num_str = value_part.split_whitespace().next().unwrap_or("0");
            num_str.parse().unwrap_or(0)
        } else {
            0
        }
    }

    /// Parse a macOS vm_stat line value (e.g., "Pages free:                 12345.")
    fn parse_vm_stat_value(line: &str) -> u64 {
        if let Some(colon_pos) = line.find(':') {
            let value_str = line[colon_pos + 1..].trim().trim_end_matches('.');
            value_str.parse().unwrap_or(0)
        } else {
            0
        }
    }

    // ========================================================================
    // File Browser Parsing
    // ========================================================================

    /// Parse `ls -la` output into structured file entries.
    /// Handles both GNU (--time-style=long-iso) and BSD formats.
    pub fn parse_directory_listing(
        output: &str,
        base_path: &str,
    ) -> Result<Vec<crate::models::file_browser::FileEntry>, ContainerError> {
        use crate::models::file_browser::{FileEntry, FileType};

        let mut entries = Vec::new();
        let base = if base_path.ends_with('/') {
            base_path.trim_end_matches('/')
        } else {
            base_path
        };

        for line in output.lines() {
            let trimmed = line.trim();
            // Skip empty lines, "total" line
            if trimmed.is_empty() || trimmed.starts_with("total ") {
                continue;
            }

            // Minimum valid ls -la line must start with a permission char
            let first_char = match trimmed.chars().next() {
                Some(c) if "dlcbps-".contains(c) => c,
                _ => continue,
            };

            let file_type = match first_char {
                'd' => FileType::Directory,
                'l' => FileType::Symlink,
                '-' => FileType::File,
                _ => FileType::Other,
            };

            // Use split_whitespace to correctly handle multiple consecutive spaces
            let parts: Vec<&str> = trimmed.split_whitespace().collect();

            // Need at least: perms links owner group size date time name (GNU = 8 parts)
            if parts.len() < 8 {
                continue;
            }

            let permissions = if parts[0].len() > 1 {
                parts[0][1..].to_string()
            } else {
                continue;
            };
            let owner = parts[2].to_string();
            let group = parts[3].to_string();
            let size: u64 = parts[4].parse().unwrap_or(0);

            // Determine GNU vs BSD format and extract date + name
            //
            // GNU --time-style=long-iso:
            //   parts[5]="2024-01-15" parts[6]="10:30" parts[7..]="name"
            //
            // BSD ls -laT (macOS):
            //   parts[5]="Jul" parts[6]="20" parts[7]="09:19:46" parts[8]="2025" parts[9..]="name"
            //
            // BSD ls -la (no -T, older files show year instead of time):
            //   parts[5]="Aug" parts[6]="6" parts[7]="2023" parts[8..]="name"
            //   OR with time: parts[5]="Jan" parts[6]="15" parts[7]="10:30" parts[8..]="name"
            let (modified, name_start_idx) = if parts[5].contains('-') && parts[5].len() == 10 {
                // GNU format: date + time, name starts at index 7
                (format!("{} {}", parts[5], parts[6]), 7)
            } else if parts.len() >= 10 && parts[7].contains(':') && parts[8].chars().all(|c| c.is_ascii_digit()) {
                // BSD -T format: month day time year, name starts at index 9
                (format!("{} {} {} {}", parts[5], parts[6], parts[7], parts[8]), 9)
            } else {
                // BSD without -T: month day (time|year), name starts at index 8
                (format!("{} {} {}", parts[5], parts[6], parts[7]), 8)
            };

            if name_start_idx >= parts.len() {
                continue;
            }

            let name_raw = parts[name_start_idx..].join(" ");

            // Handle symlinks: "name -> target"
            let (name, symlink_target) = if file_type == FileType::Symlink {
                if let Some(idx) = name_raw.find(" -> ") {
                    (name_raw[..idx].to_string(), Some(name_raw[idx + 4..].to_string()))
                } else {
                    (name_raw, None)
                }
            } else {
                (name_raw, None)
            };

            // Skip . and ..
            if name == "." || name == ".." {
                continue;
            }

            let is_hidden = name.starts_with('.');
            let path = format!("{}/{}", base, name);

            entries.push(FileEntry {
                name,
                path,
                file_type,
                size,
                permissions,
                owner,
                group,
                modified,
                symlink_target,
                is_hidden,
            });
        }

        Ok(entries)
    }

    /// Format bytes to human-readable string (e.g., "8.5G")
    fn format_bytes(bytes: u64) -> String {
        const KB: u64 = 1024;
        const MB: u64 = KB * 1024;
        const GB: u64 = MB * 1024;
        const TB: u64 = GB * 1024;

        if bytes >= TB {
            format!("{:.1}T", bytes as f64 / TB as f64)
        } else if bytes >= GB {
            format!("{:.1}G", bytes as f64 / GB as f64)
        } else if bytes >= MB {
            format!("{:.1}M", bytes as f64 / MB as f64)
        } else if bytes >= KB {
            format!("{:.1}K", bytes as f64 / KB as f64)
        } else {
            format!("{}B", bytes)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_status() {
        assert_eq!(
            OutputParser::parse_status("running"),
            ContainerStatus::Running
        );
        assert_eq!(OutputParser::parse_status("Up 2 hours"), ContainerStatus::Running);
        assert_eq!(
            OutputParser::parse_status("Exited (0)"),
            ContainerStatus::Exited
        );
        assert_eq!(
            OutputParser::parse_status("paused"),
            ContainerStatus::Paused
        );
    }

    #[test]
    fn test_parse_docker_ports() {
        let ports = OutputParser::parse_docker_ports("0.0.0.0:8080->80/tcp, 0.0.0.0:443->443/tcp");
        assert_eq!(ports.len(), 2);
        assert_eq!(ports[0].host_port, 8080);
        assert_eq!(ports[0].container_port, 80);
    }

    #[test]
    fn test_parse_size_string() {
        assert_eq!(OutputParser::parse_size_string("1.5GB"), Some(1610612736));
        assert_eq!(OutputParser::parse_size_string("100MB"), Some(104857600));
        assert_eq!(OutputParser::parse_size_string("1024KB"), Some(1048576));
    }

    #[test]
    fn test_parse_directory_listing_bsd() {
        // macOS ls -laT format
        let output = r#"total 11
drwxr-xr-x  22 root  wheel   704 Jul 20 09:19:46 2025 .
drwxr-xr-x  22 root  wheel   704 Jul 20 09:19:46 2025 ..
lrwxr-xr-x   1 root  admin    36 Jul 20 09:19:46 2025 .VolumeIcon.icns -> System/Volumes/Data/.VolumeIcon.icns
----------   1 root  admin     0 Jul 20 09:19:46 2025 .file
drwxrwxr-x  29 root  admin   928 Feb  3 22:39:50 2026 Applications
drwxr-xr-x@ 10 root  wheel   320 Jul 20 09:19:46 2025 System
drwxr-xr-x   5 root  admin   160 Aug  1 18:36:16 2025 Users
lrwxr-xr-x@  1 root  wheel    11 Jul 20 09:19:46 2025 etc -> private/etc"#;

        let entries = OutputParser::parse_directory_listing(output, "/").unwrap();
        // . and .. are skipped, so we expect 6 entries
        assert_eq!(entries.len(), 6);

        // Check .VolumeIcon.icns (symlink, hidden)
        let vi = entries.iter().find(|e| e.name == ".VolumeIcon.icns").unwrap();
        assert_eq!(vi.file_type, crate::models::file_browser::FileType::Symlink);
        assert!(vi.is_hidden);
        assert_eq!(vi.symlink_target.as_deref(), Some("System/Volumes/Data/.VolumeIcon.icns"));

        // Check Applications (directory)
        let apps = entries.iter().find(|e| e.name == "Applications").unwrap();
        assert_eq!(apps.file_type, crate::models::file_browser::FileType::Directory);
        assert_eq!(apps.size, 928);
        assert_eq!(apps.owner, "root");
        assert_eq!(apps.path, "/Applications");
        assert!(!apps.is_hidden);

        // Check etc (symlink)
        let etc = entries.iter().find(|e| e.name == "etc").unwrap();
        assert_eq!(etc.symlink_target.as_deref(), Some("private/etc"));
    }

    #[test]
    fn test_parse_directory_listing_gnu() {
        // GNU ls --time-style=long-iso format
        let output = r#"total 48
drwxr-xr-x  5 user group  4096 2024-01-15 10:30 .
drwxr-xr-x 12 user group  4096 2024-01-15 09:00 ..
-rw-r--r--  1 user group  1234 2024-01-15 10:30 readme.md
drwxr-xr-x  2 user group  4096 2024-01-10 08:15 src
lrwxrwxrwx  1 user group     6 2024-01-15 10:30 link -> target"#;

        let entries = OutputParser::parse_directory_listing(output, "/home/user").unwrap();
        assert_eq!(entries.len(), 3);

        let readme = entries.iter().find(|e| e.name == "readme.md").unwrap();
        assert_eq!(readme.file_type, crate::models::file_browser::FileType::File);
        assert_eq!(readme.size, 1234);
        assert_eq!(readme.path, "/home/user/readme.md");
        assert_eq!(readme.modified, "2024-01-15 10:30");

        let link = entries.iter().find(|e| e.name == "link").unwrap();
        assert_eq!(link.symlink_target.as_deref(), Some("target"));
    }
}
