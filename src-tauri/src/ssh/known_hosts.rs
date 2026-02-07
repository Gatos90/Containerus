/// SSH host key verification against ~/.ssh/known_hosts.
///
/// Implements an "AcceptNew" policy:
/// - Known host with matching key → accept
/// - Unknown host → auto-accept and append to known_hosts
/// - Known host with different key → reject (MITM warning)
/// - Revoked key → reject

use std::fs;
use std::io::Write;
use std::path::PathBuf;

use hmac::{Hmac, Mac};
use sha1::Sha1;

use russh_keys::key::PublicKey as RusshPublicKey;
use russh_keys::PublicKeyBase64;

use crate::models::error::ContainerError;

/// Result of checking a host key against known_hosts
#[derive(Debug)]
pub enum HostKeyCheckResult {
    /// Key matches a known entry
    Matched,
    /// Host not found in known_hosts (first connection)
    Unknown {
        key_type: String,
        fingerprint: String,
    },
    /// Key does NOT match the stored entry (possible MITM)
    Mismatch {
        expected_fingerprint: String,
        actual_fingerprint: String,
    },
    /// Host key has been revoked
    Revoked,
}

/// Check a server's public key against ~/.ssh/known_hosts.
pub fn check_host_key(
    hostname: &str,
    port: u16,
    server_key: &RusshPublicKey,
) -> Result<HostKeyCheckResult, ContainerError> {
    let known_hosts_path = known_hosts_path()?;

    let content = match fs::read_to_string(&known_hosts_path) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // No known_hosts file — everything is unknown
            return Ok(HostKeyCheckResult::Unknown {
                key_type: server_key.name().to_string(),
                fingerprint: server_key.fingerprint(),
            });
        }
        Err(e) => {
            return Err(ContainerError::HostKeyVerificationFailed {
                hostname: hostname.to_string(),
                reason: format!("Failed to read known_hosts: {}", e),
            });
        }
    };

    check_host_key_against_content(hostname, port, server_key, &content)
}

/// Check against known_hosts content (separated for testability).
fn check_host_key_against_content(
    hostname: &str,
    port: u16,
    server_key: &RusshPublicKey,
    content: &str,
) -> Result<HostKeyCheckResult, ContainerError> {
    let server_key_bytes = server_key.public_key_bytes();

    // Build the host patterns to match against
    // For port 22, match "hostname". For other ports, match "[hostname]:port".
    let host_label = if port == 22 {
        hostname.to_string()
    } else {
        format!("[{}]:{}", hostname, port)
    };

    let parser = ssh_key::known_hosts::KnownHosts::new(content);
    let mut first_mismatch_fingerprint: Option<String> = None;

    for entry_result in parser {
        let entry = match entry_result {
            Ok(e) => e,
            Err(_) => continue, // skip malformed lines
        };

        if !host_matches(entry.host_patterns(), hostname, &host_label) {
            continue;
        }

        // Host matched — check if key is revoked
        if entry.marker() == Some(&ssh_key::known_hosts::Marker::Revoked) {
            // If the revoked entry's key matches the server key, reject
            if keys_equal(&server_key_bytes, entry.public_key()) {
                return Ok(HostKeyCheckResult::Revoked);
            }
            continue;
        }

        // Check if the key matches
        if keys_equal(&server_key_bytes, entry.public_key()) {
            return Ok(HostKeyCheckResult::Matched);
        } else if first_mismatch_fingerprint.is_none() {
            first_mismatch_fingerprint = Some(format_fingerprint(entry.public_key()));
        }
    }

    // If we found host entries but none matched, it's a mismatch
    if let Some(expected_fp) = first_mismatch_fingerprint {
        return Ok(HostKeyCheckResult::Mismatch {
            expected_fingerprint: expected_fp,
            actual_fingerprint: server_key.fingerprint(),
        });
    }

    // No matching host found
    Ok(HostKeyCheckResult::Unknown {
        key_type: server_key.name().to_string(),
        fingerprint: server_key.fingerprint(),
    })
}

