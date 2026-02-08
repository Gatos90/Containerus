/// Sweep credentials from SQLite into the single credential vault on every startup.
///
/// Called at startup on desktop. Idempotent — safe to run every launch.
/// 1. Load existing vault from keyring
/// 2. Collect any DB credentials into vault (merge)
/// 3. Clean DB credential columns
/// 4. If vault changed, write once via `save_vault()` (one macOS prompt max)

#[cfg(not(target_os = "android"))]
pub fn migrate_credentials_to_keychain(conn: &rusqlite::Connection) -> Option<crate::keyring_store::CredentialVault> {
    // Load existing vault — we merge into it, never replace
    let mut vault = crate::keyring_store::load_vault().unwrap_or_default();

    // Sweep any DB credentials into vault (BEFORE cleaning!)
    let mut changed = false;
    changed |= collect_ssh_credentials_from_db(conn, &mut vault);
    changed |= collect_ai_api_key_from_db(conn, &mut vault);

    if changed {
        // ONE keyring write — ONE macOS prompt (or zero with "Always Allow")
        if let Err(e) = crate::keyring_store::save_vault(&vault) {
            tracing::error!("Failed to write vault: {}", e);
            // Don't clean DB — credentials would be lost
            return None;
        }

        // Clean DB credential columns ONLY after successful vault write
        cleanup_db_credentials(conn);

        tracing::info!(
            "Vault updated: {} SSH systems, {} AI keys",
            vault.ssh_credentials.len(),
            vault.ai_api_keys.len()
        );

        return Some(vault);
    }

    // No changes — clean any stale DB columns (no-op if already NULL)
    cleanup_db_credentials(conn);

    tracing::debug!("No new DB credentials to sweep, vault unchanged");
    None
}

// ---- Collect DB SSH credentials into vault (in-memory) ----

#[cfg(not(target_os = "android"))]
fn collect_ssh_credentials_from_db(
    conn: &rusqlite::Connection,
    vault: &mut crate::keyring_store::CredentialVault,
) -> bool {
    let mut stmt = match conn.prepare(
        "SELECT system_id, password_enc, passphrase_enc, private_key_enc
         FROM ssh_credentials
         WHERE password_enc IS NOT NULL
            OR passphrase_enc IS NOT NULL
            OR private_key_enc IS NOT NULL",
    ) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("Failed to query ssh_credentials for migration: {}", e);
            return false;
        }
    };

    let rows: Vec<(String, Option<String>, Option<String>, Option<String>)> = match stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        }) {
        Ok(mapped) => mapped.filter_map(|r| r.ok()).collect(),
        Err(e) => {
            tracing::warn!("Failed to read ssh_credentials rows: {}", e);
            return false;
        }
    };

    if rows.is_empty() {
        return false;
    }

    tracing::info!(
        "Found {} system(s) with DB-stored SSH credentials to sweep into vault",
        rows.len()
    );

    let mut changed = false;

    for (system_id, password_enc, passphrase_enc, private_key_enc) in rows {
        let creds = vault
            .ssh_credentials
            .entry(system_id.clone())
            .or_default();

        let mut system_changed = false;

        if let Some(ref enc) = password_enc {
            if let Some(plain) = crate::database::deobfuscate_credential(enc) {
                creds.password = Some(plain);
                system_changed = true;
            }
        }

        if let Some(ref enc) = passphrase_enc {
            if let Some(plain) = crate::database::deobfuscate_credential(enc) {
                creds.passphrase = Some(plain);
                system_changed = true;
            }
        }

        if let Some(ref enc) = private_key_enc {
            if let Some(plain) = crate::database::deobfuscate_credential(enc) {
                creds.private_key = Some(plain);
                system_changed = true;
            }
        }

        if system_changed {
            tracing::info!("Swept SSH credentials for system {}", system_id);
            changed = true;
        }
    }

    changed
}

// ---- Collect DB AI API key into vault (in-memory) ----

#[cfg(not(target_os = "android"))]
fn collect_ai_api_key_from_db(
    conn: &rusqlite::Connection,
    vault: &mut crate::keyring_store::CredentialVault,
) -> bool {
    let row: Option<(Option<String>, String)> = conn
        .query_row(
            "SELECT api_key, provider FROM ai_settings WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok();

    if let Some((Some(api_key), provider)) = row {
        if api_key.is_empty() {
            return false;
        }
        vault.ai_api_keys.insert(provider.clone(), api_key);
        tracing::info!("Swept AI API key for provider {}", provider);
        return true;
    }

    false
}

// ---- Cleanup: clear DB credential columns ----

#[cfg(not(target_os = "android"))]
fn cleanup_db_credentials(conn: &rusqlite::Connection) {
    if let Err(e) = conn.execute(
        "UPDATE ssh_credentials SET password_enc = NULL, passphrase_enc = NULL, private_key_enc = NULL
         WHERE password_enc IS NOT NULL OR passphrase_enc IS NOT NULL OR private_key_enc IS NOT NULL",
        [],
    ) {
        tracing::warn!("Failed to clear DB SSH credentials: {}", e);
    }

    if let Err(e) = conn.execute(
        "UPDATE ai_settings SET api_key = NULL WHERE api_key IS NOT NULL",
        [],
    ) {
        tracing::warn!("Failed to clear DB AI API key: {}", e);
    }
}

// Android: no-op
#[cfg(target_os = "android")]
pub fn migrate_credentials_to_keychain(_conn: &rusqlite::Connection) -> Option<crate::keyring_store::CredentialVault> { None }

