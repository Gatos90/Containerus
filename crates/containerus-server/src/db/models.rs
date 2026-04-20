use std::collections::HashSet;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

// ============================================================================
// Auth Provider — designed for future IDP support
// ============================================================================

/// How a user authenticates. "local" = email+password managed by us.
/// Future values: "oidc:okta", "oidc:azure-ad", "oidc:keycloak", "saml:okta", etc.
/// Stored as TEXT in PostgreSQL for maximum flexibility.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AuthProvider {
    /// Email + password managed by Containerus
    Local,
    /// OpenID Connect provider (stores provider slug, e.g. "okta", "azure-ad")
    Oidc(String),
}

impl AuthProvider {
    pub fn to_db_string(&self) -> String {
        match self {
            AuthProvider::Local => "local".to_string(),
            AuthProvider::Oidc(provider) => format!("oidc:{provider}"),
        }
    }

    pub fn from_db_string(s: &str) -> Option<Self> {
        if s == "local" {
            Some(AuthProvider::Local)
        } else if let Some(provider) = s.strip_prefix("oidc:").filter(|p| !p.is_empty()) {
            Some(AuthProvider::Oidc(provider.to_string()))
        } else {
            None
        }
    }
}

// ============================================================================
// User
// ============================================================================

#[derive(Debug, Clone, FromRow)]
pub struct UserRow {
    pub id: Uuid,
    pub email: String,
    /// NULL for IDP-only users (they don't have a local password)
    pub password_hash: Option<String>,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub is_active: bool,
    /// "local", "oidc:okta", "oidc:azure-ad", etc.
    pub auth_provider: String,
    /// External user ID from IDP (NULL for local users)
    pub external_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// User data returned to the frontend (never includes password_hash)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserResponse {
    pub id: Uuid,
    pub email: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub auth_provider: String,
    pub created_at: DateTime<Utc>,
}

impl From<UserRow> for UserResponse {
    fn from(row: UserRow) -> Self {
        Self {
            id: row.id,
            email: row.email,
            display_name: row.display_name,
            avatar_url: row.avatar_url,
            auth_provider: row.auth_provider,
            created_at: row.created_at,
        }
    }
}

