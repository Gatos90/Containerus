use std::path::Path;

use rusqlite::{Connection, Result as SqliteResult};

mod agent_preferences;
mod ai_settings;
mod app_settings;
mod command_templates;
mod connections;
mod ssh_credentials;
mod systems;

pub use agent_preferences::{get_agent_preferences, update_agent_preferences};
pub use ai_settings::{get_ai_settings, upsert_ai_settings};
pub use app_settings::{get_app_settings, upsert_app_settings, AppSettings};
pub use command_templates::{
    delete_command_template, get_all_command_templates, get_command_template,
    insert_command_template, toggle_command_favorite, update_command_template,
};
pub use connections::{
    delete_all_backend_connections, delete_backend_connection, get_all_backend_connections,
    upsert_backend_connection, SavedBackendRow,
};
pub use ssh_credentials::{
    delete_ssh_credentials, get_ssh_credentials, store_ssh_credentials, SshCredentials,
};
pub(crate) use ssh_credentials::deobfuscate_credential;
pub use systems::{
    delete_system, get_all_systems, insert_system, update_primary_runtime, update_system,
    update_system_runtimes,
};

/// Initialize the database and create tables if they don't exist
pub fn init_database(path: &Path) -> SqliteResult<Connection> {
    let conn = Connection::open(path)?;
    init_database_schema(&conn)?;
    Ok(conn)
}

/// Apply the full schema (tables + idempotent migrations) to an existing
/// connection. Exposed so in-memory test databases can share the same schema
/// without touching disk.
pub fn init_database_schema(conn: &Connection) -> SqliteResult<()> {
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
    let _ = conn.execute(
        "ALTER TABLE ai_settings ADD COLUMN api_version TEXT",
        [],
    );

    // Migration: Add private_key_enc column for SSH key content storage (mobile support)
    let _ = conn.execute(
        "ALTER TABLE ssh_credentials ADD COLUMN private_key_enc TEXT",
        [],
    );

    // CON-42: replace XOR obfuscation with AES-256-GCM authenticated encryption.
    // Add per-column random nonces + a crypto_version tag. crypto_version values:
    //   1 = legacy XOR (read-only, cleared by the startup migration sweep)
    //   2 = AES-256-GCM (new writes)
    let _ = conn.execute(
        "ALTER TABLE ssh_credentials ADD COLUMN password_nonce TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE ssh_credentials ADD COLUMN passphrase_nonce TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE ssh_credentials ADD COLUMN private_key_nonce TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE ssh_credentials ADD COLUMN crypto_version INTEGER",
        [],
    );
    // Tag any pre-existing rows as legacy XOR so the reader picks the right path.
    let _ = conn.execute(
        "UPDATE ssh_credentials SET crypto_version = 1
         WHERE crypto_version IS NULL
           AND (password_enc IS NOT NULL
                OR passphrase_enc IS NOT NULL
                OR private_key_enc IS NOT NULL)",
        [],
    );

    // CON-42: AI api_key on Android was stored plaintext. Add dedicated ciphertext
    // + nonce columns so the legacy plaintext `api_key` column can be cleared.
    let _ = conn.execute(
        "ALTER TABLE ai_settings ADD COLUMN api_key_enc TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE ai_settings ADD COLUMN api_key_nonce TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE ai_settings ADD COLUMN api_key_crypto_version INTEGER",
        [],
    );

    // Backend connections table - stores server URLs for persistent backend connections
    conn.execute(
        "CREATE TABLE IF NOT EXISTS backend_connections (
            id TEXT PRIMARY KEY,
            server_url TEXT NOT NULL,
            label TEXT NOT NULL,
            created_at TEXT NOT NULL
        )",
        [],
    )?;

    // App settings table (singleton pattern)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS app_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            ssh_config_path TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
        [],
    )?;

    // Migration: Add ssh_config_paths column (JSON array) for multiple SSH config paths
    let _ = conn.execute(
        "ALTER TABLE app_settings ADD COLUMN ssh_config_paths TEXT",
        [],
    );

    // Migration: Migrate single ssh_config_path to ssh_config_paths array
    let _ = conn.execute(
        "UPDATE app_settings SET ssh_config_paths = json_array(ssh_config_path)
         WHERE ssh_config_path IS NOT NULL AND ssh_config_path != ''
         AND (ssh_config_paths IS NULL OR ssh_config_paths = '')",
        [],
    );

    // Migration: Add vault_migration_done flag for single-vault keyring consolidation
    let _ = conn.execute(
        "ALTER TABLE app_settings ADD COLUMN vault_migration_done INTEGER NOT NULL DEFAULT 0",
        [],
    );

    // Migration: Add last_seen_version for "What's New" changelog tracking
    let _ = conn.execute(
        "ALTER TABLE app_settings ADD COLUMN last_seen_version TEXT",
        [],
    );

    // Seed built-in templates if table is empty
    command_templates::seed_built_in_templates(conn)?;

    Ok(())
}

