use async_trait::async_trait;
use russh::client::{self, Config, Handle};
use russh::keys::key;
use russh::ChannelMsg;
use russh_keys::{decode_secret_key, load_secret_key};
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::{Duration, Instant};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

use std::collections::HashMap;

use crate::executor::CommandResult;
use crate::keyring_store::JumpHostCredentials;
use crate::models::error::ContainerError;
use crate::models::system::{ContainerSystem, JumpHost, SshAuthMethod, SshConfig};

/// Format a host:port pair, bracketing IPv6 addresses to avoid ambiguity.
fn host_port(hostname: &str, port: u16) -> String {
    if hostname.contains(':') {
        format!("[{}]:{}", hostname, port)
    } else {
        format!("{}:{}", hostname, port)
    }
}

/// Reason a host key was rejected during verification.
pub enum HostKeyRejection {
    Mismatch { expected: String, actual: String },
    Revoked,
}

/// Handle to observe host key rejections after the SSH handshake.
/// Because russh takes ownership of `SshHandler`, we use `Arc<Mutex<>>` to
/// share the rejection state so the caller can inspect it after connection failure.
pub struct HostKeyWatcher(Arc<Mutex<Option<HostKeyRejection>>>);

impl HostKeyWatcher {
    /// If a host key rejection was recorded, convert it to a `ContainerError`.
    pub fn check(&self, hostname: &str, port: u16) -> Option<ContainerError> {
        let reason = self.0.lock().unwrap().take()?;
        Some(match reason {
            HostKeyRejection::Mismatch { expected, actual } => {
                ContainerError::HostKeyVerificationFailed {
                    hostname: hostname.to_string(),
                    reason: format!(
                        "Host key has changed!\nPort: {}\nExpected: {}\nReceived: {}",
                        port, expected, actual
                    ),
                }
            }
            HostKeyRejection::Revoked => ContainerError::HostKeyVerificationFailed {
                hostname: hostname.to_string(),
                reason: "Host key has been revoked".to_string(),
            },
        })
    }
}

/// SSH connection handler with host key verification.
pub struct SshHandler {
    hostname: String,
    port: u16,
    rejection: Arc<Mutex<Option<HostKeyRejection>>>,
}

impl SshHandler {
    pub fn new(hostname: String, port: u16) -> (Self, HostKeyWatcher) {
        let rejection = Arc::new(Mutex::new(None));
        let watcher = HostKeyWatcher(rejection.clone());
        (Self { hostname, port, rejection }, watcher)
    }
}

#[async_trait]
impl client::Handler for SshHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &key::PublicKey,
    ) -> Result<bool, Self::Error> {
        use crate::ssh::known_hosts::{self, HostKeyCheckResult};

        match known_hosts::check_host_key(&self.hostname, self.port, server_public_key) {
            Ok(HostKeyCheckResult::Matched) => {
                tracing::debug!("Host key verified for {}:{}", self.hostname, self.port);
                Ok(true)
            }
            Ok(HostKeyCheckResult::Unknown { key_type, fingerprint }) => {
                tracing::info!(
                    "Unknown host key for {}:{} ({} {}), auto-accepting",
                    self.hostname, self.port, key_type, fingerprint
                );
                if let Err(e) = known_hosts::add_host_key(&self.hostname, self.port, server_public_key) {
                    tracing::warn!("Failed to save host key to known_hosts: {}", e);
                }
                Ok(true)
            }
            Ok(HostKeyCheckResult::Mismatch { expected_fingerprint, actual_fingerprint }) => {
                tracing::error!(
                    "HOST KEY MISMATCH for {}:{} — possible MITM attack! Expected {}, got {}",
                    self.hostname, self.port, expected_fingerprint, actual_fingerprint
                );
                *self.rejection.lock().unwrap() = Some(HostKeyRejection::Mismatch {
                    expected: expected_fingerprint,
                    actual: actual_fingerprint,
                });
                Ok(false)
            }
            Ok(HostKeyCheckResult::Revoked) => {
                tracing::error!(
                    "Host key for {}:{} has been REVOKED",
                    self.hostname, self.port
                );
                *self.rejection.lock().unwrap() = Some(HostKeyRejection::Revoked);
                Ok(false)
            }
            Err(e) => {
                tracing::error!(
                    "Host key verification failed for {}:{}: {} — rejecting connection",
                    self.hostname, self.port, e
                );
                Ok(false)
            }
        }
    }
}

