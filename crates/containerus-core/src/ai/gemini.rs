use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tracing::info;

use super::provider::{
    AiModel, AiProvider, CompletionRequest, CompletionResponse, ShellCommandResponse,
};
use super::settings::AiProviderType;

/// Google Gemini API provider.
///
/// Uses the Gemini REST API which differs from OpenAI:
/// - Auth via `?key=` query parameter
/// - Different request/response structure
/// - System prompt via `systemInstruction`
pub struct GeminiProvider {
    client: Client,
    api_key: String,
    model: String,
    endpoint_url: String,
}

impl GeminiProvider {
    pub fn new(api_key: &str, model: &str, endpoint_url: &str) -> Self {
        let url = if endpoint_url.is_empty() {
            "https://generativelanguage.googleapis.com".to_string()
        } else {
            endpoint_url.trim_end_matches('/').to_string()
        };

        Self {
            client: Client::new(),
            api_key: api_key.to_string(),
            model: model.to_string(),
            endpoint_url: url,
        }
    }

    fn curated_models() -> Vec<AiModel> {
        vec![
            AiModel {
                id: "gemini-2.0-flash".to_string(),
                name: "Gemini 2.0 Flash".to_string(),
                provider: AiProviderType::Gemini,
                context_window: Some(1_048_576),
                parameter_size: None,
                quantization_level: None,
            },
            AiModel {
                id: "gemini-2.0-flash-lite".to_string(),
                name: "Gemini 2.0 Flash Lite".to_string(),
                provider: AiProviderType::Gemini,
                context_window: Some(1_048_576),
                parameter_size: None,
                quantization_level: None,
            },
            AiModel {
                id: "gemini-1.5-pro".to_string(),
                name: "Gemini 1.5 Pro".to_string(),
                provider: AiProviderType::Gemini,
                context_window: Some(2_097_152),
                parameter_size: None,
                quantization_level: None,
            },
            AiModel {
                id: "gemini-1.5-flash".to_string(),
                name: "Gemini 1.5 Flash".to_string(),
                provider: AiProviderType::Gemini,
                context_window: Some(1_048_576),
                parameter_size: None,
                quantization_level: None,
            },
        ]
    }
}

// --- Gemini API types ---

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GeminiRequest {
    contents: Vec<GeminiContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    system_instruction: Option<GeminiContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    generation_config: Option<GenerationConfig>,
}

#[derive(Debug, Serialize, Deserialize)]
struct GeminiContent {
    #[serde(skip_serializing_if = "Option::is_none")]
    role: Option<String>,
    parts: Vec<GeminiPart>,
}

#[derive(Debug, Serialize, Deserialize)]
struct GeminiPart {
    text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GenerationConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_output_tokens: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_mime_type: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GeminiResponse {
    #[serde(default)]
    candidates: Vec<GeminiCandidate>,
    #[serde(default)]
    usage_metadata: Option<GeminiUsage>,
}

#[derive(Debug, Deserialize)]
struct GeminiCandidate {
    content: GeminiContent,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeminiUsage {
    total_token_count: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct GeminiModelsResponse {
    #[serde(default)]
    models: Vec<GeminiModelInfo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeminiModelInfo {
    name: String,
    display_name: Option<String>,
    input_token_limit: Option<i64>,
    #[serde(default)]
    supported_generation_methods: Vec<String>,
}

#[async_trait]
impl AiProvider for GeminiProvider {
    fn provider_type(&self) -> AiProviderType {
        AiProviderType::Gemini
    }

    async fn get_completion(
        &self,
        request: CompletionRequest,
    ) -> Result<CompletionResponse, String> {
        let url = format!(
            "{}/v1beta/models/{}:generateContent?key={}",
            self.endpoint_url, self.model, self.api_key
        );
        let json_mode = request.json_mode;

        info!(
            "Sending completion request to Gemini model '{}' (json_mode={})",
            self.model, json_mode
        );

        let system_instruction = request.system_prompt.map(|prompt| GeminiContent {
            role: None,
            parts: vec![GeminiPart { text: prompt }],
        });

        let contents = vec![GeminiContent {
            role: Some("user".to_string()),
            parts: vec![GeminiPart {
                text: request.prompt,
            }],
        }];

        let generation_config = Some(GenerationConfig {
            temperature: request.temperature,
            max_output_tokens: request.max_tokens,
            response_mime_type: if json_mode {
                Some("application/json".to_string())
            } else {
                None
            },
        });

        let gemini_request = GeminiRequest {
            contents,
            system_instruction,
            generation_config,
        };

        let response = self
            .client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&gemini_request)
            .send()
            .await
            .map_err(|e| format!("Failed to send request to Gemini: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Gemini returned error {}: {}", status, body));
        }

        let gemini_response: GeminiResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Gemini response: {}", e))?;

        let content = gemini_response
            .candidates
            .first()
            .and_then(|c| c.content.parts.first())
            .map(|p| p.text.clone())
            .unwrap_or_default();

        let structured = if json_mode {
            serde_json::from_str::<ShellCommandResponse>(&content).ok()
        } else {
            None
        };

        Ok(CompletionResponse {
            content,
            tokens_used: gemini_response
                .usage_metadata
                .and_then(|u| u.total_token_count),
            structured,
        })
    }

    async fn list_models(&self) -> Result<Vec<AiModel>, String> {
        if !self.api_key.is_empty() {
            let url = format!(
                "{}/v1beta/models?key={}",
                self.endpoint_url, self.api_key
            );

            match self
                .client
                .get(&url)
                .timeout(std::time::Duration::from_secs(10))
                .send()
                .await
            {
                Ok(response) if response.status().is_success() => {
                    if let Ok(models_response) = response.json::<GeminiModelsResponse>().await {
                        let models: Vec<AiModel> = models_response
                            .models
                            .into_iter()
                            .filter(|m| {
                                m.supported_generation_methods
                                    .iter()
                                    .any(|method| method == "generateContent")
                            })
                            .map(|m| {
                                // Model names come as "models/gemini-1.5-pro" — strip prefix
                                let id = m.name.strip_prefix("models/").unwrap_or(&m.name);
                                AiModel {
                                    id: id.to_string(),
                                    name: m
                                        .display_name
                                        .unwrap_or_else(|| id.to_string()),
                                    provider: AiProviderType::Gemini,
                                    context_window: m.input_token_limit,
                                    parameter_size: None,
                                    quantization_level: None,
                                }
                            })
                            .collect();

                        if !models.is_empty() {
                            info!("Fetched {} models from Gemini API", models.len());
                            return Ok(models);
                        }
                    }
                }
                Err(e) => {
                    info!("Failed to fetch models from Gemini API: {}", e);
                }
                _ => {}
            }
        }

        info!("Using curated Gemini model list");
        Ok(Self::curated_models())
    }

    async fn is_available(&self) -> bool {
        self.test_connection().await.is_ok()
    }

    async fn test_connection(&self) -> Result<(), String> {
        let url = format!(
            "{}/v1beta/models?key={}",
            self.endpoint_url, self.api_key
        );

        let response = self
            .client
            .get(&url)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| format!("Failed to connect to Gemini: {}", e))?;

        if response.status().is_success() {
            Ok(())
        } else if response.status().as_u16() == 400 || response.status().as_u16() == 403 {
            Err("Invalid API key".to_string())
        } else {
            Err(format!(
                "Gemini returned status: {}",
                response.status()
            ))
        }
    }
}
