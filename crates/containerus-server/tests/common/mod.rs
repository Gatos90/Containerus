//! Integration-test harness for the Containerus server.
//!
//! Spins up a fresh Postgres schema (unique per run), applies the full
//! migration set via `sqlx::migrate!`, seeds the singleton `company` row the
//! server depends on, and exposes helpers for creating users, projects,
//! memberships, and per-resource ACL rows along with a fully-wired axum
//! router.
//!
//! Tests require `TEST_DATABASE_URL` to point at a Postgres instance. When
//! unset, [`TestHarness::try_new`] returns `None` and tests short-circuit
//! so local developers without a DB can still run `cargo check`/`cargo test`
//! for the rest of the crate. CI sets `REQUIRE_DB=1` to convert the skip
//! into a panic — otherwise a misconfigured Postgres service would ship as
//! "green with zero assertions".

#![allow(dead_code)]

pub mod mock_kube;
pub mod mock_ssh;
pub mod ws_harness;

use std::str::FromStr;
use std::sync::Arc;

use axum::Router;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::{Executor, PgPool};
use uuid::Uuid;

use containerus_server::auth::jwt::{create_access_token, ProjectMembership};
use containerus_server::auth::middleware::{PermissionCache, TokenRevocationCache};
use containerus_server::config::ServerConfig;
use containerus_server::connections::ConnectionManager;
use containerus_server::k8s::ClusterManager;
use containerus_server::rate_limit::RateLimiter;
use containerus_server::vault::ServerVault;
use containerus_server::{build_app, AppState};

/// Fixed UUIDs for the built-in roles (see migration 0001).
pub const ROLE_PROJECT_ADMIN: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000001);
pub const ROLE_OPERATOR: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000002);
pub const ROLE_DEVELOPER: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000003);
pub const ROLE_VIEWER: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000004);

pub const JWT_SECRET: &str = "test-jwt-secret-for-rbac-integration-tests-0123";
pub const ENCRYPTION_KEY: &str = "test-encryption-key-for-rbac-integration-0123456";
pub const ENCRYPTION_SALT: &str = "test-rbac-salt-16byte";

/// A single running test harness: isolated Postgres schema + migrated tables
/// + assembled axum router bound to an `AppState`.
pub struct TestHarness {
    pub db: PgPool,
    pub state: AppState,
    pub router: Router,
    pub company_id: Uuid,
    /// Schema name that owns all test tables. Dropped on [`TestHarness::cleanup`].
    pub schema: String,
    /// Admin pool used to drop the schema at the end of the test. We keep it
    /// separate so the migrations pool (with `search_path` bound to our
    /// schema) can be closed independently if a test caller wants to.
    admin_url: String,
}

