use base64::Engine;
use tauri::State;

use crate::executor::local::LocalExecutor;
use crate::executor::CommandExecutor;
use crate::models::container::ContainerRuntime;
use crate::models::error::ContainerError;
use crate::models::file_browser::*;
use crate::models::system::ConnectionType;
use crate::runtime::{CommandBuilder, OutputParser};
use crate::state::AppState;

/// Validate that a path is safe to use in shell commands.
fn validate_path(path: &str) -> Result<(), ContainerError> {
    if path.contains('\0') {
        return Err(ContainerError::InvalidConfiguration(
            "Path contains null byte".into(),
        ));
    }
    if !path.starts_with('/') {
        return Err(ContainerError::InvalidConfiguration(
            "Path must be absolute (start with /)".into(),
        ));
    }
    Ok(())
}

/// Execute a command, routing to local or remote executor, optionally wrapping for a container.
async fn execute_file_command(
    state: &AppState,
    system_id: &str,
    container_id: Option<&str>,
    runtime: Option<ContainerRuntime>,
    command: &str,
) -> Result<crate::executor::CommandResult, ContainerError> {
    let system = state
        .get_system(system_id)
        .ok_or_else(|| ContainerError::SystemNotFound(system_id.to_string()))?;

    // Wrap command for container if needed
    let final_command = match (container_id, runtime) {
        (Some(cid), Some(rt)) => CommandBuilder::exec_command(rt, cid, command),
        _ => command.to_string(),
    };

    match system.connection_type {
        ConnectionType::Local => {
            let executor = LocalExecutor::new();
            executor.execute(&final_command).await
        }
        ConnectionType::Remote => {
            crate::ssh::execute_on_system(system_id, &final_command).await
        }
    }
}

#[tauri::command]
pub async fn list_directory(
    state: State<'_, AppState>,
    system_id: String,
    path: String,
    container_id: Option<String>,
    runtime: Option<ContainerRuntime>,
) -> Result<DirectoryListing, ContainerError> {
    validate_path(&path)?;

    let command = CommandBuilder::list_directory(&path);
    let result = execute_file_command(
        state.inner(),
        &system_id,
        container_id.as_deref(),
        runtime,
        &command,
    )
    .await?;

    if !result.success() {
        if result.stderr.contains("Permission denied") {
            return Err(ContainerError::PermissionDenied(path));
        }
        return Err(ContainerError::CommandExecutionFailed {
            command,
            exit_code: result.exit_code,
            stderr: result.stderr,
        });
    }

    let entries = OutputParser::parse_directory_listing(&result.stdout, &path)?;
    let parent_path = if path == "/" {
        None
    } else {
        Some(
            std::path::Path::new(&path)
                .parent()
                .map(|p| {
                    let s = p.to_string_lossy().to_string();
                    if s.is_empty() { "/".to_string() } else { s }
                })
                .unwrap_or_else(|| "/".to_string()),
        )
    };

    Ok(DirectoryListing {
        path,
        entries,
        parent_path,
    })
}

#[tauri::command]
pub async fn read_file(
    state: State<'_, AppState>,
    system_id: String,
    path: String,
    container_id: Option<String>,
    runtime: Option<ContainerRuntime>,
) -> Result<FileContent, ContainerError> {
    validate_path(&path)?;

    let max_size: u64 = 1_048_576; // 1 MB
    let command = CommandBuilder::read_file(&path, max_size);
    let result = execute_file_command(
        state.inner(),
        &system_id,
        container_id.as_deref(),
        runtime,
        &command,
    )
    .await?;

    if !result.success() {
        if result.stderr.contains("Permission denied") {
            return Err(ContainerError::PermissionDenied(path));
        }
        return Err(ContainerError::CommandExecutionFailed {
            command,
            exit_code: result.exit_code,
            stderr: result.stderr,
        });
    }

    if result.stdout.starts_with("__FILE_TOO_LARGE__:") {
        let size_str = result.stdout.trim_start_matches("__FILE_TOO_LARGE__:").trim();
        return Err(ContainerError::InvalidOperation {
            message: format!("File is too large to edit in-app ({} bytes, max 1 MB)", size_str),
        });
    }

    let content = result.stdout;
    let size = content.len() as u64;
    let is_binary = content.bytes().any(|b| b == 0);

    Ok(FileContent {
        path,
        content,
        size,
        is_binary,
    })
}

#[tauri::command]
pub async fn write_file(
    state: State<'_, AppState>,
    system_id: String,
    path: String,
    content: String,
    container_id: Option<String>,
    runtime: Option<ContainerRuntime>,
) -> Result<(), ContainerError> {
    validate_path(&path)?;

    let encoded = base64::engine::general_purpose::STANDARD.encode(&content);
    let command = CommandBuilder::write_file_from_base64(&path, &encoded);
    let result = execute_file_command(
        state.inner(),
        &system_id,
        container_id.as_deref(),
        runtime,
        &command,
    )
    .await?;

    if !result.success() {
        if result.stderr.contains("Permission denied") {
            return Err(ContainerError::PermissionDenied(path));
        }
        return Err(ContainerError::CommandExecutionFailed {
            command: format!("write_file({})", path),
            exit_code: result.exit_code,
            stderr: result.stderr,
        });
    }
    Ok(())
}