/// A stream wrapping a child process stdin/stdout for ProxyCommand
pub struct ProxyStream {
    reader: tokio::process::ChildStdout,
    writer: tokio::process::ChildStdin,
}

impl AsyncRead for ProxyStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.reader).poll_read(cx, buf)
    }
}

impl AsyncWrite for ProxyStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        Pin::new(&mut self.writer).poll_write(cx, buf)
    }

    fn poll_flush(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.writer).poll_flush(cx)
    }

    fn poll_shutdown(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.writer).poll_shutdown(cx)
    }
}

impl Unpin for ProxyStream {}

/// SSH client for a single connection
pub struct SshClient {
    /// SSH session handle - pub(crate) to allow port forwarding access
    pub(crate) session: Handle<SshHandler>,
    /// Jump host sessions that must stay alive to maintain the tunnel
    _jump_sessions: Vec<Handle<SshHandler>>,
    /// ProxyCommand child process (kept alive for the duration of the connection)
    _proxy_child: Option<tokio::process::Child>,
    system_id: String,
    created_at: Instant,
    last_used: Instant,
}

impl SshClient {
    /// Create a new SSH client and connect to the system
    /// password: Optional password for authentication (used on mobile where keyring isn't available)
    /// passphrase: Optional passphrase for SSH key authentication (used on mobile where keyring isn't available)
    /// private_key_content: Optional PEM-encoded private key content (for mobile/imported keys)
    pub async fn connect(
        system: &ContainerSystem,
        password: Option<&str>,
        passphrase: Option<&str>,
        private_key_content: Option<&str>,
    ) -> Result<Self, ContainerError> {
        let ssh_config = system
            .ssh_config
            .as_ref()
            .ok_or_else(|| ContainerError::InvalidConfiguration(
                "SSH configuration required for remote system".to_string(),
            ))?;

        let config = Config::default();

        let addr = host_port(&system.hostname, ssh_config.port);
        let timeout_duration = Duration::from_secs(ssh_config.connection_timeout);

        tracing::info!("Connecting to SSH server at {}", addr);

        // Apply timeout using tokio
        let (handler, watcher) = SshHandler::new(system.hostname.clone(), ssh_config.port);
        let connect_future = client::connect(Arc::new(config), &addr, handler);
        let mut session = tokio::time::timeout(timeout_duration, connect_future)
            .await
            .map_err(|_| ContainerError::NetworkTimeout(format!(
                "SSH connection to {} timed out after {} seconds",
                system.hostname, ssh_config.connection_timeout
            )))?
            .map_err(|e| {
                watcher.check(&system.hostname, ssh_config.port)
                    .unwrap_or_else(|| ContainerError::ConnectionFailed(
                        system.hostname.clone(),
                        e.to_string(),
                    ))
            })?;

        // Authenticate
        Self::authenticate(&mut session, ssh_config, &system.hostname, password, passphrase, private_key_content).await?;

        tracing::info!("Successfully connected to {}", system.hostname);

        Ok(Self {
            session,
            _jump_sessions: Vec::new(),
            _proxy_child: None,
            system_id: system.id.0.clone(),
            created_at: Instant::now(),
            last_used: Instant::now(),
        })
    }

