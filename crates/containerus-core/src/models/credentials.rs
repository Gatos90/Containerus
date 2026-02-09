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
#[serde(rename_all = "camelCase")]
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
            .field("jump_host_credentials", &format!("{} hosts", self.jump_host_credentials.len()))
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

/// Auth tokens for a backend server connection, stored in the keyring vault.
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendTokens {
    pub access_token: String,
    pub refresh_token: String,
}

impl std::fmt::Debug for BackendTokens {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.debug_struct("BackendTokens")
            .field("access_token", &"[REDACTED]")
            .field("refresh_token", &"[REDACTED]")
            .finish()
    }
}

/// Single vault containing ALL credentials, stored as one keyring entry.
/// This ensures macOS only prompts once (one service name = one prompt).
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialVault {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub ssh_credentials: HashMap<String, SshCredentials>,
    #[serde(default)]
    pub ai_api_keys: HashMap<String, String>,
    #[serde(default)]
    pub backend_tokens: HashMap<String, BackendTokens>,
}

impl std::fmt::Debug for CredentialVault {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.debug_struct("CredentialVault")
            .field("version", &self.version)
            .field("ssh_credentials", &format!("{} systems", self.ssh_credentials.len()))
            .field("ai_api_keys", &format!("{} keys", self.ai_api_keys.len()))
            .field("backend_tokens", &format!("{} backends", self.backend_tokens.len()))
            .finish()
    }
}

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
