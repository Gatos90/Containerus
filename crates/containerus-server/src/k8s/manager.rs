use std::sync::Arc;

use dashmap::DashMap;
use kube::{
    config::{KubeConfigOptions, Kubeconfig},
    Client, Config,
};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::models::ClusterRow;
use crate::vault::ServerVault;

/// Manages Kubernetes cluster connections per-project.
/// Kubeconfigs are stored encrypted in the database and decrypted on demand.
#[derive(Clone)]
pub struct ClusterManager {
    /// Cached kube clients: cluster_id -> Client
    clients: Arc<DashMap<Uuid, Client>>,
    vault: ServerVault,
}

impl ClusterManager {
    pub fn new(vault: ServerVault) -> Self {
        Self {
            clients: Arc::new(DashMap::new()),
            vault,
        }
    }

    /// Get or create a kube::Client for the given cluster.
    pub async fn get_client(
        &self,
        cluster: &ClusterRow,
    ) -> Result<Client, K8sError> {
        // Check cache first
        if let Some(client) = self.clients.get(&cluster.id) {
            return Ok(client.clone());
        }

        // Decrypt kubeconfig
        let kubeconfig_yaml = self
            .vault
            .decrypt(&cluster.kubeconfig_encrypted, &cluster.kubeconfig_nonce)
            .map_err(|e| K8sError::DecryptionFailed(e.to_string()))?;

        let kubeconfig_str = String::from_utf8(kubeconfig_yaml)
            .map_err(|_| K8sError::InvalidKubeconfig("Invalid UTF-8 in kubeconfig".into()))?;

        // Parse kubeconfig
        let kubeconfig: Kubeconfig = serde_yaml::from_str(&kubeconfig_str)
            .map_err(|e| K8sError::InvalidKubeconfig(format!("YAML parse error: {e}")))?;

        // Build config with optional context override
        let options = KubeConfigOptions {
            context: cluster.context_name.clone(),
            ..Default::default()
        };

        let config = Config::from_custom_kubeconfig(kubeconfig, &options)
            .await
            .map_err(|e| K8sError::ConfigError(e.to_string()))?;

        let client = Client::try_from(config)
            .map_err(|e| K8sError::ClientError(e.to_string()))?;

        // Cache the client (or return existing if another thread won the race)
        Ok(self.clients.entry(cluster.id).or_insert(client).clone())
    }

