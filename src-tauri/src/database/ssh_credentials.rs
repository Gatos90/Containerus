use base64::Engine;
use rusqlite::{Connection, Result as SqliteResult};

use crate::crypto::{LocalVault, CRYPTO_VERSION_AES_GCM, CRYPTO_VERSION_LEGACY_XOR};

/// Legacy XOR obfuscation key. Kept ONLY for decrypting rows written by
/// pre-CON-42 builds during the one-shot migration sweep. New writes use
/// AES-256-GCM via `LocalVault`.
const LEGACY_XOR_KEY: &[u8] = b"containerus_ssh_credential_key_v1";

/// Deobfuscate a legacy XOR-encoded credential string. Pub(crate) because
/// the startup credential migration needs it; no new caller should rely on it.
pub(crate) fn deobfuscate_credential(encoded: &str) -> Option<String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .ok()?;
    let plaintext: Vec<u8> = bytes
        .iter()
        .enumerate()
        .map(|(i, &b)| b ^ LEGACY_XOR_KEY[i % LEGACY_XOR_KEY.len()])
        .collect();
    String::from_utf8(plaintext).ok()
}

/// SSH credentials for a system, decrypted.
#[derive(Debug, Clone, Default)]
pub struct SshCredentials {
    pub password: Option<String>,
    pub passphrase: Option<String>,
    /// PEM-encoded private key content (for mobile/imported keys)
    pub private_key: Option<String>,
}

/// Store SSH credentials for a system using AES-256-GCM.
///
/// Requires a `LocalVault`. When `vault` is `None` (e.g. Android without a
/// keystore backend), refuses to persist non-empty credentials rather than
/// falling back to plaintext / XOR obfuscation. Callers on those platforms
/// should surface the error to the UI so the user can switch to backend mode.
pub fn store_ssh_credentials(
    conn: &Connection,
    vault: Option<&LocalVault>,
    system_id: &str,
    password: Option<&str>,
    passphrase: Option<&str>,
    private_key: Option<&str>,
) -> SqliteResult<()> {
    let has_secret = password.is_some() || passphrase.is_some() || private_key.is_some();

    let vault = match vault {
        Some(v) => v,
        None => {
            if has_secret {
                // SqliteError -> callers convert to ContainerError::DatabaseError.
                // Use a dedicated code so the UI can distinguish.
                return Err(rusqlite::Error::InvalidParameterName(
                    "local keystore unavailable — cannot persist credentials securely; \
                     use backend mode or configure a keystore"
                        .to_string(),
                ));
            }
            // Nothing secret to write and no vault — nothing to do.
            return Ok(());
        }
    };

    let enc = |plain: Option<&str>| -> SqliteResult<(Option<String>, Option<String>)> {
        match plain {
            Some(p) => {
                let (ct, nonce) = vault.encrypt_string_b64(p).map_err(|e| {
                    rusqlite::Error::InvalidParameterName(format!("encrypt failed: {e}"))
                })?;
                Ok((Some(ct), Some(nonce)))
            }
            None => Ok((None, None)),
        }
    };

    let (password_enc, password_nonce) = enc(password)?;
    let (passphrase_enc, passphrase_nonce) = enc(passphrase)?;
    let (private_key_enc, private_key_nonce) = enc(private_key)?;

    conn.execute(
        "INSERT INTO ssh_credentials (
            system_id,
            password_enc, password_nonce,
            passphrase_enc, passphrase_nonce,
            private_key_enc, private_key_nonce,
            crypto_version
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(system_id) DO UPDATE SET
             password_enc     = COALESCE(?2, password_enc),
             password_nonce   = COALESCE(?3, password_nonce),
             passphrase_enc   = COALESCE(?4, passphrase_enc),
             passphrase_nonce = COALESCE(?5, passphrase_nonce),
             private_key_enc  = COALESCE(?6, private_key_enc),
             private_key_nonce= COALESCE(?7, private_key_nonce),
             crypto_version   = ?8",
        (
            system_id,
            &password_enc,
            &password_nonce,
            &passphrase_enc,
            &passphrase_nonce,
            &private_key_enc,
            &private_key_nonce,
            CRYPTO_VERSION_AES_GCM,
        ),
    )?;

    Ok(())
}

