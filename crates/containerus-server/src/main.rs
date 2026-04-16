mod api;
mod audit;
mod auth;
mod config;
mod connections;
mod db;
mod k8s;
mod rate_limit;
mod vault;
mod ws;

use auth::middleware::PermissionCache;
use sqlx::PgPool;
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::http::Method;
use tower_http::cors::{Any, CorsLayer};
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::trace::TraceLayer;
use tower_http::catch_panic::CatchPanicLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use uuid::Uuid;

use rate_limit::RateLimiter;

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
}

#[tokio::main]
async fn main() {
    // Load .env file if present
    let _ = dotenvy::dotenv();

    // Initialize logging
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "containerus_server=debug,tower_http=debug,info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!("Starting Containerus Server");

    // Load configuration
    let config = ServerConfig::from_env().expect("Failed to load configuration");
    let bind_addr = config.bind_addr;

    tracing::info!("Connecting to database...");
    let db = db::init_pool(&config.database_url)
        .await
        .expect("Failed to connect to database");

    // Initialize credential vault
    let vault = ServerVault::new(&config.encryption_key, &config.encryption_salt)
        .expect("Failed to initialize credential vault");

    // Initialize connection manager (Docker/Podman systems via SSH)
    let connections = ConnectionManager::new(vault.clone());

    // Initialize Kubernetes cluster manager
    let k8s = ClusterManager::new(vault.clone());

    // Seed admin account if ADMIN_EMAIL + ADMIN_PASSWORD are set
    seed_admin_if_configured(&db).await;

    // Load permission cache from database
    let permission_cache = PermissionCache::load_from_db(&db)
        .await
        .expect("Failed to load permission cache");

    let state = AppState {
        db,
        config,
        vault,
        connections,
        k8s,
        permission_cache,
    };

    // Start background task to clean up idle SSH connections (every 60s, 5min idle threshold)
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

    // Auto-connect all active SSH systems in the background
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

    // Pre-warm K8s cluster clients in the background
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

    // Allowed HTTP methods for all CORS configurations.
    let allowed_methods = [
        Method::GET,
        Method::POST,
        Method::PUT,
        Method::PATCH,
        Method::DELETE,
        Method::OPTIONS,
    ];
    // Allowed request headers for all CORS configurations.
    let allowed_headers = [AUTHORIZATION, CONTENT_TYPE];

    // Build CORS layer from configured origins (defaults to localhost dev server).
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

    // Rate limiter for auth endpoints: 20 requests per IP per 60 seconds.
    // This throttles brute-force login/register attempts without blocking normal usage.
    let auth_limiter = RateLimiter::new(20, std::time::Duration::from_secs(60));

    // Build the application
    let app = api::router(auth_limiter)
        .merge(ws::router())
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        // Catch handler panics and return 500 instead of crashing the server.
        .layer(CatchPanicLayer::new())
        // Reject request bodies larger than 10 MiB to prevent memory exhaustion.
        .layer(RequestBodyLimitLayer::new(10 * 1024 * 1024))
        .with_state(state);

    tracing::info!("Listening on {bind_addr}");

    let listener = tokio::net::TcpListener::bind(bind_addr)
        .await
        .expect("Failed to bind address");

    axum::serve(listener, app)
        .await
        .expect("Server error");
}

/// If ADMIN_EMAIL and ADMIN_PASSWORD env vars are set, create an admin user on first run.
/// Also creates the company row if it doesn't exist and promotes the user to company admin.
/// The admin is a server-level admin and does NOT get an auto-created project.
/// Skips if the email already exists (idempotent).
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

    // Check if already exists
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

    // Create user
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

    // Create company row if not exists (singleton)
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

    // Add user as company admin
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

