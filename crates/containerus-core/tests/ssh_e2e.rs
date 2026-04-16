//! SSH end-to-end integration tests against real sshd-in-a-container fixtures.
//!
//! These tests are gated and skip cleanly when the environment isn't ready:
//! - Docker daemon must be reachable (`docker version`).
//! - `ssh-keygen` must be on PATH (used to generate ephemeral keypairs).
//! - `CONTAINERUS_SSH_E2E=1` must be set, or `REAL_DOCKER=1` (aligns with the
//!   CON-37 Playwright suite's gating).
//!
//! Each test brings up one or more `lscr.io/linuxserver/openssh-server`
//! containers, drives them through `SshClient` / `SshConnectionPool`, then
//! tears everything down on drop. Containers are named with a `containerus-e2e-`
//! prefix so leftovers from crashed runs are easy to reap.
//!
//! Covers the CON-38 acceptance cases:
//!   - happy path: key auth connect + command execution
//!   - invalid private key surfaces a user-facing error
//!   - jump host chain (client -> bastion -> target) with command execution
//!   - mid-session disconnect + auto-reconnect via `ensure_connected`

use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use containerus_core::models::container::ContainerRuntime;
use containerus_core::models::credentials::JumpHostCredentials;
use containerus_core::models::error::ContainerError;
use containerus_core::models::system::{
    ContainerSystem, JumpHost, SshAuthMethod, SshConfig, SystemId,
};
use containerus_core::ssh::{SshClient, SshConnectionPool};

const SSHD_IMAGE: &str = "lscr.io/linuxserver/openssh-server:latest";
const SSH_USER: &str = "testuser";
const CONTAINER_PREFIX: &str = "containerus-e2e-ssh";

// -------- gating helpers --------------------------------------------------

fn e2e_gate_enabled() -> bool {
    std::env::var("CONTAINERUS_SSH_E2E").ok().as_deref() == Some("1")
        || std::env::var("REAL_DOCKER").ok().as_deref() == Some("1")
}

fn docker_available() -> bool {
    Command::new("docker")
        .arg("version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn ssh_keygen_available() -> bool {
    Command::new("ssh-keygen")
        .arg("-V")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok()
}

/// Host key verification reads `$HOME/.ssh/known_hosts`. To avoid polluting
/// the developer's real file, point `$HOME` at a test-owned tempdir for the
/// entire test binary, then pre-seed the container's host key into it per test.
static TEST_HOME: OnceLock<tempfile::TempDir> = OnceLock::new();

fn test_home() -> &'static std::path::Path {
    TEST_HOME
        .get_or_init(|| {
            let tmp = tempfile::tempdir().expect("create tempdir for HOME override");
            // SAFETY: set before any SSH calls that read dirs::home_dir().
            // Tests run with `--test-threads=1` so there is no racing reader.
            std::env::set_var("HOME", tmp.path());
            tmp
        })
        .path()
}

