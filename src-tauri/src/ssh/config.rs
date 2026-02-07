//! SSH config file parsing for importing hosts from ~/.ssh/config
//!
//! This module provides a parser for OpenSSH config files that extracts
//! host definitions and their key parameters for use in Containerus.
//! Supports: Host, Hostname, User, Port, IdentityFile, IdentitiesOnly,
//! ProxyCommand, ProxyJump, Include directives, and wildcard defaults.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use crate::models::error::ContainerError;
use crate::models::system::{JumpHost, SshAuthMethod};

/// A parsed SSH host entry from ~/.ssh/config
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshHostEntry {
    /// Host alias (the name used in SSH config)
    pub host: String,
    /// Actual hostname or IP address
    pub hostname: Option<String>,
    /// SSH username
    pub user: Option<String>,
    /// SSH port
    pub port: Option<u16>,
    /// Path to identity file (private key)
    pub identity_file: Option<String>,
    /// Whether to use only the specified identity file
    pub identities_only: Option<bool>,
    /// ProxyCommand for tunneling
    pub proxy_command: Option<String>,
    /// ProxyJump hosts (comma-separated)
    pub proxy_jump: Option<String>,
}

/// Internal representation of a host block during parsing
#[derive(Debug, Default, Clone)]
struct HostBlock {
    hostname: Option<String>,
    user: Option<String>,
    port: Option<u16>,
    identity_file: Option<String>,
    identities_only: Option<bool>,
    proxy_command: Option<String>,
    proxy_jump: Option<String>,
}

/// Get the SSH config file path, using override if provided
fn get_ssh_config_path(override_path: Option<&str>) -> Option<PathBuf> {
    if let Some(path) = override_path {
        if !path.is_empty() {
            return Some(PathBuf::from(expand_home(path)));
        }
    }
    dirs::home_dir().map(|h| h.join(".ssh").join("config"))
}

/// Check if the SSH config file exists
pub fn has_ssh_config(config_path: Option<&str>) -> bool {
    get_ssh_config_path(config_path)
        .map(|p| p.exists())
        .unwrap_or(false)
}

/// Expand ~ to home directory in a path
fn expand_home(path: &str) -> String {
    if path.starts_with("~/") || path == "~" {
        if let Some(home) = dirs::home_dir() {
            return path.replacen("~", &home.to_string_lossy(), 1);
        }
    }
    path.to_string()
}

/// Contract home directory to ~ in a path for display
fn contract_home(path: &str) -> String {
    if let Some(home) = dirs::home_dir() {
        let home_str = home.to_string_lossy();
        if path.starts_with(home_str.as_ref()) {
            return path.replacen(home_str.as_ref(), "~", 1);
        }
    }
    path.to_string()
}

/// Expand glob patterns in a path and return matching files
fn expand_glob(pattern: &str) -> Vec<PathBuf> {
    let expanded = expand_home(pattern);
    match glob::glob(&expanded) {
        Ok(paths) => paths.filter_map(|p| p.ok()).collect(),
        Err(_) => {
            // If glob fails, try as a literal path
            let path = PathBuf::from(&expanded);
            if path.exists() {
                vec![path]
            } else {
                vec![]
            }
        }
    }
}

/// Parse an SSH config file, following Include directives recursively.
/// `visited` tracks files already parsed to prevent circular includes.
fn parse_config_file(
    path: &Path,
    visited: &mut HashSet<PathBuf>,
) -> HashMap<String, HostBlock> {
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    if visited.contains(&canonical) {
        return HashMap::new();
    }
    visited.insert(canonical);

    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return HashMap::new(),
    };

    parse_config_content_with_includes(&content, path.parent(), visited)
}

