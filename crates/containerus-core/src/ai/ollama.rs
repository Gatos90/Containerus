use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tracing::info;

use super::provider::{AiModel, AiProvider, CompletionRequest, CompletionResponse, ShellCommandResponse};
use super::settings::AiProviderType;

/// Ollama API provider
pub struct OllamaProvider {
    client: Client,
    base_url: String,
    model: String,
}

impl OllamaProvider {
    pub fn new(endpoint_url: &str, model: &str) -> Self {
        Self {
            client: Client::new(),
            base_url: endpoint_url.trim_end_matches('/').to_string(),
            model: model.to_string(),
        }
    }

    /// Fetch detailed model info from /api/show endpoint
    async fn get_model_info(
        &self,
        model_name: &str,
    ) -> Result<(Option<i64>, Option<String>, Option<String>), String> {
        let url = format!("{}/api/show", self.base_url);
        let request = OllamaShowRequest {
            name: model_name.to_string(),
        };

        let response = self
            .client
            .post(&url)
            .json(&request)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| format!("Failed to get model info: {}", e))?;

        if !response.status().is_success() {
            return Ok((None, None, None));
        }

        let show_response: OllamaShowResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse model info: {}", e))?;

        // Extract context length from model_info
        let context_window = show_response.model_info.and_then(|info| {
            // Try common family prefixes
            let known_keys = [
                "llama.context_length",
                "gemma3.context_length",
                "gemma2.context_length",
                "qwen2.context_length",
                "phi3.context_length",
                "mistral.context_length",
                "deepseek2.context_length",
            ];

            for key in known_keys {
                if let Some(val) = info.get(key).and_then(|v| v.as_i64()) {
                    return Some(val);
                }
            }

            // Fallback: search for any key ending with ".context_length"
            if let Some(obj) = info.as_object() {
                for (k, v) in obj {
                    if k.ends_with(".context_length") {
                        if let Some(val) = v.as_i64() {
                            return Some(val);
                        }
                    }
                }
            }
            None
        });

        let (param_size, quant_level) = show_response
            .details
            .map(|d| (d.parameter_size, d.quantization_level))
            .unwrap_or((None, None));

        Ok((context_window, param_size, quant_level))
    }

    /// Pull/download a model from Ollama registry
    pub async fn pull_model(&self, model_name: &str) -> Result<String, String> {
        let url = format!("{}/api/pull", self.base_url);
        let request = OllamaPullRequest {
            name: model_name.to_string(),
            stream: false, // Non-streaming for simplicity
        };

        info!("Pulling model from Ollama: {}", model_name);

        let response = self
            .client
            .post(&url)
            .json(&request)
            .timeout(std::time::Duration::from_secs(3600)) // 1 hour timeout for large models
            .send()
            .await
            .map_err(|e| format!("Failed to pull model: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Ollama returned error {}: {}", status, body));
        }

        // Parse the final status
        let pull_response: OllamaPullProgress = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse pull response: {}", e))?;

        Ok(pull_response.status)
    }

    /// Delete a model from Ollama
    pub async fn delete_model(&self, model_name: &str) -> Result<(), String> {
        let url = format!("{}/api/delete", self.base_url);
        let request = OllamaDeleteRequest {
            name: model_name.to_string(),
        };

        info!("Deleting model from Ollama: {}", model_name);

        let response = self
            .client
            .delete(&url)
            .json(&request)
            .timeout(std::time::Duration::from_secs(60))
            .send()
            .await
            .map_err(|e| format!("Failed to delete model: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Ollama returned error {}: {}", status, body));
        }

        Ok(())
    }
}

// Ollama API types

