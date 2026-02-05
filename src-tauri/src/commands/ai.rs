use serde::{Deserialize, Serialize};
use tauri::State;
use tracing::info;

use crate::ai::{
    create_provider, get_shell_system_prompt, AiModel, AiProviderType, AiSettings,
    CompletionRequest, OllamaProvider, ShellCommandResponse,
};
use crate::database::{get_ai_settings, upsert_ai_settings};
use crate::AppState;

/// Get the default endpoint URL for a provider
fn default_endpoint(provider: AiProviderType) -> String {
    match provider {
        AiProviderType::Ollama => "http://localhost:11434".to_string(),
        AiProviderType::OpenAi => "https://api.openai.com".to_string(),
        AiProviderType::Anthropic => "https://api.anthropic.com".to_string(),
        AiProviderType::AzureOpenAi => String::new(), // user must provide
        AiProviderType::Groq => "https://api.groq.com/openai".to_string(),
        AiProviderType::Gemini => "https://generativelanguage.googleapis.com".to_string(),
        AiProviderType::DeepSeek => "https://api.deepseek.com".to_string(),
        AiProviderType::Mistral => "https://api.mistral.ai".to_string(),
    }
}

/// Response for AI settings
#[derive(Debug, Serialize)]
pub struct AiSettingsResponse {
    pub provider: String,
    pub api_key: Option<String>,
    pub model_name: String,
    pub endpoint_url: String,
    pub temperature: f32,
    pub max_tokens: i32,
    pub memory_enabled: bool,
    pub summary_model: Option<String>,
    pub summary_max_tokens: i32,
    pub api_version: Option<String>,
}

impl From<AiSettings> for AiSettingsResponse {
    fn from(settings: AiSettings) -> Self {
        Self {
            provider: settings.provider.to_string(),
            api_key: settings.api_key,
            model_name: settings.model_name,
            endpoint_url: settings.endpoint_url,
            temperature: settings.temperature,
            max_tokens: settings.max_tokens,
            memory_enabled: settings.memory_enabled,
            summary_model: settings.summary_model,
            summary_max_tokens: settings.summary_max_tokens,
            api_version: settings.api_version,
        }
    }
}

/// Request to update AI settings
#[derive(Debug, Deserialize)]
pub struct UpdateAiSettingsRequest {
    pub provider: String,
    pub api_key: Option<String>,
    pub model_name: String,
    pub endpoint_url: String,
    pub temperature: f32,
    pub max_tokens: i32,
    pub memory_enabled: bool,
    pub summary_model: Option<String>,
    pub summary_max_tokens: i32,
    pub api_version: Option<String>,
}

impl From<UpdateAiSettingsRequest> for AiSettings {
    fn from(req: UpdateAiSettingsRequest) -> Self {
        Self {
            provider: AiSettings::str_to_provider(&req.provider),
            api_key: req.api_key,
            model_name: req.model_name,
            endpoint_url: req.endpoint_url,
            temperature: req.temperature,
            max_tokens: req.max_tokens,
            memory_enabled: req.memory_enabled,
            summary_model: req.summary_model,
            summary_max_tokens: req.summary_max_tokens,
            api_version: req.api_version,
        }
    }
}

/// Request for shell suggestion
#[derive(Debug, Deserialize)]
pub struct ShellSuggestionRequest {
    pub query: String,
    pub context: Option<String>,
    pub os: Option<String>,
    pub shell: Option<String>,
}

/// Get current AI settings
#[tauri::command]
pub async fn get_ai_settings_cmd(state: State<'_, AppState>) -> Result<AiSettingsResponse, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let settings = get_ai_settings(&db).map_err(|e| format!("Database error: {}", e))?;
    Ok(settings.into())
}

/// Update AI settings
#[tauri::command]
pub async fn update_ai_settings_cmd(
    request: UpdateAiSettingsRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    info!("Updating AI settings: provider={}", request.provider);

    let settings: AiSettings = request.into();
    let db = state.db.lock().map_err(|e| e.to_string())?;
    upsert_ai_settings(&db, &settings).map_err(|e| format!("Database error: {}", e))?;

    Ok(())
}

/// List available AI models for the current provider
#[tauri::command]
pub async fn list_ai_models(state: State<'_, AppState>) -> Result<Vec<AiModel>, String> {
    let settings = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        get_ai_settings(&db).map_err(|e| format!("Database error: {}", e))?
    };

    let provider = create_provider(&settings);
    provider.list_models().await
}