/// Parse SSH config content, processing Include directives
fn parse_config_content_with_includes(
    content: &str,
    base_dir: Option<&Path>,
    visited: &mut HashSet<PathBuf>,
) -> HashMap<String, HostBlock> {
    let mut hosts: HashMap<String, HostBlock> = HashMap::new();
    let mut current_hosts: Vec<String> = Vec::new();

    for line in content.lines() {
        let line = line.trim();

        // Skip empty lines and comments
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        // Split on first whitespace or =
        let (key, value) = if let Some(eq_pos) = line.find('=') {
            let (k, v) = line.split_at(eq_pos);
            (k.trim().to_lowercase(), v[1..].trim().to_string())
        } else if let Some(space_pos) = line.find(|c: char| c.is_whitespace()) {
            let (k, v) = line.split_at(space_pos);
            (k.trim().to_lowercase(), v.trim().to_string())
        } else {
            continue;
        };

        match key.as_str() {
            "include" => {
                // Resolve the include path
                let include_paths = if value.starts_with('/') || value.starts_with('~') {
                    expand_glob(&value)
                } else if let Some(base) = base_dir {
                    expand_glob(&base.join(&value).to_string_lossy())
                } else {
                    expand_glob(&value)
                };

                for include_path in include_paths {
                    let included = parse_config_file(&include_path, visited);
                    // Merge included hosts (first definition wins in SSH config)
                    for (host, block) in included {
                        hosts.entry(host).or_insert(block);
                    }
                }
            }
            "host" => {
                current_hosts = value
                    .split_whitespace()
                    .map(|s| s.to_string())
                    .collect();

                for host in &current_hosts {
                    hosts.entry(host.clone()).or_default();
                }
            }
            "hostname" => {
                for host in &current_hosts {
                    if let Some(block) = hosts.get_mut(host) {
                        block.hostname = Some(value.clone());
                    }
                }
            }
            "user" => {
                for host in &current_hosts {
                    if let Some(block) = hosts.get_mut(host) {
                        block.user = Some(value.clone());
                    }
                }
            }
            "port" => {
                if let Ok(port) = value.parse::<u16>() {
                    for host in &current_hosts {
                        if let Some(block) = hosts.get_mut(host) {
                            block.port = Some(port);
                        }
                    }
                }
            }
            "identityfile" => {
                let expanded = expand_home(&value);
                let display_path = contract_home(&expanded);
                for host in &current_hosts {
                    if let Some(block) = hosts.get_mut(host) {
                        block.identity_file = Some(display_path.clone());
                    }
                }
            }
            "identitiesonly" => {
                let val = value.to_lowercase() == "yes";
                for host in &current_hosts {
                    if let Some(block) = hosts.get_mut(host) {
                        block.identities_only = Some(val);
                    }
                }
            }
            "proxycommand" => {
                for host in &current_hosts {
                    if let Some(block) = hosts.get_mut(host) {
                        block.proxy_command = Some(value.clone());
                    }
                }
            }
            "proxyjump" => {
                for host in &current_hosts {
                    if let Some(block) = hosts.get_mut(host) {
                        block.proxy_jump = Some(value.clone());
                    }
                }
            }
            _ => {
                // Ignore other directives
            }
        }
    }

    hosts
}

/// Parse config content without Include support (for unit tests with inline content)
fn parse_config_content(content: &str) -> HashMap<String, HostBlock> {
    let mut visited = HashSet::new();
    parse_config_content_with_includes(content, None, &mut visited)
}

/// Apply wildcard/default settings to a host
fn resolve_with_defaults(host: &str, hosts: &HashMap<String, HostBlock>) -> HostBlock {
    let mut result = HostBlock::default();

    // First, apply wildcard (*) defaults if present
    if let Some(defaults) = hosts.get("*") {
        result.hostname = defaults.hostname.clone();
        result.user = defaults.user.clone();
        result.port = defaults.port;
        result.identity_file = defaults.identity_file.clone();
        result.identities_only = defaults.identities_only;
        result.proxy_command = defaults.proxy_command.clone();
        result.proxy_jump = defaults.proxy_jump.clone();
    }

    // Then apply host-specific settings (override defaults)
    if let Some(specific) = hosts.get(host) {
        if specific.hostname.is_some() {
            result.hostname = specific.hostname.clone();
        }
        if specific.user.is_some() {
            result.user = specific.user.clone();
        }
        if specific.port.is_some() {
            result.port = specific.port;
        }
        if specific.identity_file.is_some() {
            result.identity_file = specific.identity_file.clone();
        }
        if specific.identities_only.is_some() {
            result.identities_only = specific.identities_only;
        }
        if specific.proxy_command.is_some() {
            result.proxy_command = specific.proxy_command.clone();
        }
        if specific.proxy_jump.is_some() {
            result.proxy_jump = specific.proxy_jump.clone();
        }
    }

    result
}

fn host_block_to_entry(host: &str, block: &HostBlock) -> SshHostEntry {
    SshHostEntry {
        host: host.to_string(),
        hostname: block.hostname.clone(),
        user: block.user.clone(),
        port: block.port,
        identity_file: block.identity_file.clone(),
        identities_only: block.identities_only,
        proxy_command: block.proxy_command.clone(),
        proxy_jump: block.proxy_jump.clone(),
    }
}

/// Read and parse the SSH config file
fn read_and_parse(config_path: Option<&str>) -> Result<HashMap<String, HostBlock>, ContainerError> {
    let path = get_ssh_config_path(config_path).ok_or_else(|| {
        ContainerError::InvalidConfiguration("Could not determine home directory".to_string())
    })?;

    if !path.exists() {
        return Ok(HashMap::new());
    }

    let mut visited = HashSet::new();
    Ok(parse_config_file(&path, &mut visited))
}

