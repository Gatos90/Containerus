use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use uuid::Uuid;

use crate::database;
use crate::models::command_template::{CommandTemplate, CreateCommandTemplateRequest, UpdateCommandTemplateRequest};
use crate::models::container::ContainerRuntime;
use crate::models::error::ContainerError;
use crate::models::system::{ConnectionState, ContainerSystem, SystemId};

pub struct AppState {
    pub db: Mutex<Connection>,
    systems: Mutex<Vec<ContainerSystem>>,
    connection_states: Mutex<HashMap<String, ConnectionState>>,
}

impl AppState {
    /// Create a new AppState with database persistence
    pub fn new(db_path: PathBuf) -> Self {
        // Create parent directories if they don't exist
        if let Some(parent) = db_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let conn = database::init_database(&db_path)
            .expect("Failed to initialize database");

        // Load existing systems from database
        let systems = database::get_all_systems(&conn)
            .unwrap_or_else(|e| {
                tracing::error!("Failed to load systems from database: {}", e);
                Vec::new()
            });

        tracing::info!("Loaded {} systems from database", systems.len());

        // Initialize connection states for all loaded systems
        let mut connection_states = HashMap::new();
        for system in &systems {
            connection_states.insert(system.id.0.clone(), ConnectionState::Disconnected);
        }

        Self {
            db: Mutex::new(conn),
            systems: Mutex::new(systems),
            connection_states: Mutex::new(connection_states),
        }
    }
}

impl AppState {
    /// Add a new system to the state
    pub fn add_system(&self, mut system: ContainerSystem) -> Result<ContainerSystem, ContainerError> {
        if system.id.0.trim().is_empty() {
            system.id = SystemId(Uuid::new_v4().to_string());
        }

        // Persist to database
        if let Err(e) = database::insert_system(&self.db.lock().unwrap(), &system) {
            tracing::error!("Failed to persist system to database: {}", e);
            return Err(ContainerError::DatabaseError {
                message: format!("Failed to save system: {}", e),
            });
        }

        self.connection_states
            .lock()
            .unwrap()
            .insert(system.id.0.clone(), ConnectionState::Disconnected);

        self.systems.lock().unwrap().push(system.clone());
        Ok(system)
    }

    /// Get a system by ID
    pub fn get_system(&self, system_id: &str) -> Option<ContainerSystem> {
        self.systems
            .lock()
            .unwrap()
            .iter()
            .find(|s| s.id.0 == system_id)
            .cloned()
    }

    /// List all systems
    pub fn list_systems(&self) -> Vec<ContainerSystem> {
        self.systems.lock().unwrap().clone()
    }

    /// Remove a system by ID
    pub fn remove_system(&self, system_id: &str) -> bool {
        let mut systems = self.systems.lock().unwrap();
        let initial_len = systems.len();
        systems.retain(|s| s.id.0 != system_id);

        if systems.len() < initial_len {
            // Delete from database
            if let Err(e) = database::delete_system(&self.db.lock().unwrap(), system_id) {
                tracing::error!("Failed to delete system from database: {}", e);
            }

            self.connection_states.lock().unwrap().remove(system_id);
            true
        } else {
            false
        }
    }

    /// Update an existing system
    pub fn update_system(&self, updated_system: ContainerSystem) -> Option<ContainerSystem> {
        let mut systems = self.systems.lock().unwrap();

        if let Some(system) = systems.iter_mut().find(|s| s.id.0 == updated_system.id.0) {
            // Update in database
            if let Err(e) = database::update_system(&self.db.lock().unwrap(), &updated_system) {
                tracing::error!("Failed to update system in database: {}", e);
                return None;
            }

            // Update in memory
            *system = updated_system.clone();
            Some(updated_system)
        } else {
            None
        }
    }

    /// Update a system's available runtimes
    pub fn update_system_runtimes(
        &self,
        system_id: &str,
        runtimes: HashSet<ContainerRuntime>,
    ) {
        // Update in database
        if let Err(e) = database::update_system_runtimes(&self.db.lock().unwrap(), system_id, &runtimes) {
            tracing::error!("Failed to update runtimes in database: {}", e);
        }

        let mut systems = self.systems.lock().unwrap();
        if let Some(system) = systems.iter_mut().find(|s| s.id.0 == system_id) {
            system.available_runtimes = runtimes;
        }
    }