/// Append a new host key entry to ~/.ssh/known_hosts.
pub fn add_host_key(
    hostname: &str,
    port: u16,
    server_key: &RusshPublicKey,
) -> Result<(), ContainerError> {
    let known_hosts_path = known_hosts_path()?;

    // Ensure ~/.ssh directory exists with correct permissions
    if let Some(parent) = known_hosts_path.parent() {
        fs::create_dir_all(parent).map_err(|e| ContainerError::HostKeyVerificationFailed {
            hostname: hostname.to_string(),
            reason: format!("Failed to create ~/.ssh directory: {}", e),
        })?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Err(e) = fs::set_permissions(parent, fs::Permissions::from_mode(0o700)) {
                tracing::warn!("Failed to set ~/.ssh directory permissions: {}", e);
            }
        }
    }

    let host_label = if port == 22 {
        hostname.to_string()
    } else {
        format!("[{}]:{}", hostname, port)
    };

    let algo = server_key.name();
    let key_base64 = server_key.public_key_base64();
    let line = format!("{} {} {}\n", host_label, algo, key_base64);

    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&known_hosts_path)
        .map_err(|e| ContainerError::HostKeyVerificationFailed {
            hostname: hostname.to_string(),
            reason: format!("Failed to open known_hosts for writing: {}", e),
        })?;

    file.write_all(line.as_bytes())
        .map_err(|e| ContainerError::HostKeyVerificationFailed {
            hostname: hostname.to_string(),
            reason: format!("Failed to write to known_hosts: {}", e),
        })?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(e) = fs::set_permissions(&known_hosts_path, fs::Permissions::from_mode(0o644)) {
            tracing::warn!("Failed to set known_hosts file permissions: {}", e);
        }
    }

    tracing::info!("Added {} host key for {} to known_hosts", algo, host_label);
    Ok(())
}

/// Check if the entry's host patterns match the given hostname.
fn host_matches(
    patterns: &ssh_key::known_hosts::HostPatterns,
    hostname: &str,
    host_label: &str,
) -> bool {
    match patterns {
        ssh_key::known_hosts::HostPatterns::Patterns(pats) => {
            let mut matched = false;
            for pat in pats {
                if pat.starts_with('!') {
                    // Negation pattern
                    if glob_match(&pat[1..], host_label) || glob_match(&pat[1..], hostname) {
                        return false;
                    }
                } else if glob_match(pat, host_label) || glob_match(pat, hostname) {
                    matched = true;
                }
            }
            matched
        }
        ssh_key::known_hosts::HostPatterns::HashedName { salt, hash } => {
            // HMAC-SHA1 of hostname with the salt
            hash_matches(salt, hash, host_label) || hash_matches(salt, hash, hostname)
        }
    }
}

/// Check if HMAC-SHA1(salt, name) == hash
fn hash_matches(salt: &[u8], expected_hash: &[u8; 20], name: &str) -> bool {
    let Ok(mut mac) = Hmac::<Sha1>::new_from_slice(salt) else {
        return false;
    };
    mac.update(name.as_bytes());
    let result = mac.finalize().into_bytes();
    result.as_slice() == expected_hash
}

/// Simple glob pattern matching supporting * and ? wildcards.
fn glob_match(pattern: &str, text: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    glob_match_inner(&p, &t)
}

fn glob_match_inner(pattern: &[char], text: &[char]) -> bool {
    match (pattern.first(), text.first()) {
        (None, None) => true,
        (Some('*'), _) => {
            // Try matching zero or more characters
            glob_match_inner(&pattern[1..], text)
                || (!text.is_empty() && glob_match_inner(pattern, &text[1..]))
        }
        (Some('?'), Some(_)) => glob_match_inner(&pattern[1..], &text[1..]),
        (Some(p), Some(t)) if *p == *t => glob_match_inner(&pattern[1..], &text[1..]),
        _ => false,
    }
}

/// Compare russh key bytes against an ssh_key::PublicKey.
fn keys_equal(russh_bytes: &[u8], ssh_key_pub: &ssh_key::PublicKey) -> bool {
    match ssh_key::PublicKey::from_bytes(russh_bytes) {
        Ok(parsed) => parsed.key_data() == ssh_key_pub.key_data(),
        Err(_) => false,
    }
}

/// Format an ssh_key::PublicKey fingerprint as SHA256:base64.
fn format_fingerprint(key: &ssh_key::PublicKey) -> String {
    use sha2::{Digest, Sha256};
    use ssh_encoding::Encode;

    let mut bytes = Vec::new();
    if key.key_data().encode(&mut bytes).is_ok() {
        let hash = Sha256::digest(&bytes);
        format!("SHA256:{}", data_encoding::BASE64_NOPAD.encode(&hash))
    } else {
        "unknown".to_string()
    }
}