/// Retrieve SSH credentials. Decrypts AES-GCM rows using `vault`. For legacy
/// XOR rows (crypto_version = 1, written by pre-CON-42 builds), falls back to
/// `deobfuscate_credential` so existing users can still connect on first
/// launch until the startup migration sweeps them into the keyring vault.
pub fn get_ssh_credentials(
    conn: &Connection,
    vault: Option<&LocalVault>,
    system_id: &str,
) -> SqliteResult<SshCredentials> {
    let mut stmt = conn.prepare(
        "SELECT password_enc, password_nonce,
                passphrase_enc, passphrase_nonce,
                private_key_enc, private_key_nonce,
                crypto_version
         FROM ssh_credentials WHERE system_id = ?1",
    )?;

    let mut rows = stmt.query([system_id])?;
    let Some(row) = rows.next()? else {
        return Ok(SshCredentials::default());
    };

    let password_enc: Option<String> = row.get(0)?;
    let password_nonce: Option<String> = row.get(1)?;
    let passphrase_enc: Option<String> = row.get(2)?;
    let passphrase_nonce: Option<String> = row.get(3)?;
    let private_key_enc: Option<String> = row.get(4)?;
    let private_key_nonce: Option<String> = row.get(5)?;
    let crypto_version: Option<i32> = row.get(6).ok();

    let decrypt = |ct: Option<String>, nonce: Option<String>| -> Option<String> {
        match (ct, nonce, crypto_version) {
            (Some(c), Some(n), Some(v)) if v == CRYPTO_VERSION_AES_GCM => {
                vault.and_then(|vlt| vlt.decrypt_string_b64(&c, &n).ok())
            }
            (Some(c), _, Some(v)) if v == CRYPTO_VERSION_LEGACY_XOR => {
                deobfuscate_credential(&c)
            }
            (Some(c), None, None) => {
                // Pre-schema-bump rows have no crypto_version — treat as legacy XOR.
                deobfuscate_credential(&c)
            }
            _ => None,
        }
    };

    Ok(SshCredentials {
        password: decrypt(password_enc, password_nonce),
        passphrase: decrypt(passphrase_enc, passphrase_nonce),
        private_key: decrypt(private_key_enc, private_key_nonce),
    })
}

