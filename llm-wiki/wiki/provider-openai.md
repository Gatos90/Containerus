# Provider: OpenAI

**Summary**: Direct OpenAI API integration. Streaming chat completions via `/v1/chat/completions`, structured outputs with JSON schema mode, native function-calling for agent tools, and `/v1/models` enumeration.

**Sources**: `crates/containerus-core/src/ai/openai.rs`.

**Last updated**: 2026-04-16

**Parent**: [[ai-providers]]
**Siblings**: [[provider-anthropic]], [[provider-ollama]], [[provider-azure]], [[provider-gemini]], [[provider-openai-compat]]

---

## Defaults

- `endpoint_url`: `https://api.openai.com/v1`
- `model_name`: typically `gpt-4o` or `gpt-4o-mini`
- Summary fallback model: `gpt-4o-mini`

## Request

`OpenAiProvider::get_completion`:

1. Build `CompletionRequest` → OpenAI chat completions payload:
   - `messages`: `[system, user]` with the request's system prompt and user input
   - `model`, `temperature`, `max_tokens`
   - `response_format: { type: "json_schema", json_schema }` when `json_mode` is true (uses `SHELL_COMMAND_JSON_SCHEMA`).
   - `tools` populated when agent tools are available, using OpenAI function-calling format.
2. POST to `{endpoint}/chat/completions` with `Authorization: Bearer {api_key}`.
3. Stream SSE chunks (`data: {...}`) and reconstruct the response. `delta.content` is forwarded as `ResponseChunk`; `tool_calls` deltas accumulate into a full function-call object.

## Response parsing

- `choices[0].message.content` → text
- `choices[0].message.tool_calls[*]` → agent tool invocations with `name` and `arguments` (JSON string, parsed)
- `usage.total_tokens` → `tokens_used`

Structured output (when `json_mode`) is parsed and attached as `CompletionResponse.structured`.

## Model list

`list_models()` → GET `/v1/models` with the bearer token. Filters to chat-capable ids (`gpt-*`, `o1-*`). Returns `AiModel { id, name, provider: "openai", context_window, parameter_size: None, quantization_level: None }` where `context_window` is populated from a known-model table when possible.

## Agent tool shape

OpenAI function calling format:

```json
{
  "type": "function",
  "function": {
    "name": "shell_execute",
    "description": "Execute a shell command...",
    "parameters": { "type": "object", "properties": {...} }
  }
}
```

The agent loop (`run_agentic_loop`) receives `tool_calls` as deltas during streaming, commits them at message end, then dispatches each through `DangerClassifier` and the execution pipeline (see [[flow-agent-query]]).

## Error mapping

| HTTP | Mapped `ContainerError` |
|---|---|
| 401 | `CredentialError("invalid API key")` |
| 429 | `Internal("rate limited")` — retryable upstream |
| 500-503 | `NetworkTimeout` — retryable |
| other 4xx | `InvalidConfiguration(msg)` |

## Key handling

Keys live in the keyring vault (`CredentialVault.ai_api_keys["openai"]`). The Tauri `get_ai_settings_cmd` hydrates the key from `AppState.ai_key_cache` before handing the struct to `create_provider`. See [[credentials-and-vault]].

## Related pages

- [[ai-providers]]
- [[ai-agent]]
- [[flow-agent-query]]