    /// Connect to a system via ProxyJump (SSH-over-SSH tunneling)
    /// Each jump host in the chain is connected sequentially, with the final
    /// connection tunneled through the chain.
    pub async fn connect_via_jump(
        system: &ContainerSystem,
        jump_hosts: &[JumpHost],
        password: Option<&str>,
        passphrase: Option<&str>,
        private_key_content: Option<&str>,
        jump_host_creds: &HashMap<String, JumpHostCredentials>,
    ) -> Result<Self, ContainerError> {
        let ssh_config = system
            .ssh_config
            .as_ref()
            .ok_or_else(|| ContainerError::InvalidConfiguration(
                "SSH configuration required for remote system".to_string(),
            ))?;

        if jump_hosts.is_empty() {
            return Self::connect(system, password, passphrase, private_key_content).await;
        }

        let timeout_duration = Duration::from_secs(ssh_config.connection_timeout);
        let mut jump_sessions: Vec<Handle<SshHandler>> = Vec::new();

        // Step 1: Connect to the first jump host via TCP
        let first_jump = &jump_hosts[0];
        let first_addr = host_port(&first_jump.hostname, first_jump.port);
        tracing::info!("ProxyJump: connecting to first jump host at {}", first_addr);

        let config = Config::default();
        let (handler, watcher) = SshHandler::new(first_jump.hostname.clone(), first_jump.port);
        let mut current_session = tokio::time::timeout(
            timeout_duration,
            client::connect(Arc::new(config), &first_addr, handler),
        )
        .await
        .map_err(|_| ContainerError::NetworkTimeout(format!(
            "Connection to jump host {} timed out", first_jump.hostname
        )))?
        .map_err(|e| {
            watcher.check(&first_jump.hostname, first_jump.port)
                .unwrap_or_else(|| ContainerError::ConnectionFailed(
                    first_jump.hostname.clone(),
                    e.to_string(),
                ))
        })?;

        // Authenticate on the first jump host
        let first_cred_key = host_port(&first_jump.hostname, first_jump.port);
        Self::authenticate_jump_host(&mut current_session, first_jump, jump_host_creds.get(&first_cred_key)).await?;

        // Step 2: Chain through remaining jump hosts (if any)
        for (i, jump) in jump_hosts.iter().enumerate().skip(1) {
            tracing::info!("ProxyJump: opening tunnel through jump host {} to {}:{}", i, jump.hostname, jump.port);

            // Open direct-tcpip channel to the next hop
            let channel = current_session
                .channel_open_direct_tcpip(
                    jump.hostname.clone(),
                    jump.port as u32,
                    "127.0.0.1",
                    0u32,
                )
                .await
                .map_err(|e| ContainerError::ConnectionFailed(
                    jump.hostname.clone(),
                    format!("Failed to open tunnel: {}", e),
                ))?;

            let stream = channel.into_stream();

            // Keep the previous session alive
            jump_sessions.push(current_session);

            // Connect SSH over the tunnel
            let config = Config::default();
            let (handler, watcher) = SshHandler::new(jump.hostname.clone(), jump.port);
            current_session = tokio::time::timeout(
                timeout_duration,
                client::connect_stream(Arc::new(config), stream, handler),
            )
            .await
            .map_err(|_| ContainerError::NetworkTimeout(format!(
                "Connection to jump host {} timed out", jump.hostname
            )))?
            .map_err(|e| {
                watcher.check(&jump.hostname, jump.port)
                    .unwrap_or_else(|| ContainerError::ConnectionFailed(
                        jump.hostname.clone(),
                        e.to_string(),
                    ))
            })?;

            // Authenticate on this jump host
            let cred_key = host_port(&jump.hostname, jump.port);
            Self::authenticate_jump_host(&mut current_session, jump, jump_host_creds.get(&cred_key)).await?;
        }

        // Step 3: Open tunnel from last jump host to the target
        let target_host = &system.hostname;
        let target_port = ssh_config.port;
        tracing::info!("ProxyJump: opening final tunnel to {}:{}", target_host, target_port);

        let channel = current_session
            .channel_open_direct_tcpip(
                target_host.clone(),
                target_port as u32,
                "127.0.0.1",
                0u32,
            )
            .await
            .map_err(|e| ContainerError::ConnectionFailed(
                target_host.clone(),
                format!("Failed to open tunnel to target: {}", e),
            ))?;

        let stream = channel.into_stream();
        jump_sessions.push(current_session);

        // Step 4: Connect SSH to the target over the tunnel
        let config = Config::default();
        let (handler, watcher) = SshHandler::new(system.hostname.clone(), ssh_config.port);
        let mut target_session = tokio::time::timeout(
            timeout_duration,
            client::connect_stream(Arc::new(config), stream, handler),
        )
        .await
        .map_err(|_| ContainerError::NetworkTimeout(format!(
            "SSH connection to {} timed out", target_host
        )))?
        .map_err(|e| {
            watcher.check(&system.hostname, ssh_config.port)
                .unwrap_or_else(|| ContainerError::ConnectionFailed(
                    target_host.clone(),
                    e.to_string(),
                ))
        })?;

        // Authenticate on the target
        Self::authenticate(&mut target_session, ssh_config, target_host, password, passphrase, private_key_content).await?;

        tracing::info!("ProxyJump: successfully connected to {} via {} jump host(s)", target_host, jump_hosts.len());

        Ok(Self {
            session: target_session,
            _jump_sessions: jump_sessions,
            _proxy_child: None,
            system_id: system.id.0.clone(),
            created_at: Instant::now(),
            last_used: Instant::now(),
        })
    }