    /// Set connection state for a system
    pub fn set_connection_state(&self, system_id: &str, state: ConnectionState) {
        self.connection_states
            .lock()
            .unwrap()
            .insert(system_id.to_string(), state);
    }

    /// Get connection state for a system (public API)
    pub fn connection_state(&self, system_id: &str) -> ConnectionState {
        *self
            .connection_states
            .lock()
            .unwrap()
            .get(system_id)
            .unwrap_or(&ConnectionState::Disconnected)
    }

    /// Get connection state (internal, doesn't clone)
    pub fn get_connection_state_internal(&self, system_id: &str) -> ConnectionState {
        *self
            .connection_states
            .lock()
            .unwrap()
            .get(system_id)
            .unwrap_or(&ConnectionState::Disconnected)
    }

    // ============================================================================
    // Command Template Methods
    // ============================================================================

    /// List all command templates
    pub fn list_command_templates(&self) -> Result<Vec<CommandTemplate>, ContainerError> {
        let db = self.db.lock().map_err(|_| ContainerError::DatabaseError {
            message: "Failed to acquire database lock".to_string(),
        })?;

        database::get_all_command_templates(&db).map_err(|e| ContainerError::DatabaseError {
            message: e.to_string(),
        })
    }

    /// Get a single command template by ID
    pub fn get_command_template(&self, id: &str) -> Result<Option<CommandTemplate>, ContainerError> {
        let db = self.db.lock().map_err(|_| ContainerError::DatabaseError {
            message: "Failed to acquire database lock".to_string(),
        })?;

        database::get_command_template(&db, id).map_err(|e| ContainerError::DatabaseError {
            message: e.to_string(),
        })
    }

    /// Create a new command template
    pub fn create_command_template(&self, request: CreateCommandTemplateRequest) -> Result<CommandTemplate, ContainerError> {
        let now = chrono::Utc::now().to_rfc3339();

        let template = CommandTemplate {
            id: Uuid::new_v4().to_string(),
            name: request.name,
            description: request.description,
            command: request.command,
            category: request.category,
            tags: request.tags,
            variables: request.variables,
            compatibility: request.compatibility,
            is_favorite: request.is_favorite,
            is_built_in: false,
            created_at: now.clone(),
            updated_at: now,
        };

        let db = self.db.lock().map_err(|_| ContainerError::DatabaseError {
            message: "Failed to acquire database lock".to_string(),
        })?;

        database::insert_command_template(&db, &template).map_err(|e| ContainerError::DatabaseError {
            message: e.to_string(),
        })?;

        Ok(template)
    }

    /// Update an existing command template
    pub fn update_command_template(&self, request: UpdateCommandTemplateRequest) -> Result<CommandTemplate, ContainerError> {
        let db = self.db.lock().map_err(|_| ContainerError::DatabaseError {
            message: "Failed to acquire database lock".to_string(),
        })?;

        // Get existing template
        let existing = database::get_command_template(&db, &request.id)
            .map_err(|e| ContainerError::DatabaseError {
                message: e.to_string(),
            })?
            .ok_or_else(|| ContainerError::NotFound {
                resource: "CommandTemplate".to_string(),
                id: request.id.clone(),
            })?;

        // Build updated template
        let now = chrono::Utc::now().to_rfc3339();
        let updated = CommandTemplate {
            id: existing.id,
            name: request.name.unwrap_or(existing.name),
            description: request.description.unwrap_or(existing.description),
            command: request.command.unwrap_or(existing.command),
            category: request.category.unwrap_or(existing.category),
            tags: request.tags.unwrap_or(existing.tags),
            variables: request.variables.unwrap_or(existing.variables),
            compatibility: request.compatibility.unwrap_or(existing.compatibility),
            is_favorite: request.is_favorite.unwrap_or(existing.is_favorite),
            is_built_in: existing.is_built_in,
            created_at: existing.created_at,
            updated_at: now,
        };

        database::update_command_template(&db, &updated).map_err(|e| ContainerError::DatabaseError {
            message: e.to_string(),
        })?;

        Ok(updated)
    }