#[cfg(test)]
mod db_tests {
    use super::*;
    use std::collections::HashSet;

    use crate::models::container::ContainerRuntime;
    use crate::models::system::{ConnectionType, ContainerSystem, SystemId};

    fn setup_db() -> Connection {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let conn = init_database(&db_path).unwrap();
        // Leak the dir so it lives for the lifetime of the test
        std::mem::forget(dir);
        conn
    }

    #[test]
    fn test_init_database_creates_tables() {
        let conn = setup_db();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM systems", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM command_templates", [], |row| {
                row.get(0)
            })
            .unwrap();
        // Built-in templates should be seeded
        assert!(count > 0);
    }

    #[test]
    fn test_system_crud() {
        let conn = setup_db();

        let system = ContainerSystem {
            id: SystemId("test-sys-1".to_string()),
            name: "Test Server".to_string(),
            hostname: "192.168.1.100".to_string(),
            connection_type: ConnectionType::Remote,
            primary_runtime: ContainerRuntime::Docker,
            available_runtimes: HashSet::from([ContainerRuntime::Docker]),
            ssh_config: None,
            auto_connect: false,
        };

        insert_system(&conn, &system).unwrap();

        let systems = get_all_systems(&conn).unwrap();
        assert_eq!(systems.len(), 1);
        assert_eq!(systems[0].name, "Test Server");
        assert_eq!(systems[0].hostname, "192.168.1.100");
        assert_eq!(systems[0].connection_type, ConnectionType::Remote);

        let mut updated = system.clone();
        updated.name = "Updated Server".to_string();
        let result = update_system(&conn, &updated).unwrap();
        assert!(result);

        let systems = get_all_systems(&conn).unwrap();
        assert_eq!(systems[0].name, "Updated Server");

        let deleted = delete_system(&conn, "test-sys-1").unwrap();
        assert!(deleted);

        let systems = get_all_systems(&conn).unwrap();
        assert!(systems.is_empty());
    }

    #[test]
    fn test_delete_nonexistent_system() {
        let conn = setup_db();
        let deleted = delete_system(&conn, "nonexistent").unwrap();
        assert!(!deleted);
    }

    #[test]
    fn test_system_with_ssh_config() {
        let conn = setup_db();

        let system = ContainerSystem {
            id: SystemId("ssh-sys".to_string()),
            name: "SSH Server".to_string(),
            hostname: "server.example.com".to_string(),
            connection_type: ConnectionType::Remote,
            primary_runtime: ContainerRuntime::Docker,
            available_runtimes: HashSet::new(),
            ssh_config: Some(crate::models::system::SshConfig {
                username: "admin".to_string(),
                port: 2222,
                ..Default::default()
            }),
            auto_connect: true,
        };

        insert_system(&conn, &system).unwrap();

        let systems = get_all_systems(&conn).unwrap();
        assert_eq!(systems.len(), 1);
        let ssh = systems[0].ssh_config.as_ref().unwrap();
        assert_eq!(ssh.username, "admin");
        assert_eq!(ssh.port, 2222);
        assert!(systems[0].auto_connect);
    }

    #[test]
    fn test_update_system_runtimes() {
        let conn = setup_db();

        let system = ContainerSystem {
            id: SystemId("rt-sys".to_string()),
            name: "Runtime Server".to_string(),
            hostname: "localhost".to_string(),
            connection_type: ConnectionType::Local,
            primary_runtime: ContainerRuntime::Docker,
            available_runtimes: HashSet::from([ContainerRuntime::Docker]),
            ssh_config: None,
            auto_connect: false,
        };

        insert_system(&conn, &system).unwrap();

        let new_runtimes = HashSet::from([ContainerRuntime::Docker, ContainerRuntime::Podman]);
        update_system_runtimes(&conn, "rt-sys", &new_runtimes).unwrap();

        let systems = get_all_systems(&conn).unwrap();
        assert!(systems[0]
            .available_runtimes
            .contains(&ContainerRuntime::Docker));
        assert!(systems[0]
            .available_runtimes
            .contains(&ContainerRuntime::Podman));
    }

    #[test]
    fn test_command_template_crud() {
        let conn = setup_db();

        let template = crate::models::command_template::CommandTemplate {
            id: "custom-1".to_string(),
            name: "My Command".to_string(),
            description: "A custom command".to_string(),
            command: "docker ps -a".to_string(),
            category: crate::models::command_template::CommandCategory::ContainerManagement,
            tags: vec!["docker".to_string()],
            variables: vec![],
            compatibility: crate::models::command_template::CommandCompatibility {
                runtimes: vec![ContainerRuntime::Docker],
                system_ids: None,
            },
            is_favorite: false,
            is_built_in: false,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        };

        insert_command_template(&conn, &template).unwrap();

        let retrieved = get_command_template(&conn, "custom-1").unwrap();
        assert!(retrieved.is_some());
        let retrieved = retrieved.unwrap();
        assert_eq!(retrieved.name, "My Command");
        assert_eq!(retrieved.command, "docker ps -a");
        assert!(!retrieved.is_built_in);

        let mut updated = retrieved.clone();
        updated.name = "Updated Command".to_string();
        let result = update_command_template(&conn, &updated).unwrap();
        assert!(result);

        let retrieved = get_command_template(&conn, "custom-1").unwrap().unwrap();
        assert_eq!(retrieved.name, "Updated Command");

        let deleted = delete_command_template(&conn, "custom-1").unwrap();
        assert!(deleted);

        let retrieved = get_command_template(&conn, "custom-1").unwrap();
        assert!(retrieved.is_none());
    }

    #[test]
    fn test_builtin_templates_not_deletable() {
        let conn = setup_db();

        let templates = get_all_command_templates(&conn).unwrap();
        let builtin = templates.iter().find(|t| t.is_built_in).unwrap();

        let deleted = delete_command_template(&conn, &builtin.id).unwrap();
        assert!(!deleted);
    }

    #[test]
    fn test_toggle_command_favorite() {
        let conn = setup_db();

        let templates = get_all_command_templates(&conn).unwrap();
        let first = &templates[0];
        let initial_fav = first.is_favorite;

        toggle_command_favorite(&conn, &first.id).unwrap();

        let after = get_command_template(&conn, &first.id).unwrap().unwrap();
        assert_ne!(after.is_favorite, initial_fav);

        toggle_command_favorite(&conn, &first.id).unwrap();
        let after2 = get_command_template(&conn, &first.id).unwrap().unwrap();
        assert_eq!(after2.is_favorite, initial_fav);
    }

    fn test_vault() -> crate::crypto::LocalVault {
        crate::crypto::LocalVault::from_key_bytes(&[0x33u8; 32])
    }

    #[test]
    fn test_ai_settings_default() {
        let conn = setup_db();
        let settings = get_ai_settings(&conn, None).unwrap();
        assert_eq!(settings.provider, crate::ai::AiProviderType::Ollama);
        assert_eq!(settings.model_name, "llama3.2");
        assert_eq!(settings.endpoint_url, "http://localhost:11434");
    }

    #[test]
    fn test_ai_settings_upsert() {
        let conn = setup_db();
        let v = test_vault();

        let settings = crate::ai::AiSettings {
            provider: crate::ai::AiProviderType::OpenAi,
            api_key: Some("sk-test".to_string()),
            model_name: "gpt-4o".to_string(),
            endpoint_url: "https://api.openai.com".to_string(),
            temperature: 0.7,
            max_tokens: 1024,
            memory_enabled: true,
            summary_model: Some("gpt-4o-mini".to_string()),
            summary_max_tokens: 200,
            api_version: None,
        };

        upsert_ai_settings(&conn, Some(&v), &settings).unwrap();

        let retrieved = get_ai_settings(&conn, Some(&v)).unwrap();
        assert_eq!(retrieved.provider, crate::ai::AiProviderType::OpenAi);
        assert_eq!(retrieved.api_key.as_deref(), Some("sk-test"));
        assert_eq!(retrieved.model_name, "gpt-4o");
        assert_eq!(retrieved.max_tokens, 1024);
        assert!(retrieved.memory_enabled);
        assert_eq!(retrieved.summary_model.as_deref(), Some("gpt-4o-mini"));
    }

    #[test]
    fn test_ai_settings_update_overwrites() {
        let conn = setup_db();

        let settings1 = crate::ai::AiSettings {
            provider: crate::ai::AiProviderType::OpenAi,
            model_name: "gpt-4o".to_string(),
            ..crate::ai::AiSettings::default()
        };
        upsert_ai_settings(&conn, None, &settings1).unwrap();

        let settings2 = crate::ai::AiSettings {
            provider: crate::ai::AiProviderType::Anthropic,
            model_name: "claude-3".to_string(),
            ..crate::ai::AiSettings::default()
        };
        upsert_ai_settings(&conn, None, &settings2).unwrap();

        let retrieved = get_ai_settings(&conn, None).unwrap();
        assert_eq!(retrieved.provider, crate::ai::AiProviderType::Anthropic);
        assert_eq!(retrieved.model_name, "claude-3");
    }

    #[test]
    fn test_ssh_credentials_store_and_retrieve() {
        let conn = setup_db();
        let v = test_vault();

        let system = ContainerSystem {
            id: SystemId("cred-sys".to_string()),
            name: "Cred System".to_string(),
            hostname: "host".to_string(),
            connection_type: ConnectionType::Remote,
            primary_runtime: ContainerRuntime::Docker,
            available_runtimes: HashSet::new(),
            ssh_config: None,
            auto_connect: false,
        };
        insert_system(&conn, &system).unwrap();

        store_ssh_credentials(&conn, Some(&v), "cred-sys", Some("mypassword"), None, None).unwrap();

        let creds = get_ssh_credentials(&conn, Some(&v), "cred-sys").unwrap();
        assert_eq!(creds.password.as_deref(), Some("mypassword"));
        assert!(creds.passphrase.is_none());
        assert!(creds.private_key.is_none());
    }

    #[test]
    fn test_ssh_credentials_with_passphrase_and_key() {
        let conn = setup_db();
        let v = test_vault();

        let system = ContainerSystem {
            id: SystemId("key-sys".to_string()),
            name: "Key System".to_string(),
            hostname: "host".to_string(),
            connection_type: ConnectionType::Remote,
            primary_runtime: ContainerRuntime::Docker,
            available_runtimes: HashSet::new(),
            ssh_config: None,
            auto_connect: false,
        };
        insert_system(&conn, &system).unwrap();

        store_ssh_credentials(
            &conn,
            Some(&v),
            "key-sys",
            None,
            Some("my-passphrase"),
            Some("PEM-KEY-DATA"),
        )
        .unwrap();

        let creds = get_ssh_credentials(&conn, Some(&v), "key-sys").unwrap();
        assert!(creds.password.is_none());
        assert_eq!(creds.passphrase.as_deref(), Some("my-passphrase"));
        assert_eq!(creds.private_key.as_deref(), Some("PEM-KEY-DATA"));
    }

    #[test]
    fn test_ssh_credentials_nonexistent_returns_default() {
        let conn = setup_db();
        let creds = get_ssh_credentials(&conn, None, "nonexistent").unwrap();
        assert!(creds.password.is_none());
        assert!(creds.passphrase.is_none());
        assert!(creds.private_key.is_none());
    }

    #[test]
    fn test_ssh_credentials_delete() {
        let conn = setup_db();
        let v = test_vault();

        let system = ContainerSystem {
            id: SystemId("del-sys".to_string()),
            name: "Del System".to_string(),
            hostname: "host".to_string(),
            connection_type: ConnectionType::Remote,
            primary_runtime: ContainerRuntime::Docker,
            available_runtimes: HashSet::new(),
            ssh_config: None,
            auto_connect: false,
        };
        insert_system(&conn, &system).unwrap();

        store_ssh_credentials(&conn, Some(&v), "del-sys", Some("pass"), None, None).unwrap();
        delete_ssh_credentials(&conn, "del-sys").unwrap();

        let creds = get_ssh_credentials(&conn, Some(&v), "del-sys").unwrap();
        assert!(creds.password.is_none());
    }

    #[test]
    fn test_app_settings_default() {
        let conn = setup_db();
        let settings = get_app_settings(&conn).unwrap();
        assert!(settings.ssh_config_paths.is_empty());
    }

    #[test]
    fn test_app_settings_upsert() {
        let conn = setup_db();

        let settings = AppSettings {
            ssh_config_paths: vec!["/home/user/.ssh/config".to_string()],
            last_seen_version: None,
        };
        upsert_app_settings(&conn, &settings).unwrap();

        let retrieved = get_app_settings(&conn).unwrap();
        assert_eq!(retrieved.ssh_config_paths.len(), 1);
        assert_eq!(retrieved.ssh_config_paths[0], "/home/user/.ssh/config");
    }

    #[test]
    fn test_agent_preferences_default() {
        let conn = setup_db();
        let prefs = get_agent_preferences(&conn).unwrap();
        assert!(prefs.auto_execute_safe_commands);
        assert!(!prefs.show_thinking_process);
        assert!(!prefs.confirm_all_commands);
        assert_eq!(prefs.max_auto_execute_steps, 5);
    }

    #[test]
    fn test_agent_preferences_upsert() {
        let conn = setup_db();

        let prefs = crate::models::agent::AgentPreferences {
            auto_execute_safe_commands: false,
            show_thinking_process: true,
            confirm_all_commands: true,
            max_auto_execute_steps: 10,
            confirmation_timeout_secs: 60,
            preferred_shell: Some("/bin/zsh".to_string()),
            dangerous_command_patterns: vec!["rm -rf".to_string()],
        };
        update_agent_preferences(&conn, &prefs).unwrap();

        let retrieved = get_agent_preferences(&conn).unwrap();
        assert!(!retrieved.auto_execute_safe_commands);
        assert!(retrieved.show_thinking_process);
        assert_eq!(retrieved.max_auto_execute_steps, 10);
        assert_eq!(retrieved.preferred_shell.as_deref(), Some("/bin/zsh"));
        assert_eq!(retrieved.dangerous_command_patterns.len(), 1);
    }
}
