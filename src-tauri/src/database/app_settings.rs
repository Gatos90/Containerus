use rusqlite::{Connection, Result as SqliteResult};
use serde::{Deserialize, Serialize};

/// App settings (singleton row, id=1)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    /// Multiple SSH config file paths (empty = use default ~/.ssh/config)
    #[serde(default)]
    pub ssh_config_paths: Vec<String>,
    /// Last app version the user has seen the "What's New" dialog for
    #[serde(default)]
    pub last_seen_version: Option<String>,
}

pub fn get_app_settings(conn: &Connection) -> SqliteResult<AppSettings> {
    let mut stmt = conn.prepare(
        "SELECT ssh_config_paths, last_seen_version FROM app_settings WHERE id = 1",
    )?;

    let mut rows = stmt.query([])?;

    if let Some(row) = rows.next()? {
        let paths_json: Option<String> = row.get(0)?;
        let last_seen_version: Option<String> = row.get(1)?;
        let ssh_config_paths: Vec<String> = paths_json
            .and_then(|j| serde_json::from_str(&j).ok())
            .unwrap_or_default();
        Ok(AppSettings {
            ssh_config_paths,
            last_seen_version,
        })
    } else {
        Ok(AppSettings::default())
    }
}

pub fn upsert_app_settings(conn: &Connection, settings: &AppSettings) -> SqliteResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    let paths_json = serde_json::to_string(&settings.ssh_config_paths)
        .unwrap_or_else(|_| "[]".to_string());

    conn.execute(
        "INSERT INTO app_settings (id, ssh_config_paths, last_seen_version, created_at, updated_at)
         VALUES (1, ?1, ?2, ?3, ?3)
         ON CONFLICT(id) DO UPDATE SET
             ssh_config_paths = excluded.ssh_config_paths,
             last_seen_version = excluded.last_seen_version,
             updated_at = excluded.updated_at",
        (&paths_json, &settings.last_seen_version, &now),
    )?;

    Ok(())
}
