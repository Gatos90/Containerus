//! Minimal in-process russh server used by the WebSocket audit integration
//! tests (CON-85). Accepts password authentication, grants PTY + shell/exec
//! requests for terminal sessions, and grants `direct-tcpip` channel opens
//! for tunnel sessions.
//!
//! The server is deliberately stripped down — it does not actually execute
//! anything or forward traffic. The handlers under test only need the SSH
//! handshake and channel opens to succeed so that the audit emissions on
//! either side of the real session are exercised end-to-end.

#![allow(dead_code)]

use std::sync::Arc;
use std::time::Duration;

use rand::rngs::OsRng;
use russh::keys::{Algorithm, PrivateKey};
use russh::server::{Auth, Config, Handler, Msg, Server, Session};
use russh::{Channel, ChannelId, MethodKind, MethodSet};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

/// A running mock SSH server bound on a random loopback port.
pub struct MockSshServer {
    pub addr: std::net::SocketAddr,
    pub password: String,
    pub public_key: russh::keys::PublicKey,
    pub join: JoinHandle<()>,
}

impl MockSshServer {
    /// Bind on `127.0.0.1:0`, start the russh event loop, and return the
    /// listening address together with the host public key the tests must
    /// trust in `known_hosts`.
    pub async fn start(password: impl Into<String>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind mock ssh listener");
        let addr = listener.local_addr().expect("local_addr");

        let host_key = PrivateKey::random(&mut OsRng, Algorithm::Ed25519)
            .expect("generate ed25519 host key");
        let public_key = host_key.public_key().clone();

        let config = Config {
            methods: MethodSet::from(&[MethodKind::Password][..]),
            auth_rejection_time: Duration::from_millis(50),
            keys: vec![host_key],
            inactivity_timeout: Some(Duration::from_secs(60)),
            ..Default::default()
        };
        let config = Arc::new(config);

        let password = password.into();
        let mut server = MockSshServerImpl {
            password: password.clone(),
        };

        let join = tokio::spawn(async move {
            let _ = server.run_on_socket(config, &listener).await;
        });

        Self {
            addr,
            password,
            public_key,
            join,
        }
    }
}

struct MockSshServerImpl {
    password: String,
}

impl Server for MockSshServerImpl {
    type Handler = MockSshHandler;

    fn new_client(&mut self, _peer_addr: Option<std::net::SocketAddr>) -> Self::Handler {
        MockSshHandler {
            expected_password: self.password.clone(),
        }
    }

    fn handle_session_error(&mut self, error: russh::Error) {
        tracing::debug!("mock ssh session error: {error}");
    }
}

struct MockSshHandler {
    expected_password: String,
}

impl Handler for MockSshHandler {
    type Error = russh::Error;

    async fn auth_password(&mut self, _user: &str, password: &str) -> Result<Auth, Self::Error> {
        if password == self.expected_password {
            Ok(Auth::Accept)
        } else {
            Ok(Auth::reject())
        }
    }

    async fn channel_open_session(
        &mut self,
        _channel: Channel<Msg>,
        _session: &mut Session,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }

    async fn channel_open_direct_tcpip(
        &mut self,
        _channel: Channel<Msg>,
        _host_to_connect: &str,
        _port_to_connect: u32,
        _originator_address: &str,
        _originator_port: u32,
        _session: &mut Session,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }

    async fn pty_request(
        &mut self,
        channel: ChannelId,
        _term: &str,
        _col_width: u32,
        _row_height: u32,
        _pix_width: u32,
        _pix_height: u32,
        _modes: &[(russh::Pty, u32)],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.channel_success(channel)?;
        Ok(())
    }

    async fn shell_request(
        &mut self,
        channel: ChannelId,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.channel_success(channel)?;
        Ok(())
    }

    async fn exec_request(
        &mut self,
        channel: ChannelId,
        _data: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.channel_success(channel)?;
        Ok(())
    }
}