    /// Store a new cluster's kubeconfig (encrypted).
    pub async fn store_cluster(
        &self,
        db: &PgPool,
        environment_id: Uuid,
        name: &str,
        kubeconfig_yaml: &str,
        context_name: Option<&str>,
        created_by: Uuid,
    ) -> Result<ClusterRow, K8sError> {
        // Validate the kubeconfig parses
        let kubeconfig: Kubeconfig = serde_yaml::from_str(kubeconfig_yaml)
            .map_err(|e| K8sError::InvalidKubeconfig(format!("YAML parse error: {e}")))?;

        // Extract API server URL from the kubeconfig
        let api_server_url = match extract_api_server(&kubeconfig, context_name) {
            Some(url) => url,
            None => {
                tracing::warn!("Could not extract API server URL from kubeconfig (context: {:?})", context_name);
                return Err(K8sError::InvalidKubeconfig(
                    "Could not extract API server URL from kubeconfig".into()
                ));
            }
        };

        // Encrypt the kubeconfig
        let (encrypted, nonce) = self
            .vault
            .encrypt(kubeconfig_yaml.as_bytes())
            .map_err(|e| K8sError::EncryptionFailed(e.to_string()))?;

        let row = sqlx::query_as::<_, ClusterRow>(
            r#"
            INSERT INTO clusters (environment_id, name, api_server_url, kubeconfig_encrypted, kubeconfig_nonce, context_name, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
            "#,
        )
        .bind(environment_id)
        .bind(name)
        .bind(&api_server_url)
        .bind(&encrypted)
        .bind(&nonce)
        .bind(context_name)
        .bind(created_by)
        .fetch_one(db)
        .await
        .map_err(K8sError::Database)?;

        Ok(row)
    }

    /// Update an existing cluster's configuration.
    pub async fn update_cluster(
        &self,
        db: &PgPool,
        cluster_id: Uuid,
        name: Option<&str>,
        kubeconfig_yaml: Option<&str>,
        context_name: Option<Option<&str>>,
    ) -> Result<ClusterRow, K8sError> {
        // If kubeconfig is being updated, validate and re-encrypt
        let new_api_url;
        let new_encrypted;
        let new_nonce;
        let effective_context = context_name.map(|c| c.map(String::from));

        if let Some(kc_yaml) = kubeconfig_yaml {
            let kubeconfig: Kubeconfig = serde_yaml::from_str(kc_yaml)
                .map_err(|e| K8sError::InvalidKubeconfig(format!("YAML parse error: {e}")))?;

            let ctx = effective_context.as_ref().and_then(|c| c.as_deref());
            let api_server_url = match extract_api_server(&kubeconfig, ctx) {
                Some(url) => url,
                None => {
                    return Err(K8sError::InvalidKubeconfig(
                        "Could not extract API server URL from kubeconfig".into(),
                    ));
                }
            };

            let (encrypted, nonce) = self
                .vault
                .encrypt(kc_yaml.as_bytes())
                .map_err(|e| K8sError::EncryptionFailed(e.to_string()))?;

            new_api_url = Some(api_server_url);
            new_encrypted = Some(encrypted);
            new_nonce = Some(nonce);
        } else {
            new_api_url = None;
            new_encrypted = None;
            new_nonce = None;
        }

        // Collect bind values in order
        struct Binds {
            name: Option<String>,
            api_url: Option<String>,
            encrypted: Option<Vec<u8>>,
            nonce: Option<Vec<u8>>,
            context: Option<Option<String>>,
        }
        let binds = Binds {
            name: name.map(String::from),
            api_url: new_api_url,
            encrypted: new_encrypted,
            nonce: new_nonce,
            context: effective_context,
        };

        // We'll build a simple query with all optional fields using COALESCE pattern
        // For simplicity, always set all fields but use COALESCE to keep existing values
        let row = sqlx::query_as::<_, ClusterRow>(
            r#"
            UPDATE clusters SET
                name = COALESCE($1, name),
                api_server_url = COALESCE($2, api_server_url),
                kubeconfig_encrypted = COALESCE($3, kubeconfig_encrypted),
                kubeconfig_nonce = COALESCE($4, kubeconfig_nonce),
                context_name = CASE WHEN $5 THEN $6 ELSE context_name END,
                updated_at = now()
            WHERE id = $7
            RETURNING *
            "#,
        )
        .bind(binds.name)
        .bind(binds.api_url)
        .bind(binds.encrypted.as_deref())
        .bind(binds.nonce.as_deref())
        .bind(binds.context.is_some()) // $5: whether to update context_name
        .bind(binds.context.flatten()) // $6: the new context_name value (nullable)
        .bind(cluster_id)
        .fetch_one(db)
        .await
        .map_err(K8sError::Database)?;

        // Invalidate cached client so it reconnects with new config
        self.clients.remove(&cluster_id);

        Ok(row)
    }

    /// Remove a cached client when a cluster is deleted.
    pub fn remove_client(&self, cluster_id: Uuid) {
        self.clients.remove(&cluster_id);
    }

    /// Test connectivity to a cluster.
    pub async fn test_connection(
        &self,
        cluster: &ClusterRow,
    ) -> Result<String, K8sError> {
        let client = self.get_client(cluster).await?;

        // Try to get the server version as a connectivity test
        let version = match client.apiserver_version().await {
            Ok(v) => v,
            Err(e) => {
                self.remove_client(cluster.id);
                return Err(K8sError::ConnectionFailed(e.to_string()));
            }
        };

        Ok(format!("v{}.{}", version.major, version.minor))
    }
}

/// Extract the API server URL from a kubeconfig.
fn extract_api_server(kubeconfig: &Kubeconfig, context_name: Option<&str>) -> Option<String> {
    // Find the target context
    let ctx_name = context_name
        .map(String::from)
        .or_else(|| kubeconfig.current_context.clone())?;

    let ctx = kubeconfig
        .contexts
        .iter()
        .find(|c| c.name == ctx_name)?;

    let cluster_name = ctx.context.as_ref()?.cluster.as_str();

    kubeconfig
        .clusters
        .iter()
        .find(|c| c.name == cluster_name)
        .and_then(|c| c.cluster.as_ref())
        .and_then(|c| c.server.clone())
}

#[derive(Debug, thiserror::Error)]
pub enum K8sError {
    #[error("Failed to decrypt kubeconfig: {0}")]
    DecryptionFailed(String),
    #[error("Failed to encrypt kubeconfig: {0}")]
    EncryptionFailed(String),
    #[error("Invalid kubeconfig: {0}")]
    InvalidKubeconfig(String),
    #[error("K8s config error: {0}")]
    ConfigError(String),
    #[error("K8s client error: {0}")]
    ClientError(String),
    #[error("Connection failed: {0}")]
    ConnectionFailed(String),
    #[error("K8s API error: {0}")]
    ApiError(String),
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
}
