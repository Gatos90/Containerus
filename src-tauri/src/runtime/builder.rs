use crate::models::container::{ContainerAction, ContainerRuntime};

/// Builder for container runtime commands (Docker, Podman, Apple Container)
pub struct CommandBuilder;

impl CommandBuilder {
    // ========================================================================
    // Container Commands
    // ========================================================================

    /// Build container list command (JSON format)
    /// Note: Port data is fetched separately via batch_inspect_containers() because
    /// Docker's {{.Ports}} template has known issues returning empty strings.
    pub fn list_containers(runtime: ContainerRuntime) -> String {
        match runtime {
            ContainerRuntime::Docker => "docker ps -a --no-trunc --format json".to_string(),
            ContainerRuntime::Podman => "podman ps -a --no-trunc --format json".to_string(),
            ContainerRuntime::Apple => "container list --all --format json".to_string(),
        }
    }

    /// Build container list fallback command (table format for older versions)
    pub fn list_containers_fallback(runtime: ContainerRuntime) -> Option<String> {
        match runtime {
            ContainerRuntime::Docker | ContainerRuntime::Podman => {
                let binary = if runtime == ContainerRuntime::Docker {
                    "docker"
                } else {
                    "podman"
                };
                Some(format!(
                    "{} ps -a --no-trunc --format 'table {{{{.ID}}}}\\t{{{{.Names}}}}\\t{{{{.Image}}}}\\t{{{{.Status}}}}\\t{{{{.CreatedAt}}}}\\t{{{{.Ports}}}}'",
                    binary
                ))
            }
            ContainerRuntime::Apple => None, // Apple Container requires JSON
        }
    }

    /// Build container inspect command
    pub fn inspect_container(runtime: ContainerRuntime, container_id: &str) -> String {
        match runtime {
            ContainerRuntime::Docker => format!("docker inspect {}", container_id),
            ContainerRuntime::Podman => format!("podman inspect {}", container_id),
            ContainerRuntime::Apple => format!("container inspect {}", container_id),
        }
    }

    /// Build batch inspect command for multiple containers
    pub fn batch_inspect_containers(runtime: ContainerRuntime, container_ids: &[&str]) -> String {
        let ids = container_ids.join(" ");
        match runtime {
            ContainerRuntime::Docker => format!("docker inspect {}", ids),
            ContainerRuntime::Podman => format!("podman inspect {}", ids),
            ContainerRuntime::Apple => format!("container inspect {}", ids),
        }
    }

    /// Build container action command (start, stop, restart, etc.)
    pub fn container_action(
        runtime: ContainerRuntime,
        action: ContainerAction,
        container_id: &str,
    ) -> String {
        match (runtime, action) {
            // Docker
            (ContainerRuntime::Docker, ContainerAction::Start) => {
                format!("docker start {}", container_id)
            }
            (ContainerRuntime::Docker, ContainerAction::Stop) => {
                format!("docker stop {}", container_id)
            }
            (ContainerRuntime::Docker, ContainerAction::Restart) => {
                format!("docker restart {}", container_id)
            }
            (ContainerRuntime::Docker, ContainerAction::Pause) => {
                format!("docker pause {}", container_id)
            }
            (ContainerRuntime::Docker, ContainerAction::Unpause) => {
                format!("docker unpause {}", container_id)
            }
            (ContainerRuntime::Docker, ContainerAction::Remove) => {
                format!("docker rm {}", container_id)
            }

            // Podman (same as Docker)
            (ContainerRuntime::Podman, ContainerAction::Start) => {
                format!("podman start {}", container_id)
            }
            (ContainerRuntime::Podman, ContainerAction::Stop) => {
                format!("podman stop {}", container_id)
            }
            (ContainerRuntime::Podman, ContainerAction::Restart) => {
                format!("podman restart {}", container_id)
            }
            (ContainerRuntime::Podman, ContainerAction::Pause) => {
                format!("podman pause {}", container_id)
            }
            (ContainerRuntime::Podman, ContainerAction::Unpause) => {
                format!("podman unpause {}", container_id)
            }
            (ContainerRuntime::Podman, ContainerAction::Remove) => {
                format!("podman rm {}", container_id)
            }

            // Apple Container (slightly different commands)
            (ContainerRuntime::Apple, ContainerAction::Start) => {
                format!("container start {}", container_id)
            }
            (ContainerRuntime::Apple, ContainerAction::Stop) => {
                format!("container stop {}", container_id)
            }
            (ContainerRuntime::Apple, ContainerAction::Restart) => {
                // Apple Container doesn't have native restart, so we chain stop && start
                format!(
                    "container stop {} && sleep 0.5 && container start {}",
                    container_id, container_id
                )
            }
            (ContainerRuntime::Apple, ContainerAction::Pause) => {
                format!("container pause {}", container_id)
            }
            (ContainerRuntime::Apple, ContainerAction::Unpause) => {
                // Apple uses "resume" instead of "unpause"
                format!("container resume {}", container_id)
            }
            (ContainerRuntime::Apple, ContainerAction::Remove) => {
                format!("container remove {}", container_id)
            }
        }
    }

