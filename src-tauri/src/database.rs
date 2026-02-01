use std::collections::HashSet;
use std::path::Path;

use base64::Engine;
use rusqlite::{Connection, Result as SqliteResult};

use crate::ai::AiSettings;
use crate::models::command_template::{
    category_to_str, get_built_in_templates, str_to_category, CommandTemplate,
};
use crate::models::container::ContainerRuntime;
use crate::models::system::{ConnectionType, ContainerSystem, SystemId};

/// Initialize the database and create tables if they don't exist
pub fn init_database(path: &Path) -> SqliteResult<Connection> {
    let conn = Connection::open(path)?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS systems (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            hostname TEXT NOT NULL,
            connection_type TEXT NOT NULL,
            primary_runtime TEXT NOT NULL,
            available_runtimes TEXT NOT NULL,
            ssh_config TEXT,
            auto_connect INTEGER NOT NULL
        )",
        [],
    )?;

    // SSH credentials table - stores encrypted passwords and passphrases
    conn.execute(
        "CREATE TABLE IF NOT EXISTS ssh_credentials (
            system_id TEXT PRIMARY KEY,
            password_enc TEXT,
            passphrase_enc TEXT,
            FOREIGN KEY (system_id) REFERENCES systems(id) ON DELETE CASCADE
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS command_templates (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            command TEXT NOT NULL,
            category TEXT NOT NULL,
            tags TEXT NOT NULL,
            variables TEXT NOT NULL,
            compatibility TEXT NOT NULL,
            is_favorite INTEGER NOT NULL DEFAULT 0,
            is_built_in INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            provider TEXT NOT NULL DEFAULT 'ollama',
            api_key TEXT,
            model_name TEXT NOT NULL DEFAULT 'llama3.2',
            endpoint_url TEXT NOT NULL DEFAULT 'http://localhost:11434',
            temperature REAL NOT NULL DEFAULT 0.3,
            max_tokens INTEGER NOT NULL DEFAULT 256,
            memory_enabled INTEGER NOT NULL DEFAULT 1,
            summary_model TEXT,
            summary_max_tokens INTEGER NOT NULL DEFAULT 100,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
        [],
    )?;

    // Migration: Add memory columns if they don't exist (for existing databases)
    let _ = conn.execute(
        "ALTER TABLE ai_settings ADD COLUMN memory_enabled INTEGER NOT NULL DEFAULT 1",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE ai_settings ADD COLUMN summary_model TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE ai_settings ADD COLUMN summary_max_tokens INTEGER NOT NULL DEFAULT 100",
        [],
    );

    // Migration: Add private_key_enc column for SSH key content storage (mobile support)
    let _ = conn.execute(
        "ALTER TABLE ssh_credentials ADD COLUMN private_key_enc TEXT",
        [],
    );

    // Seed built-in templates if table is empty
    seed_built_in_templates(&conn)?;

    Ok(conn)
}

/// Insert a new system into the database
pub fn insert_system(conn: &Connection, system: &ContainerSystem) -> SqliteResult<()> {
    let runtimes_json = serde_json::to_string(&system.available_runtimes).unwrap_or_default();
    let ssh_config_json = system
        .ssh_config
        .as_ref()
        .map(|c| serde_json::to_string(c).unwrap_or_default());

    conn.execute(
        "INSERT INTO systems (id, name, hostname, connection_type, primary_runtime, available_runtimes, ssh_config, auto_connect)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        (
            &system.id.0,
            &system.name,
            &system.hostname,
            connection_type_to_str(system.connection_type),
            runtime_to_str(system.primary_runtime),
            &runtimes_json,
            &ssh_config_json,
            system.auto_connect as i32,
        ),
    )?;

    Ok(())
}