/// List all non-wildcard hosts from the SSH config
pub fn list_hosts(config_path: Option<&str>) -> Result<Vec<SshHostEntry>, ContainerError> {
    let hosts = read_and_parse(config_path)?;

    let mut entries: Vec<SshHostEntry> = hosts
        .keys()
        .filter(|host| !host.contains('*') && !host.contains('?'))
        .map(|host| {
            let resolved = resolve_with_defaults(host, &hosts);
            host_block_to_entry(host, &resolved)
        })
        .collect();

    entries.sort_by(|a, b| a.host.cmp(&b.host));
    Ok(entries)
}

/// Get the resolved configuration for a specific host
pub fn resolve_host(host_name: &str, config_path: Option<&str>) -> Result<SshHostEntry, ContainerError> {
    let path = get_ssh_config_path(config_path).ok_or_else(|| {
        ContainerError::InvalidConfiguration("Could not determine home directory".to_string())
    })?;

    if !path.exists() {
        return Err(ContainerError::InvalidConfiguration(
            "SSH config file not found".to_string(),
        ));
    }

    let mut visited = HashSet::new();
    let hosts = parse_config_file(&path, &mut visited);
    let resolved = resolve_with_defaults(host_name, &hosts);

    Ok(host_block_to_entry(host_name, &resolved))
}

/// Resolve a ProxyJump string into a list of JumpHost structs.
/// Handles:
/// - Bare host aliases (e.g., "jump-admin") resolved against parsed SSH config
/// - Explicit user@host:port format
/// - Chained jumps separated by commas (e.g., "bastion1,bastion2")
pub fn resolve_jump_hosts(
    proxy_jump: &str,
    config_path: Option<&str>,
) -> Result<Vec<JumpHost>, ContainerError> {
    let hosts = read_and_parse(config_path)?;
    let mut result = Vec::new();

    for entry in proxy_jump.split(',') {
        let entry = entry.trim();
        if entry.is_empty() {
            continue;
        }

        result.push(resolve_single_jump_host(entry, &hosts));
    }

    Ok(result)
}

/// Resolve a single jump host entry (either a bare alias or user@host:port format)
fn resolve_single_jump_host(entry: &str, hosts: &HashMap<String, HostBlock>) -> JumpHost {
    // Check if it's in user@host:port format
    if entry.contains('@') || entry.contains(':') {
        return parse_jump_host_explicit(entry);
    }

    // Try to resolve as SSH config host alias
    if hosts.contains_key(entry) {
        let resolved = resolve_with_defaults(entry, hosts);
        return JumpHost {
            hostname: resolved.hostname.unwrap_or_else(|| entry.to_string()),
            port: resolved.port.unwrap_or(22),
            username: resolved.user.unwrap_or_default(),
            identity_file: resolved.identity_file,
            auth_method: SshAuthMethod::PublicKey,
            private_key_content: None,
        };
    }

    // Treat as a bare hostname
    JumpHost {
        hostname: entry.to_string(),
        port: 22,
        username: String::new(),
        identity_file: None,
        auth_method: SshAuthMethod::PublicKey,
        private_key_content: None,
    }
}

/// Parse an explicit jump host in user@host:port format
fn parse_jump_host_explicit(entry: &str) -> JumpHost {
    let mut username = String::new();
    let mut rest = entry;

    // Extract user@ prefix
    if let Some(at_pos) = entry.find('@') {
        username = entry[..at_pos].to_string();
        rest = &entry[at_pos + 1..];
    }

    // Extract host:port
    let (hostname, port) = if let Some(colon_pos) = rest.rfind(':') {
        let port_str = &rest[colon_pos + 1..];
        if let Ok(p) = port_str.parse::<u16>() {
            (rest[..colon_pos].to_string(), p)
        } else {
            (rest.to_string(), 22)
        }
    } else {
        (rest.to_string(), 22)
    };

    JumpHost {
        hostname,
        port,
        username,
        identity_file: None,
        auth_method: SshAuthMethod::PublicKey,
        private_key_content: None,
    }
}

/// Expand tokens in a ProxyCommand string
/// %h -> target hostname
/// %p -> target port
/// %r -> remote username
pub fn expand_proxy_command_tokens(
    proxy_command: &str,
    hostname: &str,
    port: u16,
    username: &str,
) -> String {
    proxy_command
        .replace("%h", hostname)
        .replace("%p", &port.to_string())
        .replace("%r", username)
}

