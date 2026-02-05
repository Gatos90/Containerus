use serde::{Deserialize, Serialize};

/// AI provider type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AiProviderType {
    #[serde(rename = "ollama")]
    Ollama,
    #[serde(rename = "openai")]
    OpenAi,
    #[serde(rename = "anthropic")]
    Anthropic,
    #[serde(rename = "azure_openai")]
    AzureOpenAi,
    #[serde(rename = "groq")]
    Groq,
    #[serde(rename = "gemini")]
    Gemini,
    #[serde(rename = "deepseek")]
    DeepSeek,
    #[serde(rename = "mistral")]
    Mistral,
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
            Self::AzureOpenAi => write!(f, "azure_openai"),
            Self::Groq => write!(f, "groq"),
            Self::Gemini => write!(f, "gemini"),
            Self::DeepSeek => write!(f, "deepseek"),
            Self::Mistral => write!(f, "mistral"),
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
    /// API version for Azure OpenAI (e.g., "2024-10-21")
    pub api_version: Option<String>,
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
            api_version: None,
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
            AiProviderType::AzureOpenAi => "azure_openai",
            AiProviderType::Groq => "groq",
            AiProviderType::Gemini => "gemini",
            AiProviderType::DeepSeek => "deepseek",
            AiProviderType::Mistral => "mistral",
        }
    }

    /// Convert database string to provider type
    pub fn str_to_provider(s: &str) -> AiProviderType {
        match s {
            "openai" => AiProviderType::OpenAi,
            "anthropic" => AiProviderType::Anthropic,
            "azure_openai" => AiProviderType::AzureOpenAi,
            "groq" => AiProviderType::Groq,
            "gemini" => AiProviderType::Gemini,
            "deepseek" => AiProviderType::DeepSeek,
            "mistral" => AiProviderType::Mistral,
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
            AiProviderType::OpenAi | AiProviderType::AzureOpenAi => "gpt-4o-mini".to_string(),
            AiProviderType::Ollama => "llama3.2:1b".to_string(),
            AiProviderType::Groq => "llama-3.1-8b-instant".to_string(),
            AiProviderType::Gemini => "gemini-2.0-flash-lite".to_string(),
            AiProviderType::DeepSeek => "deepseek-chat".to_string(),
            AiProviderType::Mistral => "mistral-small-latest".to_string(),
        }
    }
}
