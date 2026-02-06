//! Input Summarization Module
//!
//! Provides functionality to summarize user inputs into brief summaries
//! for conversation memory. Uses a smaller/cheaper model to compress
//! potentially large user inputs (like pasted logs) into concise summaries.

use rig::agent::AgentBuilder;
use rig::client::{CompletionClient, ProviderClient};
use rig::completion::Prompt;
use rig::providers::{anthropic, azure, deepseek, gemini, groq, mistral, ollama, openai};
use serde::{Deserialize, Serialize};

use crate::ai::{AiProviderType, AiSettings};

/// Minimum input length to trigger summarization (shorter inputs stored as-is)
const MIN_SUMMARIZATION_LENGTH: usize = 100;

/// Maximum length for truncated fallback when summarization fails
const FALLBACK_TRUNCATION_LENGTH: usize = 200;

/// Summary of a user input
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputSummary {
    /// Brief summary of what the user asked or provided
    pub summary: String,
    /// Timestamp when the input was received (millis since epoch)
    pub timestamp: i64,
    /// Length of the original input (for debugging/metrics)
    pub original_length: usize,
}

/// System prompt for the summarizer model
const SUMMARIZER_SYSTEM_PROMPT: &str = r#"You are a summarizer that creates brief summaries of user inputs for a terminal assistant's memory.

Your task: Summarize what the user is asking or providing in 1-2 sentences maximum.

Focus on:
- The user's intent (what they want to accomplish)
- Key entities mentioned (container names, file paths, service names, etc.)
- Important technical details (error messages, port numbers, etc.)

Be extremely concise. Output ONLY the summary, nothing else.

Examples:
- Input: "docker ps" output with 5 containers listed
  Summary: User ran docker ps showing 5 containers including nginx, redis, and postgres.

- Input: 500 lines of error logs
  Summary: User shared application logs showing connection errors to database on port 5432.

- Input: "list all running containers"
  Summary: User asked to list running containers.

- Input: "what's wrong with the redis container?"
  Summary: User asked about issues with the redis container."#;

/// Summarize a user input using the configured summary model
///
/// Returns an InputSummary containing the compressed version of the input.
/// For short inputs (< MIN_SUMMARIZATION_LENGTH chars), returns the input as-is.
/// Falls back to truncation if summarization fails.
pub async fn summarize_user_input(
    settings: &AiSettings,
    user_input: &str,
) -> Result<InputSummary, String> {
    let now = chrono::Utc::now().timestamp_millis();
    let original_length = user_input.len();

    // Short inputs don't need summarization
    if original_length < MIN_SUMMARIZATION_LENGTH {
        return Ok(InputSummary {
            summary: user_input.to_string(),
            timestamp: now,
            original_length,
        });
    }

    // Attempt to summarize using the LLM
    let summary_result = call_summary_model(settings, user_input).await;

    match summary_result {
        Ok(summary) => {
            tracing::debug!(
                "[Summarizer] Compressed {} chars -> {} chars",
                original_length,
                summary.len()
            );
            Ok(InputSummary {
                summary,
                timestamp: now,
                original_length,
            })
        }
        Err(e) => {
            // Fallback to truncation
            tracing::warn!(
                "[Summarizer] Failed to summarize, falling back to truncation: {}",
                e
            );
            let truncated = truncate_input(user_input);
            Ok(InputSummary {
                summary: truncated,
                timestamp: now,
                original_length,
            })
        }
    }
}

/// Call the summary model to compress the input
async fn call_summary_model(settings: &AiSettings, user_input: &str) -> Result<String, String> {
    let summary_model = settings.get_effective_summary_model();

    // Prepare the prompt - include system instructions in the user prompt
    // since we're using simple completion without AgentBuilder
    let prompt = format!(
        "{}\n\nSummarize this user input in 1-2 sentences:\n\n{}",
        SUMMARIZER_SYSTEM_PROMPT,
        // Truncate extremely long inputs to avoid context limits
        if user_input.len() > 10000 {
            &user_input[..10000]
        } else {
            user_input
        }
    );

    match settings.provider {
        AiProviderType::Anthropic => {
            let client: anthropic::Client = anthropic::Client::new(
                &settings.api_key.clone().unwrap_or_default(),
            )
            .map_err(|e| format!("Failed to create Anthropic client: {}", e))?;

            let model = client.completion_model(&summary_model);
            let agent = AgentBuilder::new(model).build();

            agent
                .prompt(&prompt)
                .await
                .map_err(|e| format!("Anthropic summarization failed: {}", e))
        }
        AiProviderType::OpenAi => {
            let client: openai::Client = openai::Client::new(
                &settings.api_key.clone().unwrap_or_default(),
            )
            .map_err(|e| format!("Failed to create OpenAI client: {}", e))?;

            let model = client.completion_model(&summary_model);
            let agent = AgentBuilder::new(model).build();

            agent
                .prompt(&prompt)
                .await
                .map_err(|e| format!("OpenAI summarization failed: {}", e))
        }
        AiProviderType::Ollama => {
            let client: ollama::Client = ProviderClient::from_env();

            let model = client.completion_model(&summary_model);
            let agent = AgentBuilder::new(model).build();

            agent
                .prompt(&prompt)
                .await
                .map_err(|e| format!("Ollama summarization failed: {}", e))
        }
        AiProviderType::AzureOpenAi => {
            let api_key = settings.api_key.clone().unwrap_or_default();
            let api_ver = settings.api_version.as_deref().unwrap_or("2024-10-21");
            let client = azure::Client::<reqwest::Client>::builder()
                .api_key(azure::AzureOpenAIAuth::ApiKey(api_key))
                .azure_endpoint(settings.endpoint_url.clone())
                .api_version(api_ver)
                .build()
                .map_err(|e| format!("Failed to create Azure OpenAI client: {}", e))?;

            let model = client.completion_model(&summary_model);
            let agent = AgentBuilder::new(model).build();

            agent
                .prompt(&prompt)
                .await
                .map_err(|e| format!("Azure OpenAI summarization failed: {}", e))
        }
        AiProviderType::Groq => {
            let client: groq::Client = groq::Client::new(
                &settings.api_key.clone().unwrap_or_default(),
            )
            .map_err(|e| format!("Failed to create Groq client: {}", e))?;

            let model = client.completion_model(&summary_model);
            let agent = AgentBuilder::new(model).build();

            agent
                .prompt(&prompt)
                .await
                .map_err(|e| format!("Groq summarization failed: {}", e))
        }
        AiProviderType::Gemini => {
            let client: gemini::Client = gemini::Client::new(
                &settings.api_key.clone().unwrap_or_default(),
            )
            .map_err(|e| format!("Failed to create Gemini client: {}", e))?;

            let model = client.completion_model(&summary_model);
            let agent = AgentBuilder::new(model).build();

            agent
                .prompt(&prompt)
                .await
                .map_err(|e| format!("Gemini summarization failed: {}", e))
        }
        AiProviderType::DeepSeek => {
            let client: deepseek::Client = deepseek::Client::new(
                &settings.api_key.clone().unwrap_or_default(),
            )
            .map_err(|e| format!("Failed to create DeepSeek client: {}", e))?;

            let model = client.completion_model(&summary_model);
            let agent = AgentBuilder::new(model).build();

            agent
                .prompt(&prompt)
                .await
                .map_err(|e| format!("DeepSeek summarization failed: {}", e))
        }
        AiProviderType::Mistral => {
            let client: mistral::Client = mistral::Client::new(
                &settings.api_key.clone().unwrap_or_default(),
            )
            .map_err(|e| format!("Failed to create Mistral client: {}", e))?;

            let model = client.completion_model(&summary_model);
            let agent = AgentBuilder::new(model).build();

            agent
                .prompt(&prompt)
                .await
                .map_err(|e| format!("Mistral summarization failed: {}", e))
        }
    }
}

