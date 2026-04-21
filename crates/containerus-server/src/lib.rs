//! Containerus server library.
//!
//! `main.rs` is a thin wrapper that calls [`run`]. Exposing everything as a
//! library target lets the `tests/` integration harness construct an
//! `AppState` + `axum::Router` against a real Postgres and drive the RBAC
//! role × endpoint matrix end-to-end.

pub mod api;
pub mod audit;
pub mod auth;
pub mod config;
pub mod connections;
pub mod db;
pub mod k8s;
pub mod rate_limit;
pub mod vault;
pub mod ws;

use auth::middleware::{PermissionCache, TokenRevocationCache, UserActiveCache};
use ws::events::PermissionEventBus;
use sqlx::PgPool;
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::http::Method;
use tower_http::cors::{Any, CorsLayer};
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::trace::TraceLayer;
use tower_http::catch_panic::CatchPanicLayer;
use uuid::Uuid;

use rate_limit::{KeyedRateLimiter, RateLimiter};

use config::ServerConfig;
use connections::ConnectionManager;
use k8s::ClusterManager;
use vault::ServerVault;

/// Shared application state available to all handlers.
#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub config: ServerConfig,
    pub vault: ServerVault,
    pub connections: ConnectionManager,
    pub k8s: ClusterManager,
    pub permission_cache: PermissionCache,
    /// CON-122: user-scoped fanout of permission-invalidation events to
    /// connected WS clients. Publish after RBAC writes; subscribers sit
    /// in `ws::permissions`.
    pub permission_events: PermissionEventBus,
    pub revocation_cache: TokenRevocationCache,
    /// CON-137: short-lived (≤30s) cache of `users.is_active` so the auth
    /// middleware can reject deactivated users without a per-request DB hit
    /// on hot paths. Invalidated explicitly by `DeactivateUser` so the
    /// happy-path eviction beats the TTL.
    pub user_active_cache: UserActiveCache,
    /// Per-email rate limit for `POST /api/auth/password/reset/request`
    /// (CON-118). Caps at 5 requests/hour per normalised email so the public
    /// endpoint cannot be weaponised for enumeration or mail-bombing against
    /// a single account. Sits on top of the blanket per-IP `auth_limiter`.
    pub password_reset_email_limiter: KeyedRateLimiter,
    /// Per-IP rate limit for `POST /api/auth/password/reset/request`. Tighter
    /// than the blanket auth limiter (which is tuned for login) so a single
    /// attacker cannot burn through reset attempts across many emails from
    /// one host.
    pub password_reset_ip_limiter: RateLimiter,
    /// Shared bucket for project member invites (CON-120). Single-invite and
    /// bulk-invite tick the same key so a caller cannot bypass the bulk
    /// ceiling by spamming single-invite calls. Keyed on
    /// `{project_id}:{user_id}` — per-project, per-inviter.
    pub project_invite_limiter: KeyedRateLimiter,
    /// CON-121: rolling in-memory buffer of container stats samples,
    /// populated lazily by the `/containers/{id}/metrics` endpoint.
    pub container_metrics: api::container_metrics::ContainerMetricsStore,
    /// CON-121: per-system throttle for `docker stats` scrapes so the
    /// shared SSH connection isn't hammered by a bursty UI.
    pub container_metrics_limiter: KeyedRateLimiter,
}

/// Build the full axum router (API + WebSocket + middleware stack) for the
/// given [`AppState`]. Split out so integration tests can assemble the same
/// router without going through the process-level `run` entry point.
pub fn build_app(state: AppState, auth_limiter: RateLimiter) -> axum::Router {
    // Allowed HTTP methods for all CORS configurations.
    let allowed_methods = [
        Method::GET,
        Method::POST,
        Method::PUT,
        Method::PATCH,
        Method::DELETE,
        Method::OPTIONS,
    ];
    let allowed_headers = [AUTHORIZATION, CONTENT_TYPE];

    let cors = {
        let cors_origins = &state.config.cors_origins;
        if cors_origins == "*" {
            tracing::warn!("CORS is set to allow all origins — this is not recommended for production");
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(allowed_methods)
                .allow_headers(allowed_headers)
        } else {
            let origins: Vec<_> = cors_origins
                .split(',')
                .filter_map(|s| {
                    let trimmed = s.trim();
                    match trimmed.parse() {
                        Ok(origin) => Some(origin),
                        Err(e) => {
                            tracing::warn!("Invalid CORS origin '{}': {}", trimmed, e);
                            None
                        }
                    }
                })
                .collect();
            if origins.is_empty() {
                tracing::error!(
                    "No valid CORS origins configured. Set CORS_ORIGINS to '*' to allow all, \
                     or provide valid origin URLs. Defaulting to localhost:1420 for safety."
                );
                CorsLayer::new()
                    .allow_origin(
                        "http://localhost:1420"
                            .parse::<axum::http::HeaderValue>()
                            .expect("static origin is valid"),
                    )
                    .allow_methods(allowed_methods)
                    .allow_headers(allowed_headers)
            } else {
                CorsLayer::new()
                    .allow_origin(origins)
                    .allow_methods(allowed_methods)
                    .allow_headers(allowed_headers)
            }
        }
    };

    api::router(auth_limiter)
        .merge(ws::router())
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .layer(CatchPanicLayer::new())
        .layer(RequestBodyLimitLayer::new(10 * 1024 * 1024))
        .with_state(state)
}