// ============================================================================
// Company (singleton: one row per deployment)
// ============================================================================

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Company {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
    pub license_tier: String,
    pub settings: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ============================================================================
// Project (renamed from Organization)
// ============================================================================

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: Uuid,
    pub company_id: Uuid,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ============================================================================
// Environment (dev, staging, production, etc.)
// ============================================================================

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Environment {
    pub id: Uuid,
    pub project_id: Uuid,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub is_default: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ============================================================================
// Role (custom + built-in)
// ============================================================================

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Role {
    pub id: Uuid,
    pub company_id: Option<Uuid>,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub is_system: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Role with its permission keys included (for API responses).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleWithPermissions {
    #[serde(flatten)]
    pub role: Role,
    pub permissions: Vec<String>,
}

// ============================================================================
// Permission
// ============================================================================

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Permission {
    pub id: Uuid,
    pub key: String,
    pub description: String,
    pub category: String,
}

// ============================================================================
// Project Membership
// ============================================================================

#[derive(Debug, Clone, FromRow)]
pub struct ProjectMemberRow {
    pub project_id: Uuid,
    pub user_id: Uuid,
    pub role_id: Uuid,
    pub joined_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMemberResponse {
    pub user_id: Uuid,
    pub email: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub role_id: Uuid,
    pub role_name: String,
    pub role_slug: String,
    pub joined_at: DateTime<Utc>,
    /// CON-134 — surfaces `users.is_active` so the People screen can render a
    /// status column + gate the Deactivate/Reactivate action without a second
    /// round-trip per row. Mirrors `AdminUserResponse.is_active` from CON-119.
    pub is_active: bool,
}

/// Pending project invite (CON-129). Emitted by
/// `GET /api/projects/{projectId}/invites` for emails that have been invited
/// but have not yet redeemed the invite (no `users` row or not yet promoted
/// into `project_members`).
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingInviteResponse {
    pub id: Uuid,
    pub email: String,
    pub role_id: Uuid,
    pub role_name: String,
    pub invited_at: DateTime<Utc>,
    pub invited_by: Option<Uuid>,
    pub expires_at: Option<DateTime<Utc>>,
}

// ============================================================================
// Resource ACL (per-resource permission overrides)
// ============================================================================

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceAcl {
    pub id: Uuid,
    pub user_id: Uuid,
    pub project_id: Uuid,
    pub resource_type: String,
    pub resource_id: Uuid,
    // CON-117: set only for `resource_type='container'` rows. Containers have
    // no PG table to FK against, so we carry the parent system id explicitly
    // and let `ON DELETE CASCADE` on systems clean up orphaned container ACLs.
    // The 0009 schema CHECK enforces the invariant (container ↔ system_id set).
    pub system_id: Option<Uuid>,
    // CON-79: reserved; the resolver never consults this value. The write
    // path rejects non-null inputs so callers can't install an overlay that
    // silently does nothing. Kept on the model so legacy rows still
    // round-trip through SELECT and so a future per-resource role overlay
    // feature can wire it up without another migration.
    pub role_id: Option<Uuid>,
    pub extra_permissions: serde_json::Value,
    pub denied_permissions: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ============================================================================
// Effective Permissions (computed at runtime, not stored)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectivePermissions {
    pub permissions: HashSet<String>,
    pub is_company_admin: bool,
}

impl EffectivePermissions {
    pub fn has(&self, perm: &str) -> bool {
        self.is_company_admin || self.permissions.contains(perm)
    }

    pub fn has_any(&self, perms: &[&str]) -> bool {
        self.is_company_admin || perms.iter().any(|p| self.permissions.contains(*p))
    }
}

// ============================================================================
// Refresh Token
// ============================================================================

#[derive(Debug, Clone, FromRow)]
pub struct RefreshTokenRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub token_hash: String,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

// ============================================================================
// Systems (environment-owned SSH servers)
// ============================================================================

#[derive(Debug, Clone, FromRow)]
pub struct SystemRow {
    pub id: Uuid,
    pub environment_id: Uuid,
    pub name: String,
    pub hostname: String,
    pub port: i32,
    pub username: String,
    pub primary_runtime: String,
    pub available_runtimes: serde_json::Value,
    pub auth_method: String,
    pub ssh_options: Option<serde_json::Value>,
    pub is_active: bool,
    pub last_connected_at: Option<DateTime<Utc>>,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// System data returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemResponse {
    pub id: Uuid,
    pub environment_id: Uuid,
    pub name: String,
    pub hostname: String,
    pub port: i32,
    pub username: String,
    pub primary_runtime: String,
    pub available_runtimes: serde_json::Value,
    pub auth_method: String,
    pub is_active: bool,
    pub last_connected_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

impl From<SystemRow> for SystemResponse {
    fn from(row: SystemRow) -> Self {
        Self {
            id: row.id,
            environment_id: row.environment_id,
            name: row.name,
            hostname: row.hostname,
            port: row.port,
            username: row.username,
            primary_runtime: row.primary_runtime,
            available_runtimes: row.available_runtimes,
            auth_method: row.auth_method,
            is_active: row.is_active,
            last_connected_at: row.last_connected_at,
            created_at: row.created_at,
        }
    }
}

// ============================================================================
// Kubernetes Clusters
// ============================================================================

#[derive(Debug, Clone, FromRow)]
pub struct ClusterRow {
    pub id: Uuid,
    pub environment_id: Uuid,
    pub name: String,
    pub api_server_url: String,
    pub kubeconfig_encrypted: Vec<u8>,
    pub kubeconfig_nonce: Vec<u8>,
    pub context_name: Option<String>,
    pub is_active: bool,
    pub last_connected_at: Option<DateTime<Utc>>,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Cluster data returned to the frontend (never includes encrypted kubeconfig).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClusterResponse {
    pub id: Uuid,
    pub environment_id: Uuid,
    pub name: String,
    pub api_server_url: String,
    pub context_name: Option<String>,
    pub is_active: bool,
    pub last_connected_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

impl From<ClusterRow> for ClusterResponse {
    fn from(row: ClusterRow) -> Self {
        Self {
            id: row.id,
            environment_id: row.environment_id,
            name: row.name,
            api_server_url: row.api_server_url,
            context_name: row.context_name,
            is_active: row.is_active,
            last_connected_at: row.last_connected_at,
            created_at: row.created_at,
        }
    }
}

// ============================================================================
// IDP Configuration
// ============================================================================

/// Stores IDP configuration per company.
/// When a company sets up SSO, they create an IdpConfig at the company level.
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdpConfig {
    pub id: Uuid,
    pub company_id: Uuid,
    /// "oidc" or "saml"
    pub protocol: String,
    /// Human-readable name (e.g., "Okta SSO", "Azure AD")
    pub display_name: String,
    /// OIDC issuer URL or SAML metadata URL
    pub issuer_url: String,
    /// OIDC client ID
    pub client_id: String,
    /// OIDC client secret (encrypted)
    #[serde(skip)]
    pub client_secret_encrypted: Vec<u8>,
    /// Nonce used for client_secret encryption
    #[serde(skip)]
    pub client_secret_nonce: Vec<u8>,
    /// Auto-create users on first SSO login
    pub auto_provision_users: bool,
    /// Default role for auto-provisioned users (now stores role_id as text)
    pub default_role: String,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ============================================================================
// Overview response types (aggregated views)
// ============================================================================

/// Aggregated overview of a single environment with its resources.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentOverview {
    pub environment: Environment,
    pub systems: Vec<SystemResponse>,
    pub clusters: Vec<ClusterResponse>,
}

/// Aggregated overview of a single project with its environments.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectOverview {
    pub project: Project,
    pub role_id: Option<Uuid>,
    pub environments: Vec<EnvironmentOverview>,
}