/// Remove all entries for a given hostname/port from ~/.ssh/known_hosts.
/// Returns the number of entries removed.
pub fn remove_host_key(hostname: &str, port: u16) -> Result<usize, ContainerError> {
    let path = known_hosts_path()?;

    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(e) => {
            return Err(ContainerError::HostKeyVerificationFailed {
                hostname: hostname.to_string(),
                reason: format!("Failed to read known_hosts: {}", e),
            });
        }
    };

    let host_label = if port == 22 {
        hostname.to_string()
    } else {
        format!("[{}]:{}", hostname, port)
    };

    let mut kept_lines = Vec::new();
    let mut removed = 0usize;

    for line in content.lines() {
        let trimmed = line.trim();

        // Preserve comments and blank lines
        if trimmed.is_empty() || trimmed.starts_with('#') {
            kept_lines.push(line);
            continue;
        }

        // Try to parse this single line as a known_hosts entry
        let parser = ssh_key::known_hosts::KnownHosts::new(line);
        let mut matches_host = false;
        for entry_result in parser {
            if let Ok(entry) = entry_result {
                if host_matches_for_removal(entry.host_patterns(), &host_label) {
                    matches_host = true;
                }
            }
        }

        if matches_host {
            removed += 1;
        } else {
            kept_lines.push(line);
        }
    }

    if removed > 0 {
        // Write back with trailing newline
        let mut output = kept_lines.join("\n");
        if !output.is_empty() {
            output.push('\n');
        }

        fs::write(&path, output.as_bytes()).map_err(|e| {
            ContainerError::HostKeyVerificationFailed {
                hostname: hostname.to_string(),
                reason: format!("Failed to write known_hosts: {}", e),
            }
        })?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Err(e) = fs::set_permissions(&path, fs::Permissions::from_mode(0o644)) {
                tracing::warn!("Failed to set known_hosts file permissions: {}", e);
            }
        }

        tracing::info!(
            "Removed {} host key entry/entries for {} from known_hosts",
            removed,
            host_label
        );
    }

    Ok(removed)
}

/// Remove host key entries from known_hosts content (separated for testability).
/// Returns (remaining_content, entries_removed).
#[cfg(test)]
fn remove_host_key_from_content(
    hostname: &str,
    port: u16,
    content: &str,
) -> (String, usize) {
    let host_label = if port == 22 {
        hostname.to_string()
    } else {
        format!("[{}]:{}", hostname, port)
    };

    let mut kept_lines = Vec::new();
    let mut removed = 0usize;

    for line in content.lines() {
        let trimmed = line.trim();

        if trimmed.is_empty() || trimmed.starts_with('#') {
            kept_lines.push(line);
            continue;
        }

        let parser = ssh_key::known_hosts::KnownHosts::new(line);
        let mut matches_host = false;
        for entry_result in parser {
            if let Ok(entry) = entry_result {
                if host_matches_for_removal(entry.host_patterns(), &host_label) {
                    matches_host = true;
                }
            }
        }

        if matches_host {
            removed += 1;
        } else {
            kept_lines.push(line);
        }
    }

    let mut output = kept_lines.join("\n");
    if !output.is_empty() {
        output.push('\n');
    }

    (output, removed)
}

/// Strict host matching for removal: only matches against `host_label` (which includes
/// port info for non-22 ports). Unlike `host_matches` used for checking, this does NOT
/// match bare hostnames against non-standard port queries, preventing accidental removal
/// of port-22 entries when removing a non-standard-port entry.
fn host_matches_for_removal(
    patterns: &ssh_key::known_hosts::HostPatterns,
    host_label: &str,
) -> bool {
    match patterns {
        ssh_key::known_hosts::HostPatterns::Patterns(pats) => {
            let mut matched = false;
            for pat in pats {
                if pat.starts_with('!') {
                    if glob_match(&pat[1..], host_label) {
                        return false;
                    }
                } else if glob_match(pat, host_label) {
                    matched = true;
                }
            }
            matched
        }
        ssh_key::known_hosts::HostPatterns::HashedName { salt, hash } => {
            hash_matches(salt, hash, host_label)
        }
    }
}

