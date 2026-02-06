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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_display_messages() {
        let err = ContainerError::SystemNotFound("sys-1".to_string());
        assert_eq!(err.to_string(), "System not found: sys-1");

        let err = ContainerError::NotConnected("sys-2".to_string());
        assert_eq!(err.to_string(), "System not connected: sys-2");

        let err = ContainerError::ConnectionFailed("host".to_string(), "timeout".to_string());
        assert_eq!(err.to_string(), "Connection failed to host: timeout");

        let err = ContainerError::SshAuthenticationFailed("bad key".to_string());
        assert_eq!(err.to_string(), "SSH authentication failed: bad key");

        let err = ContainerError::CommandExecutionFailed {
            command: "docker ps".to_string(),
            exit_code: 1,
            stderr: "permission denied".to_string(),
        };
        assert!(err.to_string().contains("docker ps"));
        assert!(err.to_string().contains("1"));

        let err = ContainerError::ContainerNotFound("c1".to_string());
        assert_eq!(err.to_string(), "Container not found: c1");

        let err = ContainerError::DatabaseError { message: "table missing".to_string() };
        assert_eq!(err.to_string(), "Database error: table missing");

        let err = ContainerError::NotFound { resource: "Image".to_string(), id: "abc".to_string() };
        assert_eq!(err.to_string(), "Image not found: abc");

        let err = ContainerError::InvalidOperation { message: "not allowed".to_string() };
        assert_eq!(err.to_string(), "Invalid operation: not allowed");
    }

    #[test]
    fn test_is_retryable() {
        assert!(ContainerError::NetworkTimeout("timeout".to_string()).is_retryable());
        assert!(ContainerError::ConnectionFailed("host".to_string(), "err".to_string()).is_retryable());
        assert!(!ContainerError::SystemNotFound("sys".to_string()).is_retryable());
        assert!(!ContainerError::NotConnected("sys".to_string()).is_retryable());
        assert!(!ContainerError::SshAuthenticationFailed("err".to_string()).is_retryable());
        assert!(!ContainerError::ContainerNotFound("c1".to_string()).is_retryable());
        assert!(!ContainerError::ParseError("err".to_string()).is_retryable());
        assert!(!ContainerError::PermissionDenied("err".to_string()).is_retryable());
        assert!(!ContainerError::Internal("err".to_string()).is_retryable());
        assert!(!ContainerError::DatabaseError { message: "err".to_string() }.is_retryable());
    }

    #[test]
    fn test_recovery_suggestions_non_empty() {
        let errors = vec![
            ContainerError::SystemNotFound("x".to_string()),
            ContainerError::NotConnected("x".to_string()),
            ContainerError::ConnectionFailed("x".to_string(), "y".to_string()),
            ContainerError::SshAuthenticationFailed("x".to_string()),
            ContainerError::CommandExecutionFailed { command: "x".to_string(), exit_code: 1, stderr: "y".to_string() },
            ContainerError::ContainerNotFound("x".to_string()),
            ContainerError::UnsupportedRuntime("x".to_string()),
            ContainerError::NetworkTimeout("x".to_string()),
            ContainerError::InvalidConfiguration("x".to_string()),
            ContainerError::ParseError("x".to_string()),
            ContainerError::PermissionDenied("x".to_string()),
            ContainerError::UnsupportedOperation("x".to_string()),
            ContainerError::CredentialError("x".to_string()),
            ContainerError::Internal("x".to_string()),
            ContainerError::DatabaseError { message: "x".to_string() },
            ContainerError::NotFound { resource: "x".to_string(), id: "y".to_string() },
            ContainerError::InvalidOperation { message: "x".to_string() },
        ];

        for err in errors {
            let suggestion = err.recovery_suggestion();
            assert!(!suggestion.is_empty(), "Recovery suggestion for {:?} should not be empty", err);
        }
    }

    #[test]
    fn test_error_serialization() {
        let err = ContainerError::SystemNotFound("sys-1".to_string());
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("SystemNotFound"));
        assert!(json.contains("sys-1"));

        let deserialized: ContainerError = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.to_string(), err.to_string());
    }

    #[test]
    fn test_error_clone() {
        let err = ContainerError::Internal("test".to_string());
        let cloned = err.clone();
        assert_eq!(err.to_string(), cloned.to_string());
    }
}