    /// Connect to a system via ProxyCommand (external process providing transport)
    pub async fn connect_via_proxy_command(
        system: &ContainerSystem,
        proxy_command: &str,
        password: Option<&str>,
        passphrase: Option<&str>,
        private_key_content: Option<&str>,
    ) -> Result<Self, ContainerError> {
        let ssh_config = system
            .ssh_config
            .as_ref()
            .ok_or_else(|| ContainerError::InvalidConfiguration(
                "SSH configuration required for remote system".to_string(),
            ))?;

        // Expand tokens in the proxy command
        let expanded_cmd = crate::ssh::config::expand_proxy_command_tokens(
            proxy_command,
            &system.hostname,
            ssh_config.port,
            &ssh_config.username,
        );

        tracing::info!("ProxyCommand: spawning '{}'", expanded_cmd);

        let timeout_duration = Duration::from_secs(ssh_config.connection_timeout);

        // Spawn the proxy command process
        let mut child = tokio::process::Command::new("sh")
            .arg("-c")
            .arg(&expanded_cmd)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| ContainerError::ConnectionFailed(
                system.hostname.clone(),
                format!("Failed to spawn ProxyCommand '{}': {}", expanded_cmd, e),
            ))?;

        let stdout = child.stdout.take().ok_or_else(|| {
            ContainerError::ConnectionFailed(
                system.hostname.clone(),
                "Failed to capture ProxyCommand stdout".to_string(),
            )
        })?;
        let stdin = child.stdin.take().ok_or_else(|| {
            ContainerError::ConnectionFailed(
                system.hostname.clone(),
                "Failed to capture ProxyCommand stdin".to_string(),
            )
        })?;

        let stream = ProxyStream {
            reader: stdout,
            writer: stdin,
        };

        // Connect SSH over the proxy stream
        let config = Config::default();
        let (handler, watcher) = SshHandler::new(system.hostname.clone(), ssh_config.port);
        let mut session = tokio::time::timeout(
            timeout_duration,
            client::connect_stream(Arc::new(config), stream, handler),
        )
        .await
        .map_err(|_| ContainerError::NetworkTimeout(format!(
            "SSH connection via ProxyCommand to {} timed out", system.hostname
        )))?
        .map_err(|e| {
            watcher.check(&system.hostname, ssh_config.port)
                .unwrap_or_else(|| ContainerError::ConnectionFailed(
                    system.hostname.clone(),
                    format!("SSH over ProxyCommand failed: {}", e),
                ))
        })?;

