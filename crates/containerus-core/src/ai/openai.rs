use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tracing::info;

use super::provider::{AiModel, AiProvider, CompletionRequest, CompletionResponse, ShellCommandResponse};
use super::settings::AiProviderType;

/// OpenAI API provider
pub struct OpenAiProvider {
    client: Client,
    api_key: String,
    model: String,
    endpoint_url: String,
}

impl OpenAiProvider {
    pub fn new(api_key: &str, model: &str, endpoint_url: &str) -> Self {
        // Use default OpenAI URL if endpoint_url is empty
        let url = if endpoint_url.is_empty() {
            "https://api.openai.com".to_string()
        } else {
            endpoint_url.to_string()
        };

        Self {
            client: Client::new(),
            api_key: api_key.to_string(),
            model: model.to_string(),
            endpoint_url: url,
        }
    }

    /// Get the base URL for OpenAI API
    fn base_url(&self) -> &str {
        &self.endpoint_url
    }

    /// Return a curated list of recommended models as fallback
    fn curated_models(&self) -> Vec<AiModel> {
        vec![
            AiModel {
                id: "gpt-4o".to_string(),
                name: "GPT-4o".to_string(),
                provider: AiProviderType::OpenAi,
                context_window: Some(128_000),
                parameter_size: None,
                quantization_level: None,
            },
            AiModel {
                id: "gpt-4o-mini".to_string(),
                name: "GPT-4o Mini".to_string(),
                provider: AiProviderType::OpenAi,
                context_window: Some(128_000),
                parameter_size: None,
                quantization_level: None,
            },
            AiModel {
                id: "gpt-4-turbo".to_string(),
                name: "GPT-4 Turbo".to_string(),
                provider: AiProviderType::OpenAi,
                context_window: Some(128_000),
                parameter_size: None,
                quantization_level: None,
            },
            AiModel {
                id: "gpt-3.5-turbo".to_string(),
                name: "GPT-3.5 Turbo".to_string(),
                provider: AiProviderType::OpenAi,
                context_window: Some(16_385),
                parameter_size: None,
                quantization_level: None,
            },
        ]
    }
}

// OpenAI API types

#[derive(Debug, Serialize)]
struct OpenAiChatRequest {
    model: String,
    messages: Vec<OpenAiMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<i32>,
    /// Response format for JSON mode
    #[serde(skip_serializing_if = "Option::is_none")]
    response_format: Option<ResponseFormat>,
}