impl TestHarness {
    /// Build a new harness if `TEST_DATABASE_URL` is configured; otherwise
    /// return `None` so callers can short-circuit with a skip message.
    pub async fn try_new(enforce_acls: bool) -> Option<Self> {
        let admin_url = match std::env::var("TEST_DATABASE_URL") {
            Ok(v) if !v.trim().is_empty() => v,
            _ => return None,
        };

        let schema = format!("rbac_test_{}", Uuid::new_v4().simple());

        // 1. Use a short-lived admin pool to create the isolated schema.
        let admin_pool = PgPoolOptions::new()
            .max_connections(1)
            .connect(&admin_url)
            .await
            .expect("connect to TEST_DATABASE_URL");
        admin_pool
            .execute(format!("CREATE SCHEMA \"{schema}\"").as_str())
            .await
            .expect("create isolated schema");
        admin_pool.close().await;

        // 2. Build the real test pool with search_path pinned to our schema
        //    so migrations and all queries land there.
        let opts = PgConnectOptions::from_str(&admin_url)
            .expect("parse TEST_DATABASE_URL")
            .options([("search_path", schema.as_str())]);

        let db = PgPoolOptions::new()
            .max_connections(8)
            .connect_with(opts)
            .await
            .expect("connect migrations pool");

        // 3. Run the full migration set into the new schema.
        sqlx::migrate!("./migrations")
            .run(&db)
            .await
            .expect("run migrations into test schema");

        // 4. Ensure the singleton `company` row exists. Several server paths
        //    (project creation, admin seed) expect exactly one company.
        let company_id: Uuid = sqlx::query_scalar(
            "INSERT INTO company (name, slug) VALUES ('Test Co', 'test')
             ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
             RETURNING id",
        )
        .fetch_one(&db)
        .await
        .expect("seed test company row");

        // 5. Load the permission cache now that built-in roles are seeded.
        let permission_cache = PermissionCache::load_from_db(&db)
            .await
            .expect("load permission cache");

        // 6. Assemble AppState with the feature flag under test.
        let config = ServerConfig {
            bind_addr: "127.0.0.1:0".parse().unwrap(),
            database_url: admin_url.clone(),
            jwt_secret: JWT_SECRET.to_string(),
            jwt_access_expiry_secs: 900,
            jwt_refresh_expiry_secs: 604_800,
            encryption_key: ENCRYPTION_KEY.to_string(),
            encryption_salt: ENCRYPTION_SALT.to_string(),
            cors_origins: "http://localhost:1420".to_string(),
            enforce_acls,
        };

        let vault =
            ServerVault::new(&config.encryption_key, &config.encryption_salt).expect("vault");

        let state = AppState {
            db: db.clone(),
            config,
            vault: vault.clone(),
            connections: ConnectionManager::new(vault.clone()),
            k8s: ClusterManager::new(vault),
            permission_cache,
            permission_events: containerus_server::ws::events::PermissionEventBus::new(),
            revocation_cache: TokenRevocationCache::new(),
            // Tests disable rate-limiting by setting a ceiling high enough to
            // never trip in a single run (mirrors `auth_limiter` above).
            password_reset_email_limiter: containerus_server::rate_limit::KeyedRateLimiter::new(
                10_000,
                std::time::Duration::from_secs(60),
            ),
            password_reset_ip_limiter: RateLimiter::new(
                10_000,
                std::time::Duration::from_secs(60),
            ),
            project_invite_limiter: containerus_server::rate_limit::KeyedRateLimiter::new(
                10_000,
                std::time::Duration::from_secs(60),
            ),
            container_metrics:
                containerus_server::api::container_metrics::ContainerMetricsStore::new(),
            container_metrics_limiter: containerus_server::rate_limit::KeyedRateLimiter::new(
                10_000,
                std::time::Duration::from_secs(60),
            ),
        };

        let auth_limiter = RateLimiter::new(10_000, std::time::Duration::from_secs(60));
        let router = build_app(state.clone(), auth_limiter);

        Some(Self {
            db,
            state,
            router,
            company_id,
            schema,
            admin_url,
        })
    }

    /// Drop the isolated schema. Callers should invoke this at the end of a
    /// test to avoid accumulating orphaned schemas in the test database.
    pub async fn cleanup(self) {
        let Self { db, admin_url, schema, .. } = self;
        db.close().await;
        if let Ok(admin_pool) = PgPoolOptions::new()
            .max_connections(1)
            .connect(&admin_url)
            .await
        {
            let _ = admin_pool
                .execute(format!("DROP SCHEMA IF EXISTS \"{schema}\" CASCADE").as_str())
                .await;
            admin_pool.close().await;
        }
    }

    /// Seed a user with a random email. Returns the user id.
    pub async fn create_user(&self, label: &str) -> Uuid {
        let email = format!("{label}-{}@test.local", Uuid::new_v4());
        sqlx::query_scalar::<_, Uuid>(
            "INSERT INTO users (email, password_hash, display_name, auth_provider)
             VALUES ($1, 'x', $2, 'local')
             RETURNING id",
        )
        .bind(&email)
        .bind(label)
        .fetch_one(&self.db)
        .await
        .expect("create user")
    }

    /// Promote a user to company admin.
    pub async fn grant_company_admin(&self, user_id: Uuid) {
        sqlx::query("INSERT INTO company_admins (user_id) VALUES ($1) ON CONFLICT DO NOTHING")
            .bind(user_id)
            .execute(&self.db)
            .await
            .expect("grant company admin");
    }

