use base64::Engine;
use rusqlite::{Connection, Result as SqliteResult};

/// Simple obfuscation key - in production, derive from device-specific data
const OBFUSCATION_KEY: &[u8] = b"containerus_ssh_credential_key_v1";

fn obfuscate(plaintext: &str) -> String {
    let bytes: Vec<u8> = plaintext
        .bytes()
        .enumerate()
        .map(|(i, b)| b ^ OBFUSCATION_KEY[i % OBFUSCATION_KEY.len()])
        .collect();
    base64::engine::general_purpose::STANDARD.encode(&bytes)
}

/// Deobfuscate a credential string (pub(crate) for migration use)
pub(crate) fn deobfuscate_credential(encoded: &str) -> Option<String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .ok()?;
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
            password: password_enc.and_then(|e| deobfuscate_credential(&e)),
            passphrase: passphrase_enc.and_then(|e| deobfuscate_credential(&e)),
            private_key: private_key_enc.and_then(|e| deobfuscate_credential(&e)),
        })
    } else {
        Ok(SshCredentials::default())
    }
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

    #[test]
    fn test_obfuscation_roundtrip() {
        let test_cases = vec![
            "simple password",
            "p@$$w0rd!#%^&*()",
            "",
            "a",
            "a very long password that exceeds the key length by quite a bit to test wrapping behavior",
            "unicode: hello world \u{00e9}\u{00e8}\u{00ea}",
        ];

        for plaintext in test_cases {
            let encoded = obfuscate(plaintext);
            let decoded = deobfuscate_credential(&encoded).unwrap();
            assert_eq!(decoded, plaintext, "Roundtrip failed for: {}", plaintext);
        }
    }

    #[test]
    fn test_obfuscation_produces_different_output() {
        let encoded = obfuscate("password123");
        assert_ne!(encoded, "password123");
        assert!(
            base64::engine::general_purpose::STANDARD
                .decode(&encoded)
                .is_ok()
        );
    }
}
