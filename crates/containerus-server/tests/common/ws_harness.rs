//! WebSocket-oriented harness (CON-85).
//!
//! [`TestHarness::oneshot_router`] drives the router in-process and skips the
//! WebSocket upgrade path. The audit-row integration tests need:
//!   * a real `ConnectInfo<SocketAddr>` on the request (so the handlers can
//!     record `ip_address`), and
//!   * a real WebSocket upgrade (the handlers only run inside `on_upgrade`).
//!
//! Both requirements are only satisfied when the router is bound to a TCP
//! socket with `into_make_service_with_connect_info::<SocketAddr>()`. This
//! module wraps that boot-up and exposes helpers for polling audit rows.
//!
//! A secondary concern is host-key verification: the core SSH client rejects
//! unknown host keys, so the mock-SSH tests must add the mock server's host
//! key to `~/.ssh/known_hosts`. Rather than scribbling on the developer's
//! real home directory, [`ensure_isolated_home`] points `$HOME` at a
//! process-scoped temporary directory the first time it is called. All tests
//! in the binary then share that directory.

#![allow(dead_code)]

use std::net::SocketAddr;
use std::sync::OnceLock;

use axum::serve::Serve;
use sqlx::PgPool;
use tempfile::TempDir;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;
use uuid::Uuid;

use super::TestHarness;

/// A [`TestHarness`] with its axum router bound on a loopback port and its
/// body consumed by a running `axum::serve` task.
pub struct RunningHarness {
    pub addr: SocketAddr,
    pub db: PgPool,
    pub state: containerus_server::AppState,
    pub company_id: Uuid,
    pub schema: String,
    admin_url: String,
    join: JoinHandle<std::io::Result<()>>,
}

impl RunningHarness {
    /// Build a formatted `ws://…` URL for a path under the harness router.
    pub fn ws_url(&self, path: &str) -> String {
        let suffix = path.trim_start_matches('/');
        format!("ws://{}/{}", self.addr, suffix)
    }

    /// Drop the axum server task, close the db pool, and drop the isolated
    /// Postgres schema. Mirrors [`TestHarness::cleanup`].
    pub async fn cleanup(self) {
        self.join.abort();
        let _ = self.join.await;
        let Self {
            db,
            admin_url,
            schema,
            ..
        } = self;
        db.close().await;
        if let Ok(admin_pool) = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .connect(&admin_url)
            .await
        {
            let _ = sqlx::Executor::execute(
                &admin_pool,
                format!("DROP SCHEMA IF EXISTS \"{schema}\" CASCADE").as_str(),
            )
            .await;
            admin_pool.close().await;
        }
    }
}

impl TestHarness {
    /// Capture the admin URL so [`RunningHarness::cleanup`] can drop the
    /// isolated schema without re-reading `TEST_DATABASE_URL`.
    fn admin_url_snapshot(&self) -> String {
        std::env::var("TEST_DATABASE_URL").unwrap_or_default()
    }

    /// Bind the assembled router on `127.0.0.1:0` with full
    /// `ConnectInfo<SocketAddr>` wiring and spawn `axum::serve`. Returns the
    /// bound address plus the usual harness state.
    pub async fn spawn_server(self) -> RunningHarness {
        let admin_url = self.admin_url_snapshot();
        let TestHarness {
            db,
            state,
            router,
            company_id,
            schema,
            ..
        } = self;

        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind harness listener");
        let addr = listener.local_addr().expect("local_addr");

        let make_service =
            router.into_make_service_with_connect_info::<SocketAddr>();
        let serve: Serve<TcpListener, _, _> = axum::serve(listener, make_service);
        let join = tokio::spawn(async move { serve.await });

        RunningHarness {
            addr,
            db,
            state,
            company_id,
            schema,
            admin_url,
            join,
        }
    }
}

/// Point `$HOME` at a process-scoped temp directory so `known_hosts` writes
/// never touch the developer's real `~/.ssh`. Safe to call repeatedly; only
/// the first call mutates the environment.
///
/// Callers must invoke this before any russh client connect in the same
/// process, because `dirs::home_dir()` reads `$HOME` lazily on each lookup.
pub fn ensure_isolated_home() {
    static HOME: OnceLock<TempDir> = OnceLock::new();
    HOME.get_or_init(|| {
        let tmp = tempfile::tempdir().expect("create isolated test home");
        // SAFETY: this runs from test init before any SSH client spawn;
        // subsequent calls short-circuit, so there is no racing writer.
        unsafe {
            std::env::set_var("HOME", tmp.path());
        }
        tmp
    });
}

/// Poll `audit_log` for a row matching `(action, resource_id)` with a short
/// bounded retry loop. The handlers emit audit rows from a separate task
/// after the WebSocket close, so tests must tolerate a brief delay between
/// closing the client and seeing the row.
pub async fn poll_audit_row(
    db: &PgPool,
    action: &str,
    resource_id: &str,
) -> sqlx::postgres::PgRow {
    use std::time::Duration;

    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    loop {
        let row = sqlx::query(
            "SELECT action, resource_type, resource_id, project_id, environment_id,
                    ip_address, user_id, actor_type, details
             FROM audit_log
             WHERE action = $1 AND resource_id = $2
             ORDER BY created_at DESC
             LIMIT 1",
        )
        .bind(action)
        .bind(resource_id)
        .fetch_optional(db)
        .await
        .expect("query audit_log");
        if let Some(r) = row {
            return r;
        }
        if std::time::Instant::now() >= deadline {
            panic!(
                "timed out waiting for audit row action={action} resource_id={resource_id}"
            );
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}