    /// Create a project and return its id.
    pub async fn create_project(&self, slug: &str) -> Uuid {
        let project_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO projects (id, company_id, name, slug) VALUES ($1, $2, $3, $4)",
        )
        .bind(project_id)
        .bind(self.company_id)
        .bind(format!("Project {slug}"))
        .bind(format!("{slug}-{}", Uuid::new_v4().simple()))
        .execute(&self.db)
        .await
        .expect("create project");
        project_id
    }

    /// Create a default environment inside `project_id` and return its id.
    pub async fn create_environment(&self, project_id: Uuid) -> Uuid {
        sqlx::query_scalar::<_, Uuid>(
            "INSERT INTO environments (project_id, name, slug, is_default)
             VALUES ($1, 'Default', 'default', true)
             RETURNING id",
        )
        .bind(project_id)
        .fetch_one(&self.db)
        .await
        .expect("create environment")
    }

    /// Create a system row under the given environment. No SSH connection is
    /// attempted — only DB-backed endpoints are exercised in the matrix.
    pub async fn create_system(&self, environment_id: Uuid, created_by: Uuid) -> Uuid {
        sqlx::query_scalar::<_, Uuid>(
            "INSERT INTO systems (environment_id, name, hostname, port, username,
                 primary_runtime, available_runtimes, auth_method, is_active, created_by)
             VALUES ($1, $2, 'localhost', 22, 'testuser', 'docker', '[\"docker\"]',
                 'password', true, $3)
             RETURNING id",
        )
        .bind(environment_id)
        .bind(format!("sys-{}", Uuid::new_v4().simple()))
        .bind(created_by)
        .fetch_one(&self.db)
        .await
        .expect("create system")
    }

    /// Add `user_id` to `project_id` with the given role.
    pub async fn add_member(&self, project_id: Uuid, user_id: Uuid, role_id: Uuid) {
        sqlx::query(
            "INSERT INTO project_members (project_id, user_id, role_id) VALUES ($1, $2, $3)",
        )
        .bind(project_id)
        .bind(user_id)
        .bind(role_id)
        .execute(&self.db)
        .await
        .expect("add member");
    }

    /// Insert or update a resource ACL row.
    pub async fn set_resource_acl(
        &self,
        user_id: Uuid,
        project_id: Uuid,
        resource_type: &str,
        resource_id: Uuid,
        extra: &[&str],
        denied: &[&str],
    ) {
        let extra_json = serde_json::json!(extra);
        let denied_json = serde_json::json!(denied);
        sqlx::query(
            "INSERT INTO resource_acls (user_id, project_id, resource_type, resource_id,
                 extra_permissions, denied_permissions)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (user_id, project_id, resource_type, resource_id)
             DO UPDATE SET extra_permissions = EXCLUDED.extra_permissions,
                           denied_permissions = EXCLUDED.denied_permissions",
        )
        .bind(user_id)
        .bind(project_id)
        .bind(resource_type)
        .bind(resource_id)
        .bind(extra_json)
        .bind(denied_json)
        .execute(&self.db)
        .await
        .expect("upsert resource acl");
    }

    /// Mint a JWT access token for `user_id` with the given memberships and
    /// company-admin flag.
    pub fn token_for(
        &self,
        user_id: Uuid,
        memberships: Vec<(Uuid, Uuid)>,
        is_company_admin: bool,
    ) -> String {
        let memberships = memberships
            .into_iter()
            .map(|(project_id, role_id)| ProjectMembership { project_id, role_id })
            .collect();
        let (token, _) = create_access_token(
            user_id,
            "test@test.local",
            memberships,
            is_company_admin,
            JWT_SECRET,
            3600,
        )
        .expect("mint access token");
        token
    }

    /// Convenience: resolve the memberships currently in the DB for `user_id`
    /// and mint a token matching that state.
    pub async fn login_as(&self, user_id: Uuid, is_company_admin: bool) -> String {
        let memberships: Vec<(Uuid, Uuid)> = sqlx::query_as(
            "SELECT project_id, role_id FROM project_members WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_all(&self.db)
        .await
        .expect("load memberships");
        self.token_for(user_id, memberships, is_company_admin)
    }
}

