use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::models::container::ContainerRuntime;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CommandCategory {
    ContainerManagement,
    Debugging,
    Networking,
    Images,
    Volumes,
    System,
    Pods,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateVariable {
    pub name: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_value: Option<String>,
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandCompatibility {
    pub runtimes: Vec<ContainerRuntime>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_ids: Option<Vec<String>>,
}

impl Default for CommandCompatibility {
    fn default() -> Self {
        Self {
            runtimes: vec![ContainerRuntime::Docker, ContainerRuntime::Podman],
            system_ids: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandTemplate {
    pub id: String,
    pub name: String,
    pub description: String,
    pub command: String,
    pub category: CommandCategory,
    pub tags: Vec<String>,
    pub variables: Vec<TemplateVariable>,
    pub compatibility: CommandCompatibility,
    pub is_favorite: bool,
    pub is_built_in: bool,
    pub created_at: String,
    pub updated_at: String,
}

impl CommandTemplate {
    pub fn new(
        name: String,
        description: String,
        command: String,
        category: CommandCategory,
        tags: Vec<String>,
        variables: Vec<TemplateVariable>,
        compatibility: CommandCompatibility,
    ) -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            description,
            command,
            category,
            tags,
            variables,
            compatibility,
            is_favorite: false,
            is_built_in: false,
            created_at: now.clone(),
            updated_at: now,
        }
    }

    /// Generate a deterministic ID for built-in templates based on name
    fn generate_built_in_id(name: &str) -> String {
        // Convert "Start Container (Apple)" → "builtin-start-container-apple"
        let slug: String = name
            .to_lowercase()
            .chars()
            .map(|c| match c {
                'a'..='z' | '0'..='9' => c,
                ' ' | '-' | '_' => '-',
                _ => '-', // Replace parentheses, etc. with dash
            })
            .collect::<String>()
            .split('-')
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("-");
        format!("builtin-{}", slug)
    }

    pub fn new_built_in(
        name: &str,
        description: &str,
        command: &str,
        category: CommandCategory,
        tags: Vec<&str>,
        variables: Vec<TemplateVariable>,
    ) -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        Self {
            id: Self::generate_built_in_id(name),
            name: name.to_string(),
            description: description.to_string(),
            command: command.to_string(),
            category,
            tags: tags.into_iter().map(String::from).collect(),
            variables,
            compatibility: CommandCompatibility::default(),
            is_favorite: false,
            is_built_in: true,
            created_at: now.clone(),
            updated_at: now,
        }
    }

    pub fn new_built_in_for_runtime(
        name: &str,
        description: &str,
        command: &str,
        category: CommandCategory,
        tags: Vec<&str>,
        variables: Vec<TemplateVariable>,
        runtimes: Vec<ContainerRuntime>,
    ) -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        Self {
            id: Self::generate_built_in_id(name),
            name: name.to_string(),
            description: description.to_string(),
            command: command.to_string(),
            category,
            tags: tags.into_iter().map(String::from).collect(),
            variables,
            compatibility: CommandCompatibility {
                runtimes,
                system_ids: None,
            },
            is_favorite: false,
            is_built_in: true,
            created_at: now.clone(),
            updated_at: now,
        }
    }
}

// Common variable definitions
fn var_container_name() -> TemplateVariable {
    TemplateVariable {
        name: "CONTAINER_NAME".to_string(),
        description: "Container name or ID".to_string(),
        default_value: None,
        required: true,
    }
}

fn var_image_name() -> TemplateVariable {
    TemplateVariable {
        name: "IMAGE_NAME".to_string(),
        description: "Image name with optional tag".to_string(),
        default_value: None,
        required: true,
    }
}

fn var_network_name() -> TemplateVariable {
    TemplateVariable {
        name: "NETWORK_NAME".to_string(),
        description: "Network name".to_string(),
        default_value: None,
        required: true,
    }
}

fn var_volume_name() -> TemplateVariable {
    TemplateVariable {
        name: "VOLUME_NAME".to_string(),
        description: "Volume name".to_string(),
        default_value: None,
        required: true,
    }
}

fn var_pod_name() -> TemplateVariable {
    TemplateVariable {
        name: "POD_NAME".to_string(),
        description: "Pod name".to_string(),
        default_value: None,
        required: true,
    }
}

fn var_shell() -> TemplateVariable {
    TemplateVariable {
        name: "SHELL".to_string(),
        description: "Shell to execute".to_string(),
        default_value: Some("/bin/sh".to_string()),
        required: true,
    }
}

fn var_command() -> TemplateVariable {
    TemplateVariable {
        name: "COMMAND".to_string(),
        description: "Command to execute".to_string(),
        default_value: None,
        required: true,
    }
}

fn var_host_port() -> TemplateVariable {
    TemplateVariable {
        name: "HOST_PORT".to_string(),
        description: "Port on host machine".to_string(),
        default_value: Some("8080".to_string()),
        required: true,
    }
}

fn var_container_port() -> TemplateVariable {
    TemplateVariable {
        name: "CONTAINER_PORT".to_string(),
        description: "Port inside container".to_string(),
        default_value: Some("80".to_string()),
        required: true,
    }
}

fn var_host_path() -> TemplateVariable {
    TemplateVariable {
        name: "HOST_PATH".to_string(),
        description: "Path on host filesystem".to_string(),
        default_value: Some("./".to_string()),
        required: true,
    }
}

fn var_container_path() -> TemplateVariable {
    TemplateVariable {
        name: "CONTAINER_PATH".to_string(),
        description: "Path inside container".to_string(),
        default_value: Some("/app".to_string()),
        required: true,
    }
}

fn var_new_name() -> TemplateVariable {
    TemplateVariable {
        name: "NEW_NAME".to_string(),
        description: "New container name".to_string(),
        default_value: None,
        required: true,
    }
}

fn var_lines() -> TemplateVariable {
    TemplateVariable {
        name: "LINES".to_string(),
        description: "Number of log lines".to_string(),
        default_value: Some("100".to_string()),
        required: true,
    }
}

fn var_source_image() -> TemplateVariable {
    TemplateVariable {
        name: "SOURCE_IMAGE".to_string(),
        description: "Source image to tag".to_string(),
        default_value: None,
        required: true,
    }
}

fn var_target_image() -> TemplateVariable {
    TemplateVariable {
        name: "TARGET_IMAGE".to_string(),
        description: "Target image name".to_string(),
        default_value: None,
        required: true,
    }
}

fn var_build_path() -> TemplateVariable {
    TemplateVariable {
        name: "BUILD_PATH".to_string(),
        description: "Build context path".to_string(),
        default_value: Some(".".to_string()),
        required: true,
    }
}

fn var_filename() -> TemplateVariable {
    TemplateVariable {
        name: "FILENAME".to_string(),
        description: "Output filename".to_string(),
        default_value: None,
        required: true,
    }
}

fn var_search_term() -> TemplateVariable {
    TemplateVariable {
        name: "SEARCH_TERM".to_string(),
        description: "Search query".to_string(),
        default_value: None,
        required: true,
    }
}

fn var_yaml_file() -> TemplateVariable {
    TemplateVariable {
        name: "YAML_FILE".to_string(),
        description: "Path to YAML file".to_string(),
        default_value: None,
        required: true,
    }
}

fn var_runtime() -> TemplateVariable {
    TemplateVariable {
        name: "RUNTIME".to_string(),
        description: "Container runtime (docker/podman)".to_string(),
        default_value: Some("docker".to_string()),
        required: true,
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCommandTemplateRequest {
    pub name: String,
    pub description: String,
    pub command: String,
    pub category: CommandCategory,
    pub tags: Vec<String>,
    pub variables: Vec<TemplateVariable>,
    pub compatibility: CommandCompatibility,
    #[serde(default)]
    pub is_favorite: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCommandTemplateRequest {
    pub id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub command: Option<String>,
    pub category: Option<CommandCategory>,
    pub tags: Option<Vec<String>>,
    pub variables: Option<Vec<TemplateVariable>>,
    pub compatibility: Option<CommandCompatibility>,
    pub is_favorite: Option<bool>,
}

/// Get the built-in command templates
pub fn get_built_in_templates() -> Vec<CommandTemplate> {
    let mut templates = Vec::new();

    // =====================================================================
    // DOCKER/PODMAN COMMANDS (shared syntax)
    // =====================================================================

    // Container Lifecycle
    templates.push(CommandTemplate::new_built_in(
        "Create Container",
        "Create a new container without starting it",
        "${RUNTIME} create --name ${CONTAINER_NAME} ${IMAGE_NAME}",
        CommandCategory::ContainerManagement,
        vec!["docker", "podman", "create", "container"],
        vec![var_runtime(), var_container_name(), var_image_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Start Container",
        "Start a stopped container",
        "${RUNTIME} start ${CONTAINER_NAME}",
        CommandCategory::ContainerManagement,
        vec!["docker", "podman", "start"],
        vec![var_runtime(), var_container_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Stop Container",
        "Stop a running container",
        "${RUNTIME} stop ${CONTAINER_NAME}",
        CommandCategory::ContainerManagement,
        vec!["docker", "podman", "stop"],
        vec![var_runtime(), var_container_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Restart Container",
        "Restart a container",
        "${RUNTIME} restart ${CONTAINER_NAME}",
        CommandCategory::ContainerManagement,
        vec!["docker", "podman", "restart"],
        vec![var_runtime(), var_container_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Pause Container",
        "Pause all processes in a container",
        "${RUNTIME} pause ${CONTAINER_NAME}",
        CommandCategory::ContainerManagement,
        vec!["docker", "podman", "pause"],
        vec![var_runtime(), var_container_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Unpause Container",
        "Unpause a paused container",
        "${RUNTIME} unpause ${CONTAINER_NAME}",
        CommandCategory::ContainerManagement,
        vec!["docker", "podman", "unpause"],
        vec![var_runtime(), var_container_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Kill Container",
        "Kill a running container",
        "${RUNTIME} kill ${CONTAINER_NAME}",
        CommandCategory::ContainerManagement,
        vec!["docker", "podman", "kill"],
        vec![var_runtime(), var_container_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Remove Container",
        "Remove a stopped container",
        "${RUNTIME} rm ${CONTAINER_NAME}",
        CommandCategory::ContainerManagement,
        vec!["docker", "podman", "remove", "rm"],
        vec![var_runtime(), var_container_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Force Remove Container",
        "Force remove a container (even if running)",
        "${RUNTIME} rm -f ${CONTAINER_NAME}",
        CommandCategory::ContainerManagement,
        vec!["docker", "podman", "remove", "force"],
        vec![var_runtime(), var_container_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Rename Container",
        "Rename a container",
        "${RUNTIME} rename ${CONTAINER_NAME} ${NEW_NAME}",
        CommandCategory::ContainerManagement,
        vec!["docker", "podman", "rename"],
        vec![var_runtime(), var_container_name(), var_new_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Run Interactive Container",
        "Run a new container with interactive shell",
        "${RUNTIME} run -it --name ${CONTAINER_NAME} ${IMAGE_NAME} ${SHELL}",
        CommandCategory::ContainerManagement,
        vec!["docker", "podman", "run", "interactive"],
        vec![var_runtime(), var_container_name(), var_image_name(), var_shell()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Run Detached Container",
        "Run a new container in background",
        "${RUNTIME} run -d --name ${CONTAINER_NAME} ${IMAGE_NAME}",
        CommandCategory::ContainerManagement,
        vec!["docker", "podman", "run", "detached", "background"],
        vec![var_runtime(), var_container_name(), var_image_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Run with Port Mapping",
        "Run a container with port forwarding",
        "${RUNTIME} run -d -p ${HOST_PORT}:${CONTAINER_PORT} --name ${CONTAINER_NAME} ${IMAGE_NAME}",
        CommandCategory::ContainerManagement,
        vec!["docker", "podman", "run", "port"],
        vec![var_runtime(), var_host_port(), var_container_port(), var_container_name(), var_image_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Run with Volume Mount",
        "Run a container with a volume mounted",
        "${RUNTIME} run -d -v ${HOST_PATH}:${CONTAINER_PATH} --name ${CONTAINER_NAME} ${IMAGE_NAME}",
        CommandCategory::ContainerManagement,
        vec!["docker", "podman", "run", "volume", "mount"],
        vec![var_runtime(), var_host_path(), var_container_path(), var_container_name(), var_image_name()],
    ));

    // Container Introspection
    templates.push(CommandTemplate::new_built_in(
        "List Running Containers",
        "List only running containers",
        "${RUNTIME} ps",
        CommandCategory::ContainerManagement,
        vec!["docker", "podman", "list", "ps", "running"],
        vec![var_runtime()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "List All Containers",
        "List all containers including stopped ones",
        "${RUNTIME} ps -a",
        CommandCategory::ContainerManagement,
        vec!["docker", "podman", "list", "ps", "all"],
        vec![var_runtime()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Inspect Container",
        "Get detailed container configuration as JSON",
        "${RUNTIME} inspect ${CONTAINER_NAME}",
        CommandCategory::Debugging,
        vec!["docker", "podman", "inspect", "json"],
        vec![var_runtime(), var_container_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "View Logs",
        "View container logs",
        "${RUNTIME} logs ${CONTAINER_NAME}",
        CommandCategory::Debugging,
        vec!["docker", "podman", "logs"],
        vec![var_runtime(), var_container_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Follow Logs",
        "Follow container logs in real-time",
        "${RUNTIME} logs -f ${CONTAINER_NAME}",
        CommandCategory::Debugging,
        vec!["docker", "podman", "logs", "follow", "tail"],
        vec![var_runtime(), var_container_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Logs with Timestamps",
        "View logs with timestamps",
        "${RUNTIME} logs -t ${CONTAINER_NAME}",
        CommandCategory::Debugging,
        vec!["docker", "podman", "logs", "timestamp"],
        vec![var_runtime(), var_container_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Tail Logs",
        "View last N lines of logs",
        "${RUNTIME} logs --tail ${LINES} ${CONTAINER_NAME}",
        CommandCategory::Debugging,
        vec!["docker", "podman", "logs", "tail"],
        vec![var_runtime(), var_lines(), var_container_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Container Stats",
        "Monitor container resource usage",
        "${RUNTIME} stats ${CONTAINER_NAME}",
        CommandCategory::Debugging,
        vec!["docker", "podman", "stats", "resources", "monitoring"],
        vec![var_runtime(), var_container_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "All Container Stats",
        "Monitor all containers resource usage",
        "${RUNTIME} stats --all",
        CommandCategory::Debugging,
        vec!["docker", "podman", "stats", "all"],
        vec![var_runtime()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Top Processes",
        "Show running processes in a container",
        "${RUNTIME} top ${CONTAINER_NAME}",
        CommandCategory::Debugging,
        vec!["docker", "podman", "top", "processes", "ps"],
        vec![var_runtime(), var_container_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Container Diff",
        "Show changes to container filesystem",
        "${RUNTIME} diff ${CONTAINER_NAME}",
        CommandCategory::Debugging,
        vec!["docker", "podman", "diff", "changes"],
        vec![var_runtime(), var_container_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Port Mappings",
        "Show port mappings for a container",
        "${RUNTIME} port ${CONTAINER_NAME}",
        CommandCategory::Debugging,
        vec!["docker", "podman", "port", "mapping"],
        vec![var_runtime(), var_container_name()],
    ));

    // Container Interaction
    templates.push(CommandTemplate::new_built_in(
        "Exec Command",
        "Execute a command in a running container",
        "${RUNTIME} exec ${CONTAINER_NAME} ${COMMAND}",
        CommandCategory::ContainerManagement,
        vec!["docker", "podman", "exec", "command"],
        vec![var_runtime(), var_container_name(), var_command()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Shell into Container (bash)",
        "Open an interactive bash shell",
        "${RUNTIME} exec -it ${CONTAINER_NAME} /bin/bash",
        CommandCategory::ContainerManagement,
        vec!["docker", "podman", "exec", "shell", "bash", "interactive"],
        vec![var_runtime(), var_container_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Shell into Container (sh)",
        "Open an interactive sh shell",
        "${RUNTIME} exec -it ${CONTAINER_NAME} /bin/sh",
        CommandCategory::ContainerManagement,
        vec!["docker", "podman", "exec", "shell", "sh", "interactive"],
        vec![var_runtime(), var_container_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Attach to Container",
        "Attach to a running container",
        "${RUNTIME} attach ${CONTAINER_NAME}",
        CommandCategory::ContainerManagement,
        vec!["docker", "podman", "attach"],
        vec![var_runtime(), var_container_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Copy to Container",
        "Copy files to a container",
        "${RUNTIME} cp ${HOST_PATH} ${CONTAINER_NAME}:${CONTAINER_PATH}",
        CommandCategory::ContainerManagement,
        vec!["docker", "podman", "cp", "copy", "upload"],
        vec![var_runtime(), var_host_path(), var_container_name(), var_container_path()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Copy from Container",
        "Copy files from a container",
        "${RUNTIME} cp ${CONTAINER_NAME}:${CONTAINER_PATH} ${HOST_PATH}",
        CommandCategory::ContainerManagement,
        vec!["docker", "podman", "cp", "copy", "download"],
        vec![var_runtime(), var_container_name(), var_container_path(), var_host_path()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "View Environment",
        "Show container environment variables",
        "${RUNTIME} exec ${CONTAINER_NAME} env",
        CommandCategory::Debugging,
        vec!["docker", "podman", "env", "environment"],
        vec![var_runtime(), var_container_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Check Health Status",
        "Get container health status",
        "${RUNTIME} inspect --format '{{.State.Health.Status}}' ${CONTAINER_NAME}",
        CommandCategory::Debugging,
        vec!["docker", "podman", "health", "status"],
        vec![var_runtime(), var_container_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Container State",
        "Get container state",
        "${RUNTIME} inspect --format '{{.State.Status}}' ${CONTAINER_NAME}",
        CommandCategory::Debugging,
        vec!["docker", "podman", "state", "status"],
        vec![var_runtime(), var_container_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Exit Code",
        "Get container exit code",
        "${RUNTIME} inspect --format '{{.State.ExitCode}}' ${CONTAINER_NAME}",
        CommandCategory::Debugging,
        vec!["docker", "podman", "exit", "code"],
        vec![var_runtime(), var_container_name()],
    ));

    // Image Management
    templates.push(CommandTemplate::new_built_in(
        "List Images",
        "List all local images",
        "${RUNTIME} images",
        CommandCategory::Images,
        vec!["docker", "podman", "images", "list"],
        vec![var_runtime()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Pull Image",
        "Pull an image from registry",
        "${RUNTIME} pull ${IMAGE_NAME}",
        CommandCategory::Images,
        vec!["docker", "podman", "pull", "download"],
        vec![var_runtime(), var_image_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Push Image",
        "Push an image to registry",
        "${RUNTIME} push ${IMAGE_NAME}",
        CommandCategory::Images,
        vec!["docker", "podman", "push", "upload"],
        vec![var_runtime(), var_image_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Build Image",
        "Build an image from Dockerfile",
        "${RUNTIME} build -t ${IMAGE_NAME} ${BUILD_PATH}",
        CommandCategory::Images,
        vec!["docker", "podman", "build", "dockerfile"],
        vec![var_runtime(), var_image_name(), var_build_path()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Build Image (No Cache)",
        "Build an image without cache",
        "${RUNTIME} build --no-cache -t ${IMAGE_NAME} ${BUILD_PATH}",
        CommandCategory::Images,
        vec!["docker", "podman", "build", "nocache"],
        vec![var_runtime(), var_image_name(), var_build_path()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Tag Image",
        "Tag an image with a new name",
        "${RUNTIME} tag ${SOURCE_IMAGE} ${TARGET_IMAGE}",
        CommandCategory::Images,
        vec!["docker", "podman", "tag"],
        vec![var_runtime(), var_source_image(), var_target_image()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Remove Image",
        "Remove an image",
        "${RUNTIME} rmi ${IMAGE_NAME}",
        CommandCategory::Images,
        vec!["docker", "podman", "rmi", "remove"],
        vec![var_runtime(), var_image_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Force Remove Image",
        "Force remove an image",
        "${RUNTIME} rmi -f ${IMAGE_NAME}",
        CommandCategory::Images,
        vec!["docker", "podman", "rmi", "remove", "force"],
        vec![var_runtime(), var_image_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Image History",
        "Show image layer history",
        "${RUNTIME} history ${IMAGE_NAME}",
        CommandCategory::Images,
        vec!["docker", "podman", "history", "layers"],
        vec![var_runtime(), var_image_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Inspect Image",
        "Get detailed image information",
        "${RUNTIME} image inspect ${IMAGE_NAME}",
        CommandCategory::Images,
        vec!["docker", "podman", "image", "inspect"],
        vec![var_runtime(), var_image_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Save Image",
        "Save image to tar archive",
        "${RUNTIME} save ${IMAGE_NAME} -o ${FILENAME}",
        CommandCategory::Images,
        vec!["docker", "podman", "save", "export", "tar"],
        vec![var_runtime(), var_image_name(), var_filename()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Load Image",
        "Load image from tar archive",
        "${RUNTIME} load -i ${FILENAME}",
        CommandCategory::Images,
        vec!["docker", "podman", "load", "import", "tar"],
        vec![var_runtime(), var_filename()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Prune Images",
        "Remove unused images",
        "${RUNTIME} image prune",
        CommandCategory::Images,
        vec!["docker", "podman", "prune", "cleanup"],
        vec![var_runtime()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Prune All Images",
        "Remove all unused images",
        "${RUNTIME} image prune -a",
        CommandCategory::Images,
        vec!["docker", "podman", "prune", "cleanup", "all"],
        vec![var_runtime()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Search Images",
        "Search for images in registry",
        "${RUNTIME} search ${SEARCH_TERM}",
        CommandCategory::Images,
        vec!["docker", "podman", "search", "registry"],
        vec![var_runtime(), var_search_term()],
    ));

    // Network Management
    templates.push(CommandTemplate::new_built_in(
        "List Networks",
        "List all networks",
        "${RUNTIME} network ls",
        CommandCategory::Networking,
        vec!["docker", "podman", "network", "list"],
        vec![var_runtime()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Create Network",
        "Create a new network",
        "${RUNTIME} network create ${NETWORK_NAME}",
        CommandCategory::Networking,
        vec!["docker", "podman", "network", "create"],
        vec![var_runtime(), var_network_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Create Bridge Network",
        "Create a new bridge network",
        "${RUNTIME} network create --driver bridge ${NETWORK_NAME}",
        CommandCategory::Networking,
        vec!["docker", "podman", "network", "create", "bridge"],
        vec![var_runtime(), var_network_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Remove Network",
        "Remove a network",
        "${RUNTIME} network rm ${NETWORK_NAME}",
        CommandCategory::Networking,
        vec!["docker", "podman", "network", "remove"],
        vec![var_runtime(), var_network_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Inspect Network",
        "Inspect network details",
        "${RUNTIME} network inspect ${NETWORK_NAME}",
        CommandCategory::Networking,
        vec!["docker", "podman", "network", "inspect"],
        vec![var_runtime(), var_network_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Connect to Network",
        "Connect a container to a network",
        "${RUNTIME} network connect ${NETWORK_NAME} ${CONTAINER_NAME}",
        CommandCategory::Networking,
        vec!["docker", "podman", "network", "connect"],
        vec![var_runtime(), var_network_name(), var_container_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Disconnect from Network",
        "Disconnect a container from a network",
        "${RUNTIME} network disconnect ${NETWORK_NAME} ${CONTAINER_NAME}",
        CommandCategory::Networking,
        vec!["docker", "podman", "network", "disconnect"],
        vec![var_runtime(), var_network_name(), var_container_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Prune Networks",
        "Remove unused networks",
        "${RUNTIME} network prune",
        CommandCategory::Networking,
        vec!["docker", "podman", "network", "prune", "cleanup"],
        vec![var_runtime()],
    ));

    // Volume Management
    templates.push(CommandTemplate::new_built_in(
        "List Volumes",
        "List all volumes",
        "${RUNTIME} volume ls",
        CommandCategory::Volumes,
        vec!["docker", "podman", "volume", "list"],
        vec![var_runtime()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Create Volume",
        "Create a new volume",
        "${RUNTIME} volume create ${VOLUME_NAME}",
        CommandCategory::Volumes,
        vec!["docker", "podman", "volume", "create"],
        vec![var_runtime(), var_volume_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Remove Volume",
        "Remove a volume",
        "${RUNTIME} volume rm ${VOLUME_NAME}",
        CommandCategory::Volumes,
        vec!["docker", "podman", "volume", "remove"],
        vec![var_runtime(), var_volume_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Inspect Volume",
        "Inspect volume details",
        "${RUNTIME} volume inspect ${VOLUME_NAME}",
        CommandCategory::Volumes,
        vec!["docker", "podman", "volume", "inspect"],
        vec![var_runtime(), var_volume_name()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Prune Volumes",
        "Remove unused volumes",
        "${RUNTIME} volume prune",
        CommandCategory::Volumes,
        vec!["docker", "podman", "volume", "prune", "cleanup"],
        vec![var_runtime()],
    ));

    // System Commands
    templates.push(CommandTemplate::new_built_in(
        "System Info",
        "Display system-wide information",
        "${RUNTIME} info",
        CommandCategory::System,
        vec!["docker", "podman", "info", "system"],
        vec![var_runtime()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Disk Usage",
        "Show disk usage",
        "${RUNTIME} system df",
        CommandCategory::System,
        vec!["docker", "podman", "disk", "df", "storage"],
        vec![var_runtime()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Detailed Disk Usage",
        "Show detailed disk usage",
        "${RUNTIME} system df -v",
        CommandCategory::System,
        vec!["docker", "podman", "disk", "df", "verbose"],
        vec![var_runtime()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "System Prune",
        "Remove unused data",
        "${RUNTIME} system prune",
        CommandCategory::System,
        vec!["docker", "podman", "prune", "cleanup"],
        vec![var_runtime()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Full System Prune",
        "Remove all unused data including volumes",
        "${RUNTIME} system prune -a --volumes",
        CommandCategory::System,
        vec!["docker", "podman", "prune", "cleanup", "all"],
        vec![var_runtime()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Version",
        "Show version information",
        "${RUNTIME} version",
        CommandCategory::System,
        vec!["docker", "podman", "version"],
        vec![var_runtime()],
    ));

    templates.push(CommandTemplate::new_built_in(
        "Events",
        "Get real-time events from the server",
        "${RUNTIME} events",
        CommandCategory::System,
        vec!["docker", "podman", "events", "monitoring"],
        vec![var_runtime()],
    ));

    // =====================================================================
    // APPLE CONTAINER COMMANDS (different base command)
    // =====================================================================

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Create Container (Apple)",
        "Create a new container without starting it",
        "container create --name ${CONTAINER_NAME} ${IMAGE_NAME}",
        CommandCategory::ContainerManagement,
        vec!["apple", "container", "create"],
        vec![var_container_name(), var_image_name()],
        vec![ContainerRuntime::Apple],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Start Container (Apple)",
        "Start a stopped container",
        "container start ${CONTAINER_NAME}",
        CommandCategory::ContainerManagement,
        vec!["apple", "container", "start"],
        vec![var_container_name()],
        vec![ContainerRuntime::Apple],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Stop Container (Apple)",
        "Stop a running container",
        "container stop ${CONTAINER_NAME}",
        CommandCategory::ContainerManagement,
        vec!["apple", "container", "stop"],
        vec![var_container_name()],
        vec![ContainerRuntime::Apple],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Restart Container (Apple)",
        "Restart a container",
        "container restart ${CONTAINER_NAME}",
        CommandCategory::ContainerManagement,
        vec!["apple", "container", "restart"],
        vec![var_container_name()],
        vec![ContainerRuntime::Apple],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Pause Container (Apple)",
        "Pause all processes in a container",
        "container pause ${CONTAINER_NAME}",
        CommandCategory::ContainerManagement,
        vec!["apple", "container", "pause"],
        vec![var_container_name()],
        vec![ContainerRuntime::Apple],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Resume Container (Apple)",
        "Resume a paused container",
        "container resume ${CONTAINER_NAME}",
        CommandCategory::ContainerManagement,
        vec!["apple", "container", "resume", "unpause"],
        vec![var_container_name()],
        vec![ContainerRuntime::Apple],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Kill Container (Apple)",
        "Kill a running container",
        "container kill ${CONTAINER_NAME}",
        CommandCategory::ContainerManagement,
        vec!["apple", "container", "kill"],
        vec![var_container_name()],
        vec![ContainerRuntime::Apple],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Remove Container (Apple)",
        "Remove a stopped container",
        "container rm ${CONTAINER_NAME}",
        CommandCategory::ContainerManagement,
        vec!["apple", "container", "remove", "rm"],
        vec![var_container_name()],
        vec![ContainerRuntime::Apple],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Run Interactive (Apple)",
        "Run a new container with interactive shell",
        "container run -it --name ${CONTAINER_NAME} ${IMAGE_NAME} ${SHELL}",
        CommandCategory::ContainerManagement,
        vec!["apple", "container", "run", "interactive"],
        vec![var_container_name(), var_image_name(), var_shell()],
        vec![ContainerRuntime::Apple],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Run Detached (Apple)",
        "Run a new container in background",
        "container run -d --name ${CONTAINER_NAME} ${IMAGE_NAME}",
        CommandCategory::ContainerManagement,
        vec!["apple", "container", "run", "detached"],
        vec![var_container_name(), var_image_name()],
        vec![ContainerRuntime::Apple],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "List Containers (Apple)",
        "List running containers",
        "container ps",
        CommandCategory::ContainerManagement,
        vec!["apple", "container", "list", "ps"],
        vec![],
        vec![ContainerRuntime::Apple],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "List All Containers (Apple)",
        "List all containers",
        "container ps -a",
        CommandCategory::ContainerManagement,
        vec!["apple", "container", "list", "all"],
        vec![],
        vec![ContainerRuntime::Apple],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Inspect Container (Apple)",
        "Get detailed container information",
        "container inspect ${CONTAINER_NAME}",
        CommandCategory::Debugging,
        vec!["apple", "container", "inspect"],
        vec![var_container_name()],
        vec![ContainerRuntime::Apple],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "View Logs (Apple)",
        "View container logs",
        "container logs ${CONTAINER_NAME}",
        CommandCategory::Debugging,
        vec!["apple", "container", "logs"],
        vec![var_container_name()],
        vec![ContainerRuntime::Apple],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Follow Logs (Apple)",
        "Follow container logs in real-time",
        "container logs -f ${CONTAINER_NAME}",
        CommandCategory::Debugging,
        vec!["apple", "container", "logs", "follow"],
        vec![var_container_name()],
        vec![ContainerRuntime::Apple],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Container Stats (Apple)",
        "Monitor container resource usage",
        "container stats ${CONTAINER_NAME}",
        CommandCategory::Debugging,
        vec!["apple", "container", "stats"],
        vec![var_container_name()],
        vec![ContainerRuntime::Apple],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Exec Command (Apple)",
        "Execute a command in a running container",
        "container exec ${CONTAINER_NAME} ${COMMAND}",
        CommandCategory::ContainerManagement,
        vec!["apple", "container", "exec"],
        vec![var_container_name(), var_command()],
        vec![ContainerRuntime::Apple],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Shell into Container (Apple)",
        "Open an interactive shell",
        "container exec -it ${CONTAINER_NAME} ${SHELL}",
        CommandCategory::ContainerManagement,
        vec!["apple", "container", "exec", "shell"],
        vec![var_container_name(), var_shell()],
        vec![ContainerRuntime::Apple],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "List Images (Apple)",
        "List all local images",
        "container images",
        CommandCategory::Images,
        vec!["apple", "container", "images", "list"],
        vec![],
        vec![ContainerRuntime::Apple],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Pull Image (Apple)",
        "Pull an image from registry",
        "container pull ${IMAGE_NAME}",
        CommandCategory::Images,
        vec!["apple", "container", "pull"],
        vec![var_image_name()],
        vec![ContainerRuntime::Apple],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Build Image (Apple)",
        "Build an image from Dockerfile",
        "container build -t ${IMAGE_NAME} ${BUILD_PATH}",
        CommandCategory::Images,
        vec!["apple", "container", "build"],
        vec![var_image_name(), var_build_path()],
        vec![ContainerRuntime::Apple],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Remove Image (Apple)",
        "Remove an image",
        "container rmi ${IMAGE_NAME}",
        CommandCategory::Images,
        vec!["apple", "container", "rmi", "remove"],
        vec![var_image_name()],
        vec![ContainerRuntime::Apple],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "List Networks (Apple)",
        "List all networks",
        "container network ls",
        CommandCategory::Networking,
        vec!["apple", "container", "network", "list"],
        vec![],
        vec![ContainerRuntime::Apple],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Create Network (Apple)",
        "Create a new network",
        "container network create ${NETWORK_NAME}",
        CommandCategory::Networking,
        vec!["apple", "container", "network", "create"],
        vec![var_network_name()],
        vec![ContainerRuntime::Apple],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Inspect Network (Apple)",
        "Inspect network details",
        "container network inspect ${NETWORK_NAME}",
        CommandCategory::Networking,
        vec!["apple", "container", "network", "inspect"],
        vec![var_network_name()],
        vec![ContainerRuntime::Apple],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "List Volumes (Apple)",
        "List all volumes",
        "container volume ls",
        CommandCategory::Volumes,
        vec!["apple", "container", "volume", "list"],
        vec![],
        vec![ContainerRuntime::Apple],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Create Volume (Apple)",
        "Create a new volume",
        "container volume create ${VOLUME_NAME}",
        CommandCategory::Volumes,
        vec!["apple", "container", "volume", "create"],
        vec![var_volume_name()],
        vec![ContainerRuntime::Apple],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "System Info (Apple)",
        "Display system-wide information",
        "container system info",
        CommandCategory::System,
        vec!["apple", "container", "system", "info"],
        vec![],
        vec![ContainerRuntime::Apple],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Disk Usage (Apple)",
        "Show disk usage",
        "container system df",
        CommandCategory::System,
        vec!["apple", "container", "disk", "df"],
        vec![],
        vec![ContainerRuntime::Apple],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "System Prune (Apple)",
        "Remove unused data",
        "container system prune",
        CommandCategory::System,
        vec!["apple", "container", "prune", "cleanup"],
        vec![],
        vec![ContainerRuntime::Apple],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Version (Apple)",
        "Show version information",
        "container version",
        CommandCategory::System,
        vec!["apple", "container", "version"],
        vec![],
        vec![ContainerRuntime::Apple],
    ));

    // =====================================================================
    // PODMAN-ONLY COMMANDS (Pods)
    // =====================================================================

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "List Pods",
        "List all pods",
        "podman pod ps",
        CommandCategory::Pods,
        vec!["podman", "pod", "list"],
        vec![],
        vec![ContainerRuntime::Podman],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "List All Pods",
        "List all pods including stopped",
        "podman pod ps -a",
        CommandCategory::Pods,
        vec!["podman", "pod", "list", "all"],
        vec![],
        vec![ContainerRuntime::Podman],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Create Pod",
        "Create a new pod",
        "podman pod create --name ${POD_NAME}",
        CommandCategory::Pods,
        vec!["podman", "pod", "create"],
        vec![var_pod_name()],
        vec![ContainerRuntime::Podman],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Start Pod",
        "Start a pod",
        "podman pod start ${POD_NAME}",
        CommandCategory::Pods,
        vec!["podman", "pod", "start"],
        vec![var_pod_name()],
        vec![ContainerRuntime::Podman],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Stop Pod",
        "Stop a pod",
        "podman pod stop ${POD_NAME}",
        CommandCategory::Pods,
        vec!["podman", "pod", "stop"],
        vec![var_pod_name()],
        vec![ContainerRuntime::Podman],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Restart Pod",
        "Restart a pod",
        "podman pod restart ${POD_NAME}",
        CommandCategory::Pods,
        vec!["podman", "pod", "restart"],
        vec![var_pod_name()],
        vec![ContainerRuntime::Podman],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Remove Pod",
        "Remove a pod",
        "podman pod rm ${POD_NAME}",
        CommandCategory::Pods,
        vec!["podman", "pod", "remove"],
        vec![var_pod_name()],
        vec![ContainerRuntime::Podman],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Force Remove Pod",
        "Force remove a pod",
        "podman pod rm -f ${POD_NAME}",
        CommandCategory::Pods,
        vec!["podman", "pod", "remove", "force"],
        vec![var_pod_name()],
        vec![ContainerRuntime::Podman],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Inspect Pod",
        "Inspect pod details",
        "podman pod inspect ${POD_NAME}",
        CommandCategory::Pods,
        vec!["podman", "pod", "inspect"],
        vec![var_pod_name()],
        vec![ContainerRuntime::Podman],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Pod Top",
        "Show processes in pod",
        "podman pod top ${POD_NAME}",
        CommandCategory::Pods,
        vec!["podman", "pod", "top", "processes"],
        vec![var_pod_name()],
        vec![ContainerRuntime::Podman],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Pod Stats",
        "Show pod statistics",
        "podman pod stats ${POD_NAME}",
        CommandCategory::Pods,
        vec!["podman", "pod", "stats"],
        vec![var_pod_name()],
        vec![ContainerRuntime::Podman],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Prune Pods",
        "Remove stopped pods",
        "podman pod prune",
        CommandCategory::Pods,
        vec!["podman", "pod", "prune", "cleanup"],
        vec![],
        vec![ContainerRuntime::Podman],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Run in Pod",
        "Run a container in a pod",
        "podman run -d --pod ${POD_NAME} --name ${CONTAINER_NAME} ${IMAGE_NAME}",
        CommandCategory::Pods,
        vec!["podman", "pod", "run", "container"],
        vec![var_pod_name(), var_container_name(), var_image_name()],
        vec![ContainerRuntime::Podman],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Generate Kube YAML",
        "Generate Kubernetes YAML from pod",
        "podman generate kube ${POD_NAME}",
        CommandCategory::Pods,
        vec!["podman", "pod", "kube", "kubernetes", "yaml"],
        vec![var_pod_name()],
        vec![ContainerRuntime::Podman],
    ));

    templates.push(CommandTemplate::new_built_in_for_runtime(
        "Play Kube YAML",
        "Create pods from Kubernetes YAML",
        "podman play kube ${YAML_FILE}",
        CommandCategory::Pods,
        vec!["podman", "pod", "kube", "kubernetes", "yaml", "deploy"],
        vec![var_yaml_file()],
        vec![ContainerRuntime::Podman],
    ));

    templates
}

/// Helper to convert category enum to string for database storage
pub fn category_to_str(cat: CommandCategory) -> &'static str {
    match cat {
        CommandCategory::ContainerManagement => "container-management",
        CommandCategory::Debugging => "debugging",
        CommandCategory::Networking => "networking",
        CommandCategory::Images => "images",
        CommandCategory::Volumes => "volumes",
        CommandCategory::System => "system",
        CommandCategory::Pods => "pods",
        CommandCategory::Custom => "custom",
    }
}

/// Map a storage string to the corresponding command category.
///
/// Recognizes the following storage strings: `"container-management"`, `"debugging"`,
/// `"networking"`, `"images"`, `"volumes"`, `"system"`, and `"pods"`. Any other value
/// maps to the `Custom` category.
///
/// # Examples
///
/// ```
/// assert_eq!(str_to_category("images"), CommandCategory::Images);
/// assert_eq!(str_to_category("container-management"), CommandCategory::ContainerManagement);
/// assert_eq!(str_to_category("unknown-value"), CommandCategory::Custom);
/// ```
pub fn str_to_category(s: &str) -> CommandCategory {
    match s {
        "container-management" => CommandCategory::ContainerManagement,
        "debugging" => CommandCategory::Debugging,
        "networking" => CommandCategory::Networking,
        "images" => CommandCategory::Images,
        "volumes" => CommandCategory::Volumes,
        "system" => CommandCategory::System,
        "pods" => CommandCategory::Pods,
        _ => CommandCategory::Custom,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_category_to_str_all() {
        assert_eq!(category_to_str(CommandCategory::ContainerManagement), "container-management");
        assert_eq!(category_to_str(CommandCategory::Debugging), "debugging");
        assert_eq!(category_to_str(CommandCategory::Networking), "networking");
        assert_eq!(category_to_str(CommandCategory::Images), "images");
        assert_eq!(category_to_str(CommandCategory::Volumes), "volumes");
        assert_eq!(category_to_str(CommandCategory::System), "system");
        assert_eq!(category_to_str(CommandCategory::Pods), "pods");
        assert_eq!(category_to_str(CommandCategory::Custom), "custom");
    }

    #[test]
    fn test_str_to_category_all() {
        assert_eq!(str_to_category("container-management"), CommandCategory::ContainerManagement);
        assert_eq!(str_to_category("debugging"), CommandCategory::Debugging);
        assert_eq!(str_to_category("networking"), CommandCategory::Networking);
        assert_eq!(str_to_category("images"), CommandCategory::Images);
        assert_eq!(str_to_category("volumes"), CommandCategory::Volumes);
        assert_eq!(str_to_category("system"), CommandCategory::System);
        assert_eq!(str_to_category("pods"), CommandCategory::Pods);
        assert_eq!(str_to_category("custom"), CommandCategory::Custom);
    }

    #[test]
    fn test_str_to_category_unknown_defaults_to_custom() {
        assert_eq!(str_to_category("unknown"), CommandCategory::Custom);
        assert_eq!(str_to_category(""), CommandCategory::Custom);
        assert_eq!(str_to_category("foobar"), CommandCategory::Custom);
    }

    #[test]
    fn test_category_roundtrip() {
        let categories = vec![
            CommandCategory::ContainerManagement,
            CommandCategory::Debugging,
            CommandCategory::Networking,
            CommandCategory::Images,
            CommandCategory::Volumes,
            CommandCategory::System,
            CommandCategory::Pods,
            CommandCategory::Custom,
        ];

        for cat in categories {
            let s = category_to_str(cat);
            let back = str_to_category(s);
            assert_eq!(back, cat, "Roundtrip failed for {:?}", cat);
        }
    }

    #[test]
    fn test_category_serialization() {
        let json = serde_json::to_string(&CommandCategory::ContainerManagement).unwrap();
        assert_eq!(json, "\"container-management\"");

        let json = serde_json::to_string(&CommandCategory::Debugging).unwrap();
        assert_eq!(json, "\"debugging\"");
    }

    #[test]
    fn test_category_deserialization() {
        let cat: CommandCategory = serde_json::from_str("\"container-management\"").unwrap();
        assert_eq!(cat, CommandCategory::ContainerManagement);

        let cat: CommandCategory = serde_json::from_str("\"pods\"").unwrap();
        assert_eq!(cat, CommandCategory::Pods);
    }

    #[test]
    fn test_command_compatibility_default() {
        let compat = CommandCompatibility::default();
        assert_eq!(compat.runtimes.len(), 2);
        assert!(compat.runtimes.contains(&ContainerRuntime::Docker));
        assert!(compat.runtimes.contains(&ContainerRuntime::Podman));
        assert!(compat.system_ids.is_none());
    }

    #[test]
    fn test_template_variable_serialization() {
        let var = TemplateVariable {
            name: "PORT".to_string(),
            description: "Port number".to_string(),
            default_value: Some("8080".to_string()),
            required: true,
        };

        let json = serde_json::to_string(&var).unwrap();
        assert!(json.contains("\"defaultValue\""));
        assert!(json.contains("8080"));

        let deserialized: TemplateVariable = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.name, "PORT");
        assert_eq!(deserialized.default_value, Some("8080".to_string()));
    }

    #[test]
    fn test_template_variable_no_default_skips_serialization() {
        let var = TemplateVariable {
            name: "NAME".to_string(),
            description: "Container name".to_string(),
            default_value: None,
            required: true,
        };

        let json = serde_json::to_string(&var).unwrap();
        assert!(!json.contains("defaultValue"));
    }

    #[test]
    fn test_command_template_new() {
        let tpl = CommandTemplate::new(
            "Test".to_string(),
            "A test template".to_string(),
            "echo hello".to_string(),
            CommandCategory::Custom,
            vec!["test".to_string()],
            vec![],
            CommandCompatibility::default(),
        );

        assert!(!tpl.id.is_empty());
        assert_eq!(tpl.name, "Test");
        assert_eq!(tpl.category, CommandCategory::Custom);
        assert!(!tpl.is_favorite);
        assert!(!tpl.is_built_in);
        assert!(!tpl.created_at.is_empty());
        assert!(!tpl.updated_at.is_empty());
    }

    #[test]
    fn test_command_template_new_generates_unique_ids() {
        let tpl1 = CommandTemplate::new(
            "Test1".to_string(),
            "".to_string(),
            "".to_string(),
            CommandCategory::Custom,
            vec![],
            vec![],
            CommandCompatibility::default(),
        );
        let tpl2 = CommandTemplate::new(
            "Test2".to_string(),
            "".to_string(),
            "".to_string(),
            CommandCategory::Custom,
            vec![],
            vec![],
            CommandCompatibility::default(),
        );

        assert_ne!(tpl1.id, tpl2.id);
    }

    /// Verifies that `CommandTemplate::new_built_in` creates a built-in template with expected defaults and deterministic ID generation.
    ///
    /// Checks:
    /// - `is_built_in` is `true` and `is_favorite` is `false`.
    /// - Generated ID is normalized from the name and prefixed with `builtin-`.
    /// - Provided tags are preserved.
    /// - Default compatibility includes the two runtimes (Docker and Podman).
    ///
    /// # Examples
    ///
    /// ```
    /// let tpl = CommandTemplate::new_built_in(
    ///     "Start Container",
    ///     "Start a stopped container",
    ///     "docker start ${CONTAINER_NAME}",
    ///     CommandCategory::ContainerManagement,
    ///     vec!["docker", "start"],
    ///     vec![],
    /// );
    ///
    /// assert!(tpl.is_built_in);
    /// assert!(!tpl.is_favorite);
    /// assert_eq!(tpl.id, "builtin-start-container");
    /// assert_eq!(tpl.tags, vec!["docker", "start"]);
    /// assert_eq!(tpl.compatibility.runtimes.len(), 2);
    /// ```
    #[test]
    fn test_new_built_in() {
        let tpl = CommandTemplate::new_built_in(
            "Start Container",
            "Start a stopped container",
            "docker start ${CONTAINER_NAME}",
            CommandCategory::ContainerManagement,
            vec!["docker", "start"],
            vec![],
        );

        assert!(tpl.is_built_in);
        assert!(!tpl.is_favorite);
        assert_eq!(tpl.id, "builtin-start-container");
        assert_eq!(tpl.tags, vec!["docker", "start"]);
        assert_eq!(tpl.compatibility.runtimes.len(), 2); // default Docker + Podman
    }

    #[test]
    fn test_new_built_in_for_runtime() {
        let tpl = CommandTemplate::new_built_in_for_runtime(
            "List Pods",
            "List all pods",
            "podman pod ps",
            CommandCategory::Pods,
            vec!["podman", "pod"],
            vec![],
            vec![ContainerRuntime::Podman],
        );

        assert!(tpl.is_built_in);
        assert_eq!(tpl.compatibility.runtimes, vec![ContainerRuntime::Podman]);
    }

    #[test]
    fn test_generate_built_in_id() {
        // Test via new_built_in which uses generate_built_in_id
        let tpl = CommandTemplate::new_built_in(
            "Create Container (Apple)",
            "",
            "",
            CommandCategory::ContainerManagement,
            vec![],
            vec![],
        );
        assert_eq!(tpl.id, "builtin-create-container-apple");

        let tpl2 = CommandTemplate::new_built_in(
            "Run with Port Mapping",
            "",
            "",
            CommandCategory::ContainerManagement,
            vec![],
            vec![],
        );
        assert_eq!(tpl2.id, "builtin-run-with-port-mapping");
    }

    #[test]
    fn test_built_in_id_handles_special_chars() {
        let tpl = CommandTemplate::new_built_in(
            "Build Image (No Cache)",
            "",
            "",
            CommandCategory::Images,
            vec![],
            vec![],
        );
        assert_eq!(tpl.id, "builtin-build-image-no-cache");
    }

    #[test]
    fn test_command_template_serialization_roundtrip() {
        let tpl = CommandTemplate::new_built_in(
            "Test Template",
            "Description",
            "docker ps",
            CommandCategory::ContainerManagement,
            vec!["docker"],
            vec![TemplateVariable {
                name: "NAME".to_string(),
                description: "Name".to_string(),
                default_value: None,
                required: true,
            }],
        );

        let json = serde_json::to_string(&tpl).unwrap();
        let deserialized: CommandTemplate = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.name, "Test Template");
        assert_eq!(deserialized.category, CommandCategory::ContainerManagement);
        assert!(deserialized.is_built_in);
        assert_eq!(deserialized.variables.len(), 1);
        assert_eq!(deserialized.variables[0].name, "NAME");
    }

    #[test]
    fn test_command_template_camel_case() {
        let tpl = CommandTemplate::new_built_in("T", "", "", CommandCategory::Custom, vec![], vec![]);
        let json = serde_json::to_string(&tpl).unwrap();

        assert!(json.contains("\"isFavorite\""));
        assert!(json.contains("\"isBuiltIn\""));
        assert!(json.contains("\"createdAt\""));
        assert!(json.contains("\"updatedAt\""));
    }

    #[test]
    fn test_get_built_in_templates_not_empty() {
        let templates = get_built_in_templates();
        assert!(!templates.is_empty());
        // Should have a significant number of templates
        assert!(templates.len() > 50);
    }

    #[test]
    fn test_built_in_templates_all_have_ids() {
        let templates = get_built_in_templates();
        for tpl in &templates {
            assert!(!tpl.id.is_empty(), "Template '{}' has empty ID", tpl.name);
            assert!(tpl.id.starts_with("builtin-"), "Template '{}' ID doesn't start with builtin-", tpl.name);
        }
    }

    #[test]
    fn test_built_in_templates_all_built_in_flag() {
        let templates = get_built_in_templates();
        for tpl in &templates {
            assert!(tpl.is_built_in, "Template '{}' should be built-in", tpl.name);
        }
    }

    #[test]
    fn test_built_in_templates_have_unique_ids() {
        let templates = get_built_in_templates();
        let mut ids: Vec<&str> = templates.iter().map(|t| t.id.as_str()).collect();
        let original_len = ids.len();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), original_len, "Built-in templates have duplicate IDs");
    }

    #[test]
    fn test_built_in_templates_have_categories() {
        let templates = get_built_in_templates();

        let has_container_management = templates.iter().any(|t| t.category == CommandCategory::ContainerManagement);
        let has_debugging = templates.iter().any(|t| t.category == CommandCategory::Debugging);
        let has_images = templates.iter().any(|t| t.category == CommandCategory::Images);
        let has_networking = templates.iter().any(|t| t.category == CommandCategory::Networking);
        let has_volumes = templates.iter().any(|t| t.category == CommandCategory::Volumes);
        let has_system = templates.iter().any(|t| t.category == CommandCategory::System);
        let has_pods = templates.iter().any(|t| t.category == CommandCategory::Pods);

        assert!(has_container_management);
        assert!(has_debugging);
        assert!(has_images);
        assert!(has_networking);
        assert!(has_volumes);
        assert!(has_system);
        assert!(has_pods);
    }

    /// Ensures built-in command templates for the Apple container runtime exist and are restricted to that runtime.
    ///
    /// This test asserts that at least one built-in template declares compatibility with the Apple runtime,
    /// and that every template which lists Apple in its compatibility runtimes lists only Apple.
    ///
    /// # Examples
    ///
    /// ```
    /// let templates = get_built_in_templates();
    /// let apple_templates: Vec<_> = templates.iter()
    ///     .filter(|t| t.compatibility.runtimes.contains(&ContainerRuntime::Apple))
    ///     .collect();
    ///
    /// assert!(!apple_templates.is_empty());
    /// for tpl in &apple_templates {
    ///     assert_eq!(tpl.compatibility.runtimes, vec![ContainerRuntime::Apple]);
    /// }
    /// ```
    #[test]
    fn test_built_in_templates_include_apple_runtime() {
        let templates = get_built_in_templates();
        let apple_templates: Vec<_> = templates.iter()
            .filter(|t| t.compatibility.runtimes.contains(&ContainerRuntime::Apple))
            .collect();

        assert!(!apple_templates.is_empty(), "Should have Apple container templates");
        // Apple templates should only have Apple runtime
        for tpl in &apple_templates {
            assert_eq!(tpl.compatibility.runtimes, vec![ContainerRuntime::Apple]);
        }
    }

    /// Verifies presence of built-in templates that are Podman-only and ensures they are categorized as Pods.
    ///
    /// Confirms at least one built-in template has `compatibility.runtimes == [ContainerRuntime::Podman]`
    /// and asserts every such template has `category == CommandCategory::Pods`.
    #[test]
    fn test_built_in_templates_include_podman_only() {
        let templates = get_built_in_templates();
        let podman_only: Vec<_> = templates.iter()
            .filter(|t| t.compatibility.runtimes == vec![ContainerRuntime::Podman])
            .collect();

        assert!(!podman_only.is_empty(), "Should have Podman-only templates (pods)");
        // Podman-only templates should be in Pods category
        for tpl in &podman_only {
            assert_eq!(tpl.category, CommandCategory::Pods);
        }
    }

    #[test]
    fn test_create_command_template_request_deserialization() {
        let json = r#"{
            "name": "Test",
            "description": "A test",
            "command": "echo hi",
            "category": "custom",
            "tags": ["test"],
            "variables": [],
            "compatibility": { "runtimes": ["docker"] }
        }"#;

        let request: CreateCommandTemplateRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.name, "Test");
        assert_eq!(request.category, CommandCategory::Custom);
        assert!(!request.is_favorite);
    }

    #[test]
    fn test_update_command_template_request_partial() {
        let json = r#"{
            "id": "tpl-1",
            "name": "Updated Name"
        }"#;

        let request: UpdateCommandTemplateRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.id, "tpl-1");
        assert_eq!(request.name, Some("Updated Name".to_string()));
        assert!(request.description.is_none());
        assert!(request.command.is_none());
        assert!(request.category.is_none());
    }
}