/// Entry point used by `main.rs`. Boots the server from environment
/// configuration and serves forever.
pub async fn run() {
    let _ = dotenvy::dotenv();

    // Initialize logging (no-op if already initialized by the harness).
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "containerus_server=debug,tower_http=debug,info".into()),
        )
        .try_init();

    tracing::info!("Starting Containerus Server");

    let config = ServerConfig::from_env().expect("Failed to load configuration");
    let bind_addr = config.bind_addr;

    tracing::info!("Connecting to database...");
    let db = db::init_pool(&config.database_url)
        .await
        .expect("Failed to connect to database");

    let vault = ServerVault::new(&config.encryption_key, &config.encryption_salt)
        .expect("Failed to initialize credential vault");

    let connections = ConnectionManager::new(vault.clone());
    let k8s = ClusterManager::new(vault.clone());

    seed_admin_if_configured(&db).await;

    let permission_cache = PermissionCache::load_from_db(&db)
        .await
        .expect("Failed to load permission cache");

    let revocation_cache = TokenRevocationCache::new();
    let user_active_cache = UserActiveCache::new();

    // Password reset throttles (CON-118). One-hour rolling windows so both
    // limiters age out after a quiet period. Numbers match the ticket's
    // acceptance criteria: "max 5/hour per email + per IP".
    let password_reset_email_limiter =
        KeyedRateLimiter::new(5, std::time::Duration::from_secs(3600));
    let password_reset_ip_limiter =
        RateLimiter::new(10, std::time::Duration::from_secs(3600));

    // Project invite throttle (CON-120). Per (project, inviter) bucket so a
    // compromised or runaway client can't spam invites; 100 invites/hour lines
    // up with the bulk-endpoint page size so one fully-saturated bulk call
    // empties the bucket for the hour.
    let project_invite_limiter =
        KeyedRateLimiter::new(100, std::time::Duration::from_secs(3600));

    // Container metrics throttle (CON-121). Keyed on system_id so all
    // containers on one host share a single budget — prevents a dashboard
    // cycling through container ids from bypassing the limit by rotating
    // keys. 60/min matches the MIN_SAMPLE_INTERVAL floor in the module.
    let container_metrics_limiter =
        KeyedRateLimiter::new(60, std::time::Duration::from_secs(60));

    let state = AppState {
        db,
        config,
        vault,
        connections,
        k8s,
        permission_cache,
        permission_events: PermissionEventBus::new(),
        revocation_cache,
        user_active_cache,
        password_reset_email_limiter,
        password_reset_ip_limiter,
        project_invite_limiter,
        container_metrics: api::container_metrics::ContainerMetricsStore::new(),
        container_metrics_limiter,
    };

    // Background: cleanup idle SSH connections.
    {
        let cleanup_cm = state.connections.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
            loop {
                interval.tick().await;
                cleanup_cm.cleanup_idle(std::time::Duration::from_secs(300)).await;
            }
        });
    }

    // Background: auto-connect active SSH systems.
    {
        let state = state.clone();
        tokio::spawn(async move {
            let systems = match sqlx::query_as::<_, crate::db::models::SystemRow>(
                "SELECT * FROM systems WHERE is_active = true",
            )
            .fetch_all(&state.db)
            .await
            {
                Ok(rows) => rows,
                Err(e) => {
                    tracing::error!("Failed to load systems for auto-connect: {e}");
                    return;
                }
            };

            if systems.is_empty() {
                return;
            }

            tracing::info!("Auto-connecting {} SSH system(s)...", systems.len());
            for system in &systems {
                match state.connections.connect_shared(&state.db, system).await {
                    Ok(()) => {
                        tracing::info!(
                            "Auto-connected to system: {} ({})",
                            system.name,
                            system.id
                        );
                    }
                    Err(e) => {
                        tracing::warn!(
                            "Failed to auto-connect to system {} ({}): {e}",
                            system.name,
                            system.id
                        );
                    }
                }
            }
            tracing::info!(
                "SSH auto-connect complete ({} active connection(s))",
                state.connections.total_connections()
            );
        });
    }

    // Background: pre-warm K8s cluster clients.
    {
        let state = state.clone();
        tokio::spawn(async move {
            let clusters = match sqlx::query_as::<_, crate::db::models::ClusterRow>(
                "SELECT * FROM clusters WHERE is_active = true",
            )
            .fetch_all(&state.db)
            .await
            {
                Ok(rows) => rows,
                Err(e) => {
                    tracing::error!("Failed to load clusters for auto-connect: {e}");
                    return;
                }
            };

            if clusters.is_empty() {
                return;
            }

            tracing::info!("Auto-connecting {} K8s cluster(s)...", clusters.len());
            for cluster in &clusters {
                match state.k8s.test_connection(cluster).await {
                    Ok(version) => {
                        tracing::info!(
                            "Auto-connected to cluster: {} ({}) - {version}",
                            cluster.name,
                            cluster.id
                        );
                        let _ = sqlx::query(
                            "UPDATE clusters SET last_connected_at = now() WHERE id = $1",
                        )
                        .bind(cluster.id)
                        .execute(&state.db)
                        .await;
                    }
                    Err(e) => {
                        tracing::warn!(
                            "Failed to auto-connect to cluster {} ({}): {e}",
                            cluster.name,
                            cluster.id
                        );
                    }
                }
            }
        });
    }

    // Rate limiter for auth endpoints: 20 requests per IP per 60 seconds.
    let auth_limiter = RateLimiter::new(20, std::time::Duration::from_secs(60));
    let app = build_app(state, auth_limiter);

    tracing::info!("Listening on {bind_addr}");

    let listener = tokio::net::TcpListener::bind(bind_addr)
        .await
        .expect("Failed to bind address");

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await
    .expect("Server error");
}