pub fn delete_ssh_credentials(conn: &Connection, system_id: &str) -> SqliteResult<()> {
    conn.execute(
        "DELETE FROM ssh_credentials WHERE system_id = ?1",
        [system_id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_vault() -> LocalVault {
        LocalVault::from_key_bytes(&[0x5au8; 32])
    }

    fn seed_system(conn: &Connection, id: &str) {
        conn.execute(
            "INSERT INTO systems (id, name, hostname, connection_type, primary_runtime, available_runtimes, auto_connect)
             VALUES (?1, ?1, 'h', 'remote', 'docker', '[]', 0)",
            [id],
        )
        .unwrap();
    }

    #[test]
    fn test_legacy_xor_deobfuscate_still_decodes_old_rows() {
        // Reproduce a pre-CON-42 XOR-encoded string and ensure the migration
        // helper can still read it back.
        let plain = "legacy-password";
        let xored: Vec<u8> = plain
            .bytes()
            .enumerate()
            .map(|(i, b)| b ^ LEGACY_XOR_KEY[i % LEGACY_XOR_KEY.len()])
            .collect();
        let encoded = base64::engine::general_purpose::STANDARD.encode(&xored);
        let decoded = deobfuscate_credential(&encoded).unwrap();
        assert_eq!(decoded, plain);
    }

    #[test]
    fn test_deobfuscate_rejects_garbage() {
        assert!(deobfuscate_credential("not base64!@#").is_none());
    }

    #[test]
    fn test_store_without_vault_and_no_secret_is_noop() {
        // Safety: calling with no vault and no secrets must not error.
        let conn = Connection::open_in_memory().unwrap();
        crate::database::init_database_schema(&conn).unwrap();
        assert!(store_ssh_credentials(&conn, None, "sys", None, None, None).is_ok());
    }

    #[test]
    fn test_store_without_vault_refuses_secret() {
        let conn = Connection::open_in_memory().unwrap();
        crate::database::init_database_schema(&conn).unwrap();
        let result =
            store_ssh_credentials(&conn, None, "sys", Some("secret"), None, None);
        assert!(result.is_err(), "must refuse to persist plaintext without vault");
    }

    #[test]
    fn test_store_and_get_with_vault_roundtrips() {
        let conn = Connection::open_in_memory().unwrap();
        crate::database::init_database_schema(&conn).unwrap();
        let vault = test_vault();
        seed_system(&conn, "sys-1");

        store_ssh_credentials(
            &conn,
            Some(&vault),
            "sys-1",
            Some("p@ssw0rd!"),
            Some("key-pass"),
            Some("-----BEGIN KEY-----\nAAA\n-----END KEY-----"),
        )
        .unwrap();

        let creds = get_ssh_credentials(&conn, Some(&vault), "sys-1").unwrap();
        assert_eq!(creds.password.as_deref(), Some("p@ssw0rd!"));
        assert_eq!(creds.passphrase.as_deref(), Some("key-pass"));
        assert!(creds.private_key.as_deref().unwrap().starts_with("-----BEGIN KEY"));
    }

    #[test]
    fn test_stored_row_has_no_plaintext() {
        // Acceptance: sqlite3 dump shows no recognizable plaintext.
        let conn = Connection::open_in_memory().unwrap();
        crate::database::init_database_schema(&conn).unwrap();
        let vault = test_vault();
        seed_system(&conn, "sys-2");

        store_ssh_credentials(
            &conn,
            Some(&vault),
            "sys-2",
            Some("SUPER-SECRET-TOKEN"),
            None,
            None,
        )
        .unwrap();

        let stored: Option<String> = conn
            .query_row(
                "SELECT password_enc FROM ssh_credentials WHERE system_id = 'sys-2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let stored = stored.unwrap();
        assert!(
            !stored.contains("SUPER-SECRET-TOKEN"),
            "ciphertext must not contain plaintext"
        );
    }

    #[test]
    fn test_get_with_wrong_vault_key_returns_none() {
        let conn = Connection::open_in_memory().unwrap();
        crate::database::init_database_schema(&conn).unwrap();
        let vault_a = LocalVault::from_key_bytes(&[0x01u8; 32]);
        let vault_b = LocalVault::from_key_bytes(&[0x02u8; 32]);
        seed_system(&conn, "sys");

        store_ssh_credentials(&conn, Some(&vault_a), "sys", Some("secret"), None, None)
            .unwrap();

        // Wrong key → AEAD rejects → we surface as missing rather than plaintext.
        let creds = get_ssh_credentials(&conn, Some(&vault_b), "sys").unwrap();
        assert!(creds.password.is_none());
    }

    #[test]
    fn test_legacy_xor_row_reads_via_fallback() {
        // Simulate a row written by a pre-CON-42 build (crypto_version = 1).
        let conn = Connection::open_in_memory().unwrap();
        crate::database::init_database_schema(&conn).unwrap();

        let plain = "old-password";
        let xored: Vec<u8> = plain
            .bytes()
            .enumerate()
            .map(|(i, b)| b ^ LEGACY_XOR_KEY[i % LEGACY_XOR_KEY.len()])
            .collect();
        let encoded = base64::engine::general_purpose::STANDARD.encode(&xored);
        seed_system(&conn, "legacy-sys");

        conn.execute(
            "INSERT INTO ssh_credentials (system_id, password_enc, crypto_version)
             VALUES (?1, ?2, ?3)",
            ("legacy-sys", &encoded, CRYPTO_VERSION_LEGACY_XOR),
        )
        .unwrap();

        let creds = get_ssh_credentials(&conn, None, "legacy-sys").unwrap();
        assert_eq!(creds.password.as_deref(), Some(plain));
    }

    #[test]
    fn test_nonces_are_unique_across_writes() {
        let conn = Connection::open_in_memory().unwrap();
        crate::database::init_database_schema(&conn).unwrap();
        let vault = test_vault();
        seed_system(&conn, "a");
        seed_system(&conn, "b");

        store_ssh_credentials(&conn, Some(&vault), "a", Some("same-secret"), None, None)
            .unwrap();
        store_ssh_credentials(&conn, Some(&vault), "b", Some("same-secret"), None, None)
            .unwrap();

        let n_a: String = conn
            .query_row(
                "SELECT password_nonce FROM ssh_credentials WHERE system_id = 'a'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let n_b: String = conn
            .query_row(
                "SELECT password_nonce FROM ssh_credentials WHERE system_id = 'b'",
                [],
                |r| r.get(0),
            )
            .unwrap();

        assert_ne!(n_a, n_b, "each encryption must use a fresh nonce");
    }
}