/// Issue a request against the harness's router and return (status, body).
///
/// The router was built with `into_make_service_with_connect_info` in
/// production, but integration tests drive the router directly via
/// `tower::ServiceExt::oneshot`, so we don't need that adapter here.
pub async fn call(
    router: &Router,
    method: axum::http::Method,
    uri: &str,
    token: Option<&str>,
    body: Option<serde_json::Value>,
) -> (axum::http::StatusCode, Vec<u8>) {
    use axum::body::Body;
    use axum::http::{header, Request};
    use tower::ServiceExt;

    let mut builder = Request::builder().method(method).uri(uri);
    if let Some(tok) = token {
        builder = builder.header(header::AUTHORIZATION, format!("Bearer {tok}"));
    }
    let body = match body {
        Some(v) => {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
            Body::from(serde_json::to_vec(&v).unwrap())
        }
        None => Body::empty(),
    };
    let mut request = builder.body(body).expect("build request");
    // Production wires this via `into_make_service_with_connect_info`; when
    // driving the router directly with `oneshot`, handlers that take a
    // `ConnectInfo<SocketAddr>` extractor (e.g. `/api/auth/password/*`) will
    // 500 unless we install one ourselves. Use a loopback address so tests
    // that do inspect the IP see something sensible.
    request.extensions_mut().insert(axum::extract::ConnectInfo(
        std::net::SocketAddr::from(([127, 0, 0, 1], 0)),
    ));
    let response = router.clone().oneshot(request).await.expect("router");
    let status = response.status();
    let body_bytes = axum::body::to_bytes(response.into_body(), 10 * 1024 * 1024)
        .await
        .expect("read body")
        .to_vec();
    (status, body_bytes)
}

/// Emit a structured skip message when `TEST_DATABASE_URL` isn't configured,
/// or panic if `REQUIRE_DB=1` is set.
///
/// Local dev ergonomics: missing DB → skip so `cargo test` still passes.
/// CI ergonomics: `REQUIRE_DB=1` flips the skip into a hard fail so a broken
/// Postgres service (misconfigured image, port clash, healthcheck failure)
/// can't ship as "green CI with zero assertions run".
pub fn skip_without_db(test_name: &str) {
    if std::env::var("REQUIRE_DB").map(|v| v == "1").unwrap_or(false) {
        panic!(
            "[{test_name}] REQUIRE_DB=1 is set but TEST_DATABASE_URL is empty or missing — \
             refusing to skip. Fix the CI Postgres service or unset REQUIRE_DB."
        );
    }
    eprintln!(
        "[{test_name}] skipping: TEST_DATABASE_URL is not set. \
         Point it at a local Postgres (e.g. the docker-compose db service) to run the RBAC matrix."
    );
}

/// Tiny wrapper so test expectations read clearly.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum Expect {
    Allow,
    Deny,
}

impl Expect {
    pub fn matches(self, status: axum::http::StatusCode) -> bool {
        match self {
            // For an "allow" case we only require that the request cleared the
            // permission gate — anything that isn't 401/403 counts. Some
            // endpoints then fail on downstream concerns (missing SSH, etc.)
            // which is fine; it means authorization was not the reason.
            Expect::Allow => status != axum::http::StatusCode::FORBIDDEN
                && status != axum::http::StatusCode::UNAUTHORIZED,
            Expect::Deny => status == axum::http::StatusCode::FORBIDDEN,
        }
    }
}

/// Ensure every test run uses the same `Arc<tracing_subscriber>` init, but
/// only once. `run()` in the lib also tries to init tracing; the harness is
/// isolated from that path so the `try_init` there is a no-op if we've
/// already set one up here.
static TRACING_INIT: std::sync::OnceLock<Arc<()>> = std::sync::OnceLock::new();

pub fn init_test_tracing() {
    TRACING_INIT.get_or_init(|| {
        let _ = tracing_subscriber::fmt()
            .with_test_writer()
            .with_env_filter(
                tracing_subscriber::EnvFilter::try_from_default_env()
                    .unwrap_or_else(|_| "warn".into()),
            )
            .try_init();
        Arc::new(())
    });
}