    /// Build force remove command
    pub fn force_remove_container(runtime: ContainerRuntime, container_id: &str) -> String {
        match runtime {
            ContainerRuntime::Docker => format!("docker rm -f {}", container_id),
            ContainerRuntime::Podman => format!("podman rm -f {}", container_id),
            ContainerRuntime::Apple => format!("container remove --force {}", container_id),
        }
    }

    /// Build container logs command
    pub fn container_logs(
        runtime: ContainerRuntime,
        container_id: &str,
        tail: Option<u32>,
        timestamps: bool,
    ) -> String {
        let tail_arg = tail.map(|n| format!("--tail {}", n)).unwrap_or_default();
        let ts_arg = if timestamps { "--timestamps" } else { "" };

        match runtime {
            ContainerRuntime::Docker => {
                format!("docker logs {} {} {}", tail_arg, ts_arg, container_id).trim().to_string()
            }
            ContainerRuntime::Podman => {
                format!("podman logs {} {} {}", tail_arg, ts_arg, container_id).trim().to_string()
            }
            ContainerRuntime::Apple => {
                // Apple Container has simpler log options
                format!("container logs {} {}", tail_arg, container_id).trim().to_string()
            }
        }
    }

    /// Build streaming logs command (follow mode)
    pub fn container_logs_stream(runtime: ContainerRuntime, container_id: &str) -> String {
        match runtime {
            ContainerRuntime::Docker => format!("docker logs -f {}", container_id),
            ContainerRuntime::Podman => format!("podman logs -f {}", container_id),
            ContainerRuntime::Apple => format!("container logs -f {}", container_id),
        }
    }

    // ========================================================================
    // Image Commands
    // ========================================================================

    /// Build image list command
    pub fn list_images(runtime: ContainerRuntime) -> String {
        match runtime {
            ContainerRuntime::Docker => "docker images --format json".to_string(),
            ContainerRuntime::Podman => "podman images --format json".to_string(),
            ContainerRuntime::Apple => "container image list --format json".to_string(),
        }
    }

    /// Build image pull command
    pub fn pull_image(runtime: ContainerRuntime, image: &str) -> String {
        match runtime {
            ContainerRuntime::Docker => format!("docker pull {}", image),
            ContainerRuntime::Podman => format!("podman pull {}", image),
            ContainerRuntime::Apple => format!("container image pull {}", image),
        }
    }

    /// Build image remove command
    pub fn remove_image(runtime: ContainerRuntime, image_id: &str, force: bool) -> String {
        let force_flag = if force { "-f " } else { "" };
        match runtime {
            ContainerRuntime::Docker => format!("docker rmi {}{}", force_flag, image_id),
            ContainerRuntime::Podman => format!("podman rmi {}{}", force_flag, image_id),
            ContainerRuntime::Apple => {
                let force_opt = if force { "--force " } else { "" };
                format!("container image remove {}{}", force_opt, image_id)
            }
        }
    }

    /// Build image inspect command
    pub fn inspect_image(runtime: ContainerRuntime, image_id: &str) -> String {
        match runtime {
            ContainerRuntime::Docker => format!("docker image inspect {}", image_id),
            ContainerRuntime::Podman => format!("podman image inspect {}", image_id),
            ContainerRuntime::Apple => format!("container image inspect {}", image_id),
        }
    }

    /// Build image tag command
    pub fn tag_image(runtime: ContainerRuntime, source: &str, target: &str) -> String {
        match runtime {
            ContainerRuntime::Docker => format!("docker tag {} {}", source, target),
            ContainerRuntime::Podman => format!("podman tag {} {}", source, target),
            ContainerRuntime::Apple => format!("container image tag {} {}", source, target),
        }
    }

    // ========================================================================
    // Volume Commands
    // ========================================================================

    /// Build volume list command
    pub fn list_volumes(runtime: ContainerRuntime) -> String {
        match runtime {
            ContainerRuntime::Docker => "docker volume ls --format json".to_string(),
            ContainerRuntime::Podman => "podman volume ls --format json".to_string(),
            ContainerRuntime::Apple => "container volume list --format json".to_string(),
        }
    }

    /// Build volume create command
    pub fn create_volume(runtime: ContainerRuntime, name: &str) -> String {
        match runtime {
            ContainerRuntime::Docker => format!("docker volume create {}", name),
            ContainerRuntime::Podman => format!("podman volume create {}", name),
            ContainerRuntime::Apple => format!("container volume create {}", name),
        }
    }

    /// Build volume remove command
    pub fn remove_volume(runtime: ContainerRuntime, name: &str, force: bool) -> String {
        let force_flag = if force { "-f " } else { "" };
        match runtime {
            ContainerRuntime::Docker => format!("docker volume rm {}{}", force_flag, name),
            ContainerRuntime::Podman => format!("podman volume rm {}{}", force_flag, name),
            ContainerRuntime::Apple => {
                let force_opt = if force { "--force " } else { "" };
                format!("container volume remove {}{}", force_opt, name)
            }
        }
    }

    /// Build volume inspect command
    pub fn inspect_volume(runtime: ContainerRuntime, name: &str) -> String {
        match runtime {
            ContainerRuntime::Docker => format!("docker volume inspect {}", name),
            ContainerRuntime::Podman => format!("podman volume inspect {}", name),
            ContainerRuntime::Apple => format!("container volume inspect {}", name),
        }
    }

    // ========================================================================
    // Network Commands
    // ========================================================================

