use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use base64::Engine;
use rand::RngCore;

/// crypto_version=1 marks rows written with the legacy XOR obfuscation.
/// Retained for read-only migration only.
pub const CRYPTO_VERSION_LEGACY_XOR: i32 = 1;

/// crypto_version=2 marks rows written with AES-256-GCM + random 12-byte nonce.
pub const CRYPTO_VERSION_AES_GCM: i32 = 2;

#[cfg(not(target_os = "android"))]
const MASTER_KEY_SERVICE: &str = "containerus.crypto.master_key";
#[cfg(not(target_os = "android"))]
const MASTER_KEY_USER: &str = "default";

/// AES-256-GCM wrapper used for persisting credentials in the local SQLite DB.
pub struct LocalVault {
    cipher: Aes256Gcm,
}

impl LocalVault {
    /// Build a vault from a raw 32-byte key. Callers are responsible for
    /// sourcing the key from a secure location (OS keyring on desktop).
    pub fn from_key_bytes(key_bytes: &[u8; 32]) -> Self {
        let key = Key::<Aes256Gcm>::from_slice(key_bytes);
        Self { cipher: Aes256Gcm::new(key) }
    }

    /// Acquire (or generate and store) a 32-byte master key in the OS keyring.
    /// Desktop only — Android has no keyring backend wired up in this crate.
    #[cfg(not(target_os = "android"))]
    pub fn from_os_keyring() -> Result<Self, VaultError> {
        let entry = keyring::Entry::new(MASTER_KEY_SERVICE, MASTER_KEY_USER)
            .map_err(|e| VaultError::Keyring(format!("entry: {e}")))?;

        let key_bytes: [u8; 32] = match entry.get_password() {
            Ok(b64) => {
                let raw = base64::engine::general_purpose::STANDARD
                    .decode(b64.as_bytes())
                    .map_err(|e| VaultError::Keyring(format!("decode: {e}")))?;
                if raw.len() != 32 {
                    return Err(VaultError::Keyring(
                        "stored master key is not 32 bytes".into(),
                    ));
                }
                let mut arr = [0u8; 32];
                arr.copy_from_slice(&raw);
                arr
            }
            Err(keyring::Error::NoEntry) => {
                // First launch on this install — generate a fresh random key
                // and persist it. Subsequent launches will read it back.
                let mut arr = [0u8; 32];
                rand::thread_rng().fill_bytes(&mut arr);
                let b64 = base64::engine::general_purpose::STANDARD.encode(arr);
                entry
                    .set_password(&b64)
                    .map_err(|e| VaultError::Keyring(format!("set: {e}")))?;
                arr
            }
            Err(e) => return Err(VaultError::Keyring(format!("get: {e}"))),
        };

        Ok(Self::from_key_bytes(&key_bytes))
    }

    /// Encrypt `plaintext`, returning (ciphertext, nonce). Nonce is a fresh
    /// 12-byte random value per call (reuse is catastrophic for AES-GCM).
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

    /// Decrypt `ciphertext` using `nonce`. Fails on tampering or wrong key.
    pub fn decrypt(&self, ciphertext: &[u8], nonce: &[u8]) -> Result<Vec<u8>, VaultError> {
        if nonce.len() != 12 {
            return Err(VaultError::InvalidNonce);
        }
        let nonce = Nonce::from_slice(nonce);
        self.cipher
            .decrypt(nonce, ciphertext)
            .map_err(|_| VaultError::DecryptionFailed)
    }

    /// Encrypt a UTF-8 string, returning (base64(ciphertext), base64(nonce)).
    /// Convenient for storage in TEXT columns without changing the schema type.
    pub fn encrypt_string_b64(&self, plaintext: &str) -> Result<(String, String), VaultError> {
        let (ct, nonce) = self.encrypt(plaintext.as_bytes())?;
        Ok((
            base64::engine::general_purpose::STANDARD.encode(&ct),
            base64::engine::general_purpose::STANDARD.encode(&nonce),
        ))
    }

