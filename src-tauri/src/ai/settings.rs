use serde::{Deserialize, Serialize};

/// AI provider type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiProviderType {
    Ollama,
    OpenAi,
    Anthropic,
}

impl Default for AiProviderType {
    fn default() -> Self {
        Self::Ollama
    }
}

impl std::fmt::Display for AiProviderType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Ollama => write!(f, "ollama"),
            Self::OpenAi => write!(f, "openai"),
            Self::Anthropic => write!(f, "anthropic"),
        }
    }
}

/// AI settings stored in the database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiSettings {
    pub provider: AiProviderType,
    pub api_key: Option<String>,
    pub model_name: String,
    pub endpoint_url: String,
    pub temperature: f32,
    pub max_tokens: i32,
    /// Enable conversation memory via summarization
    pub memory_enabled: bool,
    /// Model to use for summarizing exchanges (e.g., "claude-3-haiku", "gpt-4o-mini")
    /// If None, uses a smaller/cheaper model from the same provider
    pub summary_model: Option<String>,
    /// Max tokens for each summary (default: 100)
    pub summary_max_tokens: i32,
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            provider: AiProviderType::Ollama,
            api_key: None,
            model_name: "llama3.2".to_string(),
            endpoint_url: "http://localhost:11434".to_string(),
            temperature: 0.3,
            max_tokens: 256,
            memory_enabled: true,
            summary_model: None,
            summary_max_tokens: 100,
        }
    }
}

impl AiSettings {
    /// Convert provider type to database string
    pub fn provider_to_str(&self) -> &'static str {
        match self.provider {
            AiProviderType::Ollama => "ollama",
            AiProviderType::OpenAi => "openai",
            AiProviderType::Anthropic => "anthropic",
        }
    }

    /// Convert database string to provider type
    pub fn str_to_provider(s: &str) -> AiProviderType {
        match s {
            "openai" => AiProviderType::OpenAi,
            "anthropic" => AiProviderType::Anthropic,
            _ => AiProviderType::Ollama,
        }
    }

    /// Get the effective summary model name
    /// Returns the configured summary_model if set, otherwise returns a default
    /// smaller/cheaper model for the current provider
    pub fn get_effective_summary_model(&self) -> String {
        if let Some(ref model) = self.summary_model {
            return model.clone();
        }
        // Default summary models per provider (smaller, faster models)
        match self.provider {
            AiProviderType::Anthropic => "claude-3-haiku-20240307".to_string(),
            AiProviderType::OpenAi => "gpt-4o-mini".to_string(),
            AiProviderType::Ollama => {
                // For Ollama, use a small model if available, otherwise use the main model
                "llama3.2:1b".to_string()
            }
        }
    }
}
