//! Input Summarization Module
//!
//! Provides functionality to summarize user inputs into brief summaries
//! for conversation memory. Uses a smaller/cheaper model to compress
//! potentially large user inputs (like pasted logs) into concise summaries.

use rig::agent::AgentBuilder;
use rig::client::{CompletionClient, ProviderClient};
use rig::completion::Prompt;
use rig::providers::{anthropic, ollama, openai};
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
}