// ========================================================================
// Multi-path support: read and merge hosts from multiple SSH config files
// ========================================================================

/// Read and parse multiple SSH config files, merging hosts.
/// First-definition-wins semantics (same as OpenSSH Include).
/// If paths is empty, falls back to default ~/.ssh/config.
fn read_and_parse_multiple(config_paths: &[String]) -> Result<HashMap<String, HostBlock>, ContainerError> {
    let mut visited = HashSet::new();
    let mut all_hosts: HashMap<String, HostBlock> = HashMap::new();

    let paths_to_parse: Vec<PathBuf> = if config_paths.is_empty() {
        // Default: use ~/.ssh/config
        match dirs::home_dir().map(|h| h.join(".ssh").join("config")) {
            Some(p) => vec![p],
            None => return Err(ContainerError::InvalidConfiguration(
                "Could not determine home directory".to_string(),
            )),
        }
    } else {
        config_paths
            .iter()
            .filter(|p| !p.is_empty())
            .map(|p| PathBuf::from(expand_home(p)))
            .collect()
    };

    for path in &paths_to_parse {
        if !path.exists() {
            continue;
        }
        let hosts = parse_config_file(path, &mut visited);
        // First-definition-wins: only insert if not already present
        for (host, block) in hosts {
            all_hosts.entry(host).or_insert(block);
        }
    }

    Ok(all_hosts)
}

/// List all non-wildcard hosts from multiple SSH config files
pub fn list_hosts_multi(config_paths: &[String]) -> Result<Vec<SshHostEntry>, ContainerError> {
    let hosts = read_and_parse_multiple(config_paths)?;

    let mut entries: Vec<SshHostEntry> = hosts
        .keys()
        .filter(|host| !host.contains('*') && !host.contains('?'))
        .map(|host| {
            let resolved = resolve_with_defaults(host, &hosts);
            host_block_to_entry(host, &resolved)
        })
        .collect();

    entries.sort_by(|a, b| a.host.cmp(&b.host));
    Ok(entries)
}