/// Get the path to ~/.ssh/known_hosts.
fn known_hosts_path() -> Result<PathBuf, ContainerError> {
    dirs::home_dir()
        .map(|h| h.join(".ssh").join("known_hosts"))
        .ok_or_else(|| ContainerError::HostKeyVerificationFailed {
            hostname: "<unknown>".to_string(),
            reason: "Could not determine home directory".to_string(),
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_glob_match_exact() {
        assert!(glob_match("example.com", "example.com"));
        assert!(!glob_match("example.com", "other.com"));
    }

    #[test]
    fn test_glob_match_star() {
        assert!(glob_match("*.example.com", "foo.example.com"));
        assert!(glob_match("*.example.com", "bar.example.com"));
        assert!(!glob_match("*.example.com", "example.com"));
    }

    #[test]
    fn test_glob_match_question() {
        assert!(glob_match("test.example.???", "test.example.com"));
        assert!(glob_match("test.example.???", "test.example.org"));
        assert!(!glob_match("test.example.???", "test.example.info"));
    }

    #[test]
    fn test_glob_match_bracket_port() {
        assert!(glob_match("[example.com]:2222", "[example.com]:2222"));
        assert!(!glob_match("[example.com]:2222", "[example.com]:22"));
    }

    #[test]
    fn test_host_matches_plain_pattern() {
        let patterns: ssh_key::known_hosts::HostPatterns = "example.com".parse().unwrap();
        assert!(host_matches(&patterns, "example.com", "example.com"));
        assert!(!host_matches(&patterns, "other.com", "other.com"));
    }

    #[test]
    fn test_host_matches_wildcard() {
        let patterns: ssh_key::known_hosts::HostPatterns = "*.example.com".parse().unwrap();
        assert!(host_matches(&patterns, "foo.example.com", "foo.example.com"));
        assert!(!host_matches(&patterns, "example.com", "example.com"));
    }

    #[test]
    fn test_host_matches_negation() {
        let patterns: ssh_key::known_hosts::HostPatterns =
            "*.example.com,!bad.example.com".parse().unwrap();
        assert!(host_matches(&patterns, "good.example.com", "good.example.com"));
        assert!(!host_matches(&patterns, "bad.example.com", "bad.example.com"));
    }

    #[test]
    fn test_host_matches_port() {
        let patterns: ssh_key::known_hosts::HostPatterns = "[example.com]:2222".parse().unwrap();
        // The host_label for port 2222 would be "[example.com]:2222"
        assert!(host_matches(&patterns, "example.com", "[example.com]:2222"));
        // Port 22 uses bare hostname
        assert!(!host_matches(&patterns, "example.com", "example.com"));
    }

    #[test]
    fn test_host_matches_hashed() {
        // Create an HMAC-SHA1 hash of "example.com" with a known salt
        let salt = b"testsalt";
        let mut mac = Hmac::<Sha1>::new_from_slice(salt).unwrap();
        mac.update(b"example.com");
        let result = mac.finalize().into_bytes();
        let mut hash = [0u8; 20];
        hash.copy_from_slice(&result);

        let patterns = ssh_key::known_hosts::HostPatterns::HashedName {
            salt: salt.to_vec(),
            hash,
        };

        assert!(host_matches(&patterns, "example.com", "example.com"));
        assert!(!host_matches(&patterns, "other.com", "other.com"));
    }

    #[test]
    fn test_check_unknown_host() {
        // Empty known_hosts → everything is unknown
        let key = russh_keys::key::KeyPair::generate_ed25519();
        let pub_key = key.clone_public_key().unwrap();
        let result = check_host_key_against_content("newhost.com", 22, &pub_key, "").unwrap();
        assert!(matches!(result, HostKeyCheckResult::Unknown { .. }));
    }

    #[test]
    fn test_check_matched_host() {
        let key = russh_keys::key::KeyPair::generate_ed25519();
        let pub_key = key.clone_public_key().unwrap();
        let base64 = pub_key.public_key_base64();
        let algo = pub_key.name();

        let content = format!("myhost.com {} {}\n", algo, base64);
        let result = check_host_key_against_content("myhost.com", 22, &pub_key, &content).unwrap();
        assert!(matches!(result, HostKeyCheckResult::Matched));
    }

    #[test]
    fn test_check_mismatched_host() {
        let key1 = russh_keys::key::KeyPair::generate_ed25519();
        let pub_key1 = key1.clone_public_key().unwrap();
        let base64_1 = pub_key1.public_key_base64();
        let algo_1 = pub_key1.name();

        let key2 = russh_keys::key::KeyPair::generate_ed25519();
        let pub_key2 = key2.clone_public_key().unwrap();

        let content = format!("myhost.com {} {}\n", algo_1, base64_1);
        let result = check_host_key_against_content("myhost.com", 22, &pub_key2, &content).unwrap();
        assert!(matches!(result, HostKeyCheckResult::Mismatch { .. }));
    }

    #[test]
    fn test_check_nonstandard_port() {
        let key = russh_keys::key::KeyPair::generate_ed25519();
        let pub_key = key.clone_public_key().unwrap();
        let base64 = pub_key.public_key_base64();
        let algo = pub_key.name();

        // Entry uses [hostname]:port format for non-22 ports
        let content = format!("[myhost.com]:2222 {} {}\n", algo, base64);
        let result = check_host_key_against_content("myhost.com", 2222, &pub_key, &content).unwrap();
        assert!(matches!(result, HostKeyCheckResult::Matched));

        // Same host on different port should NOT match
        let result = check_host_key_against_content("myhost.com", 22, &pub_key, &content).unwrap();
        assert!(matches!(result, HostKeyCheckResult::Unknown { .. }));
    }

    #[test]
    fn test_check_revoked_key() {
        let key = russh_keys::key::KeyPair::generate_ed25519();
        let pub_key = key.clone_public_key().unwrap();
        let base64 = pub_key.public_key_base64();
        let algo = pub_key.name();

        let content = format!("@revoked myhost.com {} {}\n", algo, base64);
        let result = check_host_key_against_content("myhost.com", 22, &pub_key, &content).unwrap();
        assert!(matches!(result, HostKeyCheckResult::Revoked));
    }

    #[test]
    fn test_remove_host_key_removes_matching() {
        let key1 = russh_keys::key::KeyPair::generate_ed25519();
        let pub_key1 = key1.clone_public_key().unwrap();
        let base64_1 = pub_key1.public_key_base64();
        let algo_1 = pub_key1.name();

        let key2 = russh_keys::key::KeyPair::generate_ed25519();
        let pub_key2 = key2.clone_public_key().unwrap();
        let base64_2 = pub_key2.public_key_base64();
        let algo_2 = pub_key2.name();

        let content = format!(
            "host1.com {} {}\nhost2.com {} {}\n",
            algo_1, base64_1, algo_2, base64_2
        );

        let (remaining, removed) = remove_host_key_from_content("host1.com", 22, &content);
        assert_eq!(removed, 1);
        assert!(!remaining.contains("host1.com"));
        assert!(remaining.contains("host2.com"));
    }

    #[test]
    fn test_remove_host_key_preserves_comments() {
        let key = russh_keys::key::KeyPair::generate_ed25519();
        let pub_key = key.clone_public_key().unwrap();
        let base64 = pub_key.public_key_base64();
        let algo = pub_key.name();

        let content = format!(
            "# This is a comment\n\nmyhost.com {} {}\n# Another comment\n",
            algo, base64
        );

        let (remaining, removed) = remove_host_key_from_content("myhost.com", 22, &content);
        assert_eq!(removed, 1);
        assert!(remaining.contains("# This is a comment"));
        assert!(remaining.contains("# Another comment"));
        assert!(!remaining.contains("myhost.com"));
    }

    #[test]
    fn test_remove_host_key_nonstandard_port() {
        let key = russh_keys::key::KeyPair::generate_ed25519();
        let pub_key = key.clone_public_key().unwrap();
        let base64 = pub_key.public_key_base64();
        let algo = pub_key.name();

        let content = format!(
            "[myhost.com]:2222 {} {}\nmyhost.com {} {}\n",
            algo, base64, algo, base64
        );

        // Remove port 2222 entry — should keep the port 22 entry
        let (remaining, removed) = remove_host_key_from_content("myhost.com", 2222, &content);
        assert_eq!(removed, 1);
        assert!(!remaining.contains("[myhost.com]:2222"));
        assert!(remaining.contains("myhost.com"));
    }

    #[test]
    fn test_remove_host_key_no_match() {
        let key = russh_keys::key::KeyPair::generate_ed25519();
        let pub_key = key.clone_public_key().unwrap();
        let base64 = pub_key.public_key_base64();
        let algo = pub_key.name();

        let content = format!("other.com {} {}\n", algo, base64);

        let (remaining, removed) = remove_host_key_from_content("myhost.com", 22, &content);
        assert_eq!(removed, 0);
        assert!(remaining.contains("other.com"));
    }

    #[test]
    fn test_check_skips_malformed_lines() {
        let key = russh_keys::key::KeyPair::generate_ed25519();
        let pub_key = key.clone_public_key().unwrap();
        let base64 = pub_key.public_key_base64();
        let algo = pub_key.name();

        let content = format!(
            "this is garbage\nmyhost.com {} {}\nalso bad\n",
            algo, base64
        );
        let result = check_host_key_against_content("myhost.com", 22, &pub_key, &content).unwrap();
        assert!(matches!(result, HostKeyCheckResult::Matched));
    }
}
