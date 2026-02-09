use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use argon2::Argon2;
use rand::RngCore;
use sqlx::PgPool;
use uuid::Uuid;

/// Server-side credential vault using AES-256-GCM encryption.
/// Credentials are encrypted before storage and decrypted on retrieval.
#[derive(Clone)]
pub struct ServerVault {
    cipher: Aes256Gcm,
}

impl ServerVault {
    /// Create a new vault from an encryption key, using Argon2 for key derivation.
    /// The salt should be a stable, application-level value stored in configuration.
    pub fn new(encryption_key: &str, salt: &str) -> Result<Self, VaultError> {
        let key_bytes = argon2_derive_key(encryption_key.as_bytes(), salt.as_bytes())?;

        let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
        let cipher = Aes256Gcm::new(key);

        Ok(Self { cipher })
    }

    /// Encrypt plaintext data, returning (ciphertext, nonce).
    pub fn encrypt(&self, plaintext: &[u8]) -> Result<(Vec<u8>, Vec<u8>), VaultError> {
        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = self
            .cipher
            .encrypt(nonce, plaintext)
            .map_err(|_| VaultError::EncryptionFailed)?;

        Ok((ciphertext, nonce_bytes.to_vec()))
    }

    /// Decrypt ciphertext using the provided nonce.
    pub fn decrypt(&self, ciphertext: &[u8], nonce: &[u8]) -> Result<Vec<u8>, VaultError> {
        if nonce.len() != 12 {
            return Err(VaultError::InvalidNonce);
        }
        let nonce = Nonce::from_slice(nonce);

        self.cipher
            .decrypt(nonce, ciphertext)
            .map_err(|_| VaultError::DecryptionFailed)
    }

    /// Store an encrypted credential for a system.
    pub async fn store_credential(
        &self,
        db: &PgPool,
        system_id: Uuid,
        credential_type: &str,
        plaintext: &str,
        jump_host_key: Option<&str>,
    ) -> Result<Uuid, VaultError> {
        let (encrypted_data, nonce) = self.encrypt(plaintext.as_bytes())?;

        // Upsert: insert or update if exists
        let row = sqlx::query_scalar::<_, Uuid>(
            r#"
            INSERT INTO system_credentials (system_id, credential_type, encrypted_data, nonce, jump_host_key)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (system_id, credential_type, COALESCE(jump_host_key, ''))
            DO UPDATE SET encrypted_data = $3, nonce = $4, updated_at = now()
            RETURNING id
            "#,
        )
        .bind(system_id)
        .bind(credential_type)
        .bind(&encrypted_data)
        .bind(&nonce)
        .bind(jump_host_key)
        .fetch_one(db)
        .await
        .map_err(|e| VaultError::Database(e.to_string()))?;

        Ok(row)
    }

    /// Retrieve and decrypt a credential for a system.
    pub async fn get_credential(
        &self,
        db: &PgPool,
        system_id: Uuid,
        credential_type: &str,
        jump_host_key: Option<&str>,
    ) -> Result<Option<String>, VaultError> {
        let row = sqlx::query_as::<_, (Vec<u8>, Vec<u8>)>(
            r#"
            SELECT encrypted_data, nonce FROM system_credentials
            WHERE system_id = $1
              AND credential_type = $2
              AND COALESCE(jump_host_key, '') = COALESCE($3, '')
            "#,
        )
        .bind(system_id)
        .bind(credential_type)
        .bind(jump_host_key)
        .fetch_optional(db)
        .await
        .map_err(|e| VaultError::Database(e.to_string()))?;

        match row {
            Some((encrypted_data, nonce)) => {
                let plaintext = self.decrypt(&encrypted_data, &nonce)?;
                let text = String::from_utf8(plaintext)
                    .map_err(|_| VaultError::DecryptionFailed)?;
                Ok(Some(text))
            }
            None => Ok(None),
        }
    }