    /// Inverse of `encrypt_string_b64`.
    pub fn decrypt_string_b64(
        &self,
        ciphertext_b64: &str,
        nonce_b64: &str,
    ) -> Result<String, VaultError> {
        let ct = base64::engine::general_purpose::STANDARD
            .decode(ciphertext_b64.as_bytes())
            .map_err(|_| VaultError::DecryptionFailed)?;
        let nonce = base64::engine::general_purpose::STANDARD
            .decode(nonce_b64.as_bytes())
            .map_err(|_| VaultError::DecryptionFailed)?;
        let pt = self.decrypt(&ct, &nonce)?;
        String::from_utf8(pt).map_err(|_| VaultError::DecryptionFailed)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum VaultError {
    #[error("Encryption failed")]
    EncryptionFailed,
    #[error("Decryption failed — wrong key or corrupted data")]
    DecryptionFailed,
    #[error("Invalid nonce (must be 12 bytes)")]
    InvalidNonce,
    #[error("OS keyring error: {0}")]
    Keyring(String),
    #[error("No local keystore available on this platform — configure a keystore or use backend mode")]
    KeystoreUnavailable,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_vault() -> LocalVault {
        // Deterministic key for tests — never do this in production.
        LocalVault::from_key_bytes(&[0x7au8; 32])
    }

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let vault = test_vault();
        let (ct, nonce) = vault.encrypt(b"my-secret-ssh-password").unwrap();
        assert_ne!(ct, b"my-secret-ssh-password");
        let pt = vault.decrypt(&ct, &nonce).unwrap();
        assert_eq!(pt, b"my-secret-ssh-password");
    }

    #[test]
    fn unique_nonces_across_encrypts() {
        let vault = test_vault();
        let (_, n1) = vault.encrypt(b"data").unwrap();
        let (_, n2) = vault.encrypt(b"data").unwrap();
        let (_, n3) = vault.encrypt(b"data").unwrap();
        assert_ne!(n1, n2);
        assert_ne!(n2, n3);
        assert_ne!(n1, n3);
        assert_eq!(n1.len(), 12);
    }

    #[test]
    fn tamper_fails_decrypt() {
        let vault = test_vault();
        let (mut ct, nonce) = vault.encrypt(b"data").unwrap();
        // Flip a byte — AEAD should reject
        ct[0] ^= 0xff;
        assert!(vault.decrypt(&ct, &nonce).is_err());
    }

    #[test]
    fn wrong_key_fails_decrypt() {
        let a = LocalVault::from_key_bytes(&[0x01u8; 32]);
        let b = LocalVault::from_key_bytes(&[0x02u8; 32]);
        let (ct, nonce) = a.encrypt(b"secret").unwrap();
        assert!(b.decrypt(&ct, &nonce).is_err());
    }

    #[test]
    fn invalid_nonce_length_fails() {
        let vault = test_vault();
        let (ct, _) = vault.encrypt(b"data").unwrap();
        assert!(vault.decrypt(&ct, &[0u8; 8]).is_err());
        assert!(vault.decrypt(&ct, &[0u8; 16]).is_err());
    }

    #[test]
    fn b64_string_roundtrip() {
        let vault = test_vault();
        let (ct_b64, nonce_b64) = vault.encrypt_string_b64("hello world").unwrap();
        assert_ne!(ct_b64, "hello world");
        let pt = vault.decrypt_string_b64(&ct_b64, &nonce_b64).unwrap();
        assert_eq!(pt, "hello world");
    }

    #[test]
    fn empty_plaintext_roundtrips() {
        let vault = test_vault();
        let (ct, nonce) = vault.encrypt(b"").unwrap();
        assert_eq!(vault.decrypt(&ct, &nonce).unwrap(), b"");
    }

    #[test]
    fn large_plaintext_roundtrips() {
        let vault = test_vault();
        let key = "-----BEGIN RSA PRIVATE KEY-----\n".to_string()
            + &"A".repeat(4096)
            + "\n-----END RSA PRIVATE KEY-----";
        let (ct, nonce) = vault.encrypt(key.as_bytes()).unwrap();
        assert_eq!(vault.decrypt(&ct, &nonce).unwrap(), key.as_bytes());
    }
}