/// Get all systems from the database
pub fn get_all_systems(conn: &Connection) -> SqliteResult<Vec<ContainerSystem>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, hostname, connection_type, primary_runtime, available_runtimes, ssh_config, auto_connect FROM systems",
    )?;

    let systems = stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let name: String = row.get(1)?;
            let hostname: String = row.get(2)?;
            let connection_type_str: String = row.get(3)?;
            let primary_runtime_str: String = row.get(4)?;
            let runtimes_json: String = row.get(5)?;
            let ssh_config_json: Option<String> = row.get(6)?;
            let auto_connect: i32 = row.get(7)?;

            Ok(ContainerSystem {
                id: SystemId(id),
                name,
                hostname,
                connection_type: str_to_connection_type(&connection_type_str),
                primary_runtime: str_to_runtime(&primary_runtime_str),
                available_runtimes: serde_json::from_str(&runtimes_json).unwrap_or_default(),
                ssh_config: ssh_config_json.and_then(|j| serde_json::from_str(&j).ok()),
                auto_connect: auto_connect != 0,
            })
        })?
        .collect::<SqliteResult<Vec<_>>>()?;

    Ok(systems)
}

/// Update a system's available runtimes
pub fn update_system_runtimes(
    conn: &Connection,
    system_id: &str,
    runtimes: &HashSet<ContainerRuntime>,
) -> SqliteResult<()> {
    let runtimes_json = serde_json::to_string(runtimes).unwrap_or_default();

    conn.execute(
        "UPDATE systems SET available_runtimes = ?1 WHERE id = ?2",
        (&runtimes_json, system_id),
    )?;

    Ok(())
}

/// Update an existing system in the database
pub fn update_system(conn: &Connection, system: &ContainerSystem) -> SqliteResult<bool> {
    let runtimes_json = serde_json::to_string(&system.available_runtimes).unwrap_or_default();
    let ssh_config_json = system
        .ssh_config
        .as_ref()
        .map(|c| serde_json::to_string(c).unwrap_or_default());

    let rows_affected = conn.execute(
        "UPDATE systems SET name = ?1, hostname = ?2, connection_type = ?3, primary_runtime = ?4, available_runtimes = ?5, ssh_config = ?6, auto_connect = ?7 WHERE id = ?8",
        (
            &system.name,
            &system.hostname,
            connection_type_to_str(system.connection_type),
            runtime_to_str(system.primary_runtime),
            &runtimes_json,
            &ssh_config_json,
            system.auto_connect as i32,
            &system.id.0,
        ),
    )?;

    Ok(rows_affected > 0)
}

/// Delete a system from the database
pub fn delete_system(conn: &Connection, system_id: &str) -> SqliteResult<bool> {
    let rows_affected = conn.execute("DELETE FROM systems WHERE id = ?1", [system_id])?;
    Ok(rows_affected > 0)
}

// Helper functions for enum conversion

fn connection_type_to_str(ct: ConnectionType) -> &'static str {
    match ct {
        ConnectionType::Local => "local",
        ConnectionType::Remote => "remote",
    }
}

fn str_to_connection_type(s: &str) -> ConnectionType {
    match s {
        "remote" => ConnectionType::Remote,
        _ => ConnectionType::Local,
    }
}

fn runtime_to_str(rt: ContainerRuntime) -> &'static str {
    match rt {
        ContainerRuntime::Docker => "docker",
        ContainerRuntime::Podman => "podman",
        ContainerRuntime::Apple => "apple",
    }
}

fn str_to_runtime(s: &str) -> ContainerRuntime {
    match s {
        "podman" => ContainerRuntime::Podman,
        "apple" => ContainerRuntime::Apple,
        _ => ContainerRuntime::Docker,
    }
}

// ============================================================================
// Command Template Database Functions
// ============================================================================