    /// Build network list command
    pub fn list_networks(runtime: ContainerRuntime) -> String {
        match runtime {
            ContainerRuntime::Docker => "docker network ls --format json".to_string(),
            ContainerRuntime::Podman => "podman network ls --format json".to_string(),
            ContainerRuntime::Apple => "container network list --format json".to_string(),
        }
    }

    /// Build network create command
    pub fn create_network(
        runtime: ContainerRuntime,
        name: &str,
        driver: Option<&str>,
        subnet: Option<&str>,
    ) -> String {
        let driver_arg = driver
            .map(|d| format!("--driver {}", d))
            .unwrap_or_default();
        let subnet_arg = subnet
            .map(|s| format!("--subnet {}", s))
            .unwrap_or_default();

        match runtime {
            ContainerRuntime::Docker => {
                format!("docker network create {} {} {}", driver_arg, subnet_arg, name)
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ")
            }
            ContainerRuntime::Podman => {
                format!("podman network create {} {} {}", driver_arg, subnet_arg, name)
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ")
            }
            ContainerRuntime::Apple => format!("container network create {}", name),
        }
    }

    /// Build network remove command
    pub fn remove_network(runtime: ContainerRuntime, name: &str) -> String {
        match runtime {
            ContainerRuntime::Docker => format!("docker network rm {}", name),
            ContainerRuntime::Podman => format!("podman network rm {}", name),
            ContainerRuntime::Apple => format!("container network remove {}", name),
        }
    }

    /// Build network inspect command
    pub fn inspect_network(runtime: ContainerRuntime, name: &str) -> String {
        match runtime {
            ContainerRuntime::Docker => format!("docker network inspect {}", name),
            ContainerRuntime::Podman => format!("podman network inspect {}", name),
            ContainerRuntime::Apple => format!("container network inspect {}", name),
        }
    }

    /// Build network connect command
    pub fn connect_to_network(
        runtime: ContainerRuntime,
        network: &str,
        container_id: &str,
    ) -> String {
        match runtime {
            ContainerRuntime::Docker => {
                format!("docker network connect {} {}", network, container_id)
            }
            ContainerRuntime::Podman => {
                format!("podman network connect {} {}", network, container_id)
            }
            ContainerRuntime::Apple => {
                format!("container network connect {} {}", network, container_id)
            }
        }
    }

    /// Build network disconnect command
    pub fn disconnect_from_network(
        runtime: ContainerRuntime,
        network: &str,
        container_id: &str,
    ) -> String {
        match runtime {
            ContainerRuntime::Docker => {
                format!("docker network disconnect {} {}", network, container_id)
            }
            ContainerRuntime::Podman => {
                format!("podman network disconnect {} {}", network, container_id)
            }
            ContainerRuntime::Apple => {
                format!("container network disconnect {} {}", network, container_id)
            }
        }
    }

    // ========================================================================
    // System Commands
    // ========================================================================

    /// Build runtime version command
    pub fn runtime_version(runtime: ContainerRuntime) -> String {
        match runtime {
            ContainerRuntime::Docker => "docker --version".to_string(),
            ContainerRuntime::Podman => "podman --version".to_string(),
            ContainerRuntime::Apple => "container --version".to_string(),
        }
    }

    /// Build system info command
    pub fn system_info(runtime: ContainerRuntime) -> String {
        match runtime {
            ContainerRuntime::Docker => "docker info --format json".to_string(),
            ContainerRuntime::Podman => "podman info --format json".to_string(),
            ContainerRuntime::Apple => "container system status".to_string(),
        }
    }

    /// Build disk usage command
    pub fn disk_usage(runtime: ContainerRuntime) -> String {
        match runtime {
            ContainerRuntime::Docker => "docker system df --format json".to_string(),
            ContainerRuntime::Podman => "podman system df --format json".to_string(),
            ContainerRuntime::Apple => "container system status".to_string(), // No direct equivalent
        }
    }

    /// Build runtime detection command (checks if runtime is available)
    pub fn detect_runtime(runtime: ContainerRuntime) -> String {
        Self::runtime_version(runtime)
    }

    // ========================================================================
    // Terminal / Exec Commands
    // ========================================================================

    /// Build exec command for terminal access
    pub fn exec_terminal(runtime: ContainerRuntime, container_id: &str, shell: &str) -> String {
        match runtime {
            ContainerRuntime::Docker => format!("docker exec -it {} {}", container_id, shell),
            ContainerRuntime::Podman => format!("podman exec -it {} {}", container_id, shell),
            ContainerRuntime::Apple => format!("container exec -it {} {}", container_id, shell),
        }
    }

    /// Build exec command without TTY (for scripting).
    /// Wraps in `sh -c` so shell operators (||, >, 2>/dev/null, |) work inside the container.
    pub fn exec_command(
        runtime: ContainerRuntime,
        container_id: &str,
        command: &str,
    ) -> String {
        // Escape characters that have special meaning inside double quotes
        let escaped = command
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('$', "\\$")
            .replace('`', "\\`");
        match runtime {
            ContainerRuntime::Docker => {
                format!("docker exec {} sh -c \"{}\"", container_id, escaped)
            }
            ContainerRuntime::Podman => {
                format!("podman exec {} sh -c \"{}\"", container_id, escaped)
            }
            ContainerRuntime::Apple => {
                format!("container exec {} sh -c \"{}\"", container_id, escaped)
            }
        }
    }

