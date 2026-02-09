use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tracing::info;

use super::provider::{AiModel, AiProvider, CompletionRequest, CompletionResponse, ShellCommandResponse};
use super::settings::AiProviderType;

/// Anthropic API provider
pub struct AnthropicProvider {
    client: Client,
    api_key: String,
    model: String,
}

impl AnthropicProvider {
    pub fn new(api_key: &str, model: &str) -> Self {
        Self {
            client: Client::new(),
            api_key: api_key.to_string(),
            model: model.to_string(),
        }
    }

    /// Get the base URL for Anthropic API
    fn base_url(&self) -> &str {
        "https://api.anthropic.com"
    }

    /// Get the API version header (updated for tool_use support)
    fn api_version(&self) -> &str {
        "2024-06-01"
    }

    /// Return a curated list of recommended models as fallback
    fn curated_models(&self) -> Vec<AiModel> {
        vec![
            AiModel {
                id: "claude-sonnet-4-20250514".to_string(),
                name: "Claude Sonnet 4".to_string(),
                provider: AiProviderType::Anthropic,
                context_window: Some(200_000),
                parameter_size: None,
                quantization_level: None,
            },
            AiModel {
                id: "claude-3-5-sonnet-20241022".to_string(),
                name: "Claude 3.5 Sonnet".to_string(),
                provider: AiProviderType::Anthropic,
                context_window: Some(200_000),
                parameter_size: None,
                quantization_level: None,
            },
            AiModel {
                id: "claude-3-5-haiku-20241022".to_string(),
                name: "Claude 3.5 Haiku".to_string(),
                provider: AiProviderType::Anthropic,
                context_window: Some(200_000),
                parameter_size: None,
                quantization_level: None,
            },
            AiModel {
                id: "claude-3-opus-20240229".to_string(),
                name: "Claude 3 Opus".to_string(),
                provider: AiProviderType::Anthropic,
                context_window: Some(200_000),
                parameter_size: None,
                quantization_level: None,
            },
        ]
    }
}

// Anthropic API types

#[derive(Debug, Serialize)]
struct AnthropicRequest {
    model: String,
    max_tokens: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
    messages: Vec<AnthropicMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<AnthropicTool>>,
}

/// Tool definition for Anthropic API
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnthropicTool {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

/// Message content block - can be text, tool_use, or tool_result
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    #[serde(rename = "tool_result")]
    ToolResult {
        tool_use_id: String,
        content: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        is_error: Option<bool>,
    },
}

/// Message with structured content (for tool_use flow)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnthropicMessageWithContent {
    pub role: String,
    pub content: MessageContent,
}

/// Message content can be a string or array of content blocks
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MessageContent {
    Text(String),
    Blocks(Vec<ContentBlock>),
}

#[derive(Debug, Serialize, Deserialize)]
struct AnthropicMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct AnthropicResponse {
    content: Vec<AnthropicContentBlock>,
    #[serde(default)]
    usage: Option<AnthropicUsage>,
    #[serde(default)]
    stop_reason: Option<String>,
}

/// Response content block that handles both text and tool_use
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum AnthropicContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
}

#[derive(Debug, Deserialize)]
struct AnthropicUsage {
    input_tokens: i32,
    output_tokens: i32,
}

// Models API response types
#[derive(Debug, Deserialize)]
struct AnthropicModelsResponse {
    data: Vec<AnthropicModelInfo>,
}

#[derive(Debug, Deserialize)]
struct AnthropicModelInfo {
    id: String,
    display_name: String,
}

/// Response from a tool-enabled completion
#[derive(Debug, Clone)]
pub struct ToolCompletionResponse {
    /// Text content blocks
    pub text: String,
    /// Tool use requests from the AI
    pub tool_calls: Vec<ToolCall>,
    /// Stop reason (end_turn, tool_use, etc.)
    pub stop_reason: String,
    /// Tokens used
    pub tokens_used: Option<i32>,
}

/// A tool call from the AI
#[derive(Debug, Clone)]
pub struct ToolCall {
    /// Unique ID for this tool call
    pub id: String,
    /// Name of the tool to call
    pub name: String,
    /// Arguments for the tool
    pub input: serde_json::Value,
}

#[async_trait]
impl AiProvider for AnthropicProvider {
    fn provider_type(&self) -> AiProviderType {
        AiProviderType::Anthropic
    }

    async fn get_completion(&self, request: CompletionRequest) -> Result<CompletionResponse, String> {
        let url = format!("{}/v1/messages", self.base_url());
        let json_mode = request.json_mode;

        info!("Sending completion request to Anthropic (json_mode={})", json_mode);

        let anthropic_request = AnthropicRequest {
            model: self.model.clone(),
            max_tokens: request.max_tokens.unwrap_or(256),
            system: request.system_prompt,
            messages: vec![AnthropicMessage {
                role: "user".to_string(),
                content: request.prompt,
            }],
            temperature: request.temperature,
            tools: None,
        };

        let response = self
            .client
            .post(&url)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", self.api_version())
            .header("Content-Type", "application/json")
            .json(&anthropic_request)
            .send()
            .await
            .map_err(|e| format!("Failed to send request to Anthropic: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Anthropic returned error {}: {}", status, body));
        }

        let anthropic_response: AnthropicResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Anthropic response: {}", e))?;