/// Append the container's SSH host public key to the test-owned known_hosts so
/// that `check_server_key` accepts the handshake. For jump-host chains, this
/// must be called for every hop (bastion AND target).
fn trust_container_host_key(container_name: &str, hostname_label: &str, port: u16) {
    let home = test_home();
    let ssh_dir = home.join(".ssh");
    std::fs::create_dir_all(&ssh_dir).expect("create test .ssh dir");
    let known_hosts = ssh_dir.join("known_hosts");

    // linuxserver/openssh-server regenerates host keys into /config on startup.
    // Wait briefly for the file to appear — it's created as part of normal boot.
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut pubkey_line = String::new();
    while Instant::now() < deadline {
        let output = Command::new("docker")
            .args([
                "exec",
                container_name,
                "cat",
                "/config/ssh_host_keys/ssh_host_ed25519_key.pub",
            ])
            .output()
            .expect("docker exec cat host key");
        if output.status.success() {
            pubkey_line = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !pubkey_line.is_empty() {
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    assert!(
        !pubkey_line.is_empty(),
        "could not read host pubkey from {container_name}"
    );

    // Line looks like: `ssh-ed25519 AAAAC3... optional comment`
    let mut parts = pubkey_line.split_whitespace();
    let algo = parts.next().expect("pubkey algo");
    let b64 = parts.next().expect("pubkey body");

    let host_label = if port == 22 {
        hostname_label.to_string()
    } else {
        format!("[{}]:{}", hostname_label, port)
    };

    let entry = format!("{host_label} {algo} {b64}\n");

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&known_hosts)
        .expect("open test known_hosts");
    file.write_all(entry.as_bytes())
        .expect("write host entry to test known_hosts");
}

/// Returns `true` if every precondition is in place. Emits a visible skip
/// message to the test runner otherwise so it's clear why the case was a no-op.
fn preflight(test_name: &str) -> bool {
    if !e2e_gate_enabled() {
        eprintln!(
            "[skip] {test_name}: set CONTAINERUS_SSH_E2E=1 (or REAL_DOCKER=1) to run SSH E2E suite"
        );
        return false;
    }
    if !docker_available() {
        eprintln!("[skip] {test_name}: docker daemon unreachable");
        return false;
    }
    if !ssh_keygen_available() {
        eprintln!("[skip] {test_name}: ssh-keygen not on PATH");
        return false;
    }
    true
}

// -------- key generation --------------------------------------------------

struct KeyPair {
    /// PEM-encoded private key (OpenSSH format — accepted by `russh`'s `decode_secret_key`).
    private_pem: String,
    /// Single-line OpenSSH public key (what gets dropped into `authorized_keys`).
    public_openssh: String,
    /// Lives for the duration of the keypair — removed on drop.
    _tmp: tempfile::TempDir,
}

fn generate_ed25519_keypair() -> KeyPair {
    let tmp = tempfile::tempdir().expect("create temp dir for keypair");
    let priv_path: PathBuf = tmp.path().join("id_ed25519");
    let pub_path: PathBuf = tmp.path().join("id_ed25519.pub");

    let status = Command::new("ssh-keygen")
        .args([
            "-t", "ed25519",
            "-N", "",
            "-C", "containerus-e2e",
            "-f",
        ])
        .arg(&priv_path)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .expect("ssh-keygen to start");
    assert!(status.success(), "ssh-keygen exited non-zero");

    let private_pem = std::fs::read_to_string(&priv_path).expect("read generated private key");
    let public_openssh = std::fs::read_to_string(&pub_path)
        .expect("read generated public key")
        .trim()
        .to_string();

    KeyPair { private_pem, public_openssh, _tmp: tmp }
}

// -------- docker fixture --------------------------------------------------

fn unique_suffix() -> String {
    // Pid + elapsed micros is plenty — these containers only need to be unique
    // within a single `cargo test` invocation.
    use std::time::SystemTime;
    let ts = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_micros())
        .unwrap_or(0);
    format!("{}-{}", std::process::id(), ts)
}

/// Runs `docker rm -f <name>` and swallows failures — used from Drop.
fn docker_rm_force(name: &str) {
    let _ = Command::new("docker")
        .args(["rm", "-f", name])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

/// Runs `docker network rm <name>` and swallows failures — used from Drop.
fn docker_network_rm(name: &str) {
    let _ = Command::new("docker")
        .args(["network", "rm", name])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

struct Network {
    name: String,
}

impl Network {
    fn create(label: &str) -> Self {
        let name = format!("{}-net-{}-{}", CONTAINER_PREFIX, label, unique_suffix());
        let status = Command::new("docker")
            .args(["network", "create", &name])
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .status()
            .expect("docker network create to run");
        assert!(status.success(), "docker network create failed");
        Self { name }
    }
}

impl Drop for Network {
    fn drop(&mut self) {
        docker_network_rm(&self.name);
    }
}

struct SshdContainer {
    name: String,
    /// Port on 127.0.0.1 that maps to the container's 2222. `None` when the
    /// container is only reachable over an internal docker network (jump-host
    /// inner hops).
    host_port: Option<u16>,
    /// DNS-reachable alias on the shared docker network (when attached).
    network_alias: Option<String>,
}

impl SshdContainer {
    fn start(
        label: &str,
        pubkey: &str,
        expose_host_port: bool,
        network: Option<&Network>,
    ) -> Self {
        let name = format!("{}-{}-{}", CONTAINER_PREFIX, label, unique_suffix());

        // No `--rm` here — Drop cleans up via `docker rm -f`, and `--rm` races
        // with `docker restart` in the mid-session-disconnect test.
        let mut args: Vec<String> = vec![
            "run".into(),
            "-d".into(),
            "--name".into(),
            name.clone(),
            "-e".into(),
            format!("USER_NAME={SSH_USER}"),
            "-e".into(),
            format!("PUBLIC_KEY={pubkey}"),
            "-e".into(),
            "SUDO_ACCESS=false".into(),
            "-e".into(),
            "PASSWORD_ACCESS=false".into(),
            "-e".into(),
            "PUID=1000".into(),
            "-e".into(),
            "PGID=1000".into(),
        ];

        // Pin a specific host port instead of letting docker pick one: Docker
        // Desktop re-allocates ephemeral ports on `docker restart`, which
        // breaks the mid-session-disconnect and jump-host tests (both issue a
        // restart after starting the container).
        let host_port = if expose_host_port { Some(pick_free_port()) } else { None };
        if let Some(port) = host_port {
            args.extend(["-p".into(), format!("127.0.0.1:{port}:2222")]);
        }

        let network_alias = network.map(|n| {
            let alias = label.replace('_', "-");
            args.extend([
                "--network".into(),
                n.name.clone(),
                "--network-alias".into(),
                alias.clone(),
                "--hostname".into(),
                alias.clone(),
            ]);
            alias
        });

        args.push(SSHD_IMAGE.to_string());

        let status = Command::new("docker")
            .args(&args)
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .status()
            .expect("docker run to start");
        assert!(status.success(), "docker run failed for {name}");

        let container = Self { name, host_port, network_alias };
        if let Some(port) = container.host_port {
            wait_for_ssh_banner("127.0.0.1", port, Duration::from_secs(30));
        }
        container
    }

    fn hostname_alias(&self) -> &str {
        self.network_alias.as_deref().expect("network alias not configured")
    }

    /// `linuxserver/openssh-server` ships with `AllowTcpForwarding no`, which
    /// breaks ProxyJump (`channel_open_direct_tcpip` returns
    /// `AdministrativelyProhibited`). Flip the flag in-place and restart so
    /// the jump-host tests can open tunnels through this bastion.
    fn enable_tcp_forwarding(&self) {
        // Candidate paths differ across the image's release channels.
        let script = r#"
            set -e
            for f in /config/sshd/sshd_config /etc/ssh/sshd_config; do
                if [ -f "$f" ]; then
                    if grep -qE '^\s*AllowTcpForwarding' "$f"; then
                        sed -i 's/^\s*AllowTcpForwarding.*/AllowTcpForwarding yes/' "$f"
                    else
                        echo 'AllowTcpForwarding yes' >> "$f"
                    fi
                    if grep -qE '^\s*GatewayPorts' "$f"; then
                        sed -i 's/^\s*GatewayPorts.*/GatewayPorts yes/' "$f"
                    else
                        echo 'GatewayPorts yes' >> "$f"
                    fi
                fi
            done
        "#;

        let status = Command::new("docker")
            .args(["exec", &self.name, "sh", "-c", script])
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .status()
            .expect("docker exec sshd_config patch");
        assert!(status.success(), "patching sshd_config in {} failed", self.name);

        let restart = Command::new("docker")
            .args(["restart", "-t", "2", &self.name])
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .status()
            .expect("docker restart after sshd_config patch");
        assert!(restart.success(), "restart after patch failed for {}", self.name);

        if let Some(port) = self.host_port {
            wait_for_ssh_banner("127.0.0.1", port, Duration::from_secs(30));
        } else {
            // No host port mapped — give sshd a moment to come back up on the
            // internal network. 2s is enough in practice for a bare restart.
            std::thread::sleep(Duration::from_secs(2));
        }
    }
}

impl Drop for SshdContainer {
    fn drop(&mut self) {
        docker_rm_force(&self.name);
    }
}

/// Ask the OS for a free TCP port on the loopback, then release it. Small
/// race window between close and the subsequent `docker run -p`, but good
/// enough for single-threaded integration tests.
fn pick_free_port() -> u16 {
    use std::net::TcpListener;
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral loopback port");
    let port = listener.local_addr().expect("local_addr").port();
    drop(listener);
    port
}

fn wait_for_ssh_banner(host: &str, port: u16, timeout: Duration) {
    use std::io::Read;
    use std::net::TcpStream;

    let deadline = Instant::now() + timeout;
    let addr = format!("{host}:{port}");
    let mut last_err: Option<String> = None;

    while Instant::now() < deadline {
        match TcpStream::connect(&addr) {
            Ok(mut stream) => {
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .expect("set_read_timeout");
                let mut buf = [0u8; 64];
                match stream.read(&mut buf) {
                    Ok(n) if n > 0 => {
                        let banner = String::from_utf8_lossy(&buf[..n]);
                        if banner.starts_with("SSH-") {
                            return;
                        }
                        last_err = Some(format!("non-SSH banner: {banner:?}"));
                    }
                    Ok(_) => last_err = Some("empty banner".into()),
                    Err(e) => last_err = Some(format!("banner read error: {e}")),
                }
            }
            Err(e) => {
                last_err = Some(format!("connect error: {e}"));
            }
        }
        std::thread::sleep(Duration::from_millis(500));
    }

    panic!("sshd at {addr} never presented banner within {timeout:?} (last: {last_err:?})");
}

// -------- system builders -------------------------------------------------

fn system_for(container: &SshdContainer, key_pem: &str) -> ContainerSystem {
    let port = container.host_port.expect("host port required for direct connect");
    ContainerSystem {
        id: SystemId(format!("test-{}", container.name)),
        name: container.name.clone(),
        hostname: "127.0.0.1".into(),
        connection_type: containerus_core::models::system::ConnectionType::Remote,
        primary_runtime: ContainerRuntime::Docker,
        available_runtimes: HashSet::new(),
        ssh_config: Some(SshConfig {
            username: SSH_USER.into(),
            port,
            auth_method: SshAuthMethod::PublicKey,
            private_key_path: None,
            private_key_content: Some(key_pem.into()),
            connection_timeout: 30,
            proxy_command: None,
            proxy_jump: None,
            ssh_config_host: None,
        }),
        auto_connect: false,
    }
}

// -------- tests -----------------------------------------------------------

#[tokio::test]
async fn happy_path_key_auth_connects_and_executes() {
    if !preflight("happy_path_key_auth_connects_and_executes") {
        return;
    }

    let keys = generate_ed25519_keypair();
    let container = SshdContainer::start("happy", &keys.public_openssh, true, None);
    let system = system_for(&container, &keys.private_pem);

    trust_container_host_key(
        &container.name,
        "127.0.0.1",
        container.host_port.expect("host port"),
    );

    let mut pool = SshConnectionPool::new();
    let creds: HashMap<String, JumpHostCredentials> = HashMap::new();

    pool.connect(&system, None, None, None, &creds)
        .await
        .expect("happy path connect");
    assert!(pool.is_connected(&system.id.0));

    let result = pool
        .execute(&system.id.0, "echo containerus-e2e-ok")
        .await
        .expect("execute command");

    assert_eq!(result.exit_code, 0, "stderr={:?}", result.stderr);
    assert!(
        result.stdout.contains("containerus-e2e-ok"),
        "unexpected stdout: {:?}",
        result.stdout
    );

    assert!(pool.validate_connection(&system.id.0).await.expect("validate"));
}

#[tokio::test]
async fn invalid_private_key_surfaces_user_facing_error() {
    if !preflight("invalid_private_key_surfaces_user_facing_error") {
        return;
    }

    let keys = generate_ed25519_keypair();
    let container = SshdContainer::start("badkey", &keys.public_openssh, true, None);
    trust_container_host_key(
        &container.name,
        "127.0.0.1",
        container.host_port.expect("host port"),
    );
    let mut system = system_for(&container, &keys.private_pem);

    // Clobber the key content with garbage — the authenticator should reject
    // this with a clear CredentialError, not a silent failure.
    if let Some(cfg) = system.ssh_config.as_mut() {
        cfg.private_key_content = Some("-----BEGIN OPENSSH PRIVATE KEY-----\nnot a real key\n-----END OPENSSH PRIVATE KEY-----\n".into());
    }

    let result = SshClient::connect(&system, None, None, None).await;
    let err = match result {
        Ok(_) => panic!("connect with malformed key unexpectedly succeeded"),
        Err(e) => e,
    };

    match err {
        ContainerError::CredentialError(msg) => {
            assert!(
                msg.to_lowercase().contains("ssh key") || msg.to_lowercase().contains("parse"),
                "expected parse-failure hint, got: {msg}"
            );
        }
        other => panic!("expected CredentialError for malformed key, got {other:?}"),
    }
}

#[tokio::test]
async fn jump_host_chain_executes_on_target() {
    if !preflight("jump_host_chain_executes_on_target") {
        return;
    }

    let keys = generate_ed25519_keypair();
    let network = Network::create("jump");
    let bastion = SshdContainer::start("bastion", &keys.public_openssh, true, Some(&network));
    let target = SshdContainer::start("target", &keys.public_openssh, false, Some(&network));

    // Enable TCP forwarding on the bastion — the stock sshd_config refuses
    // `direct-tcpip`, which is what ProxyJump opens.
    bastion.enable_tcp_forwarding();

    let bastion_port = bastion.host_port.expect("bastion host port");
    let target_alias = target.hostname_alias().to_string();

    // Trust both hops — the bastion on its exposed host port, the target on
    // its internal docker-network alias (which is what `check_server_key`
    // sees during the tunneled handshake).
    trust_container_host_key(&bastion.name, "127.0.0.1", bastion_port);
    trust_container_host_key(&target.name, &target_alias, 2222);

    let system = ContainerSystem {
        id: SystemId(format!("test-jump-{}", unique_suffix())),
        name: "jump-target".into(),
        hostname: target_alias.clone(),
        connection_type: containerus_core::models::system::ConnectionType::Remote,
        primary_runtime: ContainerRuntime::Docker,
        available_runtimes: HashSet::new(),
        ssh_config: Some(SshConfig {
            username: SSH_USER.into(),
            port: 2222, // inner (network-internal) port on the target
            auth_method: SshAuthMethod::PublicKey,
            private_key_path: None,
            private_key_content: Some(keys.private_pem.clone()),
            connection_timeout: 30,
            proxy_command: None,
            proxy_jump: Some(vec![JumpHost {
                hostname: "127.0.0.1".into(),
                port: bastion_port,
                username: SSH_USER.into(),
                identity_file: None,
                auth_method: SshAuthMethod::PublicKey,
                private_key_content: Some(keys.private_pem.clone()),
            }]),
            ssh_config_host: None,
        }),
        auto_connect: false,
    };

    let mut pool = SshConnectionPool::new();
    let creds: HashMap<String, JumpHostCredentials> = HashMap::new();

    pool.connect(&system, None, None, None, &creds)
        .await
        .expect("jump host connect");

    let result = pool
        .execute(&system.id.0, "hostname && echo via-jump-ok")
        .await
        .expect("execute via jump chain");

    assert_eq!(result.exit_code, 0, "stderr={:?}", result.stderr);
    assert!(
        result.stdout.contains("via-jump-ok"),
        "unexpected stdout: {:?}",
        result.stdout
    );
    assert!(
        result.stdout.contains(&target_alias),
        "expected hostname to be the target alias {target_alias:?}, got: {:?}",
        result.stdout
    );
}

#[tokio::test]
async fn mid_session_disconnect_triggers_reconnect() {
    if !preflight("mid_session_disconnect_triggers_reconnect") {
        return;
    }

    let keys = generate_ed25519_keypair();
    let container = SshdContainer::start("reconn", &keys.public_openssh, true, None);
    let port = container.host_port.expect("initial host port");
    let system = system_for(&container, &keys.private_pem);

    trust_container_host_key(&container.name, "127.0.0.1", port);

    let mut pool = SshConnectionPool::new();
    let creds: HashMap<String, JumpHostCredentials> = HashMap::new();

    pool.connect(&system, None, None, None, &creds)
        .await
        .expect("initial connect");
    assert!(pool.validate_connection(&system.id.0).await.expect("validate"));

    // Simulate a mid-session drop: restart the sshd container. The host key
    // persists inside /config, so the restarted server presents the same
    // fingerprint and `ensure_connected` should transparently reconnect.
    let restart_status = Command::new("docker")
        .args(["restart", "-t", "2", &container.name])
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .status()
        .expect("docker restart");
    assert!(restart_status.success(), "docker restart failed");

    wait_for_ssh_banner("127.0.0.1", port, Duration::from_secs(30));

    // The pooled connection is now stale. `validate_connection` can block on
    // a half-open TCP session (production execute() has no timeout, filed as
    // a follow-up), so cap the check here; timing out counts as "dead" for
    // the purposes of this test.
    let alive_before = tokio::time::timeout(
        Duration::from_secs(10),
        pool.validate_connection(&system.id.0),
    )
    .await
    .ok()
    .and_then(|r| r.ok())
    .unwrap_or(false);
    assert!(!alive_before, "expected stale connection to report dead");

    // `ensure_connected` drops the stale handle and reconnects. Bound it with
    // a timeout for the same reason.
    tokio::time::timeout(
        Duration::from_secs(30),
        pool.ensure_connected(&system, None, None, None, &creds),
    )
    .await
    .expect("ensure_connected timed out after 30s")
    .expect("ensure_connected after disconnect");
    assert!(pool.is_connected(&system.id.0));

    let result = pool
        .execute(&system.id.0, "echo reconnected")
        .await
        .expect("execute after reconnect");
    assert_eq!(result.exit_code, 0, "stderr={:?}", result.stderr);
    assert!(
        result.stdout.contains("reconnected"),
        "unexpected stdout: {:?}",
        result.stdout
    );
}