#[derive(Debug, Serialize)]
struct OllamaGenerateRequest {
    model: String,
    prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    options: Option<OllamaOptions>,
    /// Format for structured output: "json" for JSON mode
    #[serde(skip_serializing_if = "Option::is_none")]
    format: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
struct OllamaOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    num_predict: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct OllamaGenerateResponse {
    response: String,
    #[serde(default)]
    eval_count: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct OllamaTagsResponse {
    models: Vec<OllamaModel>,
}

#[derive(Debug, Deserialize)]
struct OllamaModel {
    name: String,
    #[serde(default)]
    #[allow(dead_code)]
    size: Option<u64>,
}

// Types for /api/show endpoint
#[derive(Debug, Serialize)]
struct OllamaShowRequest {
    name: String,
}

#[derive(Debug, Deserialize)]
struct OllamaShowResponse {
    #[serde(default)]
    model_info: Option<serde_json::Value>,
    #[serde(default)]
    details: Option<OllamaModelDetails>,
}

#[derive(Debug, Deserialize)]
struct OllamaModelDetails {
    #[serde(default)]
    parameter_size: Option<String>,
    #[serde(default)]
    quantization_level: Option<String>,
}

// Types for /api/pull endpoint
#[derive(Debug, Serialize)]
struct OllamaPullRequest {
    name: String,
    stream: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaPullProgress {
    pub status: String,
    #[serde(default)]
    pub digest: Option<String>,
    #[serde(default)]
    pub total: Option<u64>,
    #[serde(default)]
    pub completed: Option<u64>,
}

// Types for /api/delete endpoint
#[derive(Debug, Serialize)]
struct OllamaDeleteRequest {
    name: String,
}

#[async_trait]
impl AiProvider for OllamaProvider {
    fn provider_type(&self) -> AiProviderType {
        AiProviderType::Ollama
    }

    async fn get_completion(&self, request: CompletionRequest) -> Result<CompletionResponse, String> {
        let url = format!("{}/api/generate", self.base_url);
        let json_mode = request.json_mode;

        info!("Sending completion request to Ollama: {} (json_mode={})", url, json_mode);

        let ollama_request = OllamaGenerateRequest {
            model: self.model.clone(),
            prompt: request.prompt,
            system: request.system_prompt,
            stream: false,
            options: Some(OllamaOptions {
                temperature: request.temperature,
                num_predict: request.max_tokens,
            }),
            format: if json_mode {
                Some(serde_json::json!("json"))
            } else {
                None
            },
        };

        let response = self
            .client
            .post(&url)
            .json(&ollama_request)
            .send()
            .await
            .map_err(|e| format!("Failed to send request to Ollama: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Ollama returned error {}: {}", status, body));
        }

        let ollama_response: OllamaGenerateResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

        // Try to parse structured response if in JSON mode
        let structured = if json_mode {
            serde_json::from_str::<ShellCommandResponse>(&ollama_response.response).ok()
        } else {
            None
        };

        Ok(CompletionResponse {
            content: ollama_response.response,
            tokens_used: ollama_response.eval_count,
            structured,
        })
    }

    async fn list_models(&self) -> Result<Vec<AiModel>, String> {
        let url = format!("{}/api/tags", self.base_url);

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to get models from Ollama: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Ollama returned error {}: {}", status, body));
        }

        let tags_response: OllamaTagsResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Ollama models response: {}", e))?;

        // Fetch detailed info for each model
        let mut models = Vec::new();
        for m in tags_response.models {
            let (context_window, parameter_size, quantization_level) =
                self.get_model_info(&m.name).await.unwrap_or((None, None, None));

            models.push(AiModel {
                id: m.name.clone(),
                name: m.name,
                provider: AiProviderType::Ollama,
                context_window,
                parameter_size,
                quantization_level,
            });
        }

        Ok(models)
    }

    async fn is_available(&self) -> bool {
        self.test_connection().await.is_ok()
    }

    async fn test_connection(&self) -> Result<(), String> {
        let url = format!("{}/api/tags", self.base_url);

        let response = self
            .client
            .get(&url)
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await
            .map_err(|e| format!("Failed to connect to Ollama: {}", e))?;

        if response.status().is_success() {
            Ok(())
        } else {
            Err(format!("Ollama returned status: {}", response.status()))
        }
    }
}

// Note: Tool calling is now handled by the Rig framework in agent/rig_executor.rs
// The manual tool types have been removed as they're no longer needed.