/// Sync built-in command templates with the database
/// - Cleans up duplicate built-in templates from old random UUID bug
/// - Inserts any missing built-in templates
/// - Updates existing built-in templates with latest content (preserving user's favorite status)
fn seed_built_in_templates(conn: &Connection) -> SqliteResult<()> {
    let templates = get_built_in_templates();

    // Get existing built-in template IDs and their favorite status
    // Only consider templates with deterministic IDs (starting with "builtin-")
    let mut stmt = conn.prepare(
        "SELECT id, is_favorite FROM command_templates WHERE is_built_in = 1 AND id LIKE 'builtin-%'",
    )?;
    let existing: std::collections::HashMap<String, bool> = stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let is_favorite: i32 = row.get(1)?;
            Ok((id, is_favorite != 0))
        })?
        .filter_map(|r| r.ok())
        .collect();

    // Delete old built-in templates with random UUIDs (the duplicate bug)
    // These are built-in templates that DON'T start with "builtin-"
    conn.execute(
        "DELETE FROM command_templates WHERE is_built_in = 1 AND id NOT LIKE 'builtin-%'",
        [],
    )?;

    for template in templates {
        if let Some(&is_favorite) = existing.get(&template.id) {
            // Template exists - update it but preserve the user's favorite setting
            let tags_json = serde_json::to_string(&template.tags).unwrap_or_default();
            let variables_json = serde_json::to_string(&template.variables).unwrap_or_default();
            let compatibility_json = serde_json::to_string(&template.compatibility).unwrap_or_default();

            conn.execute(
                "UPDATE command_templates
                 SET name = ?1, description = ?2, command = ?3, category = ?4, tags = ?5, variables = ?6, compatibility = ?7, updated_at = ?8
                 WHERE id = ?9",
                (
                    &template.name,
                    &template.description,
                    &template.command,
                    category_to_str(template.category),
                    &tags_json,
                    &variables_json,
                    &compatibility_json,
                    &template.updated_at,
                    &template.id,
                ),
            )?;

            // Preserve the user's favorite status (don't overwrite it)
            let _ = is_favorite; // Kept for clarity - we don't modify is_favorite
        } else {
            // Template doesn't exist - insert it
            insert_command_template(conn, &template)?;
        }
    }

    Ok(())
}

/// Insert a new command template into the database
pub fn insert_command_template(conn: &Connection, template: &CommandTemplate) -> SqliteResult<()> {
    let tags_json = serde_json::to_string(&template.tags).unwrap_or_default();
    let variables_json = serde_json::to_string(&template.variables).unwrap_or_default();
    let compatibility_json = serde_json::to_string(&template.compatibility).unwrap_or_default();

    conn.execute(
        "INSERT INTO command_templates (id, name, description, command, category, tags, variables, compatibility, is_favorite, is_built_in, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        (
            &template.id,
            &template.name,
            &template.description,
            &template.command,
            category_to_str(template.category),
            &tags_json,
            &variables_json,
            &compatibility_json,
            template.is_favorite as i32,
            template.is_built_in as i32,
            &template.created_at,
            &template.updated_at,
        ),
    )?;

    Ok(())
}

/// Get all command templates from the database
pub fn get_all_command_templates(conn: &Connection) -> SqliteResult<Vec<CommandTemplate>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, description, command, category, tags, variables, compatibility, is_favorite, is_built_in, created_at, updated_at
         FROM command_templates
         ORDER BY is_favorite DESC, name ASC",
    )?;

    let templates = stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let name: String = row.get(1)?;
            let description: String = row.get(2)?;
            let command: String = row.get(3)?;
            let category_str: String = row.get(4)?;
            let tags_json: String = row.get(5)?;
            let variables_json: String = row.get(6)?;
            let compatibility_json: String = row.get(7)?;
            let is_favorite: i32 = row.get(8)?;
            let is_built_in: i32 = row.get(9)?;
            let created_at: String = row.get(10)?;
            let updated_at: String = row.get(11)?;

            Ok(CommandTemplate {
                id,
                name,
                description,
                command,
                category: str_to_category(&category_str),
                tags: serde_json::from_str(&tags_json).unwrap_or_default(),
                variables: serde_json::from_str(&variables_json).unwrap_or_default(),
                compatibility: serde_json::from_str(&compatibility_json).unwrap_or_default(),
                is_favorite: is_favorite != 0,
                is_built_in: is_built_in != 0,
                created_at,
                updated_at,
            })
        })?
        .collect::<SqliteResult<Vec<_>>>()?;

    Ok(templates)
}

