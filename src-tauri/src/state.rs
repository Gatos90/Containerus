use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;

use dashmap::DashMap;
use rusqlite::Connection;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::database;
use crate::keyring_store::SshCredentials;
use crate::models::command_template::{CommandTemplate, CreateCommandTemplateRequest, UpdateCommandTemplateRequest};
use crate::models::container::ContainerRuntime;
use crate::models::credentials::BackendTokens;
use crate::models::error::ContainerError;
use crate::models::system::{ConnectionState, ContainerSystem, SystemId};

pub struct AppState {
    pub db: Mutex<Connection>,
    systems: RwLock<Vec<ContainerSystem>>,
    connection_states: DashMap<String, ConnectionState>,
    ssh_credential_cache: DashMap<String, SshCredentials>,
    ai_key_cache: DashMap<String, String>,
    backend_token_cache: DashMap<String, BackendTokens>,
}

impl AppState {
    /// Create a new AppState with database persistence
    pub fn new(db_path: PathBuf) -> Self {
        if let Some(parent) = db_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let conn = database::init_database(&db_path)
            .expect("Failed to initialize database");

        let systems = database::get_all_systems(&conn)
            .unwrap_or_else(|e| {
                tracing::error!("Failed to load systems from database: {}", e);
                Vec::new()
            });

        tracing::info!("Loaded {} systems from database", systems.len());

        let connection_states: DashMap<String, ConnectionState> = DashMap::new();
        for system in &systems {
            connection_states.insert(system.id.0.clone(), ConnectionState::Disconnected);
        }

        Self {
            db: Mutex::new(conn),
            systems: RwLock::new(systems),
            connection_states,
            ssh_credential_cache: DashMap::new(),
            ai_key_cache: DashMap::new(),
            backend_token_cache: DashMap::new(),
        }
    }
}

impl AppState {
    pub async fn add_system(&self, mut system: ContainerSystem) -> Result<ContainerSystem, ContainerError> {
        if system.id.0.trim().is_empty() {
            system.id = SystemId(Uuid::new_v4().to_string());
        }

        let mut systems = self.systems.write().await;

        if let Err(e) = database::insert_system(&self.db.lock().unwrap(), &system) {
            tracing::error!("Failed to persist system to database: {}", e);
            return Err(ContainerError::DatabaseError {
                message: format!("Failed to save system: {}", e),
            });
        }

        self.connection_states.insert(system.id.0.clone(), ConnectionState::Disconnected);
        systems.push(system.clone());
        Ok(system)
    }

    pub async fn get_system(&self, system_id: &str) -> Option<ContainerSystem> {
        self.systems
            .read()
            .await
            .iter()
            .find(|s| s.id.0 == system_id)
            .cloned()
    }

    /// List all systems without cloning the full Vec
    pub async fn list_systems(&self) -> Vec<ContainerSystem> {
        self.systems.read().await.iter().cloned().collect()
    }

    pub async fn remove_system(&self, system_id: &str) -> bool {
        let mut systems = self.systems.write().await;
        let initial_len = systems.len();
        systems.retain(|s| s.id.0 != system_id);

        if systems.len() < initial_len {
            if let Err(e) = database::delete_system(&self.db.lock().unwrap(), system_id) {
                tracing::error!("Failed to delete system from database: {}", e);
            }
            self.connection_states.remove(system_id);
            true
        } else {
            false
        }
    }

    pub async fn update_system(&self, updated_system: ContainerSystem) -> Option<ContainerSystem> {
        let mut systems = self.systems.write().await;

        if let Some(system) = systems.iter_mut().find(|s| s.id.0 == updated_system.id.0) {
            if let Err(e) = database::update_system(&self.db.lock().unwrap(), &updated_system) {
                tracing::error!("Failed to update system in database: {}", e);
                return None;
            }
            *system = updated_system.clone();
            Some(updated_system)
        } else {
            None
        }
    }