        // Extract text from content blocks
        let content = anthropic_response
            .content
            .into_iter()
            .filter_map(|c| match c {
                AnthropicContentBlock::Text { text } => Some(text),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("");

        let tokens_used = anthropic_response
            .usage
            .map(|u| u.input_tokens + u.output_tokens);

        // Try to parse structured response if in JSON mode
        // Anthropic doesn't have native JSON mode, so we rely on prompt engineering
        let structured = if json_mode {
            serde_json::from_str::<ShellCommandResponse>(&content).ok()
        } else {
            None
        };

        Ok(CompletionResponse {
            content,
            tokens_used,
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
                .header("x-api-key", &self.api_key)
                .header("anthropic-version", "2023-06-01")
                .timeout(std::time::Duration::from_secs(10))
                .send()
                .await
            {
                Ok(response) if response.status().is_success() => {
                    if let Ok(models_response) = response.json::<AnthropicModelsResponse>().await {
                        let models: Vec<AiModel> = models_response
                            .data
                            .into_iter()
                            .map(|m| AiModel {
                                id: m.id.clone(),
                                name: m.display_name,
                                provider: AiProviderType::Anthropic,
                                context_window: Some(200_000), // All Claude 3+ models have 200K
                                parameter_size: None,
                                quantization_level: None,
                            })
                            .collect();

                        if !models.is_empty() {
                            info!("Fetched {} models from Anthropic API", models.len());
                            return Ok(models);
                        }
                    }
                }
                Err(e) => {
                    info!("Failed to fetch models from Anthropic API: {}", e);
                }
                _ => {}
            }
        }

        // Fall back to curated list
        info!("Using curated Anthropic model list");
        Ok(self.curated_models())
    }

    async fn is_available(&self) -> bool {
        self.test_connection().await.is_ok()
    }

    async fn test_connection(&self) -> Result<(), String> {
        // Send a minimal request to test the API key
        let url = format!("{}/v1/messages", self.base_url());

        let test_request = AnthropicRequest {
            model: "claude-3-5-haiku-20241022".to_string(),
            max_tokens: 1,
            system: None,
            messages: vec![AnthropicMessage {
                role: "user".to_string(),
                content: "Hi".to_string(),
            }],
            temperature: None,
            tools: None,
        };

        let response = self
            .client
            .post(&url)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", self.api_version())
            .header("Content-Type", "application/json")
            .json(&test_request)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| format!("Failed to connect to Anthropic: {}", e))?;

        if response.status().is_success() {
            Ok(())
        } else if response.status().as_u16() == 401 {
            Err("Invalid API key".to_string())
        } else {
            let body = response.text().await.unwrap_or_default();
            Err(format!("Anthropic error: {}", body))
        }
    }
}

impl AnthropicProvider {
    /// Get a completion with tool support for agentic workflows
    ///
    /// This method:
    /// 1. Sends the messages with tool definitions
    /// 2. Parses both text and tool_use content blocks
    /// 3. Returns structured response with tool calls
    pub async fn get_tool_completion(
        &self,
        messages: &[AnthropicMessageWithContent],
        system: Option<&str>,
        tools: &[AnthropicTool],
        max_tokens: i32,
        temperature: Option<f32>,
    ) -> Result<ToolCompletionResponse, String> {
        let url = format!("{}/v1/messages", self.base_url());

        // Build request body manually for proper serialization
        let mut body = serde_json::json!({
            "model": self.model,
            "max_tokens": max_tokens,
            "messages": messages,
        });

        if let Some(sys) = system {
            body["system"] = serde_json::json!(sys);
        }

        if !tools.is_empty() {
            body["tools"] = serde_json::to_value(tools).unwrap_or(serde_json::json!([]));
        }

        if let Some(temp) = temperature {
            body["temperature"] = serde_json::json!(temp);
        }

        info!("Sending tool completion request to Anthropic with {} tools", tools.len());

        let response = self
            .client
            .post(&url)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", self.api_version())
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Failed to send request to Anthropic: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Anthropic returned error {}: {}", status, body));
        }

        let anthropic_response: AnthropicResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Anthropic response: {}", e))?;

        // Parse content blocks
        let mut text_parts: Vec<String> = Vec::new();
        let mut tool_calls: Vec<ToolCall> = Vec::new();

        for block in anthropic_response.content {
            match block {
                AnthropicContentBlock::Text { text } => {
                    text_parts.push(text);
                }
                AnthropicContentBlock::ToolUse { id, name, input } => {
                    tool_calls.push(ToolCall { id, name, input });
                }
            }
        }

        let tokens_used = anthropic_response
            .usage
            .map(|u| u.input_tokens + u.output_tokens);

        Ok(ToolCompletionResponse {
            text: text_parts.join(""),
            tool_calls,
            stop_reason: anthropic_response.stop_reason.unwrap_or_else(|| "end_turn".to_string()),
            tokens_used,
        })
    }

    /// Create a user message with tool results
    pub fn create_tool_result_message(tool_use_id: &str, result: &str, is_error: bool) -> ContentBlock {
        ContentBlock::ToolResult {
            tool_use_id: tool_use_id.to_string(),
            content: result.to_string(),
            is_error: if is_error { Some(true) } else { None },
        }
    }

    /// Create an assistant message with tool use (for conversation history)
    pub fn create_tool_use_block(id: &str, name: &str, input: serde_json::Value) -> ContentBlock {
        ContentBlock::ToolUse {
            id: id.to_string(),
            name: name.to_string(),
            input,
        }
    }
}
