use tauri::State;

use crate::models::command_template::{
    CommandTemplate, CreateCommandTemplateRequest, UpdateCommandTemplateRequest,
};
use crate::models::error::ContainerError;
use crate::state::AppState;

/// List all command templates
#[tauri::command]
pub fn list_command_templates(
    state: State<'_, AppState>,
) -> Result<Vec<CommandTemplate>, ContainerError> {
    state.list_command_templates()
}

/// Get a single command template by ID
#[tauri::command]
pub fn get_command_template(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<CommandTemplate>, ContainerError> {
    state.get_command_template(&id)
}

/// Create a new command template
#[tauri::command]
pub fn create_command_template(
    state: State<'_, AppState>,
    request: CreateCommandTemplateRequest,
) -> Result<CommandTemplate, ContainerError> {
    state.create_command_template(request)
}

/// Update an existing command template
#[tauri::command]
pub fn update_command_template(
    state: State<'_, AppState>,
    request: UpdateCommandTemplateRequest,
) -> Result<CommandTemplate, ContainerError> {
    state.update_command_template(request)
}

/// Delete a command template (only non-built-in templates can be deleted)
#[tauri::command]
pub fn delete_command_template(
    state: State<'_, AppState>,
    id: String,
) -> Result<bool, ContainerError> {
    state.delete_command_template(&id)
}

/// Toggle the favorite status of a command template
#[tauri::command]
pub fn toggle_command_favorite(
    state: State<'_, AppState>,
    id: String,
) -> Result<CommandTemplate, ContainerError> {
    state.toggle_command_favorite(&id)
}

/// Duplicate a command template
#[tauri::command]
pub fn duplicate_command_template(
    state: State<'_, AppState>,
    id: String,
) -> Result<CommandTemplate, ContainerError> {
    state.duplicate_command_template(&id)
}