    /// Delete all credentials for a system.
    pub async fn delete_system_credentials(
        &self,
        db: &PgPool,
        system_id: Uuid,
    ) -> Result<(), VaultError> {
        sqlx::query("DELETE FROM system_credentials WHERE system_id = $1")
            .bind(system_id)
            .execute(db)
            .await
            .map_err(|e| VaultError::Database(e.to_string()))?;
        Ok(())
    }
}

/// Derive a 32-byte encryption key using Argon2id.
/// Salt must be at least 8 bytes (16+ recommended).
fn argon2_derive_key(password: &[u8], salt: &[u8]) -> Result<[u8; 32], VaultError> {
    if salt.len() < 8 {
        return Err(VaultError::InvalidSalt);
    }
    let mut key_bytes = [0u8; 32];
    Argon2::default()
        .hash_password_into(password, salt, &mut key_bytes)
        .map_err(|_| VaultError::KeyDerivationFailed)?;
    Ok(key_bytes)
}

#[derive(Debug, thiserror::Error)]
pub enum VaultError {
    #[error("Key derivation failed")]
    KeyDerivationFailed,
    #[error("Invalid salt: must be at least 8 bytes (16+ recommended)")]
    InvalidSalt,
    #[error("Encryption failed")]
    EncryptionFailed,
    #[error("Decryption failed — wrong key or corrupted data")]
    DecryptionFailed,
    #[error("Invalid nonce (must be 12 bytes)")]
    InvalidNonce,
    #[error("Database error: {0}")]
    Database(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let vault = ServerVault::new("test-encryption-key-for-aes256", "test-salt").unwrap();
        let plaintext = b"my-secret-ssh-password";

        let (ciphertext, nonce) = vault.encrypt(plaintext).unwrap();
        assert_ne!(ciphertext, plaintext);

        let decrypted = vault.decrypt(&ciphertext, &nonce).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_wrong_key_fails_decrypt() {
        let vault1 = ServerVault::new("key-one", "test-salt").unwrap();
        let vault2 = ServerVault::new("key-two", "test-salt").unwrap();

        let (ciphertext, nonce) = vault1.encrypt(b"secret").unwrap();
        assert!(vault2.decrypt(&ciphertext, &nonce).is_err());
    }

    #[test]
    fn test_invalid_nonce_fails() {
        let vault = ServerVault::new("test-key", "test-salt").unwrap();
        let (ciphertext, _) = vault.encrypt(b"data").unwrap();

        // Wrong nonce length
        assert!(vault.decrypt(&ciphertext, &[0u8; 8]).is_err());
    }

    #[test]
    fn test_tampered_ciphertext_fails() {
        let vault = ServerVault::new("test-key", "test-salt").unwrap();
        let (mut ciphertext, nonce) = vault.encrypt(b"data").unwrap();

        // Flip a byte
        if let Some(byte) = ciphertext.first_mut() {
            *byte ^= 0xff;
        }

        assert!(vault.decrypt(&ciphertext, &nonce).is_err());
    }

    #[test]
    fn test_empty_plaintext() {
        let vault = ServerVault::new("test-key", "test-salt").unwrap();
        let (ciphertext, nonce) = vault.encrypt(b"").unwrap();
        let decrypted = vault.decrypt(&ciphertext, &nonce).unwrap();
        assert!(decrypted.is_empty());
    }

    #[test]
    fn test_large_plaintext() {
        let vault = ServerVault::new("test-key", "test-salt").unwrap();
        let large_key = "-----BEGIN RSA PRIVATE KEY-----\n".to_string()
            + &"A".repeat(4000)
            + "\n-----END RSA PRIVATE KEY-----";
        let (ciphertext, nonce) = vault.encrypt(large_key.as_bytes()).unwrap();
        let decrypted = vault.decrypt(&ciphertext, &nonce).unwrap();
        assert_eq!(decrypted, large_key.as_bytes());
    }

    #[test]
    fn test_unique_nonces() {
        let vault = ServerVault::new("test-key", "test-salt").unwrap();
        let (_, nonce1) = vault.encrypt(b"data").unwrap();
        let (_, nonce2) = vault.encrypt(b"data").unwrap();
        // Nonces should be unique (random)
        assert_ne!(nonce1, nonce2);
    }
}
