use rusqlite::{Connection, Result as SqliteResult};

use crate::ai::AiSettings;
use crate::crypto::{LocalVault, CRYPTO_VERSION_AES_GCM};

/// Load AI settings. Decrypts `api_key_enc` (AES-GCM) when present; otherwise
/// falls back to the legacy plaintext `api_key` column so already-installed
/// Android users can still log in on first launch after upgrade. New writes
/// never touch the plaintext column.
pub fn get_ai_settings(
    conn: &Connection,
    vault: Option<&LocalVault>,
) -> SqliteResult<AiSettings> {
    let mut stmt = conn.prepare(
        "SELECT provider, api_key, model_name, endpoint_url, temperature, max_tokens,
                memory_enabled, summary_model, summary_max_tokens, api_version,
                api_key_enc, api_key_nonce, api_key_crypto_version
         FROM ai_settings WHERE id = 1",
    )?;

    let mut rows = stmt.query([])?;

    if let Some(row) = rows.next()? {
        let provider: String = row.get(0)?;
        let api_key_plain: Option<String> = row.get(1)?;
        let model_name: String = row.get(2)?;
        let endpoint_url: String = row.get(3)?;
        let temperature: f64 = row.get(4)?;
        let max_tokens: i32 = row.get(5)?;
        let memory_enabled: i32 = row.get(6).unwrap_or(1);
        let summary_model: Option<String> = row.get(7).unwrap_or(None);
        let summary_max_tokens: i32 = row.get(8).unwrap_or(100);
        let api_version: Option<String> = row.get(9).unwrap_or(None);
        let api_key_enc: Option<String> = row.get(10).unwrap_or(None);
        let api_key_nonce: Option<String> = row.get(11).unwrap_or(None);
        let api_key_crypto_version: Option<i32> = row.get(12).unwrap_or(None);

        let api_key = match (api_key_enc, api_key_nonce, api_key_crypto_version) {
            (Some(ct), Some(nonce), Some(v)) if v == CRYPTO_VERSION_AES_GCM => {
                vault.and_then(|vlt| vlt.decrypt_string_b64(&ct, &nonce).ok())
            }
            _ => api_key_plain, // legacy plaintext fallback
        };

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

/// Persist AI settings. If `settings.api_key` is a non-empty string:
///   * With `vault = Some(_)` → encrypts into `api_key_enc`/`api_key_nonce`
///     (crypto_version = 2) and clears the legacy plaintext column.
///   * With `vault = None` → refuses (returns error). Storing a plaintext
///     API key in SQLite is exactly the Android H2 exposure we're fixing.
///
/// An empty or `None` api_key clears all columns.
pub fn upsert_ai_settings(
    conn: &Connection,
    vault: Option<&LocalVault>,
    settings: &AiSettings,
) -> SqliteResult<()> {
    let now = chrono::Utc::now().to_rfc3339();

    let (api_key_enc, api_key_nonce, api_key_crypto_version): (
        Option<String>,
        Option<String>,
        Option<i32>,
    ) = match settings.api_key.as_deref() {
        Some(k) if !k.is_empty() => {
            let Some(vlt) = vault else {
                return Err(rusqlite::Error::InvalidParameterName(
                    "local keystore unavailable — cannot persist AI api_key securely; \
                     use backend mode or configure a keystore"
                        .to_string(),
                ));
            };
            let (ct, nonce) = vlt.encrypt_string_b64(k).map_err(|e| {
                rusqlite::Error::InvalidParameterName(format!("encrypt failed: {e}"))
            })?;
            (Some(ct), Some(nonce), Some(CRYPTO_VERSION_AES_GCM))
        }
        _ => (None, None, None),
    };

    conn.execute(
        "INSERT INTO ai_settings (id, provider, api_key, model_name, endpoint_url, temperature, max_tokens,
            memory_enabled, summary_model, summary_max_tokens, api_version,
            api_key_enc, api_key_nonce, api_key_crypto_version,
            created_at, updated_at)
         VALUES (1, ?1, NULL, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
         ON CONFLICT(id) DO UPDATE SET
             provider = excluded.provider,
             api_key = NULL,
             model_name = excluded.model_name,
             endpoint_url = excluded.endpoint_url,
             temperature = excluded.temperature,
             max_tokens = excluded.max_tokens,
             memory_enabled = excluded.memory_enabled,
             summary_model = excluded.summary_model,
             summary_max_tokens = excluded.summary_max_tokens,
             api_version = excluded.api_version,
             api_key_enc = excluded.api_key_enc,
             api_key_nonce = excluded.api_key_nonce,
             api_key_crypto_version = excluded.api_key_crypto_version,
             updated_at = excluded.updated_at",
        (
            settings.provider_to_str(),
            &settings.model_name,
            &settings.endpoint_url,
            settings.temperature as f64,
            settings.max_tokens,
            settings.memory_enabled as i32,
            &settings.summary_model,
            settings.summary_max_tokens,
            &settings.api_version,
            &api_key_enc,
            &api_key_nonce,
            api_key_crypto_version,
            &now,
        ),
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::{AiProviderType, AiSettings};
    use crate::database::init_database_schema;

    fn vault() -> LocalVault {
        LocalVault::from_key_bytes(&[0xabu8; 32])
    }

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_database_schema(&conn).unwrap();
        conn
    }

    #[test]
    fn roundtrip_with_vault_encrypts_and_decrypts_api_key() {
        let conn = setup();
        let v = vault();
        let settings = AiSettings {
            provider: AiProviderType::OpenAi,
            api_key: Some("sk-real-secret".into()),
            model_name: "gpt-4o".into(),
            endpoint_url: "https://api.openai.com".into(),
            temperature: 0.7,
            max_tokens: 1024,
            memory_enabled: true,
            summary_model: None,
            summary_max_tokens: 100,
            api_version: None,
        };
        upsert_ai_settings(&conn, Some(&v), &settings).unwrap();

        // Ciphertext column must not contain the plaintext.
        let ct: Option<String> = conn
            .query_row("SELECT api_key_enc FROM ai_settings WHERE id = 1", [], |r| r.get(0))
            .unwrap();
        assert!(ct.as_deref().is_some_and(|s| !s.contains("sk-real-secret")));

        // Plaintext column must be NULL.
        let plain: Option<String> = conn
            .query_row("SELECT api_key FROM ai_settings WHERE id = 1", [], |r| r.get(0))
            .unwrap();
        assert!(plain.is_none(), "plaintext api_key column must be cleared");

        let got = get_ai_settings(&conn, Some(&v)).unwrap();
        assert_eq!(got.api_key.as_deref(), Some("sk-real-secret"));
    }

    #[test]
    fn without_vault_refuses_non_empty_api_key() {
        let conn = setup();
        let settings = AiSettings {
            provider: AiProviderType::OpenAi,
            api_key: Some("sk-would-leak".into()),
            ..AiSettings::default()
        };
        let res = upsert_ai_settings(&conn, None, &settings);
        assert!(res.is_err(), "must refuse to store plaintext without vault");
    }

    #[test]
    fn without_vault_allows_empty_or_none_api_key() {
        let conn = setup();
        let settings = AiSettings {
            provider: AiProviderType::Ollama,
            api_key: None,
            ..AiSettings::default()
        };
        assert!(upsert_ai_settings(&conn, None, &settings).is_ok());

        let settings_empty = AiSettings {
            provider: AiProviderType::Ollama,
            api_key: Some(String::new()),
            ..AiSettings::default()
        };
        assert!(upsert_ai_settings(&conn, None, &settings_empty).is_ok());
    }

    #[test]
    fn wrong_vault_key_returns_none_rather_than_plaintext() {
        let conn = setup();
        let v1 = LocalVault::from_key_bytes(&[0x01u8; 32]);
        let v2 = LocalVault::from_key_bytes(&[0x02u8; 32]);
        let settings = AiSettings {
            api_key: Some("sk-x".into()),
            ..AiSettings::default()
        };
        upsert_ai_settings(&conn, Some(&v1), &settings).unwrap();
        let got = get_ai_settings(&conn, Some(&v2)).unwrap();
        assert!(got.api_key.is_none());
    }
}