/// List available AI models for a specific provider (for settings UI)
#[tauri::command]
pub async fn list_models_for_provider(
    provider_type: String,
    api_key: Option<String>,
    endpoint_url: Option<String>,
    api_version: Option<String>,
) -> Result<Vec<AiModel>, String> {
    let provider_enum = AiSettings::str_to_provider(&provider_type);

    let settings = AiSettings {
        provider: provider_enum,
        api_key,
        model_name: String::new(),
        endpoint_url: endpoint_url.unwrap_or_else(|| default_endpoint(provider_enum)),
        temperature: 0.3,
        max_tokens: 256,
        memory_enabled: true,
        summary_model: None,
        summary_max_tokens: 100,
        api_version,
    };

    let provider = create_provider(&settings);
    provider.list_models().await
}

/// Test AI connection
#[tauri::command]
pub async fn test_ai_connection(state: State<'_, AppState>) -> Result<(), String> {
    let settings = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        get_ai_settings(&db).map_err(|e| format!("Database error: {}", e))?
    };

    info!("Testing AI connection for provider: {}", settings.provider);

    let provider = create_provider(&settings);
    provider.test_connection().await
}

/// Test connection with specific settings (for settings UI)
#[tauri::command]
pub async fn test_ai_connection_with_settings(
    provider_type: String,
    api_key: Option<String>,
    endpoint_url: Option<String>,
    api_version: Option<String>,
) -> Result<(), String> {
    let provider_enum = AiSettings::str_to_provider(&provider_type);

    info!("Testing AI connection for provider: {}", provider_enum);

    let settings = AiSettings {
        provider: provider_enum,
        api_key,
        model_name: String::new(),
        endpoint_url: endpoint_url.unwrap_or_else(|| default_endpoint(provider_enum)),
        temperature: 0.3,
        max_tokens: 256,
        memory_enabled: true,
        summary_model: None,
        summary_max_tokens: 100,
        api_version,
    };

    let provider = create_provider(&settings);
    provider.test_connection().await
}

/// Get a shell command suggestion from the AI
#[tauri::command]
pub async fn get_shell_suggestion(
    request: ShellSuggestionRequest,
    state: State<'_, AppState>,
) -> Result<ShellCommandResponse, String> {
    let settings = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        get_ai_settings(&db).map_err(|e| format!("Database error: {}", e))?
    };

    info!(
        "Getting shell suggestion from {}: {}",
        settings.provider, request.query
    );

    let provider = create_provider(&settings);

    // Check if provider is available
    if !provider.is_available().await {
        return Err(format!(
            "{} is not available. Please check your settings.",
            settings.provider
        ));
    }

    let os = request.os.as_deref().unwrap_or("linux");
    let shell = request.shell.as_deref().unwrap_or("bash");

    // Use JSON mode for structured responses
    let system_prompt = get_shell_system_prompt(os, shell, true);

    let user_prompt = if let Some(ctx) = &request.context {
        format!(
            "Recent terminal output:\n```\n{}\n```\n\nUser request: {}",
            ctx, request.query
        )
    } else {
        format!("User request: {}", request.query)
    };

    let completion_request = CompletionRequest {
        prompt: user_prompt,
        system_prompt: Some(system_prompt),
        context: request.context,
        temperature: Some(settings.temperature),
        max_tokens: Some(settings.max_tokens),
        json_mode: true,
    };

    let response = provider.get_completion(completion_request).await?;

    // Return structured response if available, otherwise try to parse from content
    if let Some(structured) = response.structured {
        Ok(structured)
    } else {
        // Fallback: try to parse JSON from content
        serde_json::from_str::<ShellCommandResponse>(&response.content)
            .map_err(|e| format!("Failed to parse AI response as JSON: {}. Raw response: {}", e, response.content))
    }
}

/// Pull/download a model from Ollama
#[tauri::command]
pub async fn pull_ollama_model(
    model_name: String,
    endpoint_url: Option<String>,
) -> Result<String, String> {
    let url = endpoint_url.unwrap_or_else(|| "http://localhost:11434".to_string());

    info!("Pulling Ollama model: {} from {}", model_name, url);

    let provider = OllamaProvider::new(&url, &model_name);
    provider.pull_model(&model_name).await
}

/// Delete a model from Ollama
#[tauri::command]
pub async fn delete_ollama_model(
    model_name: String,
    endpoint_url: Option<String>,
) -> Result<(), String> {
    let url = endpoint_url.unwrap_or_else(|| "http://localhost:11434".to_string());

    info!("Deleting Ollama model: {} from {}", model_name, url);

    let provider = OllamaProvider::new(&url, &model_name);
    provider.delete_model(&model_name).await
}