/// OpenAI response format for JSON mode
#[derive(Debug, Serialize)]
struct ResponseFormat {
    #[serde(rename = "type")]
    format_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct OpenAiMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct OpenAiChatResponse {
    choices: Vec<OpenAiChoice>,
    #[serde(default)]
    usage: Option<OpenAiUsage>,
}

#[derive(Debug, Deserialize)]
struct OpenAiChoice {
    message: OpenAiMessage,
}

#[derive(Debug, Deserialize)]
struct OpenAiUsage {
    total_tokens: i32,
}

// Models API response types
#[derive(Debug, Deserialize)]
struct OpenAiModelsResponse {
    data: Vec<OpenAiModelInfo>,
}

#[derive(Debug, Deserialize)]
struct OpenAiModelInfo {
    id: String,
}

/// Format model ID to a readable name
fn format_model_name(id: &str) -> String {
    // Handle common prefixes
    let formatted = id
        .replace("gpt-", "GPT-")
        .replace("chatgpt-", "ChatGPT-");

    // Split by hyphens and capitalize appropriately
    formatted
        .split('-')
        .enumerate()
        .map(|(i, part)| {
            if i == 0 {
                part.to_string() // Keep first part as-is (already handled GPT/ChatGPT)
            } else if part.chars().all(|c| c.is_numeric() || c == '.') {
                part.to_string() // Keep version numbers as-is
            } else {
                // Capitalize first letter of other parts
                let mut chars = part.chars();
                match chars.next() {
                    Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
                    None => String::new(),
                }
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Get known context window for common models
fn get_known_context_window(id: &str) -> Option<i64> {
    if id.contains("gpt-4.1") || id.contains("gpt-5") {
        Some(1_000_000)
    } else if id.contains("gpt-4o") || id.contains("gpt-4-turbo") || id.contains("o1-") || id.contains("o3-") {
        Some(128_000)
    } else if id.contains("gpt-4") {
        Some(8_192)
    } else if id.contains("gpt-3.5-turbo-16k") {
        Some(16_385)
    } else if id.contains("gpt-3.5") {
        Some(4_096)
    } else {
        None
    }
}

#[async_trait]
impl AiProvider for OpenAiProvider {
    fn provider_type(&self) -> AiProviderType {
        AiProviderType::OpenAi
    }

    async fn get_completion(&self, request: CompletionRequest) -> Result<CompletionResponse, String> {
        let url = format!("{}/v1/chat/completions", self.base_url());
        let json_mode = request.json_mode;

        info!("Sending completion request to OpenAI (json_mode={})", json_mode);

        let mut messages = Vec::new();

        // Add system message if provided
        if let Some(system_prompt) = request.system_prompt {
            messages.push(OpenAiMessage {
                role: "system".to_string(),
                content: system_prompt,
            });
        }

        // Add user message
        messages.push(OpenAiMessage {
            role: "user".to_string(),
            content: request.prompt,
        });

        let openai_request = OpenAiChatRequest {
            model: self.model.clone(),
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
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&openai_request)
            .send()
            .await
            .map_err(|e| format!("Failed to send request to OpenAI: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("OpenAI returned error {}: {}", status, body));
        }

        let openai_response: OpenAiChatResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse OpenAI response: {}", e))?;

        let content = openai_response
            .choices
            .first()
            .map(|c| c.message.content.clone())
            .unwrap_or_default();

        // Try to parse structured response if in JSON mode
        let structured = if json_mode {
            serde_json::from_str::<ShellCommandResponse>(&content).ok()
        } else {
            None
        };

        Ok(CompletionResponse {
            content,
            tokens_used: openai_response.usage.map(|u| u.total_tokens),
            structured,
        })
    }

    async fn list_models(&self) -> Result<Vec<AiModel>, String> {
        // Try to fetch from API if we have an API key
        if !self.api_key.is_empty() {
            let url = format!("{}/v1/models", self.base_url());

            match self
                .client
                .get(&url)
                .header("Authorization", format!("Bearer {}", self.api_key))
                .timeout(std::time::Duration::from_secs(10))
                .send()
                .await
            {
                Ok(response) if response.status().is_success() => {
                    if let Ok(models_response) = response.json::<OpenAiModelsResponse>().await {
                        // Convert all models and sort by ID
                        let mut models: Vec<AiModel> = models_response
                            .data
                            .into_iter()
                            .map(|m| AiModel {
                                id: m.id.clone(),
                                name: format_model_name(&m.id),
                                provider: AiProviderType::OpenAi,
                                context_window: get_known_context_window(&m.id),
                                parameter_size: None,
                                quantization_level: None,
                            })
                            .collect();

                        // Sort models: prioritize gpt-4o, then gpt-4, then others
                        models.sort_by(|a, b| {
                            let priority = |id: &str| -> i32 {
                                if id.starts_with("gpt-4o") {
                                    0
                                } else if id.starts_with("gpt-4") {
                                    1
                                } else if id.starts_with("o1-") || id.starts_with("o3-") {
                                    2
                                } else {
                                    3
                                }
                            };
                            priority(&a.id).cmp(&priority(&b.id)).then(a.id.cmp(&b.id))
                        });

                        if !models.is_empty() {
                            info!("Fetched {} chat models from OpenAI API", models.len());
                            return Ok(models);
                        }
                    }
                }
                Err(e) => {
                    info!("Failed to fetch models from OpenAI API: {}", e);
                }
                _ => {}
            }
        }

        // Fall back to curated list
        info!("Using curated OpenAI model list");
        Ok(self.curated_models())
    }

    async fn is_available(&self) -> bool {
        self.test_connection().await.is_ok()
    }

    async fn test_connection(&self) -> Result<(), String> {
        let url = format!("{}/v1/models", self.base_url());

        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| format!("Failed to connect to OpenAI: {}", e))?;

        if response.status().is_success() {
            Ok(())
        } else if response.status().as_u16() == 401 {
            Err("Invalid API key".to_string())
        } else {
            Err(format!("OpenAI returned status: {}", response.status()))
        }
    }
}

// Note: Tool/Function calling is now handled by the Rig framework in agent/rig_executor.rs
// The manual tool types have been removed as they're no longer needed.