    /// Get the default shell to use when exec'ing into a container
    pub fn default_shell() -> &'static str {
        "/bin/sh"
    }

    // ========================================================================
    // Extended System Info Commands
    // ========================================================================

    /// Combined command to get all extended system info in one call (Unix/Linux/macOS)
    /// Returns structured output with delimiters for parsing
    pub fn get_extended_system_info_unix(runtime: ContainerRuntime) -> String {
        let runtime_bin = match runtime {
            ContainerRuntime::Docker => "docker",
            ContainerRuntime::Podman => "podman",
            ContainerRuntime::Apple => "container",
        };

        format!(
            r#"echo "===USERNAME===" && whoami && \
echo "===USERID===" && id -u && \
echo "===SUDO===" && (sudo -n true 2>/dev/null && echo yes || echo no) && \
echo "===OSTYPE===" && uname -s && \
echo "===HOSTNAME===" && hostname && \
echo "===DISTRO===" && (cat /etc/os-release 2>/dev/null || sw_vers 2>/dev/null || echo unknown) && \
echo "===CPUCOUNT===" && (nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 0) && \
echo "===MEMORY===" && (free -h 2>/dev/null | grep -i mem || (sysctl -n hw.memsize 2>/dev/null | awk '{{printf "%.0fG\n", $1/1024/1024/1024}}')) && \
echo "===DISK===" && df -h / 2>/dev/null | tail -1 && \
echo "===UPTIME===" && (uptime -p 2>/dev/null || uptime | sed 's/.*up /up /' | sed 's/,.*load.*//' 2>/dev/null || echo unknown) && \
echo "===CONTAINERS===" && ({0} ps -q 2>/dev/null | wc -l | tr -d ' ') && \
echo "===TOTALCONTAINERS===" && ({0} ps -aq 2>/dev/null | wc -l | tr -d ' ') && \
echo "===IMAGES===" && ({0} images -q 2>/dev/null | wc -l | tr -d ' ') && \
echo "===RUNTIMEVERSION===" && ({0} --version 2>/dev/null | head -1) && \
echo "===END===""#,
            runtime_bin
        )
    }

    /// Combined command for Windows systems using PowerShell
    pub fn get_extended_system_info_windows(runtime: ContainerRuntime) -> String {
        let runtime_bin = match runtime {
            ContainerRuntime::Docker => "docker",
            ContainerRuntime::Podman => "podman",
            ContainerRuntime::Apple => "container", // Won't work on Windows anyway
        };

        // PowerShell commands that work on Windows - all on one line, no backticks
        format!(
            r#"$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator); $os = Get-CimInstance Win32_OperatingSystem; $cs = Get-CimInstance Win32_ComputerSystem; $disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"; $uptime = (Get-Date) - $os.LastBootUpTime; Write-Output "===USERNAME==="; Write-Output $env:USERNAME; Write-Output "===USERID==="; if ($isAdmin) {{ Write-Output "0" }} else {{ Write-Output "1000" }}; Write-Output "===SUDO==="; Write-Output "no"; Write-Output "===OSTYPE==="; Write-Output "Windows"; Write-Output "===HOSTNAME==="; Write-Output $env:COMPUTERNAME; Write-Output "===DISTRO==="; Write-Output $os.Caption; Write-Output "===CPUCOUNT==="; Write-Output $env:NUMBER_OF_PROCESSORS; Write-Output "===MEMORY==="; Write-Output "$([math]::Round($cs.TotalPhysicalMemory / 1GB))G"; Write-Output "===DISK==="; Write-Output "$([math]::Round($disk.Size/1GB))G $([math]::Round(($disk.Size - $disk.FreeSpace) / $disk.Size * 100))%"; Write-Output "===UPTIME==="; Write-Output "$($uptime.Days) days, $($uptime.Hours) hours"; Write-Output "===CONTAINERS==="; Write-Output (({0} ps -q 2>$null | Measure-Object -Line).Lines); Write-Output "===TOTALCONTAINERS==="; Write-Output (({0} ps -aq 2>$null | Measure-Object -Line).Lines); Write-Output "===IMAGES==="; Write-Output (({0} images -q 2>$null | Measure-Object -Line).Lines); Write-Output "===RUNTIMEVERSION==="; {0} --version 2>$null | Select-Object -First 1; Write-Output "===END===""#,
            runtime_bin
        )
    }

    /// Get the appropriate system info command based on platform
    /// For remote (SSH) systems, always use Unix commands
    /// For local systems, detect the current OS
    pub fn get_extended_system_info_for_local(runtime: ContainerRuntime) -> String {
        if cfg!(windows) {
            Self::get_extended_system_info_windows(runtime)
        } else {
            Self::get_extended_system_info_unix(runtime)
        }
    }

    /// Get Unix system info command (for SSH/remote systems which are typically Unix)
    pub fn get_extended_system_info_for_remote(runtime: ContainerRuntime) -> String {
        Self::get_extended_system_info_unix(runtime)
    }

    // ========================================================================
    // Live Metrics Commands
    // ========================================================================

    /// Lightweight command to get live CPU/Memory/Load metrics (Unix/Linux/macOS)
    /// Uses /proc filesystem on Linux for minimal overhead
    pub fn get_live_metrics_unix() -> &'static str {
        r#"echo "===CPU===" && cat /proc/stat 2>/dev/null | head -1 && \
