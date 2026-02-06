use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tracing::info;

use super::provider::{
    AiModel, AiProvider, CompletionRequest, CompletionResponse, ShellCommandResponse,
};
use super::settings::AiProviderType;

/// Generic OpenAI-compatible API provider.
/// Used for Groq, DeepSeek, Mistral, and any other provider that implements
/// the OpenAI `/v1/chat/completions` and `/v1/models` API format.
pub struct OpenAiCompatProvider {
    client: Client,
    api_key: String,
    model: String,
    endpoint_url: String,
    provider_type: AiProviderType,
    curated_models: Vec<AiModel>,
}

impl OpenAiCompatProvider {
    pub fn new(
        provider_type: AiProviderType,
        api_key: &str,
        model: &str,
        endpoint_url: &str,
        curated_models: Vec<AiModel>,
    ) -> Self {
        Self {
            client: Client::new(),
            api_key: api_key.to_string(),
            model: model.to_string(),
            endpoint_url: endpoint_url.trim_end_matches('/').to_string(),
            provider_type,
            curated_models,
        }
    }

    fn base_url(&self) -> &str {
        &self.endpoint_url
    }
}

// --- Curated model lists ---

pub fn groq_models() -> Vec<AiModel> {
    vec![
        AiModel {
            id: "llama-3.3-70b-versatile".to_string(),
            name: "Llama 3.3 70B Versatile".to_string(),
            provider: AiProviderType::Groq,
            context_window: Some(128_000),
            parameter_size: Some("70B".to_string()),
            quantization_level: None,
        },
        AiModel {
            id: "llama-3.1-8b-instant".to_string(),
            name: "Llama 3.1 8B Instant".to_string(),
            provider: AiProviderType::Groq,
            context_window: Some(128_000),
            parameter_size: Some("8B".to_string()),
            quantization_level: None,
        },
        AiModel {
            id: "mixtral-8x7b-32768".to_string(),
            name: "Mixtral 8x7B".to_string(),
            provider: AiProviderType::Groq,
            context_window: Some(32_768),
            parameter_size: Some("46.7B".to_string()),
            quantization_level: None,
        },
        AiModel {
            id: "gemma2-9b-it".to_string(),
            name: "Gemma 2 9B".to_string(),
            provider: AiProviderType::Groq,
            context_window: Some(8_192),
            parameter_size: Some("9B".to_string()),
            quantization_level: None,
        },
    ]
}

pub fn deepseek_models() -> Vec<AiModel> {
    vec![
        AiModel {
            id: "deepseek-chat".to_string(),
            name: "DeepSeek Chat (V3)".to_string(),
            provider: AiProviderType::DeepSeek,
            context_window: Some(64_000),
            parameter_size: None,
            quantization_level: None,
        },
        AiModel {
            id: "deepseek-reasoner".to_string(),
            name: "DeepSeek Reasoner (R1)".to_string(),
            provider: AiProviderType::DeepSeek,
            context_window: Some(64_000),
            parameter_size: None,
            quantization_level: None,
        },
    ]
}

pub fn mistral_models() -> Vec<AiModel> {
    vec![
        AiModel {
            id: "mistral-large-latest".to_string(),
            name: "Mistral Large".to_string(),
            provider: AiProviderType::Mistral,
            context_window: Some(128_000),
            parameter_size: None,
            quantization_level: None,
        },
        AiModel {
            id: "mistral-small-latest".to_string(),
            name: "Mistral Small".to_string(),
            provider: AiProviderType::Mistral,
            context_window: Some(128_000),
            parameter_size: None,
            quantization_level: None,
        },
        AiModel {
            id: "open-mistral-nemo".to_string(),
            name: "Mistral Nemo".to_string(),
            provider: AiProviderType::Mistral,
            context_window: Some(128_000),
            parameter_size: Some("12B".to_string()),
            quantization_level: None,
        },
        AiModel {
            id: "codestral-latest".to_string(),
            name: "Codestral".to_string(),
            provider: AiProviderType::Mistral,
            context_window: Some(32_000),
            parameter_size: None,
            quantization_level: None,
        },
    ]
}

// --- OpenAI-compatible API types ---

#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
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
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
    #[serde(default)]
    usage: Option<ChatUsage>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Debug, Deserialize)]
struct ChatUsage {
    total_tokens: i32,
}

#[derive(Debug, Deserialize)]
struct ModelsResponse {
    data: Vec<ModelInfo>,
}

#[derive(Debug, Deserialize)]
struct ModelInfo {
    id: String,
}

#[async_trait]
impl AiProvider for OpenAiCompatProvider {
    fn provider_type(&self) -> AiProviderType {
        self.provider_type
    }

    async fn get_completion(
        &self,
        request: CompletionRequest,
    ) -> Result<CompletionResponse, String> {
        let url = format!("{}/v1/chat/completions", self.base_url());
        let json_mode = request.json_mode;

        info!(
            "Sending completion request to {} (json_mode={})",
            self.provider_type, json_mode
        );

        let mut messages = Vec::new();

        if let Some(system_prompt) = request.system_prompt {
            messages.push(ChatMessage {
                role: "system".to_string(),
                content: system_prompt,
            });
        }

        messages.push(ChatMessage {
            role: "user".to_string(),
            content: request.prompt,
        });

        let chat_request = ChatRequest {
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
            .json(&chat_request)
            .send()
            .await
            .map_err(|e| format!("Failed to send request to {}: {}", self.provider_type, e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("{} returned error {}: {}", self.provider_type, status, body));
        }

        let chat_response: ChatResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse {} response: {}", self.provider_type, e))?;

        let content = chat_response
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
            tokens_used: chat_response.usage.map(|u| u.total_tokens),
            structured,
        })
    }

    async fn list_models(&self) -> Result<Vec<AiModel>, String> {
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
                    if let Ok(models_response) = response.json::<ModelsResponse>().await {
                        let mut models: Vec<AiModel> = models_response
                            .data
                            .into_iter()
                            .map(|m| AiModel {
                                id: m.id.clone(),
                                name: m.id.clone(),
                                provider: self.provider_type,
                                context_window: None,
                                parameter_size: None,
                                quantization_level: None,
                            })
                            .collect();

                        models.sort_by(|a, b| a.id.cmp(&b.id));

                        if !models.is_empty() {
                            info!(
                                "Fetched {} models from {} API",
                                models.len(),
                                self.provider_type
                            );
                            return Ok(models);
                        }
                    }
                }
                Err(e) => {
                    info!("Failed to fetch models from {} API: {}", self.provider_type, e);
                }
                _ => {}
            }
        }

        info!("Using curated {} model list", self.provider_type);
        Ok(self.curated_models.clone())
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
            .map_err(|e| format!("Failed to connect to {}: {}", self.provider_type, e))?;

        if response.status().is_success() {
            Ok(())
        } else if response.status().as_u16() == 401 {
            Err("Invalid API key".to_string())
        } else {
            Err(format!(
                "{} returned status: {}",
                self.provider_type,
                response.status()
            ))
        }
    }
}
