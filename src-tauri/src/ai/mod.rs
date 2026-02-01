//! AI Provider Module
//!
//! This module provides a multi-provider AI abstraction for shell command suggestions.
//! Supports Ollama (local), OpenAI, and Anthropic.

mod anthropic;
mod ollama;
mod openai;
mod provider;
mod settings;

// Anthropic-specific types (for backward compatibility)
pub use anthropic::{
    AnthropicContentBlock, AnthropicMessageWithContent, AnthropicProvider, AnthropicTool,
    ContentBlock, MessageContent,
};

// Provider implementations
pub use ollama::OllamaProvider;
pub use openai::OpenAiProvider;

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
    match settings.provider {
        AiProviderType::Ollama => Arc::new(OllamaProvider::new(
            &settings.endpoint_url,
            &settings.model_name,
        )),
        AiProviderType::OpenAi => Arc::new(OpenAiProvider::new(
            settings.api_key.as_deref().unwrap_or(""),
            &settings.model_name,
            &settings.endpoint_url,
        )),
        AiProviderType::Anthropic => Arc::new(AnthropicProvider::new(
            settings.api_key.as_deref().unwrap_or(""),
            &settings.model_name,
        )),
    }
}
