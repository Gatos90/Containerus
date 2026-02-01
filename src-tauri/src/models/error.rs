use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error, Clone, Serialize, Deserialize)]
pub enum ContainerError {
    #[error("System not found: {0}")]
    SystemNotFound(String),

    #[error("System not connected: {0}")]
    NotConnected(String),

    #[error("Connection failed to {0}: {1}")]
    ConnectionFailed(String, String),

    #[error("SSH authentication failed: {0}")]
    SshAuthenticationFailed(String),

    #[error("Command execution failed: {command} (exit code: {exit_code})\nStderr: {stderr}")]
    CommandExecutionFailed {
        command: String,
        exit_code: i32,
        stderr: String,
    },

    #[error("Container not found: {0}")]
    ContainerNotFound(String),

    #[error("Unsupported runtime: {0}")]
    UnsupportedRuntime(String),

    #[error("Network timeout: {0}")]
    NetworkTimeout(String),

    #[error("Invalid configuration: {0}")]
    InvalidConfiguration(String),

    #[error("Parse error: {0}")]
    ParseError(String),

    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("Unsupported operation: {0}")]
    UnsupportedOperation(String),

    #[error("Credential error: {0}")]
    CredentialError(String),

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("Database error: {message}")]
    DatabaseError { message: String },

    #[error("{resource} not found: {id}")]
    NotFound { resource: String, id: String },

    #[error("Invalid operation: {message}")]
    InvalidOperation { message: String },
}

impl ContainerError {
    /// Check if this error can be retried
    pub fn is_retryable(&self) -> bool {
        matches!(
            self,
            ContainerError::NetworkTimeout(_) | ContainerError::ConnectionFailed(_, _)
        )
    }

    /// Get a suggestion for recovering from this error
    pub fn recovery_suggestion(&self) -> &str {
        match self {
            ContainerError::SystemNotFound(_) => "Add the system to your configuration",
            ContainerError::NotConnected(_) => "Connect to the system first",
            ContainerError::ConnectionFailed(_, _) => "Check network connectivity and try again",
            ContainerError::SshAuthenticationFailed(_) => "Verify your SSH credentials",
            ContainerError::CommandExecutionFailed { .. } => {
                "Check container runtime is installed and running"
            }
            ContainerError::ContainerNotFound(_) => "The container may have been removed",
            ContainerError::UnsupportedRuntime(_) => "Install Docker, Podman, or Apple Container",
            ContainerError::NetworkTimeout(_) => "Check network connection and firewall settings",
            ContainerError::InvalidConfiguration(_) => "Review your system configuration",
            ContainerError::ParseError(_) => "Try refreshing the data",
            ContainerError::PermissionDenied(_) => {
                "Check user permissions for container operations"
            }
            ContainerError::UnsupportedOperation(_) => "This operation is not available",
            ContainerError::CredentialError(_) => "Re-enter your credentials",
            ContainerError::Internal(_) => "Restart the application and try again",
            ContainerError::DatabaseError { .. } => "Try restarting the application",
            ContainerError::NotFound { .. } => "The requested resource may have been deleted",
            ContainerError::InvalidOperation { .. } => "This operation is not allowed",
        }
    }
}

// For backwards compatibility
pub type ContainerusError = ContainerError;

pub type Result<T> = std::result::Result<T, ContainerError>;