/// Get a single command template by ID
pub fn get_command_template(conn: &Connection, id: &str) -> SqliteResult<Option<CommandTemplate>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, description, command, category, tags, variables, compatibility, is_favorite, is_built_in, created_at, updated_at
         FROM command_templates
         WHERE id = ?1",
    )?;

    let mut rows = stmt.query([id])?;

    if let Some(row) = rows.next()? {
        let id: String = row.get(0)?;
        let name: String = row.get(1)?;
        let description: String = row.get(2)?;
        let command: String = row.get(3)?;
        let category_str: String = row.get(4)?;
        let tags_json: String = row.get(5)?;
        let variables_json: String = row.get(6)?;
        let compatibility_json: String = row.get(7)?;
        let is_favorite: i32 = row.get(8)?;
        let is_built_in: i32 = row.get(9)?;
        let created_at: String = row.get(10)?;
        let updated_at: String = row.get(11)?;

        Ok(Some(CommandTemplate {
            id,
            name,
            description,
            command,
            category: str_to_category(&category_str),
            tags: serde_json::from_str(&tags_json).unwrap_or_default(),
            variables: serde_json::from_str(&variables_json).unwrap_or_default(),
            compatibility: serde_json::from_str(&compatibility_json).unwrap_or_default(),
            is_favorite: is_favorite != 0,
            is_built_in: is_built_in != 0,
            created_at,
            updated_at,
        }))
    } else {
        Ok(None)
    }
}

/// Update an existing command template
pub fn update_command_template(conn: &Connection, template: &CommandTemplate) -> SqliteResult<bool> {
    let tags_json = serde_json::to_string(&template.tags).unwrap_or_default();
    let variables_json = serde_json::to_string(&template.variables).unwrap_or_default();
    let compatibility_json = serde_json::to_string(&template.compatibility).unwrap_or_default();

    let rows_affected = conn.execute(
        "UPDATE command_templates
         SET name = ?1, description = ?2, command = ?3, category = ?4, tags = ?5, variables = ?6, compatibility = ?7, is_favorite = ?8, updated_at = ?9
         WHERE id = ?10",
        (
            &template.name,
            &template.description,
            &template.command,
            category_to_str(template.category),
            &tags_json,
            &variables_json,
            &compatibility_json,
            template.is_favorite as i32,
            &template.updated_at,
            &template.id,
        ),
    )?;

    Ok(rows_affected > 0)
}

/// Delete a command template (only non-built-in templates can be deleted)
pub fn delete_command_template(conn: &Connection, id: &str) -> SqliteResult<bool> {
    let rows_affected = conn.execute(
        "DELETE FROM command_templates WHERE id = ?1 AND is_built_in = 0",
        [id],
    )?;
    Ok(rows_affected > 0)
}

/// Toggle the favorite status of a command template
pub fn toggle_command_favorite(conn: &Connection, id: &str) -> SqliteResult<bool> {
    let rows_affected = conn.execute(
        "UPDATE command_templates SET is_favorite = NOT is_favorite, updated_at = ?1 WHERE id = ?2",
        (chrono::Utc::now().to_rfc3339(), id),
    )?;
    Ok(rows_affected > 0)
}

// ============================================================================
// AI Settings Database Functions
// ============================================================================

/// Get AI settings from the database (returns default if not set)
pub fn get_ai_settings(conn: &Connection) -> SqliteResult<AiSettings> {
    let mut stmt = conn.prepare(
        "SELECT provider, api_key, model_name, endpoint_url, temperature, max_tokens,
                memory_enabled, summary_model, summary_max_tokens
         FROM ai_settings WHERE id = 1",
    )?;

    let mut rows = stmt.query([])?;

    if let Some(row) = rows.next()? {
        let provider: String = row.get(0)?;
        let api_key: Option<String> = row.get(1)?;
        let model_name: String = row.get(2)?;
        let endpoint_url: String = row.get(3)?;
        let temperature: f64 = row.get(4)?;
        let max_tokens: i32 = row.get(5)?;
        let memory_enabled: i32 = row.get(6).unwrap_or(1);
        let summary_model: Option<String> = row.get(7).unwrap_or(None);
        let summary_max_tokens: i32 = row.get(8).unwrap_or(100);

        Ok(AiSettings {
            provider: AiSettings::str_to_provider(&provider),
            api_key,
            model_name,
            endpoint_url,
            temperature: temperature as f32,
            max_tokens,
            memory_enabled: memory_enabled != 0,
            summary_model,
            summary_max_tokens,
        })
    } else {
        // Return default settings
        Ok(AiSettings::default())
    }
}