    pub async fn update_system_runtimes(
        &self,
        system_id: &str,
        runtimes: HashSet<ContainerRuntime>,
        new_primary: Option<ContainerRuntime>,
    ) {
        let mut systems = self.systems.write().await;
        let Some(system) = systems.iter_mut().find(|s| s.id.0 == system_id) else {
            tracing::warn!("update_system_runtimes: system {system_id} not found, skipping");
            return;
        };
        system.available_runtimes = runtimes.clone();
        if let Some(primary) = new_primary.filter(|p| runtimes.contains(p)) {
            system.primary_runtime = primary;
        }
        drop(systems);

        let db = self.db.lock().unwrap();

        if let Err(e) = database::update_system_runtimes(&db, system_id, &runtimes) {
            tracing::error!("Failed to update runtimes in database: {}", e);
        }

        if let Some(primary) = new_primary {
            if let Err(e) = database::update_primary_runtime(&db, system_id, primary) {
                tracing::error!("Failed to update primary runtime in database: {}", e);
            }
        }
    }

    pub fn set_connection_state(&self, system_id: &str, state: ConnectionState) {
        self.connection_states.insert(system_id.to_string(), state);
    }

    pub fn connection_state(&self, system_id: &str) -> ConnectionState {
        self.connection_states
            .get(system_id)
            .map(|s| *s)
            .unwrap_or(ConnectionState::Disconnected)
    }

    pub fn get_connection_state_internal(&self, system_id: &str) -> ConnectionState {
        self.connection_states
            .get(system_id)
            .map(|s| *s)
            .unwrap_or(ConnectionState::Disconnected)
    }

    // ============================================================================
    // Command Template Methods
    // ============================================================================

    pub fn list_command_templates(&self) -> Result<Vec<CommandTemplate>, ContainerError> {
        let db = self.db.lock().map_err(|_| ContainerError::DatabaseError {
            message: "Failed to acquire database lock".to_string(),
        })?;

        database::get_all_command_templates(&db).map_err(|e| ContainerError::DatabaseError {
            message: e.to_string(),
        })
    }

    pub fn get_command_template(&self, id: &str) -> Result<Option<CommandTemplate>, ContainerError> {
        let db = self.db.lock().map_err(|_| ContainerError::DatabaseError {
            message: "Failed to acquire database lock".to_string(),
        })?;

        database::get_command_template(&db, id).map_err(|e| ContainerError::DatabaseError {
            message: e.to_string(),
        })
    }

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