/// Resolve a specific host from multiple SSH config files
pub fn resolve_host_multi(host_name: &str, config_paths: &[String]) -> Result<SshHostEntry, ContainerError> {
    let hosts = read_and_parse_multiple(config_paths)?;
    let resolved = resolve_with_defaults(host_name, &hosts);
    Ok(host_block_to_entry(host_name, &resolved))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_config() {
        let content = r#"
Host myserver
    HostName 192.168.1.100
    User admin
    Port 2222
"#;
        let hosts = parse_config_content(content);
        assert!(hosts.contains_key("myserver"));
        let block = hosts.get("myserver").unwrap();
        assert_eq!(block.hostname, Some("192.168.1.100".to_string()));
        assert_eq!(block.user, Some("admin".to_string()));
        assert_eq!(block.port, Some(2222));
    }

    #[test]
    fn test_parse_with_proxy_command() {
        let content = r#"
Host internal
    HostName internal.server
    ProxyCommand ssh -W %h:%p bastion
"#;
        let hosts = parse_config_content(content);
        let block = hosts.get("internal").unwrap();
        assert_eq!(
            block.proxy_command,
            Some("ssh -W %h:%p bastion".to_string())
        );
    }

    #[test]
    fn test_parse_with_proxy_jump() {
        let content = r#"
Host target
    HostName target.internal
    ProxyJump bastion@jump.example.com
"#;
        let hosts = parse_config_content(content);
        let block = hosts.get("target").unwrap();
        assert_eq!(
            block.proxy_jump,
            Some("bastion@jump.example.com".to_string())
        );
    }

    #[test]
    fn test_wildcard_defaults() {
        let content = r#"
Host *
    User defaultuser
    Port 22

Host special
    HostName special.server
    Port 2222
"#;
        let hosts = parse_config_content(content);
        let resolved = resolve_with_defaults("special", &hosts);
        assert_eq!(resolved.user, Some("defaultuser".to_string()));
        assert_eq!(resolved.port, Some(2222));
        assert_eq!(resolved.hostname, Some("special.server".to_string()));
    }

    #[test]
    fn test_expand_proxy_command_tokens() {
        let cmd = "ssh -W %h:%p bastion@jump.example.com";
        let expanded = expand_proxy_command_tokens(cmd, "internal.server", 22, "admin");
        assert_eq!(
            expanded,
            "ssh -W internal.server:22 bastion@jump.example.com"
        );
    }

    #[test]
    fn test_expand_proxy_command_with_user() {
        let cmd = "ssh -l %r -W %h:%p jump.example.com";
        let expanded = expand_proxy_command_tokens(cmd, "target.server", 2222, "deploy");
        assert_eq!(
            expanded,
            "ssh -l deploy -W target.server:2222 jump.example.com"
        );
    }

    #[test]
    fn test_multiple_hosts_on_one_line() {
        let content = r#"
Host server1 server2 server3
    User shared
    Port 22
"#;
        let hosts = parse_config_content(content);
        assert!(hosts.contains_key("server1"));
        assert!(hosts.contains_key("server2"));
        assert!(hosts.contains_key("server3"));
        assert_eq!(
            hosts.get("server1").unwrap().user,
            Some("shared".to_string())
        );
    }

    #[test]
    fn test_parse_identities_only() {
        let content = r#"
Host secure
    HostName secure.example.com
    User deploy
    IdentityFile ~/.ssh/deploy_key
    IdentitiesOnly yes

Host insecure
    HostName insecure.example.com
    IdentitiesOnly no
"#;
        let hosts = parse_config_content(content);
        assert_eq!(hosts.get("secure").unwrap().identities_only, Some(true));
        assert_eq!(hosts.get("insecure").unwrap().identities_only, Some(false));
    }

    #[test]
    fn test_resolve_jump_host_bare_alias() {
        let content = r#"
Host jump-admin
    HostName 164.30.20.153
    User kjanzen
    IdentityFile ~/.ssh/docassist
    IdentitiesOnly yes

Host chatbot
    HostName 192.168.3.166
    User kjanzen
    ProxyJump jump-admin
    IdentityFile ~/.ssh/docassist
    IdentitiesOnly yes
"#;
        let hosts = parse_config_content(content);

        // Resolve the ProxyJump alias
        let jump = resolve_single_jump_host("jump-admin", &hosts);
        assert_eq!(jump.hostname, "164.30.20.153");
        assert_eq!(jump.port, 22);
        assert_eq!(jump.username, "kjanzen");
        assert_eq!(jump.identity_file, Some("~/.ssh/docassist".to_string()));
    }

    #[test]
    fn test_resolve_jump_host_explicit_format() {
        let jump = parse_jump_host_explicit("bastion@jump.example.com:2222");
        assert_eq!(jump.hostname, "jump.example.com");
        assert_eq!(jump.port, 2222);
        assert_eq!(jump.username, "bastion");
    }

    #[test]
    fn test_resolve_jump_host_user_at_host() {
        let jump = parse_jump_host_explicit("admin@bastion.example.com");
        assert_eq!(jump.hostname, "bastion.example.com");
        assert_eq!(jump.port, 22);
        assert_eq!(jump.username, "admin");
    }

    #[test]
    fn test_resolve_chained_jump_hosts() {
        let content = r#"
Host bastion1
    HostName 10.0.0.1
    User jump1

Host bastion2
    HostName 10.0.0.2
    User jump2
    Port 2222
"#;
        let hosts = parse_config_content(content);

        let chain: Vec<JumpHost> = "bastion1,bastion2"
            .split(',')
            .map(|e| resolve_single_jump_host(e.trim(), &hosts))
            .collect();

        assert_eq!(chain.len(), 2);
        assert_eq!(chain[0].hostname, "10.0.0.1");
        assert_eq!(chain[0].username, "jump1");
        assert_eq!(chain[0].port, 22);
        assert_eq!(chain[1].hostname, "10.0.0.2");
        assert_eq!(chain[1].username, "jump2");
        assert_eq!(chain[1].port, 2222);
    }

    #[test]
    fn test_resolve_mixed_chain() {
        let content = r#"
Host bastion
    HostName 10.0.0.1
    User admin
"#;
        let hosts = parse_config_content(content);

        // Mix of alias and explicit format
        let chain: Vec<JumpHost> = "bastion,user@10.0.0.99:3333"
            .split(',')
            .map(|e| resolve_single_jump_host(e.trim(), &hosts))
            .collect();

        assert_eq!(chain.len(), 2);
        assert_eq!(chain[0].hostname, "10.0.0.1");
        assert_eq!(chain[0].username, "admin");
        assert_eq!(chain[1].hostname, "10.0.0.99");
        assert_eq!(chain[1].port, 3333);
        assert_eq!(chain[1].username, "user");
    }

    #[test]
    fn test_identities_only_default_inheritance() {
        let content = r#"
Host *
    IdentitiesOnly yes

Host myhost
    HostName myhost.example.com
"#;
        let hosts = parse_config_content(content);
        let resolved = resolve_with_defaults("myhost", &hosts);
        assert_eq!(resolved.identities_only, Some(true));
    }
}