/// Insert or update AI settings (upsert)
pub fn upsert_ai_settings(conn: &Connection, settings: &AiSettings) -> SqliteResult<()> {
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO ai_settings (id, provider, api_key, model_name, endpoint_url, temperature, max_tokens,
            memory_enabled, summary_model, summary_max_tokens, created_at, updated_at)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
         ON CONFLICT(id) DO UPDATE SET
             provider = excluded.provider,
             api_key = excluded.api_key,
             model_name = excluded.model_name,
             endpoint_url = excluded.endpoint_url,
             temperature = excluded.temperature,
             max_tokens = excluded.max_tokens,
             memory_enabled = excluded.memory_enabled,
             summary_model = excluded.summary_model,
             summary_max_tokens = excluded.summary_max_tokens,
             updated_at = excluded.updated_at",
        (
            settings.provider_to_str(),
            &settings.api_key,
            &settings.model_name,
            &settings.endpoint_url,
            settings.temperature as f64,
            settings.max_tokens,
            settings.memory_enabled as i32,
            &settings.summary_model,
            settings.summary_max_tokens,
            &now,
        ),
    )?;

    Ok(())
}

// ============================================================================
// Agent Preferences Database Functions
// ============================================================================

use crate::models::agent::AgentPreferences;

/// Get agent preferences from the database (returns default if not set)
pub fn get_agent_preferences(conn: &Connection) -> Result<AgentPreferences, String> {
    // First ensure the table exists
    conn.execute(
        "CREATE TABLE IF NOT EXISTS agent_preferences (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            auto_execute_safe_commands INTEGER NOT NULL DEFAULT 1,
            show_thinking_process INTEGER NOT NULL DEFAULT 0,
            confirm_all_commands INTEGER NOT NULL DEFAULT 0,
            max_auto_execute_steps INTEGER NOT NULL DEFAULT 5,
            confirmation_timeout_secs INTEGER NOT NULL DEFAULT 300,
            preferred_shell TEXT,
            dangerous_command_patterns TEXT NOT NULL DEFAULT '[]'
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT auto_execute_safe_commands, show_thinking_process, confirm_all_commands,
                max_auto_execute_steps, confirmation_timeout_secs, preferred_shell, dangerous_command_patterns
             FROM agent_preferences WHERE id = 1",
        )
        .map_err(|e| e.to_string())?;

    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;

    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let auto_execute: i32 = row.get(0).map_err(|e| e.to_string())?;
        let show_thinking: i32 = row.get(1).map_err(|e| e.to_string())?;
        let confirm_all: i32 = row.get(2).map_err(|e| e.to_string())?;
        let max_steps: i32 = row.get(3).map_err(|e| e.to_string())?;
        let timeout: i32 = row.get(4).map_err(|e| e.to_string())?;
        let shell: Option<String> = row.get(5).map_err(|e| e.to_string())?;
        let patterns_json: String = row.get(6).map_err(|e| e.to_string())?;

        Ok(AgentPreferences {
            auto_execute_safe_commands: auto_execute != 0,
            show_thinking_process: show_thinking != 0,
            confirm_all_commands: confirm_all != 0,
            max_auto_execute_steps: max_steps,
            confirmation_timeout_secs: timeout,
            preferred_shell: shell,
            dangerous_command_patterns: serde_json::from_str(&patterns_json).unwrap_or_default(),
        })
    } else {
        // Return default settings
        Ok(AgentPreferences::default())
    }
}