echo "===MEM===" && cat /proc/meminfo 2>/dev/null | grep -E '^(MemTotal|MemAvailable|MemFree|Buffers|Cached|SwapTotal|SwapFree):' && \
echo "===LOAD===" && cat /proc/loadavg 2>/dev/null && \
echo "===END===""#
    }

    /// Lightweight command for macOS (uses vm_stat and sysctl)
    pub fn get_live_metrics_macos() -> &'static str {
        r#"echo "===CPU===" && top -l 1 -n 0 2>/dev/null | grep "CPU usage" && \
echo "===MEM===" && vm_stat 2>/dev/null && sysctl -n hw.memsize 2>/dev/null && \
echo "===LOAD===" && sysctl -n vm.loadavg 2>/dev/null && \
echo "===END===""#
    }

    /// Lightweight command for Windows using PowerShell
    pub fn get_live_metrics_windows() -> &'static str {
        r#"$cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average; $os = Get-CimInstance Win32_OperatingSystem; $cores = (Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum; Write-Output "===CPU==="; Write-Output $cpu; Write-Output "===MEM==="; Write-Output "$($os.TotalVisibleMemorySize) $($os.FreePhysicalMemory)"; Write-Output "===SWAP==="; $pf = Get-CimInstance Win32_PageFileUsage -ErrorAction SilentlyContinue; if ($pf) { Write-Output "$($pf.AllocatedBaseSize) $($pf.CurrentUsage)" } else { Write-Output "0 0" }; Write-Output "===LOAD==="; $load = [math]::Round(($cpu / 100) * $cores, 2); Write-Output "$load $load $load"; Write-Output "===END===""#
    }

    /// Get the appropriate live metrics command based on platform
    pub fn get_live_metrics_for_local() -> &'static str {
        if cfg!(windows) {
            Self::get_live_metrics_windows()
        } else if cfg!(target_os = "macos") {
            Self::get_live_metrics_macos()
        } else {
            Self::get_live_metrics_unix()
        }
    }

    /// Get Unix live metrics command (for SSH/remote systems)
    pub fn get_live_metrics_for_remote() -> &'static str {
        Self::get_live_metrics_unix()
    }

    // ========================================================================
    // File Browser Commands
    // ========================================================================

    /// Shell-escape a path for safe use in commands.
    /// Wraps in single quotes, escaping any embedded single quotes.
    pub fn shell_escape(path: &str) -> String {
        format!("'{}'", path.replace('\'', "'\\''"))
    }

    /// List directory contents with full metadata.
    /// Tries GNU ls first (Linux), falls back to BSD ls (macOS).
    pub fn list_directory(path: &str) -> String {
        let escaped = Self::shell_escape(path);
        format!(
            "ls -la --time-style=long-iso {} 2>/dev/null || ls -la {}",
            escaped, escaped
        )
    }

    /// Read a text file with a size guard.
    pub fn read_file(path: &str, max_size_bytes: u64) -> String {
        let escaped = Self::shell_escape(path);
        format!(
            "FILE_SIZE=$(stat -c%s {0} 2>/dev/null || stat -f%z {0} 2>/dev/null); \
             if [ \"$FILE_SIZE\" -gt {1} ] 2>/dev/null; then \
               echo \"__FILE_TOO_LARGE__:$FILE_SIZE\"; \
             else \
               cat {0}; \
             fi",
            escaped, max_size_bytes
        )
    }

    /// Write content to a file using base64 transport (safe for special chars).
    pub fn write_file_from_base64(path: &str, base64_content: &str) -> String {
        let escaped = Self::shell_escape(path);
        format!(
            "printf '%s' '{}' | base64 -d > {}",
            base64_content, escaped
        )
    }

    /// Create a directory (and parents).
    pub fn create_directory(path: &str) -> String {
        format!("mkdir -p {}", Self::shell_escape(path))
    }

    /// Delete a single file.
    pub fn delete_file(path: &str) -> String {
        format!("rm {}", Self::shell_escape(path))
    }

    /// Delete a directory recursively.
    pub fn delete_directory(path: &str) -> String {
        format!("rm -rf {}", Self::shell_escape(path))
    }

    /// Rename / move a file or directory.
    pub fn rename_path(old_path: &str, new_path: &str) -> String {
        format!(
            "mv {} {}",
            Self::shell_escape(old_path),
            Self::shell_escape(new_path)
        )
    }

    /// Read a file as base64 (for binary download).
    pub fn read_file_base64(path: &str) -> String {
        format!("base64 {}", Self::shell_escape(path))
    }

    /// Write base64-encoded data to a file (for upload).
    pub fn write_file_base64(path: &str, base64_data: &str) -> String {
        let escaped = Self::shell_escape(path);
        format!("printf '%s' '{}' | base64 -d > {}", base64_data, escaped)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list_containers() {
        assert_eq!(
            CommandBuilder::list_containers(ContainerRuntime::Docker),
            "docker ps -a --no-trunc --format json"
        );
        assert_eq!(
            CommandBuilder::list_containers(ContainerRuntime::Podman),
            "podman ps -a --no-trunc --format json"
        );
        assert_eq!(
            CommandBuilder::list_containers(ContainerRuntime::Apple),
            "container list --all --format json"
        );
    }

    #[test]
    fn test_container_action() {
        assert_eq!(
            CommandBuilder::container_action(
                ContainerRuntime::Docker,
                ContainerAction::Start,
                "abc123"
            ),
            "docker start abc123"
        );
        assert_eq!(
            CommandBuilder::container_action(
                ContainerRuntime::Apple,
                ContainerAction::Unpause,
                "abc123"
            ),
            "container resume abc123" // Apple uses "resume" instead of "unpause"
        );
    }

    #[test]
    fn test_all_container_actions_docker() {
        let actions = vec![
            (ContainerAction::Start, "docker start c1"),
            (ContainerAction::Stop, "docker stop c1"),
            (ContainerAction::Restart, "docker restart c1"),
            (ContainerAction::Pause, "docker pause c1"),
            (ContainerAction::Unpause, "docker unpause c1"),
            (ContainerAction::Remove, "docker rm c1"),
        ];
        for (action, expected) in actions {
            assert_eq!(
                CommandBuilder::container_action(ContainerRuntime::Docker, action, "c1"),
                expected
            );
        }
    }

    #[test]
    fn test_all_container_actions_podman() {
        assert_eq!(
            CommandBuilder::container_action(ContainerRuntime::Podman, ContainerAction::Start, "c1"),
            "podman start c1"
        );
        assert_eq!(
            CommandBuilder::container_action(ContainerRuntime::Podman, ContainerAction::Remove, "c1"),
            "podman rm c1"
        );
    }

    #[test]
    fn test_apple_restart_chains_stop_and_start() {
        let cmd = CommandBuilder::container_action(ContainerRuntime::Apple, ContainerAction::Restart, "c1");
        assert!(cmd.contains("container stop c1"));
        assert!(cmd.contains("container start c1"));
    }

    #[test]
    fn test_apple_remove_uses_remove_not_rm() {
        assert_eq!(
            CommandBuilder::container_action(ContainerRuntime::Apple, ContainerAction::Remove, "c1"),
            "container remove c1"
        );
    }

    #[test]
    fn test_list_containers_fallback() {
        assert!(CommandBuilder::list_containers_fallback(ContainerRuntime::Docker).is_some());
        assert!(CommandBuilder::list_containers_fallback(ContainerRuntime::Podman).is_some());
        assert!(CommandBuilder::list_containers_fallback(ContainerRuntime::Apple).is_none());
    }

    #[test]
    fn test_inspect_container() {
        assert_eq!(
            CommandBuilder::inspect_container(ContainerRuntime::Docker, "abc"),
            "docker inspect abc"
        );
        assert_eq!(
            CommandBuilder::inspect_container(ContainerRuntime::Apple, "abc"),
            "container inspect abc"
        );
    }

    #[test]
    fn test_batch_inspect_containers() {
        let cmd = CommandBuilder::batch_inspect_containers(ContainerRuntime::Docker, &["c1", "c2", "c3"]);
        assert_eq!(cmd, "docker inspect c1 c2 c3");
    }

    #[test]
    fn test_force_remove_container() {
        assert_eq!(
            CommandBuilder::force_remove_container(ContainerRuntime::Docker, "c1"),
            "docker rm -f c1"
        );
        assert_eq!(
            CommandBuilder::force_remove_container(ContainerRuntime::Apple, "c1"),
            "container remove --force c1"
        );
    }

    #[test]
    fn test_container_logs_with_options() {
        let cmd = CommandBuilder::container_logs(ContainerRuntime::Docker, "c1", Some(100), true);
        assert!(cmd.contains("--tail 100"));
        assert!(cmd.contains("--timestamps"));
        assert!(cmd.contains("c1"));
    }

    #[test]
    fn test_container_logs_no_options() {
        let cmd = CommandBuilder::container_logs(ContainerRuntime::Docker, "c1", None, false);
        assert!(!cmd.contains("--tail"));
        assert!(!cmd.contains("--timestamps"));
        assert!(cmd.contains("docker logs"));
        assert!(cmd.contains("c1"));
    }

    #[test]
    fn test_container_logs_apple_no_timestamps() {
        let cmd = CommandBuilder::container_logs(ContainerRuntime::Apple, "c1", Some(50), true);
        assert!(cmd.contains("container logs"));
        assert!(cmd.contains("--tail 50"));
        // Apple doesn't support --timestamps
        assert!(!cmd.contains("--timestamps"));
    }

    #[test]
    fn test_container_logs_stream() {
        assert_eq!(
            CommandBuilder::container_logs_stream(ContainerRuntime::Docker, "c1"),
            "docker logs -f c1"
        );
        assert_eq!(
            CommandBuilder::container_logs_stream(ContainerRuntime::Apple, "c1"),
            "container logs -f c1"
        );
    }

    #[test]
    fn test_list_images() {
        assert_eq!(
            CommandBuilder::list_images(ContainerRuntime::Docker),
            "docker images --format json"
        );
        assert_eq!(
            CommandBuilder::list_images(ContainerRuntime::Apple),
            "container image list --format json"
        );
    }

    #[test]
    fn test_pull_image() {
        assert_eq!(
            CommandBuilder::pull_image(ContainerRuntime::Docker, "nginx:latest"),
            "docker pull nginx:latest"
        );
        assert_eq!(
            CommandBuilder::pull_image(ContainerRuntime::Apple, "nginx:latest"),
            "container image pull nginx:latest"
        );
    }

    #[test]
    fn test_remove_image_with_force() {
        assert_eq!(
            CommandBuilder::remove_image(ContainerRuntime::Docker, "img1", true),
            "docker rmi -f img1"
        );
        assert_eq!(
            CommandBuilder::remove_image(ContainerRuntime::Docker, "img1", false),
            "docker rmi img1"
        );
        assert_eq!(
            CommandBuilder::remove_image(ContainerRuntime::Apple, "img1", true),
            "container image remove --force img1"
        );
    }

    #[test]
    fn test_inspect_image() {
        assert_eq!(
            CommandBuilder::inspect_image(ContainerRuntime::Docker, "img1"),
            "docker image inspect img1"
        );
    }

    #[test]
    fn test_tag_image() {
        assert_eq!(
            CommandBuilder::tag_image(ContainerRuntime::Docker, "src:v1", "dst:v2"),
            "docker tag src:v1 dst:v2"
        );
        assert_eq!(
            CommandBuilder::tag_image(ContainerRuntime::Apple, "src:v1", "dst:v2"),
            "container image tag src:v1 dst:v2"
        );
    }

    #[test]
    fn test_list_volumes() {
        assert_eq!(
            CommandBuilder::list_volumes(ContainerRuntime::Docker),
            "docker volume ls --format json"
        );
    }

    #[test]
    fn test_create_volume() {
        assert_eq!(
            CommandBuilder::create_volume(ContainerRuntime::Docker, "myvol"),
            "docker volume create myvol"
        );
    }

    #[test]
    fn test_remove_volume_with_force() {
        assert_eq!(
            CommandBuilder::remove_volume(ContainerRuntime::Docker, "myvol", true),
            "docker volume rm -f myvol"
        );
        assert_eq!(
            CommandBuilder::remove_volume(ContainerRuntime::Apple, "myvol", true),
            "container volume remove --force myvol"
        );
    }

    #[test]
    fn test_inspect_volume() {
        assert_eq!(
            CommandBuilder::inspect_volume(ContainerRuntime::Podman, "vol1"),
            "podman volume inspect vol1"
        );
    }

    #[test]
    fn test_list_networks() {
        assert_eq!(
            CommandBuilder::list_networks(ContainerRuntime::Docker),
            "docker network ls --format json"
        );
    }

    #[test]
    fn test_create_network_with_options() {
        let cmd = CommandBuilder::create_network(
            ContainerRuntime::Docker,
            "mynet",
            Some("bridge"),
            Some("10.0.0.0/24"),
        );
        assert!(cmd.contains("docker network create"));
        assert!(cmd.contains("--driver bridge"));
        assert!(cmd.contains("--subnet 10.0.0.0/24"));
        assert!(cmd.contains("mynet"));
    }

    #[test]
    fn test_create_network_no_options() {
        let cmd = CommandBuilder::create_network(ContainerRuntime::Docker, "mynet", None, None);
        assert_eq!(cmd, "docker network create mynet");
    }

    #[test]
    fn test_create_network_apple_ignores_driver_subnet() {
        let cmd = CommandBuilder::create_network(
            ContainerRuntime::Apple,
            "mynet",
            Some("bridge"),
            Some("10.0.0.0/24"),
        );
        assert_eq!(cmd, "container network create mynet");
    }

    #[test]
    fn test_remove_network() {
        assert_eq!(
            CommandBuilder::remove_network(ContainerRuntime::Docker, "mynet"),
            "docker network rm mynet"
        );
        assert_eq!(
            CommandBuilder::remove_network(ContainerRuntime::Apple, "mynet"),
            "container network remove mynet"
        );
    }

    #[test]
    fn test_inspect_network() {
        assert_eq!(
            CommandBuilder::inspect_network(ContainerRuntime::Docker, "mynet"),
            "docker network inspect mynet"
        );
    }

    #[test]
    fn test_connect_to_network() {
        assert_eq!(
            CommandBuilder::connect_to_network(ContainerRuntime::Docker, "mynet", "c1"),
            "docker network connect mynet c1"
        );
    }

    #[test]
    fn test_disconnect_from_network() {
        assert_eq!(
            CommandBuilder::disconnect_from_network(ContainerRuntime::Podman, "mynet", "c1"),
            "podman network disconnect mynet c1"
        );
    }

    #[test]
    fn test_runtime_version() {
        assert_eq!(CommandBuilder::runtime_version(ContainerRuntime::Docker), "docker --version");
        assert_eq!(CommandBuilder::runtime_version(ContainerRuntime::Podman), "podman --version");
        assert_eq!(CommandBuilder::runtime_version(ContainerRuntime::Apple), "container --version");
    }

    #[test]
    fn test_system_info() {
        assert_eq!(
            CommandBuilder::system_info(ContainerRuntime::Docker),
            "docker info --format json"
        );
        assert_eq!(
            CommandBuilder::system_info(ContainerRuntime::Apple),
            "container system status"
        );
    }

    #[test]
    fn test_disk_usage() {
        assert_eq!(
            CommandBuilder::disk_usage(ContainerRuntime::Docker),
            "docker system df --format json"
        );
    }

    #[test]
    fn test_detect_runtime_delegates_to_version() {
        assert_eq!(
            CommandBuilder::detect_runtime(ContainerRuntime::Docker),
            CommandBuilder::runtime_version(ContainerRuntime::Docker)
        );
    }

    #[test]
    fn test_exec_terminal() {
        assert_eq!(
            CommandBuilder::exec_terminal(ContainerRuntime::Docker, "c1", "/bin/bash"),
            "docker exec -it c1 /bin/bash"
        );
    }

    #[test]
    fn test_exec_command_escapes_special_chars() {
        let cmd = CommandBuilder::exec_command(
            ContainerRuntime::Docker,
            "c1",
            "echo $HOME && ls \"dir\"",
        );
        assert!(cmd.contains("docker exec c1 sh -c"));
        assert!(cmd.contains("\\$HOME"));
        assert!(cmd.contains("\\\"dir\\\""));
    }

    #[test]
    fn test_default_shell() {
        assert_eq!(CommandBuilder::default_shell(), "/bin/sh");
    }

    #[test]
    fn test_shell_escape() {
        assert_eq!(CommandBuilder::shell_escape("/tmp/test"), "'/tmp/test'");
        assert_eq!(CommandBuilder::shell_escape("it's"), "'it'\\''s'");
    }

    #[test]
    fn test_list_directory() {
        let cmd = CommandBuilder::list_directory("/var/log");
        assert!(cmd.contains("ls -la"));
        assert!(cmd.contains("'/var/log'"));
    }

    #[test]
    fn test_read_file() {
        let cmd = CommandBuilder::read_file("/etc/hosts", 1048576);
        assert!(cmd.contains("'/etc/hosts'"));
        assert!(cmd.contains("1048576"));
        assert!(cmd.contains("__FILE_TOO_LARGE__"));
    }

    #[test]
    fn test_write_file_from_base64() {
        let cmd = CommandBuilder::write_file_from_base64("/tmp/file.txt", "SGVsbG8=");
        assert!(cmd.contains("base64 -d"));
        assert!(cmd.contains("'/tmp/file.txt'"));
        assert!(cmd.contains("SGVsbG8="));
    }

    #[test]
    fn test_create_directory() {
        assert_eq!(CommandBuilder::create_directory("/tmp/newdir"), "mkdir -p '/tmp/newdir'");
    }

    #[test]
    fn test_delete_file() {
        assert_eq!(CommandBuilder::delete_file("/tmp/file.txt"), "rm '/tmp/file.txt'");
    }

    #[test]
    fn test_delete_directory() {
        assert_eq!(CommandBuilder::delete_directory("/tmp/dir"), "rm -rf '/tmp/dir'");
    }

    #[test]
    fn test_rename_path() {
        assert_eq!(
            CommandBuilder::rename_path("/old/path", "/new/path"),
            "mv '/old/path' '/new/path'"
        );
    }

    #[test]
    fn test_read_file_base64() {
        assert_eq!(
            CommandBuilder::read_file_base64("/tmp/binary"),
            "base64 '/tmp/binary'"
        );
    }

    #[test]
    fn test_extended_system_info_unix_contains_markers() {
        let cmd = CommandBuilder::get_extended_system_info_unix(ContainerRuntime::Docker);
        assert!(cmd.contains("===USERNAME==="));
        assert!(cmd.contains("===HOSTNAME==="));
        assert!(cmd.contains("===CONTAINERS==="));
        assert!(cmd.contains("===END==="));
        assert!(cmd.contains("docker"));
    }

    #[test]
    fn test_extended_system_info_windows_contains_markers() {
        let cmd = CommandBuilder::get_extended_system_info_windows(ContainerRuntime::Docker);
        assert!(cmd.contains("===USERNAME==="));
        assert!(cmd.contains("===END==="));
        assert!(cmd.contains("docker"));
    }

    #[test]
    fn test_live_metrics_unix_contains_markers() {
        let cmd = CommandBuilder::get_live_metrics_unix();
        assert!(cmd.contains("===CPU==="));
        assert!(cmd.contains("===MEM==="));
        assert!(cmd.contains("===LOAD==="));
        assert!(cmd.contains("===END==="));
    }

    #[test]
    fn test_live_metrics_macos_contains_markers() {
        let cmd = CommandBuilder::get_live_metrics_macos();
        assert!(cmd.contains("===CPU==="));
        assert!(cmd.contains("vm_stat"));
    }

    #[test]
    fn test_live_metrics_windows_contains_markers() {
        let cmd = CommandBuilder::get_live_metrics_windows();
        assert!(cmd.contains("===CPU==="));
        assert!(cmd.contains("===MEM==="));
    }

    #[test]
    fn test_extended_system_info_for_remote_always_unix() {
        let cmd = CommandBuilder::get_extended_system_info_for_remote(ContainerRuntime::Podman);
        // Remote always uses Unix commands
        assert!(cmd.contains("whoami"));
        assert!(cmd.contains("podman"));
    }

    #[test]
    fn test_live_metrics_for_remote_always_unix() {
        let cmd = CommandBuilder::get_live_metrics_for_remote();
        assert!(cmd.contains("/proc/stat"));
    }
}
