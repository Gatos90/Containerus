use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tracing::info;

use super::provider::{
    AiModel, AiProvider, CompletionRequest, CompletionResponse, ShellCommandResponse,
};
use super::settings::AiProviderType;

const DEFAULT_API_VERSION: &str = "2024-10-21";

/// Azure OpenAI API provider.
///
/// Azure uses deployment-based URLs:
/// `{endpoint}/openai/deployments/{deployment}/chat/completions?api-version=...`
///
/// - `endpoint_url` = Azure resource endpoint (e.g. `https://myresource.openai.azure.com`)
/// - `model` = deployment name
/// - `api_version` = Azure API version (defaults to `2024-10-21`)
pub struct AzureProvider {
    client: Client,
    api_key: String,
    deployment: String,
    endpoint_url: String,
    api_version: String,
}

impl AzureProvider {
    pub fn new(api_key: &str, deployment: &str, endpoint_url: &str, api_version: Option<&str>) -> Self {
        let version = api_version
            .filter(|v| !v.is_empty())
            .unwrap_or(DEFAULT_API_VERSION);

        Self {
            client: Client::new(),
            api_key: api_key.to_string(),
            deployment: deployment.to_string(),
            endpoint_url: endpoint_url.trim_end_matches('/').to_string(),
            api_version: version.to_string(),
        }
    }

    pub fn api_version(&self) -> &str {
        &self.api_version
    }

    fn completions_url(&self) -> String {
        format!(
            "{}/openai/deployments/{}/chat/completions?api-version={}",
            self.endpoint_url, self.deployment, self.api_version
        )
    }
}

// --- Azure OpenAI API types (same as OpenAI but auth via api-key header) ---

#[derive(Debug, Serialize)]
struct AzureChatRequest {
    messages: Vec<AzureMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_format: Option<ResponseFormat>,
}

#[derive(Debug, Serialize)]
struct ResponseFormat {
    #[serde(rename = "type")]
    format_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct AzureMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct AzureChatResponse {
    choices: Vec<AzureChoice>,
    #[serde(default)]
    usage: Option<AzureUsage>,
}

#[derive(Debug, Deserialize)]
struct AzureChoice {
    message: AzureMessage,
}

#[derive(Debug, Deserialize)]
struct AzureUsage {
    total_tokens: i32,
}

#[derive(Debug, Deserialize)]
struct AzureDeploymentsResponse {
    data: Vec<AzureDeployment>,
}

#[derive(Debug, Deserialize)]
struct AzureDeployment {
    id: String,
    model: String,
    status: String,
}

#[async_trait]
impl AiProvider for AzureProvider {
    fn provider_type(&self) -> AiProviderType {
        AiProviderType::AzureOpenAi
    }

    async fn get_completion(
        &self,
        request: CompletionRequest,
    ) -> Result<CompletionResponse, String> {
        let url = self.completions_url();
        let json_mode = request.json_mode;

        info!(
            "Sending completion request to Azure OpenAI deployment '{}' (json_mode={})",
            self.deployment, json_mode
        );

        let mut messages = Vec::new();

        if let Some(system_prompt) = request.system_prompt {
            messages.push(AzureMessage {
                role: "system".to_string(),
                content: system_prompt,
            });
        }

        messages.push(AzureMessage {
            role: "user".to_string(),
            content: request.prompt,
        });

        let azure_request = AzureChatRequest {
            messages,
            temperature: request.temperature,
            max_tokens: request.max_tokens,
            response_format: if json_mode {
                Some(ResponseFormat {
                    format_type: "json_object".to_string(),
                })
            } else {
                None
            },
        };

        let response = self
            .client
            .post(&url)
            .header("api-key", &self.api_key)
            .header("Content-Type", "application/json")
            .json(&azure_request)
            .send()
            .await
            .map_err(|e| format!("Failed to send request to Azure OpenAI: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!(
                "Azure OpenAI returned error {}: {}",
                status, body
            ));
        }

        let azure_response: AzureChatResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Azure OpenAI response: {}", e))?;

        let content = azure_response
            .choices
            .first()
            .map(|c| c.message.content.clone())
            .unwrap_or_default();

        let structured = if json_mode {
            serde_json::from_str::<ShellCommandResponse>(&content).ok()
        } else {
            None
        };

        Ok(CompletionResponse {
            content,
            tokens_used: azure_response.usage.map(|u| u.total_tokens),
            structured,
        })
    }

    async fn list_models(&self) -> Result<Vec<AiModel>, String> {
        if self.endpoint_url.is_empty() || self.api_key.is_empty() {
            return Ok(vec![]);
        }

        // Azure provides a list deployments endpoint
        let url = format!(
            "{}/openai/deployments?api-version={}",
            self.endpoint_url, self.api_version
        );

        match self
            .client
            .get(&url)
            .header("api-key", &self.api_key)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => {
                if let Ok(deployments) = response.json::<AzureDeploymentsResponse>().await {
                    let models: Vec<AiModel> = deployments
                        .data
                        .into_iter()
                        .filter(|d| d.status == "succeeded")
                        .map(|d| AiModel {
                            id: d.id.clone(),
                            name: format!("{} ({})", d.id, d.model),
                            provider: AiProviderType::AzureOpenAi,
                            context_window: None,
                            parameter_size: None,
                            quantization_level: None,
                        })
                        .collect();

                    if !models.is_empty() {
                        info!("Fetched {} deployments from Azure OpenAI", models.len());
                        return Ok(models);
                    }
                }
            }
            Err(e) => {
                info!("Failed to list Azure deployments: {}", e);
            }
            _ => {}
        }

        // Fallback: empty list, user can add deployments manually
        Ok(vec![])
    }

    async fn is_available(&self) -> bool {
        self.test_connection().await.is_ok()
    }

    async fn test_connection(&self) -> Result<(), String> {
        if self.endpoint_url.is_empty() {
            return Err("Azure endpoint URL is required".to_string());
        }
        if self.deployment.is_empty() {
            return Err("Azure deployment name is required".to_string());
        }

        // Try a minimal completions call to verify credentials and deployment
        let url = self.completions_url();

        let test_request = AzureChatRequest {
            messages: vec![AzureMessage {
                role: "user".to_string(),
                content: "hi".to_string(),
            }],
            temperature: Some(0.0),
            max_tokens: Some(1),
            response_format: None,
        };

        let response = self
            .client
            .post(&url)
            .header("api-key", &self.api_key)
            .header("Content-Type", "application/json")
            .json(&test_request)
            .timeout(std::time::Duration::from_secs(15))
            .send()
            .await
            .map_err(|e| format!("Failed to connect to Azure OpenAI: {}", e))?;

        if response.status().is_success() {
            Ok(())
        } else if response.status().as_u16() == 401 {
            Err("Invalid API key".to_string())
        } else if response.status().as_u16() == 404 {
            Err(format!(
                "Deployment '{}' not found. Check your deployment name and endpoint URL.",
                self.deployment
            ))
        } else {
            Err(format!(
                "Azure OpenAI returned status: {}",
                response.status()
            ))
        }
    }
}