    /// Delete a command template (only non-built-in templates can be deleted)
    pub fn delete_command_template(&self, id: &str) -> Result<bool, ContainerError> {
        let db = self.db.lock().map_err(|_| ContainerError::DatabaseError {
            message: "Failed to acquire database lock".to_string(),
        })?;

        // Check if it's a built-in template
        if let Some(template) = database::get_command_template(&db, id).map_err(|e| {
            ContainerError::DatabaseError {
                message: e.to_string(),
            }
        })? {
            if template.is_built_in {
                return Err(ContainerError::InvalidOperation {
                    message: "Cannot delete built-in command templates".to_string(),
                });
            }
        }

        database::delete_command_template(&db, id).map_err(|e| ContainerError::DatabaseError {
            message: e.to_string(),
        })
    }

    /// Toggle the favorite status of a command template
    pub fn toggle_command_favorite(&self, id: &str) -> Result<CommandTemplate, ContainerError> {
        let db = self.db.lock().map_err(|_| ContainerError::DatabaseError {
            message: "Failed to acquire database lock".to_string(),
        })?;

        database::toggle_command_favorite(&db, id).map_err(|e| ContainerError::DatabaseError {
            message: e.to_string(),
        })?;

        // Return the updated template
        database::get_command_template(&db, id)
            .map_err(|e| ContainerError::DatabaseError {
                message: e.to_string(),
            })?
            .ok_or_else(|| ContainerError::NotFound {
                resource: "CommandTemplate".to_string(),
                id: id.to_string(),
            })
    }

    /// Duplicate a command template
    pub fn duplicate_command_template(&self, id: &str) -> Result<CommandTemplate, ContainerError> {
        let db = self.db.lock().map_err(|_| ContainerError::DatabaseError {
            message: "Failed to acquire database lock".to_string(),
        })?;

        // Get existing template
        let existing = database::get_command_template(&db, id)
            .map_err(|e| ContainerError::DatabaseError {
                message: e.to_string(),
            })?
            .ok_or_else(|| ContainerError::NotFound {
                resource: "CommandTemplate".to_string(),
                id: id.to_string(),
            })?;

        // Create duplicate with new ID and name
        let now = chrono::Utc::now().to_rfc3339();
        let duplicate = CommandTemplate {
            id: Uuid::new_v4().to_string(),
            name: format!("{} (Copy)", existing.name),
            description: existing.description,
            command: existing.command,
            category: existing.category,
            tags: existing.tags,
            variables: existing.variables,
            compatibility: existing.compatibility,
            is_favorite: false,
            is_built_in: false, // Duplicates are never built-in
            created_at: now.clone(),
            updated_at: now,
        };

        database::insert_command_template(&db, &duplicate).map_err(|e| ContainerError::DatabaseError {
            message: e.to_string(),
        })?;

        Ok(duplicate)
    }

    // ============================================================================
    // SSH Credentials Methods
    // ============================================================================

    /// Store SSH credentials for a system
    pub fn store_ssh_credentials(
        &self,
        system_id: &str,
        password: Option<&str>,
        passphrase: Option<&str>,
        private_key: Option<&str>,
    ) -> Result<(), ContainerError> {
        let db = self.db.lock().map_err(|_| ContainerError::DatabaseError {
            message: "Failed to acquire database lock".to_string(),
        })?;

        database::store_ssh_credentials(&db, system_id, password, passphrase, private_key)
            .map_err(|e| ContainerError::DatabaseError {
                message: e.to_string(),
            })
    }

    /// Get SSH credentials for a system
    pub fn get_ssh_credentials(&self, system_id: &str) -> Result<database::SshCredentials, ContainerError> {
        let db = self.db.lock().map_err(|_| ContainerError::DatabaseError {
            message: "Failed to acquire database lock".to_string(),
        })?;

        database::get_ssh_credentials(&db, system_id)
            .map_err(|e| ContainerError::DatabaseError {
                message: e.to_string(),
            })
    }

    /// Delete SSH credentials for a system
    pub fn delete_ssh_credentials(&self, system_id: &str) -> Result<(), ContainerError> {
        let db = self.db.lock().map_err(|_| ContainerError::DatabaseError {
            message: "Failed to acquire database lock".to_string(),
        })?;

        database::delete_ssh_credentials(&db, system_id)
            .map_err(|e| ContainerError::DatabaseError {
                message: e.to_string(),
            })
    }
}
