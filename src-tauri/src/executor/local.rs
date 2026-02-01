use async_trait::async_trait;
use std::process::Stdio;
use std::time::{Duration, Instant};
use tokio::process::Command;
use tokio::time::timeout;

use super::{CommandExecutor, CommandResult};
use crate::models::error::ContainerError;
use crate::models::system::{ConnectionType, ContainerSystem};

/// Executor for local command execution using std::process
pub struct LocalExecutor;

impl LocalExecutor {
    pub fn new() -> Self {
        Self
    }

    /// Get the shell and shell argument for the current platform
    fn get_shell_command() -> (&'static str, &'static str) {
        if cfg!(target_os = "windows") {
            ("cmd", "/C")
        } else {
            ("/bin/sh", "-c")
        }
    }

    /// Get the PATH environment variable with common binary locations
    fn get_path_env() -> String {
        let base_path = std::env::var("PATH").unwrap_or_default();

        if cfg!(target_os = "windows") {
            // Add common Docker/Podman paths on Windows
            let additional_paths = vec![
                r"C:\Program Files\Docker\Docker\resources\bin",
                r"C:\Program Files\RedHat\Podman",
                r"C:\ProgramData\chocolatey\bin",
            ];
            format!("{};{}", additional_paths.join(";"), base_path)
        } else if cfg!(target_os = "macos") {
            // Add common paths on macOS including Homebrew
            let additional_paths = vec![
                "/opt/homebrew/bin",
                "/usr/local/bin",
                "/usr/bin",
                "/bin",
                "/usr/sbin",
                "/sbin",
            ];
            format!("{}:{}", additional_paths.join(":"), base_path)
        } else {
            // Linux paths
            let additional_paths = vec![
                "/usr/local/bin",
                "/usr/bin",
                "/bin",
                "/usr/sbin",
                "/sbin",
            ];
            format!("{}:{}", additional_paths.join(":"), base_path)
        }
    }

    async fn execute_internal(&self, command: &str) -> Result<CommandResult, ContainerError> {
        let start = Instant::now();
        let (shell, shell_arg) = Self::get_shell_command();

        let output = Command::new(shell)
            .arg(shell_arg)
            .arg(command)
            .env("PATH", Self::get_path_env())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| ContainerError::CommandExecutionFailed {
                command: command.to_string(),
                exit_code: -1,
                stderr: e.to_string(),
            })?;

        let execution_time_ms = start.elapsed().as_millis() as u64;

        Ok(CommandResult {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code().unwrap_or(-1),
            execution_time_ms,
        })
    }

    /// Execute a PowerShell command (Windows only, but callable on any platform)
    pub async fn execute_powershell(&self, command: &str) -> Result<CommandResult, ContainerError> {
        let start = Instant::now();

        // Find PowerShell executable - try pwsh (PowerShell Core) first, then Windows PowerShell
        let powershell_path = Self::find_powershell();

        let output = Command::new(&powershell_path)
            .arg("-NoProfile")
            .arg("-NonInteractive")
            .arg("-Command")
            .arg(command)
            .env("PATH", Self::get_path_env())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| ContainerError::CommandExecutionFailed {
                command: format!("powershell: {}", command),
                exit_code: -1,
                stderr: format!("Failed to run PowerShell ({}): {}", powershell_path, e),
            })?;

        let execution_time_ms = start.elapsed().as_millis() as u64;

        Ok(CommandResult {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code().unwrap_or(-1),
            execution_time_ms,
        })
    }

    /// Find PowerShell executable path
    fn find_powershell() -> String {
        // Common PowerShell locations on Windows
        let candidates = [
            // PowerShell Core (pwsh) - preferred
            r"C:\Program Files\PowerShell\7\pwsh.exe",
            // Windows PowerShell
            r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
            r"C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe",
        ];

        for path in candidates {
            if std::path::Path::new(path).exists() {
                return path.to_string();
            }
        }

        // Fallback to just "powershell.exe" and hope it's in PATH
        "powershell.exe".to_string()
    }
}

impl Default for LocalExecutor {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl CommandExecutor for LocalExecutor {
    async fn execute(&self, command: &str) -> Result<CommandResult, ContainerError> {
        self.execute_internal(command).await
    }

    async fn execute_with_timeout(
        &self,
        command: &str,
        timeout_duration: Duration,
    ) -> Result<CommandResult, ContainerError> {
        match timeout(timeout_duration, self.execute_internal(command)).await {
            Ok(result) => result,
            Err(_) => Err(ContainerError::NetworkTimeout(format!(
                "Command timed out after {}ms: {}",
                timeout_duration.as_millis(),
                command
            ))),
        }
    }

    fn can_execute(&self, system: &ContainerSystem) -> bool {
        system.connection_type == ConnectionType::Local
    }

    fn connection_type(&self) -> ConnectionType {
        ConnectionType::Local
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_local_executor_echo() {
        let executor = LocalExecutor::new();
        let result = executor.execute("echo hello").await.unwrap();
        assert!(result.success());
        assert!(result.stdout.trim().contains("hello"));
    }

    #[tokio::test]
    async fn test_local_executor_failure() {
        let executor = LocalExecutor::new();
        // This command should fail
        let result = executor.execute("exit 1").await.unwrap();
        assert!(!result.success());
    }
}