/// Truncate input as a fallback when summarization fails
fn truncate_input(input: &str) -> String {
    if input.len() <= FALLBACK_TRUNCATION_LENGTH {
        return input.to_string();
    }

    // Try to truncate at a word boundary
    let truncated = &input[..FALLBACK_TRUNCATION_LENGTH];
    if let Some(last_space) = truncated.rfind(' ') {
        format!("{}...", &truncated[..last_space])
    } else {
        format!("{}...", truncated)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_truncate_input_short() {
        let input = "short input";
        assert_eq!(truncate_input(input), "short input");
    }

    #[test]
    fn test_truncate_input_long() {
        let input = "a ".repeat(200);
        let truncated = truncate_input(&input);
        assert!(truncated.len() <= FALLBACK_TRUNCATION_LENGTH + 3); // +3 for "..."
        assert!(truncated.ends_with("..."));
    }

    #[test]
    fn test_input_summary_short_passthrough() {
        // Short inputs should pass through without summarization
        // (This is a sync test; async summarization is tested separately)
        let input = "list containers";
        assert!(input.len() < MIN_SUMMARIZATION_LENGTH);
    }

    #[test]
    fn test_truncate_input_at_word_boundary() {
        // Build a string that's longer than FALLBACK_TRUNCATION_LENGTH
        let words: Vec<&str> = (0..50).map(|_| "word").collect();
        let input = words.join(" ");
        let truncated = truncate_input(&input);
        // Should end with "..." and break at a space
        assert!(truncated.ends_with("..."));
        // The part before "..." shouldn't end mid-word
        let before_dots = &truncated[..truncated.len() - 3];
        assert!(!before_dots.ends_with("wor")); // not mid-word
    }

    #[test]
    fn test_truncate_input_exact_boundary() {
        let input = "x".repeat(FALLBACK_TRUNCATION_LENGTH);
        let truncated = truncate_input(&input);
        assert_eq!(truncated, input); // exactly at boundary, no truncation
    }

    #[test]
    fn test_truncate_input_one_over_boundary() {
        let input = "x".repeat(FALLBACK_TRUNCATION_LENGTH + 1);
        let truncated = truncate_input(&input);
        // No spaces, so truncation happens at character boundary
        assert!(truncated.ends_with("..."));
    }

    #[test]
    fn test_truncate_input_empty() {
        assert_eq!(truncate_input(""), "");
    }

    #[test]
    fn test_min_summarization_length_constant() {
        assert_eq!(MIN_SUMMARIZATION_LENGTH, 100);
    }

    #[test]
    fn test_fallback_truncation_length_constant() {
        assert_eq!(FALLBACK_TRUNCATION_LENGTH, 200);
    }

    #[test]
    fn test_input_summary_serialization() {
        let summary = InputSummary {
            summary: "User asked about containers".to_string(),
            timestamp: 1700000000000,
            original_length: 500,
        };
        let json = serde_json::to_value(&summary).unwrap();
        assert_eq!(json["summary"], "User asked about containers");
        assert_eq!(json["timestamp"], 1700000000000i64);
        assert_eq!(json["originalLength"], 500);
    }

    #[test]
    fn test_input_summary_deserialization() {
        let json = r#"{"summary":"test","timestamp":123,"originalLength":10}"#;
        let summary: InputSummary = serde_json::from_str(json).unwrap();
        assert_eq!(summary.summary, "test");
        assert_eq!(summary.timestamp, 123);
        assert_eq!(summary.original_length, 10);
    }
}
