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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_ai_settings() {
        let settings = AiSettings::default();
        assert_eq!(settings.provider, AiProviderType::Ollama);
        assert!(settings.api_key.is_none());
        assert_eq!(settings.model_name, "llama3.2");
        assert_eq!(settings.endpoint_url, "http://localhost:11434");
        assert!((settings.temperature - 0.3).abs() < f32::EPSILON);
        assert_eq!(settings.max_tokens, 256);
        assert!(settings.memory_enabled);
        assert!(settings.summary_model.is_none());
        assert_eq!(settings.summary_max_tokens, 100);
        assert!(settings.api_version.is_none());
    }

    #[test]
    fn test_default_ai_provider_type() {
        let provider = AiProviderType::default();
        assert_eq!(provider, AiProviderType::Ollama);
    }

    #[test]
    fn test_provider_display() {
        assert_eq!(format!("{}", AiProviderType::Ollama), "ollama");
        assert_eq!(format!("{}", AiProviderType::OpenAi), "openai");
        assert_eq!(format!("{}", AiProviderType::Anthropic), "anthropic");
        assert_eq!(format!("{}", AiProviderType::AzureOpenAi), "azure_openai");
        assert_eq!(format!("{}", AiProviderType::Groq), "groq");
        assert_eq!(format!("{}", AiProviderType::Gemini), "gemini");
        assert_eq!(format!("{}", AiProviderType::DeepSeek), "deepseek");
        assert_eq!(format!("{}", AiProviderType::Mistral), "mistral");
    }

    #[test]
    fn test_provider_to_str() {
        let settings = AiSettings { provider: AiProviderType::OpenAi, ..AiSettings::default() };
        assert_eq!(settings.provider_to_str(), "openai");

        let settings = AiSettings { provider: AiProviderType::Anthropic, ..AiSettings::default() };
        assert_eq!(settings.provider_to_str(), "anthropic");

        let settings = AiSettings { provider: AiProviderType::AzureOpenAi, ..AiSettings::default() };
        assert_eq!(settings.provider_to_str(), "azure_openai");
    }

    #[test]
    fn test_str_to_provider() {
        assert_eq!(AiSettings::str_to_provider("ollama"), AiProviderType::Ollama);
        assert_eq!(AiSettings::str_to_provider("openai"), AiProviderType::OpenAi);
        assert_eq!(AiSettings::str_to_provider("anthropic"), AiProviderType::Anthropic);
        assert_eq!(AiSettings::str_to_provider("azure_openai"), AiProviderType::AzureOpenAi);
        assert_eq!(AiSettings::str_to_provider("groq"), AiProviderType::Groq);
        assert_eq!(AiSettings::str_to_provider("gemini"), AiProviderType::Gemini);
        assert_eq!(AiSettings::str_to_provider("deepseek"), AiProviderType::DeepSeek);
        assert_eq!(AiSettings::str_to_provider("mistral"), AiProviderType::Mistral);
    }

    #[test]
    fn test_str_to_provider_unknown_defaults_to_ollama() {
        assert_eq!(AiSettings::str_to_provider("unknown"), AiProviderType::Ollama);
        assert_eq!(AiSettings::str_to_provider(""), AiProviderType::Ollama);
        assert_eq!(AiSettings::str_to_provider("OPENAI"), AiProviderType::Ollama);
    }

    #[test]
    fn test_provider_to_str_roundtrip() {
        let providers = vec![
            AiProviderType::Ollama,
            AiProviderType::OpenAi,
            AiProviderType::Anthropic,
            AiProviderType::AzureOpenAi,
            AiProviderType::Groq,
            AiProviderType::Gemini,
            AiProviderType::DeepSeek,
            AiProviderType::Mistral,
        ];

        for provider in providers {
            let settings = AiSettings { provider, ..AiSettings::default() };
            let str_val = settings.provider_to_str();
            let roundtripped = AiSettings::str_to_provider(str_val);
            assert_eq!(provider, roundtripped);
        }
    }

    #[test]
    fn test_get_effective_summary_model_with_configured() {
        let settings = AiSettings {
            summary_model: Some("custom-model".to_string()),
            ..AiSettings::default()
        };
        assert_eq!(settings.get_effective_summary_model(), "custom-model");
    }

    #[test]
    fn test_get_effective_summary_model_defaults() {
        let mut settings = AiSettings::default();

        settings.provider = AiProviderType::Anthropic;
        assert_eq!(settings.get_effective_summary_model(), "claude-3-haiku-20240307");

        settings.provider = AiProviderType::OpenAi;
        assert_eq!(settings.get_effective_summary_model(), "gpt-4o-mini");

        settings.provider = AiProviderType::AzureOpenAi;
        assert_eq!(settings.get_effective_summary_model(), "gpt-4o-mini");

        settings.provider = AiProviderType::Ollama;
        assert_eq!(settings.get_effective_summary_model(), "llama3.2:1b");

        settings.provider = AiProviderType::Groq;
        assert_eq!(settings.get_effective_summary_model(), "llama-3.1-8b-instant");

        settings.provider = AiProviderType::Gemini;
        assert_eq!(settings.get_effective_summary_model(), "gemini-2.0-flash-lite");

        settings.provider = AiProviderType::DeepSeek;
        assert_eq!(settings.get_effective_summary_model(), "deepseek-chat");

        settings.provider = AiProviderType::Mistral;
        assert_eq!(settings.get_effective_summary_model(), "mistral-small-latest");
    }

    #[test]
    fn test_provider_serialization() {
        let json = serde_json::to_string(&AiProviderType::Ollama).unwrap();
        assert_eq!(json, "\"ollama\"");

        let provider: AiProviderType = serde_json::from_str("\"openai\"").unwrap();
        assert_eq!(provider, AiProviderType::OpenAi);

        let provider: AiProviderType = serde_json::from_str("\"azure_openai\"").unwrap();
        assert_eq!(provider, AiProviderType::AzureOpenAi);
    }

    #[test]
    fn test_settings_serialization_roundtrip() {
        let settings = AiSettings {
            provider: AiProviderType::OpenAi,
            api_key: Some("sk-test-key".to_string()),
            model_name: "gpt-4o".to_string(),
            endpoint_url: "https://api.openai.com".to_string(),
            temperature: 0.7,
            max_tokens: 1024,
            memory_enabled: true,
            summary_model: Some("gpt-4o-mini".to_string()),
            summary_max_tokens: 200,
            api_version: None,
        };

        let json = serde_json::to_string(&settings).unwrap();
        let deserialized: AiSettings = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.provider, AiProviderType::OpenAi);
        assert_eq!(deserialized.api_key.as_deref(), Some("sk-test-key"));
        assert_eq!(deserialized.model_name, "gpt-4o");
        assert_eq!(deserialized.max_tokens, 1024);
        assert!(deserialized.memory_enabled);
    }
}
