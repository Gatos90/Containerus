//! AI Provider Module
//!
//! This module provides a multi-provider AI abstraction for shell command suggestions.
//! Supports Ollama (local), OpenAI, Anthropic, Azure OpenAI, Groq, Google Gemini,
//! DeepSeek, and Mistral.

mod anthropic;
mod azure;
mod gemini;
mod ollama;
mod openai;
mod openai_compat;
mod provider;
mod settings;

// Anthropic-specific types (for backward compatibility)
pub use anthropic::{
    AnthropicContentBlock, AnthropicMessageWithContent, AnthropicProvider, AnthropicTool,
    ContentBlock, MessageContent,
};

// Provider implementations
pub use azure::AzureProvider;
pub use gemini::GeminiProvider;
pub use ollama::OllamaProvider;
pub use openai::OpenAiProvider;
pub use openai_compat::OpenAiCompatProvider;

// Common provider types
pub use provider::{
    get_shell_system_prompt, strip_markdown, AiModel, AiProvider, CommandAlternative,
    CompletionRequest, CompletionResponse, ShellCommandResponse, SHELL_COMMAND_JSON_SCHEMA,
};

// Settings
pub use settings::{AiProviderType, AiSettings};

use std::sync::Arc;

/// Create an AI provider based on settings
pub fn create_provider(settings: &AiSettings) -> Arc<dyn AiProvider> {
    let api_key = settings.api_key.as_deref().unwrap_or("");

    match settings.provider {
        AiProviderType::Ollama => Arc::new(OllamaProvider::new(
            &settings.endpoint_url,
            &settings.model_name,
        )),
        AiProviderType::OpenAi => Arc::new(OpenAiProvider::new(
            api_key,
            &settings.model_name,
            &settings.endpoint_url,
        )),
        AiProviderType::Anthropic => Arc::new(AnthropicProvider::new(
            api_key,
            &settings.model_name,
        )),
        AiProviderType::AzureOpenAi => Arc::new(AzureProvider::new(
            api_key,
            &settings.model_name,
            &settings.endpoint_url,
            settings.api_version.as_deref(),
        )),
        AiProviderType::Groq => Arc::new(OpenAiCompatProvider::new(
            AiProviderType::Groq,
            api_key,
            &settings.model_name,
            &settings.endpoint_url,
            openai_compat::groq_models(),
        )),
        AiProviderType::Gemini => Arc::new(GeminiProvider::new(
            api_key,
            &settings.model_name,
            &settings.endpoint_url,
        )),
        AiProviderType::DeepSeek => Arc::new(OpenAiCompatProvider::new(
            AiProviderType::DeepSeek,
            api_key,
            &settings.model_name,
            &settings.endpoint_url,
            openai_compat::deepseek_models(),
        )),
        AiProviderType::Mistral => Arc::new(OpenAiCompatProvider::new(
            AiProviderType::Mistral,
            api_key,
            &settings.model_name,
            &settings.endpoint_url,
            openai_compat::mistral_models(),
        )),
    }
}