/// If ADMIN_EMAIL and ADMIN_PASSWORD env vars are set, create an admin user on first run.
/// Also creates the company row if it doesn't exist and promotes the user to company admin.
async fn seed_admin_if_configured(db: &PgPool) {
    let email = match std::env::var("ADMIN_EMAIL") {
        Ok(e) if !e.is_empty() => e,
        _ => return,
    };
    let password = match std::env::var("ADMIN_PASSWORD") {
        Ok(p) if !p.is_empty() => p,
        _ => return,
    };
    let display_name = std::env::var("ADMIN_DISPLAY_NAME")
        .unwrap_or_else(|_| "Admin".to_string());
    let company_name = std::env::var("COMPANY_NAME")
        .unwrap_or_else(|_| "My Company".to_string());

    let exists: i64 = match sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE email = $1")
        .bind(&email)
        .fetch_one(db)
        .await
    {
        Ok(count) => count,
        Err(e) => {
            tracing::error!("Failed to check for existing admin user: {e}");
            return;
        }
    };

    if exists > 0 {
        tracing::info!("Admin user already exists, skipping seed");
        return;
    }

    let password_hash = match auth::password::hash_password(&password) {
        Ok(h) => h,
        Err(e) => {
            tracing::error!("Failed to hash admin password: {e}");
            return;
        }
    };

    let user_id = Uuid::new_v4();

    let mut tx = match db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!("Failed to start transaction for admin seed: {e}");
            return;
        }
    };

    if let Err(e) = sqlx::query(
        "INSERT INTO users (id, email, password_hash, display_name, auth_provider) VALUES ($1, $2, $3, $4, 'local')"
    )
        .bind(user_id)
        .bind(&email)
        .bind(&password_hash)
        .bind(&display_name)
        .execute(&mut *tx)
        .await
    {
        tracing::error!("Failed to create admin user: {e}");
        return;
    }

    if let Err(e) = sqlx::query(
        "INSERT INTO company (name, slug) VALUES ($1, 'default') ON CONFLICT DO NOTHING"
    )
        .bind(&company_name)
        .execute(&mut *tx)
        .await
    {
        tracing::error!("Failed to create company: {e}");
        return;
    }

    if let Err(e) = sqlx::query(
        "INSERT INTO company_admins (user_id) VALUES ($1) ON CONFLICT DO NOTHING"
    )
        .bind(user_id)
        .execute(&mut *tx)
        .await
    {
        tracing::error!("Failed to add company admin: {e}");
        return;
    }

    if let Err(e) = tx.commit().await {
        tracing::error!("Failed to commit admin seed: {e}");
        return;
    }

    tracing::info!("Created admin user with id: {user_id} (company admin: true, no default project)");
}