        // Authenticate on the target
        Self::authenticate(&mut session, ssh_config, &system.hostname, password, passphrase, private_key_content).await?;

        tracing::info!("ProxyCommand: successfully connected to {}", system.hostname);

        Ok(Self {
            session,
            _jump_sessions: Vec::new(),
            _proxy_child: Some(child),
            system_id: system.id.0.clone(),
            created_at: Instant::now(),
            last_used: Instant::now(),
        })
    }

    /// Authenticate on a jump host using its own independent credentials.
    /// Supports both password and public key authentication per hop.
    async fn authenticate_jump_host(
        session: &mut Handle<SshHandler>,
        jump: &JumpHost,
        jump_creds: Option<&JumpHostCredentials>,
    ) -> Result<(), ContainerError> {
        if jump.username.is_empty() {
            return Err(ContainerError::InvalidConfiguration(
                format!("Jump host {} has no username configured", jump.hostname),
            ));
        }

        match jump.auth_method {
            SshAuthMethod::Password => {
                let password = jump_creds
                    .and_then(|c| c.password.as_deref())
                    .ok_or_else(|| ContainerError::CredentialError(format!(
                        "Password required for jump host {} but not provided", jump.hostname
                    )))?;

                tracing::debug!("Authenticating on jump host {} with password", jump.hostname);

                let auth_result = session
                    .authenticate_password(&jump.username, password)
                    .await
                    .map_err(|e| ContainerError::SshAuthenticationFailed(format!(
                        "Jump host {} password auth error: {}", jump.hostname, e
                    )))?;

                if !auth_result {
                    return Err(ContainerError::SshAuthenticationFailed(format!(
                        "Password authentication failed on jump host {}", jump.hostname
                    )));
                }
            }
            SshAuthMethod::PublicKey => {
                let effective_passphrase = jump_creds.and_then(|c| c.passphrase.clone());

                // Try key sources in priority order:
                // 1. Imported key content from JumpHost config
                // 2. Imported key content from vault credentials
                // 3. Identity file path
                let key = if let Some(key_content) = &jump.private_key_content {
                    tracing::debug!("Authenticating on jump host {} with imported key content", jump.hostname);
                    decode_secret_key(key_content, effective_passphrase.as_deref())
                        .map_err(|e| ContainerError::CredentialError(format!(
                            "Failed to parse jump host {} key content: {}", jump.hostname, e
                        )))?
                } else if let Some(key_content) = jump_creds.and_then(|c| c.private_key.as_deref()) {
                    tracing::debug!("Authenticating on jump host {} with vault key content", jump.hostname);
                    decode_secret_key(key_content, effective_passphrase.as_deref())
                        .map_err(|e| ContainerError::CredentialError(format!(
                            "Failed to parse jump host {} vault key: {}", jump.hostname, e
                        )))?
                } else if let Some(key_path) = &jump.identity_file {
                    tracing::debug!("Authenticating on jump host {} with key file {}", jump.hostname, key_path);

                    let expanded_path = if key_path.starts_with("~") {
                        let home = dirs::home_dir()
                            .ok_or_else(|| ContainerError::InvalidConfiguration(
                                "Could not determine home directory".to_string(),
                            ))?;
                        key_path.replacen("~", &home.to_string_lossy(), 1)
                    } else {
                        key_path.clone()
                    };

                    load_secret_key(&expanded_path, effective_passphrase.as_deref())
                        .map_err(|e| ContainerError::CredentialError(format!(
                            "Failed to load jump host key from {}: {}", expanded_path, e
                        )))?
                } else {
                    return Err(ContainerError::InvalidConfiguration(format!(
                        "Jump host {} requires public key auth but no key is configured (no identity file, no imported key)",
                        jump.hostname
                    )));
                };

                let auth_result = session
                    .authenticate_publickey(&jump.username, Arc::new(key))
                    .await
                    .map_err(|e| ContainerError::SshAuthenticationFailed(format!(
                        "Jump host {} auth error: {}", jump.hostname, e
                    )))?;

                if !auth_result {
                    return Err(ContainerError::SshAuthenticationFailed(format!(
                        "Public key authentication failed on jump host {}", jump.hostname
                    )));
                }
            }
        }

        tracing::info!("Authenticated on jump host {}", jump.hostname);
        Ok(())
    }

    /// Authenticate with the SSH server
    /// password: Optional password passed from frontend (used on mobile)
    /// passphrase: Optional passphrase for SSH key authentication (used on mobile)
    /// private_key_content: Optional PEM-encoded private key content (for mobile/imported keys)
    async fn authenticate(
        session: &mut Handle<SshHandler>,
        config: &SshConfig,
        hostname: &str,
        password: Option<&str>,
        passphrase: Option<&str>,
        private_key_content: Option<&str>,
    ) -> Result<(), ContainerError> {
        match config.auth_method {
            SshAuthMethod::Password => {
                // Password must be provided by the caller (resolved from keyring/DB in connect_system)
                let password_to_use = if let Some(pwd) = password {
                    tracing::debug!("Using password provided by caller");
                    pwd.to_string()
                } else {
                    return Err(ContainerError::CredentialError(
                        "Password required. Please provide password when connecting.".to_string(),
                    ));
                };

                tracing::debug!("Attempting password authentication...");

                let auth_result = session
                    .authenticate_password(&config.username, &password_to_use)
                    .await
                    .map_err(|e| {
                        tracing::error!("SSH password authentication error: {}", e);
                        ContainerError::SshAuthenticationFailed(e.to_string())
                    })?;

                if !auth_result {
                    tracing::error!("SSH password authentication rejected by server for user: {}", config.username);
                    return Err(ContainerError::SshAuthenticationFailed(
                        "Password authentication failed - server rejected credentials".to_string(),
                    ));
                }

                tracing::debug!("Password authentication successful");
            }
            SshAuthMethod::PublicKey => {
                // Use provided passphrase first (from frontend), fall back to keyring (desktop only)
                let effective_passphrase = if let Some(pp) = passphrase {
                    tracing::debug!("Using passphrase provided by frontend");
                    Some(pp.to_string())
                } else {
                    None
                };

                // Try to load key from content first (mobile/imported keys), then from file path (desktop fallback)
                let key = if let Some(key_content) = private_key_content {
                    // Parse key from PEM content (mobile/imported keys)
                    tracing::debug!("Using private key content (imported key)");
                    decode_secret_key(key_content, effective_passphrase.as_deref())
                        .map_err(|e| ContainerError::CredentialError(format!(
                            "Failed to parse SSH key content: {}",
                            e
                        )))?
                } else if let Some(key_content) = &config.private_key_content {
                    // Parse key from config content (stored in system config)
                    tracing::debug!("Using private key content from config");
                    decode_secret_key(key_content, effective_passphrase.as_deref())
                        .map_err(|e| ContainerError::CredentialError(format!(
                            "Failed to parse SSH key content: {}",
                            e
                        )))?
                } else if let Some(key_path) = &config.private_key_path {
                    // Load key from file path (desktop fallback)
                    tracing::debug!("Loading private key from path: {}", key_path);

                    // Expand ~ to home directory
                    let expanded_path = if key_path.starts_with("~") {
                        let home = dirs::home_dir()
                            .ok_or_else(|| ContainerError::InvalidConfiguration(
                                "Could not determine home directory".to_string(),
                            ))?;
                        key_path.replacen("~", &home.to_string_lossy(), 1)
                    } else {
                        key_path.clone()
                    };

                    // Passphrase should be provided by the caller (resolved from keyring/DB in connect_system)
                    load_secret_key(&expanded_path, effective_passphrase.as_deref())
                        .map_err(|e| ContainerError::CredentialError(format!(
                            "Failed to load SSH key from {}: {}",
                            expanded_path, e
                        )))?
                } else {
                    return Err(ContainerError::InvalidConfiguration(
                        "Private key path or content required for public key authentication".to_string(),
                    ));
                };

                let auth_result = session
                    .authenticate_publickey(&config.username, Arc::new(key))
                    .await
                    .map_err(|e| ContainerError::SshAuthenticationFailed(e.to_string()))?;

                if !auth_result {
                    return Err(ContainerError::SshAuthenticationFailed(
                        "Public key authentication failed".to_string(),
                    ));
                }
            }
        }

        tracing::info!("SSH authentication successful for {}", hostname);
        Ok(())
    }

    /// Execute a command on the remote system
    pub async fn execute(&mut self, command: &str) -> Result<CommandResult, ContainerError> {
        let start = Instant::now();
        self.last_used = Instant::now();

        let mut channel = self
            .session
            .channel_open_session()
            .await
            .map_err(|e| ContainerError::Internal(format!("Failed to open SSH channel: {}", e)))?;

        channel
            .exec(true, command)
            .await
            .map_err(|e| ContainerError::Internal(format!("Failed to execute command: {}", e)))?;

        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut exit_code = 0;

        loop {
            match channel.wait().await {
                Some(ChannelMsg::Data { data }) => {
                    stdout.extend_from_slice(&data);
                }
                Some(ChannelMsg::ExtendedData { data, ext }) if ext == 1 => {
                    stderr.extend_from_slice(&data);
                }
                Some(ChannelMsg::ExitStatus { exit_status }) => {
                    exit_code = exit_status as i32;
                }
                Some(ChannelMsg::Eof) | None => break,
                _ => {}
            }
        }

        let execution_time_ms = start.elapsed().as_millis() as u64;

        Ok(CommandResult {
            stdout: String::from_utf8_lossy(&stdout).to_string(),
            stderr: String::from_utf8_lossy(&stderr).to_string(),
            exit_code,
            execution_time_ms,
        })
    }

    /// Get the system ID this client is connected to
    pub fn system_id(&self) -> &str {
        &self.system_id
    }

    /// Get when this connection was created
    pub fn created_at(&self) -> Instant {
        self.created_at
    }

    /// Get when this connection was last used
    pub fn last_used(&self) -> Instant {
        self.last_used
    }

    /// Check if the connection is still valid by sending a ping
    pub async fn is_alive(&mut self) -> bool {
        match self.execute("echo ok").await {
            Ok(result) => result.success() && result.stdout.trim() == "ok",
            Err(_) => false,
        }
    }

    /// Open an interactive PTY channel for terminal sessions
    /// This creates a new channel on the existing SSH connection (subterminal)
    /// Returns the raw channel for the caller to manage
    pub async fn open_pty_channel_raw(
        &mut self,
        cols: u32,
        rows: u32,
        command: Option<&str>,
    ) -> Result<russh::Channel<russh::client::Msg>, ContainerError> {
        self.last_used = Instant::now();

        let channel = self
            .session
            .channel_open_session()
            .await
            .map_err(|e| ContainerError::Internal(format!("Failed to open SSH channel: {}", e)))?;

        // Request PTY allocation
        channel
            .request_pty(true, "xterm-256color", cols, rows, 0, 0, &[])
            .await
            .map_err(|e| ContainerError::Internal(format!("Failed to request PTY: {}", e)))?;

        // Start shell or run command
        if let Some(cmd) = command {
            channel
                .exec(true, cmd)
                .await
                .map_err(|e| ContainerError::Internal(format!("Failed to exec: {}", e)))?;
        } else {
            channel
                .request_shell(true)
                .await
                .map_err(|e| ContainerError::Internal(format!("Failed to request shell: {}", e)))?;
        }

        Ok(channel)
    }
}

