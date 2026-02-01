use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::settings::AiProviderType;

/// Structured shell command response from AI
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellCommandResponse {
    pub command: String,
    pub explanation: String,
    pub is_dangerous: bool,
    pub requires_sudo: bool,
    pub affects_files: Vec<String>,
    pub alternatives: Vec<CommandAlternative>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

/// Alternative command suggestion
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandAlternative {
    pub command: String,
    pub description: String,
}

/// AI model information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiModel {
    pub id: String,
    pub name: String,
    pub provider: AiProviderType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameter_size: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quantization_level: Option<String>,
}

/// Request for AI completion
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionRequest {
    pub prompt: String,
    pub system_prompt: Option<String>,
    pub context: Option<String>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<i32>,
    /// Enable structured JSON output mode
    #[serde(default)]
    pub json_mode: bool,
}

/// Response from AI completion
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionResponse {
    pub content: String,
    pub tokens_used: Option<i32>,
    /// Parsed structured response (when json_mode is enabled)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub structured: Option<ShellCommandResponse>,
}

/// Trait for AI providers
#[async_trait]
pub trait AiProvider: Send + Sync {
    /// Get the provider type
    fn provider_type(&self) -> AiProviderType;

    /// Get a completion from the AI
    async fn get_completion(&self, request: CompletionRequest) -> Result<CompletionResponse, String>;

    /// List available models
    async fn list_models(&self) -> Result<Vec<AiModel>, String>;

    /// Check if the provider is available
    async fn is_available(&self) -> bool;

    /// Test the connection to the provider
    async fn test_connection(&self) -> Result<(), String>;
}

/// JSON schema for shell command responses (used in prompts and Ollama format)
pub const SHELL_COMMAND_JSON_SCHEMA: &str = r#"{
  "type": "object",
  "properties": {
    "command": { "type": "string", "description": "The shell command to execute" },
    "explanation": { "type": "string", "description": "What the command does" },
    "is_dangerous": { "type": "boolean", "description": "Could cause data loss or system damage" },
    "requires_sudo": { "type": "boolean", "description": "Needs elevated privileges" },
    "affects_files": { "type": "array", "items": { "type": "string" }, "description": "Files/directories that will be modified" },
    "alternatives": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "command": { "type": "string" },
          "description": { "type": "string" }
        },
        "required": ["command", "description"]
      }
    },
    "warning": { "type": "string", "description": "Optional warning for dangerous commands" }
  },
  "required": ["command", "explanation", "is_dangerous", "requires_sudo", "affects_files", "alternatives"]
}"#;

/// Get the system prompt for shell command suggestions
pub fn get_shell_system_prompt(os: &str, shell: &str, json_mode: bool) -> String {
    if json_mode {
        format!(
            r#"You are a shell command assistant for {} using {}.

You MUST respond with valid JSON matching this exact schema:
{}

Rules:
- Always respond with valid JSON only, no other text
- Set is_dangerous=true for commands that delete files, modify system configs, or could cause data loss
- Set requires_sudo=true if the command needs root/admin privileges
- List all files/directories that will be created, modified, or deleted in affects_files
- Provide 1-2 alternatives when available (different flags, tools, or approaches)
- Add a warning message for dangerous operations (null if not dangerous)

Example response:
{{
  "command": "rm -rf ./temp/",
  "explanation": "Recursively deletes the temp directory and all contents",
  "is_dangerous": true,
  "requires_sudo": false,
  "affects_files": ["./temp/"],
  "alternatives": [
    {{"command": "rm -ri ./temp/", "description": "Interactive mode, prompts before each deletion"}}
  ],
  "warning": "This will permanently delete all files in ./temp/"
}}"#,
            os, shell, SHELL_COMMAND_JSON_SCHEMA
        )
    } else {
        format!(
            r#"You are a shell command assistant for {} using {}.

CRITICAL: Output ONLY the raw command. NO markdown, NO backticks, NO code blocks, NO explanations.

Examples of CORRECT output:
docker logs -n 100 container-name
ls -la /var/log

Examples of WRONG output:
`docker logs -n 100 container-name`
```bash
docker logs -n 100 container-name
```

Rules:
- Output the command directly, ready to paste into terminal
- If multiple commands needed, separate with &&
- For dangerous commands, prefix with # WARNING:"#,
            os, shell
        )
    }
}

/// Strip markdown formatting from AI output
pub fn strip_markdown(text: &str) -> String {
    let mut result = text.trim().to_string();

    // Remove code blocks: ```bash\n...\n``` or ```\n...\n```
    if result.starts_with("```") {
        if let Some(end_idx) = result[3..].find("```") {
            let inner = &result[3..3 + end_idx];
            // Skip the language identifier line if present
            result = if let Some(newline_idx) = inner.find('\n') {
                inner[newline_idx + 1..].trim().to_string()
            } else {
                inner.trim().to_string()
            };
        }
    }

    // Remove inline backticks: `command`
    if result.starts_with('`') && result.ends_with('`') && result.len() > 2 {
        result = result[1..result.len() - 1].to_string();
    }

    result.trim().to_string()
}
