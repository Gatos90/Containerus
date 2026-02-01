pub mod local;
pub mod remote;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::models::error::ContainerError;
use crate::models::system::{ConnectionType, ContainerSystem};

/// Result of executing a command
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub execution_time_ms: u64,
}

impl CommandResult {
    pub fn success(&self) -> bool {
        self.exit_code == 0
    }

    pub fn combined_output(&self) -> String {
        if self.stderr.is_empty() {
            self.stdout.clone()
        } else if self.stdout.is_empty() {
            self.stderr.clone()
        } else {
            format!("{}\n{}", self.stdout, self.stderr)
        }
    }
}

/// Trait for command execution (local or remote)
#[async_trait]
pub trait CommandExecutor: Send + Sync {
    /// Execute a command and return the result
    async fn execute(&self, command: &str) -> Result<CommandResult, ContainerError>;

    /// Execute a command with a timeout
    async fn execute_with_timeout(
        &self,
        command: &str,
        timeout: Duration,
    ) -> Result<CommandResult, ContainerError>;

    /// Check if this executor can handle the given system
    fn can_execute(&self, system: &ContainerSystem) -> bool;

    /// Get the connection type this executor handles
    fn connection_type(&self) -> ConnectionType;
}

/// Factory function to get the appropriate executor for a system
pub fn get_executor_for_system(system: &ContainerSystem) -> Box<dyn CommandExecutor> {
    match system.connection_type {
        ConnectionType::Local => Box::new(local::LocalExecutor::new()),
        ConnectionType::Remote => Box::new(remote::RemoteExecutor::new(system.id.0.clone())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_command_result_success() {
        let result = CommandResult {
            stdout: "output".to_string(),
            stderr: "".to_string(),
            exit_code: 0,
            execution_time_ms: 100,
        };
        assert!(result.success());
    }

    #[test]
    fn test_command_result_failure() {
        let result = CommandResult {
            stdout: "".to_string(),
            stderr: "error".to_string(),
            exit_code: 1,
            execution_time_ms: 100,
        };
        assert!(!result.success());
    }
}