    pub fn update_command_template(&self, request: UpdateCommandTemplateRequest) -> Result<CommandTemplate, ContainerError> {
        let db = self.db.lock().map_err(|_| ContainerError::DatabaseError {
            message: "Failed to acquire database lock".to_string(),
        })?;

        let existing = database::get_command_template(&db, &request.id)
            .map_err(|e| ContainerError::DatabaseError {
                message: e.to_string(),
            })?
            .ok_or_else(|| ContainerError::NotFound {
                resource: "CommandTemplate".to_string(),
                id: request.id.clone(),
            })?;

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

    pub fn delete_command_template(&self, id: &str) -> Result<bool, ContainerError> {
        let db = self.db.lock().map_err(|_| ContainerError::DatabaseError {
            message: "Failed to acquire database lock".to_string(),
        })?;

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

    pub fn toggle_command_favorite(&self, id: &str) -> Result<CommandTemplate, ContainerError> {
        let db = self.db.lock().map_err(|_| ContainerError::DatabaseError {
            message: "Failed to acquire database lock".to_string(),
        })?;

        database::toggle_command_favorite(&db, id).map_err(|e| ContainerError::DatabaseError {
            message: e.to_string(),
        })?;

        database::get_command_template(&db, id)
            .map_err(|e| ContainerError::DatabaseError {
                message: e.to_string(),
            })?
            .ok_or_else(|| ContainerError::NotFound {
                resource: "CommandTemplate".to_string(),
                id: id.to_string(),
            })
    }

    pub fn duplicate_command_template(&self, id: &str) -> Result<CommandTemplate, ContainerError> {
        let db = self.db.lock().map_err(|_| ContainerError::DatabaseError {
            message: "Failed to acquire database lock".to_string(),
        })?;

        let existing = database::get_command_template(&db, id)
            .map_err(|e| ContainerError::DatabaseError {
                message: e.to_string(),
            })?
            .ok_or_else(|| ContainerError::NotFound {
                resource: "CommandTemplate".to_string(),
                id: id.to_string(),
            })?;

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
            is_built_in: false,
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

    pub fn get_ssh_credentials(&self, system_id: &str) -> Result<database::SshCredentials, ContainerError> {
        let db = self.db.lock().map_err(|_| ContainerError::DatabaseError {
            message: "Failed to acquire database lock".to_string(),
        })?;

        database::get_ssh_credentials(&db, system_id)
            .map_err(|e| ContainerError::DatabaseError {
                message: e.to_string(),
            })
    }

    pub fn delete_ssh_credentials(&self, system_id: &str) -> Result<(), ContainerError> {
        let db = self.db.lock().map_err(|_| ContainerError::DatabaseError {
            message: "Failed to acquire database lock".to_string(),
        })?;

        database::delete_ssh_credentials(&db, system_id)
            .map_err(|e| ContainerError::DatabaseError {
                message: e.to_string(),
            })
    }

    // ============================================================================
    // Credential Cache Methods (in-memory, populated at startup from keyring)
    // ============================================================================

    pub fn cache_ssh_credentials(&self, system_id: &str, creds: SshCredentials) {
        self.ssh_credential_cache.insert(system_id.to_string(), creds);
    }

    pub fn get_cached_ssh_credentials(&self, system_id: &str) -> Option<SshCredentials> {
        self.ssh_credential_cache.get(system_id).map(|r| r.clone())
    }

    pub fn remove_cached_ssh_credentials(&self, system_id: &str) {
        self.ssh_credential_cache.remove(system_id);
    }

    pub fn cache_ai_api_key(&self, provider: &str, key: String) {
        self.ai_key_cache.insert(provider.to_string(), key);
    }

    pub fn get_cached_ai_api_key(&self, provider: &str) -> Option<String> {
        self.ai_key_cache.get(provider).map(|r| r.clone())
    }

    pub fn remove_cached_ai_api_key(&self, provider: &str) {
        self.ai_key_cache.remove(provider);
    }

    // ============================================================================
    // Backend Token Cache Methods
    // ============================================================================

    pub fn cache_backend_tokens(&self, id: &str, tokens: BackendTokens) {
        self.backend_token_cache.insert(id.to_string(), tokens);
    }

    pub fn get_cached_backend_tokens(&self, id: &str) -> Option<BackendTokens> {
        self.backend_token_cache.get(id).map(|r| r.clone())
    }

    pub fn remove_cached_backend_tokens(&self, id: &str) {
        self.backend_token_cache.remove(id);
    }

    pub fn clear_all_backend_tokens(&self) {
        self.backend_token_cache.clear();
    }

    #[cfg(not(target_os = "android"))]
    pub fn flush_vault(&self) -> Result<(), String> {
        let ssh: HashMap<String, SshCredentials> = self
            .ssh_credential_cache
            .iter()
            .map(|r| (r.key().clone(), r.value().clone()))
            .collect();
        let ai: HashMap<String, String> = self
            .ai_key_cache
            .iter()
            .map(|r| (r.key().clone(), r.value().clone()))
            .collect();
        let backend: HashMap<String, BackendTokens> = self
            .backend_token_cache
            .iter()
            .map(|r| (r.key().clone(), r.value().clone()))
            .collect();
        let vault = crate::keyring_store::CredentialVault {
            version: 1,
            ssh_credentials: ssh,
            ai_api_keys: ai,
            backend_tokens: backend,
        };
        crate::keyring_store::save_vault(&vault)
    }
}
