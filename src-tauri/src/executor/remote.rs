use async_trait::async_trait;
use std::time::Duration;

use super::{CommandExecutor, CommandResult};
use crate::models::error::ContainerError;
use crate::models::system::{ConnectionType, ContainerSystem};

/// Executor for remote command execution via SSH
pub struct RemoteExecutor {
    system_id: String,
}

impl RemoteExecutor {
    pub fn new(system_id: String) -> Self {
        Self { system_id }
    }

    pub fn system_id(&self) -> &str {
        &self.system_id
    }
}

#[async_trait]
impl CommandExecutor for RemoteExecutor {
    async fn execute(&self, command: &str) -> Result<CommandResult, ContainerError> {
        // This will be implemented once we have the SSH client
        // For now, we'll use the SSH client from the global state
        crate::ssh::execute_on_system(&self.system_id, command).await
    }

    async fn execute_with_timeout(
        &self,
        command: &str,
        timeout_duration: Duration,
    ) -> Result<CommandResult, ContainerError> {
        // SSH has its own timeout mechanisms, but we can wrap it
        match tokio::time::timeout(timeout_duration, self.execute(command)).await {
            Ok(result) => result,
            Err(_) => Err(ContainerError::NetworkTimeout(format!(
                "SSH command timed out after {}ms: {}",
                timeout_duration.as_millis(),
                command
            ))),
        }
    }

    fn can_execute(&self, system: &ContainerSystem) -> bool {
        system.connection_type == ConnectionType::Remote && system.id.0 == self.system_id
    }

    fn connection_type(&self) -> ConnectionType {
        ConnectionType::Remote
    }
}
