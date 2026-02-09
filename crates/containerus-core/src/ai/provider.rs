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

#[cfg(test)]
mod tests {
    use super::*;

    // === strip_markdown tests ===

    #[test]
    fn test_strip_markdown_plain_text() {
        assert_eq!(strip_markdown("docker ps -a"), "docker ps -a");
    }

    #[test]
    fn test_strip_markdown_inline_backticks() {
        assert_eq!(strip_markdown("`docker ps -a`"), "docker ps -a");
    }

    #[test]
    fn test_strip_markdown_code_block_with_lang() {
        let input = "```bash\ndocker ps -a\n```";
        assert_eq!(strip_markdown(input), "docker ps -a");
    }

    #[test]
    fn test_strip_markdown_code_block_without_lang() {
        let input = "```\ndocker ps -a\n```";
        assert_eq!(strip_markdown(input), "docker ps -a");
    }

    #[test]
    fn test_strip_markdown_trims_whitespace() {
        assert_eq!(strip_markdown("  docker ps  "), "docker ps");
    }

    #[test]
    fn test_strip_markdown_single_backtick_not_stripped() {
        // Single backtick character is kept (len <= 2)
        assert_eq!(strip_markdown("`"), "`");
    }

    // === get_shell_system_prompt tests ===

    #[test]
    fn test_get_shell_system_prompt_json_mode() {
        let prompt = get_shell_system_prompt("macOS", "zsh", true);
        assert!(prompt.contains("macOS"));
        assert!(prompt.contains("zsh"));
        assert!(prompt.contains("JSON"));
        assert!(prompt.contains(SHELL_COMMAND_JSON_SCHEMA));
    }

    #[test]
    fn test_get_shell_system_prompt_plain_mode() {
        let prompt = get_shell_system_prompt("Linux", "bash", false);
        assert!(prompt.contains("Linux"));
        assert!(prompt.contains("bash"));
        assert!(prompt.contains("ONLY the raw command"));
        assert!(!prompt.contains(SHELL_COMMAND_JSON_SCHEMA));
    }

    // === Struct serialization tests ===

    #[test]
    fn test_shell_command_response_serialization() {
        let response = ShellCommandResponse {
            command: "docker ps".to_string(),
            explanation: "List containers".to_string(),
            is_dangerous: false,
            requires_sudo: false,
            affects_files: vec![],
            alternatives: vec![CommandAlternative {
                command: "docker container ls".to_string(),
                description: "Alias".to_string(),
            }],
            warning: None,
        };

        let json = serde_json::to_value(&response).unwrap();
        assert_eq!(json["command"], "docker ps");
        assert_eq!(json["is_dangerous"], false);
        assert!(json.get("warning").is_none() || json["warning"].is_null());

        // Roundtrip
        let deserialized: ShellCommandResponse = serde_json::from_value(json).unwrap();
        assert_eq!(deserialized.command, "docker ps");
        assert_eq!(deserialized.alternatives.len(), 1);
    }

    #[test]
    fn test_shell_command_response_with_warning() {
        let response = ShellCommandResponse {
            command: "rm -rf /tmp".to_string(),
            explanation: "Delete tmp".to_string(),
            is_dangerous: true,
            requires_sudo: false,
            affects_files: vec!["/tmp".to_string()],
            alternatives: vec![],
            warning: Some("This will delete all files in /tmp".to_string()),
        };

        let json = serde_json::to_value(&response).unwrap();
        assert_eq!(json["is_dangerous"], true);
        assert!(json["warning"].is_string());
    }

    #[test]
    fn test_ai_model_serialization() {
        let model = AiModel {
            id: "gpt-4o".to_string(),
            name: "GPT-4o".to_string(),
            provider: AiProviderType::OpenAi,
            context_window: Some(128000),
            parameter_size: None,
            quantization_level: None,
        };

        let json = serde_json::to_value(&model).unwrap();
        assert_eq!(json["id"], "gpt-4o");
        assert_eq!(json["context_window"], 128000);
        // Optional None fields should be skipped
        assert!(json.get("parameter_size").is_none() || json["parameter_size"].is_null());
    }

    #[test]
    fn test_completion_request_serialization() {
        let request = CompletionRequest {
            prompt: "list containers".to_string(),
            system_prompt: Some("You are helpful".to_string()),
            context: None,
            temperature: Some(0.7),
            max_tokens: Some(1024),
            json_mode: true,
        };

        let json = serde_json::to_value(&request).unwrap();
        assert_eq!(json["prompt"], "list containers");
        assert_eq!(json["json_mode"], true);
        // f32 -> f64 conversion may have precision loss; check approximately
        assert!(json["temperature"].as_f64().unwrap() > 0.69 && json["temperature"].as_f64().unwrap() < 0.71);
    }

    #[test]
    fn test_completion_response_serialization() {
        let response = CompletionResponse {
            content: "docker ps -a".to_string(),
            tokens_used: Some(42),
            structured: None,
        };

        let json = serde_json::to_value(&response).unwrap();
        assert_eq!(json["content"], "docker ps -a");
        assert_eq!(json["tokens_used"], 42);
    }

    #[test]
    fn test_json_schema_is_valid_json() {
        let parsed: serde_json::Value = serde_json::from_str(SHELL_COMMAND_JSON_SCHEMA).unwrap();
        assert_eq!(parsed["type"], "object");
        assert!(parsed["properties"]["command"].is_object());
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
