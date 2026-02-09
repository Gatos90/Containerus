use std::net::SocketAddr;

/// Server configuration loaded from environment variables.
#[derive(Clone)]
pub struct ServerConfig {
    /// Address to bind the server to (default: 0.0.0.0:8080)
    pub bind_addr: SocketAddr,
    /// PostgreSQL connection URL
    pub database_url: String,
    /// Secret key for signing JWTs
    pub jwt_secret: String,
    /// JWT access token expiry in seconds (default: 15 minutes)
    pub jwt_access_expiry_secs: i64,
    /// JWT refresh token expiry in seconds (default: 7 days)
    pub jwt_refresh_expiry_secs: i64,
    /// Encryption key for server-side credential vault (AES-256)
    pub encryption_key: String,
    /// Salt for encryption key derivation (Argon2)
    pub encryption_salt: String,
    /// Allowed CORS origins (comma-separated, or "*" for all)
    pub cors_origins: String,
}

impl ServerConfig {
    /// Load configuration from environment variables.
    pub fn from_env() -> Result<Self, String> {
        let database_url = std::env::var("DATABASE_URL")
            .map_err(|_| "DATABASE_URL environment variable is required")?;
        let jwt_secret = std::env::var("JWT_SECRET")
            .map_err(|_| "JWT_SECRET environment variable is required")?;
        if jwt_secret.len() < 32 {
            return Err("JWT_SECRET must be at least 32 characters".into());
        }
        let encryption_key = std::env::var("ENCRYPTION_KEY")
            .map_err(|_| "ENCRYPTION_KEY environment variable is required")?;
        if encryption_key.len() < 32 {
            return Err("ENCRYPTION_KEY must be at least 32 characters".into());
        }

        let bind_addr: SocketAddr = std::env::var("BIND_ADDR")
            .unwrap_or_else(|_| "0.0.0.0:8080".to_string())
            .parse()
            .map_err(|e| format!("Invalid BIND_ADDR: {e}"))?;

        let jwt_access_expiry_secs: i64 = std::env::var("JWT_ACCESS_EXPIRY_SECS")
            .unwrap_or_else(|_| "900".to_string())
            .parse()
            .map_err(|e| format!("Invalid JWT_ACCESS_EXPIRY_SECS: {e}"))?;
        if jwt_access_expiry_secs <= 0 {
            return Err("JWT_ACCESS_EXPIRY_SECS must be a positive value".into());
        }

        let jwt_refresh_expiry_secs: i64 = std::env::var("JWT_REFRESH_EXPIRY_SECS")
            .unwrap_or_else(|_| "604800".to_string())
            .parse()
            .map_err(|e| format!("Invalid JWT_REFRESH_EXPIRY_SECS: {e}"))?;
        if jwt_refresh_expiry_secs <= 0 {
            return Err("JWT_REFRESH_EXPIRY_SECS must be a positive value".into());
        }

        if jwt_access_expiry_secs >= jwt_refresh_expiry_secs {
            return Err("JWT_ACCESS_EXPIRY_SECS must be less than JWT_REFRESH_EXPIRY_SECS".into());
        }

        let encryption_salt = std::env::var("ENCRYPTION_SALT")
            .map_err(|_| "ENCRYPTION_SALT environment variable is required for secure key derivation")?;
        if encryption_salt.len() < 16 {
            return Err("ENCRYPTION_SALT must be at least 16 bytes".into());
        }

        let cors_origins = std::env::var("CORS_ORIGINS")
            .unwrap_or_else(|_| "http://localhost:1420".to_string());

        Ok(Self {
            bind_addr,
            database_url,
            jwt_secret,
            jwt_access_expiry_secs,
            jwt_refresh_expiry_secs,
            encryption_key,
            encryption_salt,
            cors_origins,
        })
    }
}