#[tauri::command]
pub async fn create_directory(
    state: State<'_, AppState>,
    system_id: String,
    path: String,
    container_id: Option<String>,
    runtime: Option<ContainerRuntime>,
) -> Result<(), ContainerError> {
    validate_path(&path)?;

    let command = CommandBuilder::create_directory(&path);
    let result = execute_file_command(
        state.inner(),
        &system_id,
        container_id.as_deref(),
        runtime,
        &command,
    )
    .await?;

    if !result.success() {
        return Err(ContainerError::CommandExecutionFailed {
            command,
            exit_code: result.exit_code,
            stderr: result.stderr,
        });
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_path(
    state: State<'_, AppState>,
    system_id: String,
    path: String,
    is_directory: bool,
    container_id: Option<String>,
    runtime: Option<ContainerRuntime>,
) -> Result<(), ContainerError> {
    validate_path(&path)?;

    // Safety: don't allow deleting root
    if path == "/" {
        return Err(ContainerError::InvalidOperation {
            message: "Cannot delete root directory".to_string(),
        });
    }

    let command = if is_directory {
        CommandBuilder::delete_directory(&path)
    } else {
        CommandBuilder::delete_file(&path)
    };
    let result = execute_file_command(
        state.inner(),
        &system_id,
        container_id.as_deref(),
        runtime,
        &command,
    )
    .await?;

    if !result.success() {
        if result.stderr.contains("Permission denied") {
            return Err(ContainerError::PermissionDenied(path));
        }
        return Err(ContainerError::CommandExecutionFailed {
            command,
            exit_code: result.exit_code,
            stderr: result.stderr,
        });
    }
    Ok(())
}

#[tauri::command]
pub async fn rename_path(
    state: State<'_, AppState>,
    system_id: String,
    old_path: String,
    new_path: String,
    container_id: Option<String>,
    runtime: Option<ContainerRuntime>,
) -> Result<(), ContainerError> {
    validate_path(&old_path)?;
    validate_path(&new_path)?;

    let command = CommandBuilder::rename_path(&old_path, &new_path);
    let result = execute_file_command(
        state.inner(),
        &system_id,
        container_id.as_deref(),
        runtime,
        &command,
    )
    .await?;

    if !result.success() {
        return Err(ContainerError::CommandExecutionFailed {
            command,
            exit_code: result.exit_code,
            stderr: result.stderr,
        });
    }
    Ok(())
}

#[tauri::command]
pub async fn download_file(
    state: State<'_, AppState>,
    system_id: String,
    remote_path: String,
    local_path: String,
    container_id: Option<String>,
    runtime: Option<ContainerRuntime>,
) -> Result<(), ContainerError> {
    validate_path(&remote_path)?;

    let command = CommandBuilder::read_file_base64(&remote_path);
    let result = execute_file_command(
        state.inner(),
        &system_id,
        container_id.as_deref(),
        runtime,
        &command,
    )
    .await?;

    if !result.success() {
        if result.stderr.contains("Permission denied") {
            return Err(ContainerError::PermissionDenied(remote_path));
        }
        return Err(ContainerError::CommandExecutionFailed {
            command,
            exit_code: result.exit_code,
            stderr: result.stderr,
        });
    }

    let decoded = base64::engine::general_purpose::STANDARD
        .decode(result.stdout.trim())
        .map_err(|e| ContainerError::ParseError(format!("Base64 decode failed: {}", e)))?;

    std::fs::write(&local_path, decoded)
        .map_err(|e| ContainerError::Internal(format!("Failed to write local file: {}", e)))?;

    Ok(())
}

#[tauri::command]
pub async fn upload_file(
    state: State<'_, AppState>,
    system_id: String,
    local_path: String,
    remote_path: String,
    container_id: Option<String>,
    runtime: Option<ContainerRuntime>,
) -> Result<(), ContainerError> {
    validate_path(&remote_path)?;

    let data = std::fs::read(&local_path)
        .map_err(|e| ContainerError::Internal(format!("Failed to read local file: {}", e)))?;

    // Limit upload size (50 MB before base64 encoding)
    if data.len() > 50_000_000 {
        return Err(ContainerError::InvalidOperation {
            message: "File is too large to upload (max 50 MB)".to_string(),
        });
    }

    let encoded = base64::engine::general_purpose::STANDARD.encode(&data);
    let command = CommandBuilder::write_file_base64(&remote_path, &encoded);
    let result = execute_file_command(
        state.inner(),
        &system_id,
        container_id.as_deref(),
        runtime,
        &command,
    )
    .await?;

    if !result.success() {
        if result.stderr.contains("Permission denied") {
            return Err(ContainerError::PermissionDenied(remote_path));
        }
        return Err(ContainerError::CommandExecutionFailed {
            command: format!("upload_file({})", remote_path),
            exit_code: result.exit_code,
            stderr: result.stderr,
        });
    }
    Ok(())
}
