use rusqlite::{Connection, Result as SqliteResult};

use crate::ai::AiSettings;

pub fn get_ai_settings(conn: &Connection) -> SqliteResult<AiSettings> {
    let mut stmt = conn.prepare(
        "SELECT provider, api_key, model_name, endpoint_url, temperature, max_tokens,
                memory_enabled, summary_model, summary_max_tokens, api_version
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
        let api_version: Option<String> = row.get(9).unwrap_or(None);

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
            api_version,
        })
    } else {
        Ok(AiSettings::default())
    }
}

pub fn upsert_ai_settings(conn: &Connection, settings: &AiSettings) -> SqliteResult<()> {
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO ai_settings (id, provider, api_key, model_name, endpoint_url, temperature, max_tokens,
            memory_enabled, summary_model, summary_max_tokens, api_version, created_at, updated_at)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)
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
             api_version = excluded.api_version,
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
            &settings.api_version,
            &now,
        ),
    )?;

    Ok(())
}