/// Insert or update agent preferences (upsert)
pub fn update_agent_preferences(
    conn: &Connection,
    preferences: &AgentPreferences,
) -> Result<(), String> {
    // First ensure the table exists
    conn.execute(
        "CREATE TABLE IF NOT EXISTS agent_preferences (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            auto_execute_safe_commands INTEGER NOT NULL DEFAULT 1,
            show_thinking_process INTEGER NOT NULL DEFAULT 0,
            confirm_all_commands INTEGER NOT NULL DEFAULT 0,
            max_auto_execute_steps INTEGER NOT NULL DEFAULT 5,
            confirmation_timeout_secs INTEGER NOT NULL DEFAULT 300,
            preferred_shell TEXT,
            dangerous_command_patterns TEXT NOT NULL DEFAULT '[]'
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    let patterns_json =
        serde_json::to_string(&preferences.dangerous_command_patterns).unwrap_or_default();

    conn.execute(
        "INSERT INTO agent_preferences (id, auto_execute_safe_commands, show_thinking_process, confirm_all_commands, max_auto_execute_steps, confirmation_timeout_secs, preferred_shell, dangerous_command_patterns)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
             auto_execute_safe_commands = excluded.auto_execute_safe_commands,
             show_thinking_process = excluded.show_thinking_process,
             confirm_all_commands = excluded.confirm_all_commands,
             max_auto_execute_steps = excluded.max_auto_execute_steps,
             confirmation_timeout_secs = excluded.confirmation_timeout_secs,
             preferred_shell = excluded.preferred_shell,
             dangerous_command_patterns = excluded.dangerous_command_patterns",
        (
            preferences.auto_execute_safe_commands as i32,
            preferences.show_thinking_process as i32,
            preferences.confirm_all_commands as i32,
            preferences.max_auto_execute_steps,
            preferences.confirmation_timeout_secs,
            &preferences.preferred_shell,
            &patterns_json,
        ),
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

// ============================================================================
// SSH Credentials Database Functions
// ============================================================================

/// Simple obfuscation key - in production, derive from device-specific data
const OBFUSCATION_KEY: &[u8] = b"containerus_ssh_credential_key_v1";

/// Obfuscate a credential string (simple XOR + base64)
/// Note: This is NOT cryptographically secure, just basic obfuscation
fn obfuscate(plaintext: &str) -> String {
    let bytes: Vec<u8> = plaintext
        .bytes()
        .enumerate()
        .map(|(i, b)| b ^ OBFUSCATION_KEY[i % OBFUSCATION_KEY.len()])
        .collect();
    base64::engine::general_purpose::STANDARD.encode(&bytes)
}

/// Deobfuscate a credential string
fn deobfuscate(encoded: &str) -> Option<String> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(encoded).ok()?;
    let plaintext: Vec<u8> = bytes
        .iter()
        .enumerate()
        .map(|(i, &b)| b ^ OBFUSCATION_KEY[i % OBFUSCATION_KEY.len()])
        .collect();
    String::from_utf8(plaintext).ok()
}

/// SSH credentials for a system
#[derive(Debug, Clone, Default)]
pub struct SshCredentials {
    pub password: Option<String>,
    pub passphrase: Option<String>,
    /// PEM-encoded private key content (for mobile/imported keys)
    pub private_key: Option<String>,
}

/// Store SSH credentials for a system (upsert)
pub fn store_ssh_credentials(
    conn: &Connection,
    system_id: &str,
    password: Option<&str>,
    passphrase: Option<&str>,
    private_key: Option<&str>,
) -> SqliteResult<()> {
    let password_enc = password.map(obfuscate);
    let passphrase_enc = passphrase.map(obfuscate);
    let private_key_enc = private_key.map(obfuscate);

    conn.execute(
        "INSERT INTO ssh_credentials (system_id, password_enc, passphrase_enc, private_key_enc)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(system_id) DO UPDATE SET
             password_enc = COALESCE(?2, password_enc),
             passphrase_enc = COALESCE(?3, passphrase_enc),
             private_key_enc = COALESCE(?4, private_key_enc)",
        (system_id, &password_enc, &passphrase_enc, &private_key_enc),
    )?;

    Ok(())
}

/// Get SSH credentials for a system
pub fn get_ssh_credentials(conn: &Connection, system_id: &str) -> SqliteResult<SshCredentials> {
    let mut stmt = conn.prepare(
        "SELECT password_enc, passphrase_enc, private_key_enc FROM ssh_credentials WHERE system_id = ?1",
    )?;

    let mut rows = stmt.query([system_id])?;

    if let Some(row) = rows.next()? {
        let password_enc: Option<String> = row.get(0)?;
        let passphrase_enc: Option<String> = row.get(1)?;
        let private_key_enc: Option<String> = row.get(2)?;

        Ok(SshCredentials {
            password: password_enc.and_then(|e| deobfuscate(&e)),
            passphrase: passphrase_enc.and_then(|e| deobfuscate(&e)),
            private_key: private_key_enc.and_then(|e| deobfuscate(&e)),
        })
    } else {
        Ok(SshCredentials::default())
    }
}

/// Delete SSH credentials for a system
pub fn delete_ssh_credentials(conn: &Connection, system_id: &str) -> SqliteResult<()> {
    conn.execute("DELETE FROM ssh_credentials WHERE system_id = ?1", [system_id])?;
    Ok(())
}
