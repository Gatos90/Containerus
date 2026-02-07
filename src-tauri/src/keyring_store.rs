/// Keyring-based credential storage for desktop platforms.
/// All credentials (SSH + AI API keys) are stored in a single keyring vault entry,
/// so macOS only prompts once. On Android, all functions return defaults — credentials stay in the DB.

use std::collections::HashMap;
use serde::{Deserialize, Serialize};

/// Credentials for a single jump host, keyed by "hostname:port"
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpHostCredentials {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub passphrase: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub private_key: Option<String>,
}

impl std::fmt::Debug for JumpHostCredentials {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.debug_struct("JumpHostCredentials")
            .field("password", &self.password.as_ref().map(|_| "[REDACTED]"))
            .field("passphrase", &self.passphrase.as_ref().map(|_| "[REDACTED]"))
            .field("private_key", &self.private_key.as_ref().map(|_| "[REDACTED]"))
            .finish()
    }
}

/// SSH credentials retrieved from the keyring
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct SshCredentials {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub passphrase: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub private_key: Option<String>,
    /// Per-jump-host credentials, keyed by "hostname:port"
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub jump_host_credentials: HashMap<String, JumpHostCredentials>,
}

impl std::fmt::Debug for SshCredentials {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.debug_struct("SshCredentials")
            .field("password", &self.password.as_ref().map(|_| "[REDACTED]"))
            .field("passphrase", &self.passphrase.as_ref().map(|_| "[REDACTED]"))
            .field("private_key", &self.private_key.as_ref().map(|_| "[REDACTED]"))
            .field("jump_host_credentials", &self.jump_host_credentials)
            .finish()
    }
}

impl SshCredentials {
    pub fn is_empty(&self) -> bool {
        self.password.is_none()
            && self.passphrase.is_none()
            && self.private_key.is_none()
            && self.jump_host_credentials.is_empty()
    }
}

/// Single vault containing ALL credentials, stored as one keyring entry.
/// This ensures macOS only prompts once (one service name = one prompt).
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct CredentialVault {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub ssh_credentials: HashMap<String, SshCredentials>,
    #[serde(default)]
    pub ai_api_keys: HashMap<String, String>,
}

impl std::fmt::Debug for CredentialVault {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.debug_struct("CredentialVault")
            .field("version", &self.version)
            .field("ssh_credentials", &format!("{} systems", self.ssh_credentials.len()))
            .field("ai_api_keys", &format!("{} keys", self.ai_api_keys.len()))
            .finish()
    }
}

// ======================== Desktop implementation ========================

#[cfg(not(target_os = "android"))]
mod inner {
    use super::CredentialVault;

    const VAULT_SERVICE: &str = "containerus.vault";
    const VAULT_USER: &str = "default";

    fn get_secret(service: &str, key: &str) -> Result<Option<String>, String> {
        let entry = keyring::Entry::new(service, key)
            .map_err(|e| format!("keyring entry error: {}", e))?;
        match entry.get_password() {
            Ok(val) => Ok(Some(val)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("keyring get error: {}", e)),
        }
    }

    fn set_secret(service: &str, key: &str, value: &str) -> Result<(), String> {
        let entry = keyring::Entry::new(service, key)
            .map_err(|e| format!("keyring entry error: {}", e))?;
        entry
            .set_password(value)
            .map_err(|e| format!("keyring set error: {}", e))
    }

    fn delete_secret(service: &str, key: &str) -> Result<(), String> {
        let entry = keyring::Entry::new(service, key)
            .map_err(|e| format!("keyring entry error: {}", e))?;
        match entry.delete_password() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("keyring delete error: {}", e)),
        }
    }

    pub fn load_vault() -> Result<CredentialVault, String> {
        match get_secret(VAULT_SERVICE, VAULT_USER)? {
            Some(json) => serde_json::from_str(&json).map_err(|e| {
                format!(
                    "Vault JSON corrupted — refusing to overwrite. \
                     Delete the '{}' keyring entry manually to reset. Error: {}",
                    VAULT_SERVICE, e
                )
            }),
            None => Ok(CredentialVault { version: 1, ..Default::default() }),
        }
    }

    pub fn save_vault(vault: &CredentialVault) -> Result<(), String> {
        let json = serde_json::to_string(vault)
            .map_err(|e| format!("failed to serialize vault: {}", e))?;
        set_secret(VAULT_SERVICE, VAULT_USER, &json)
    }

    pub fn delete_vault() -> Result<(), String> {
        delete_secret(VAULT_SERVICE, VAULT_USER)
    }
}

// ======================== Android stubs ========================

#[cfg(target_os = "android")]
mod inner {
    use super::CredentialVault;

    pub fn load_vault() -> Result<CredentialVault, String> { Ok(CredentialVault::default()) }
    pub fn save_vault(_vault: &CredentialVault) -> Result<(), String> { Ok(()) }
    pub fn delete_vault() -> Result<(), String> { Ok(()) }
}

// ======================== Public re-exports ========================

pub use inner::*;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_empty() {
        let creds = SshCredentials::default();
        assert!(creds.is_empty());

        let creds = SshCredentials { password: Some("x".into()), ..Default::default() };
        assert!(!creds.is_empty());
    }

    #[test]
    fn test_debug_redacts_secrets() {
        let creds = SshCredentials {
            password: Some("secret-pw".into()),
            passphrase: Some("secret-pp".into()),
            private_key: Some("-----BEGIN KEY-----".into()),
            ..Default::default()
        };
        let debug = format!("{:?}", creds);
        assert!(!debug.contains("secret-pw"));
        assert!(!debug.contains("secret-pp"));
        assert!(!debug.contains("BEGIN KEY"));
        assert!(debug.contains("REDACTED"));
    }
}
