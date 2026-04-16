# AI providers

**Summary**: `containerus-core::ai` is a provider-agnostic abstraction over eight LLM providers. Every provider implements `AiProvider` (async trait) with `get_completion`, `list_models`, `is_available`, `test_connection`. The factory `create_provider(&AiSettings)` picks the right backend from the settings.

**Sources**: `crates/containerus-core/src/ai/`.

**Last updated**: 2026-04-16

---

## Providers

| Provider | Impl file | Notes |
|---|---|---|
| Ollama | `ollama.rs` | Local models, default `http://localhost:11434`. Supports `pull_model`, `delete_model`. |
| OpenAI | `openai.rs` | Official API. Streaming + structured output. |
| Anthropic | `anthropic.rs` | Claude family. Native tool_use for the agent. |
| Azure OpenAI | `azure.rs` | Uses `api_version` field; deployment-id routing. |
| Groq | via `openai_compat.rs` | OpenAI-compatible; custom model list. |
| Gemini | `gemini.rs` | Google models. |
| DeepSeek | via `openai_compat.rs` | OpenAI-compatible. |
| Mistral | via `openai_compat.rs` | OpenAI-compatible. |

## Factory — `mod.rs`

```rust
pub fn create_provider(settings: &AiSettings) -> Arc<dyn AiProvider> {
    match settings.provider {
        Ollama => Arc::new(OllamaProvider::new(endpoint_url, model_name)),
        OpenAi => Arc::new(OpenAiProvider::new(api_key, model_name, endpoint_url)),
        Anthropic => Arc::new(AnthropicProvider::new(api_key, model_name)),
        AzureOpenAi => Arc::new(AzureProvider::new(api_key, model_name, endpoint_url, api_version)),
        Groq => Arc::new(OpenAiCompatProvider::new(..., groq_models())),
        Gemini => Arc::new(GeminiProvider::new(api_key, model_name, endpoint_url)),
        DeepSeek => Arc::new(OpenAiCompatProvider::new(..., deepseek_models())),
        Mistral => Arc::new(OpenAiCompatProvider::new(..., mistral_models())),
    }
}
```

## Settings — `settings.rs`

```rust
pub struct AiSettings {
    pub provider: AiProviderType,
    pub api_key: Option<String>,
    pub model_name: String,
    pub endpoint_url: String,
    pub temperature: f32,
    pub max_tokens: i32,
    pub memory_enabled: bool,
    pub summary_model: Option<String>,
    pub summary_max_tokens: i32,
    pub api_version: Option<String>, // Azure only
}
```

Defaults: Ollama / `llama3.2` / `http://localhost:11434` / T=0.3 / max=256 / memory on / summary max=100.

`get_effective_summary_model()` picks a small/cheap model per provider (e.g., Anthropic → `claude-3-haiku-20240307`, OpenAI → `gpt-4o-mini`, Ollama → `llama3.2:1b`, Groq → `llama-3.1-8b-instant`, Gemini → `gemini-2.0-flash-lite`, DeepSeek → `deepseek-chat`, Mistral → `mistral-small-latest`). This is used by the [[ai-agent]] summarizer.

## Trait — `provider.rs`

```rust
#[async_trait]
pub trait AiProvider: Send + Sync {
    fn provider_type(&self) -> AiProviderType;
    async fn get_completion(&self, req: CompletionRequest) -> Result<CompletionResponse>;
    async fn list_models(&self) -> Result<Vec<AiModel>>;
    fn is_available(&self) -> bool;
    async fn test_connection(&self) -> Result<()>;
}
```

`CompletionRequest` carries `prompt`, `system_prompt`, `context`, `temperature`, `max_tokens`, `json_mode`, `timeout_secs`. `CompletionResponse` returns `content`, `tokens_used`, and a `structured` payload when `json_mode` is on.

## Structured shell-command output

`SHELL_COMMAND_JSON_SCHEMA` defines a JSON schema for shell suggestions:

```rust
pub struct ShellCommandResponse {
    pub command: String,
    pub explanation: String,
    pub is_dangerous: bool,
    pub requires_sudo: bool,
    pub affects_files: bool,
    pub alternatives: Vec<CommandAlternative>,
    pub warning: Option<String>,
}
```

`get_shell_system_prompt(os, shell, json_mode)` emits a context-aware system prompt:

- `json_mode=true` — embeds the JSON schema and strict formatting rules
- `json_mode=false` — plain command-only output for direct execution

The Tauri command `get_shell_suggestion` uses this pair to offer inline autocomplete inside the terminal composer.

## Key management

- Desktop: API keys live in the keyring vault (`CredentialVault.ai_api_keys` keyed by provider). At request time they're hydrated into the Tauri in-memory `ai_key_cache` and injected into the `AiSettings` supplied to `create_provider`. The SQLite `ai_settings.api_key` column stays NULL post-migration.
- Server: not applicable; the server does not issue LLM requests itself. All AI work happens client-side.

## Model enumeration

`list_models()` varies by provider:

- Ollama — queries `/api/tags` on the endpoint
- OpenAI / Azure — `/v1/models` (Azure appends `?api-version=<v>`)
- Anthropic — static list (Claude family + older)
- Gemini — `/v1beta/models`
- Groq / DeepSeek / Mistral — static lists built into `openai_compat.rs`

The frontend's `list_ai_models` command surfaces them into the settings dropdown, and the Ollama-specific `pull_ollama_model` / `delete_ollama_model` commands let users manage local models directly.

## Related pages

- [[ai-agent]]
- [[credentials-and-vault]]
- [[crate-containerus-core]]
