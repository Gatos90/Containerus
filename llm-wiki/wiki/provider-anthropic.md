# Provider: Anthropic

**Summary**: Claude family via the `/v1/messages` API. Uses Anthropic's native `tool_use` for agent tools — which is the canonical path for the agentic loop — plus structured output and streaming.

**Sources**: `crates/containerus-core/src/ai/anthropic.rs`.

**Last updated**: 2026-04-16

**Parent**: [[ai-providers]]
**Siblings**: [[provider-openai]], [[provider-ollama]], [[provider-azure]], [[provider-gemini]], [[provider-openai-compat]]

---

## Defaults

- `endpoint_url`: `https://api.anthropic.com`
- `model_name`: typically `claude-opus-4-5`, `claude-sonnet-4-5`, or similar 4.x model
- Summary fallback: `claude-3-haiku-20240307`
- Required header: `anthropic-version: 2023-06-01`

## Request

`AnthropicProvider::get_completion`:

1. Build the messages payload:
   - `system` (string) — separate from `messages` per Anthropic schema.
   - `messages: [{ role: "user"|"assistant"|"tool", content }]`.
   - `model`, `max_tokens`, `temperature`.
   - `tools: [{ name, description, input_schema }]` when the agent supplies them.
2. POST `/v1/messages` with `x-api-key`, `anthropic-version`, `content-type`.
3. Stream SSE: `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`.

## Tool use — native

Anthropic's tool use format is the agent's preferred path. When the model decides to call a tool, a `content_block_start` with `{"type": "tool_use", "id", "name", "input"}` appears. `content_block_delta` frames incrementally fill the `input` JSON. At `content_block_stop`, the parsed input is handed to the agent dispatcher.

The agent's response back to the model (after running the tool) uses:

```json
{
  "role": "user",
  "content": [{ "type": "tool_result", "tool_use_id": "...", "content": "stdout/stderr" }]
}
```

`run_agentic_loop` handles this mapping — see [[flow-agent-query]] and [[agent-tools]].

## Structured output

When `json_mode` is requested, the implementation prompts with instructions plus the schema in the system prompt. True "strict JSON mode" isn't supported on Anthropic, but the model is reliable with the schema embedded; the result is JSON-parsed and attached as `structured`.

## Model list

Claude models are enumerated statically in `anthropic.rs` (no public models endpoint). Includes Claude 4 Opus / Sonnet / Haiku and legacy 3.x models. `context_window` values are hand-populated (typically 200k for 3.x, up to 1M for Claude 4 with beta flag).

## Streaming details

Each `ResponseChunk` emitted by the agent corresponds to:
- `text` deltas → `ChunkType::Text`
- `thinking` deltas (extended thinking mode) → `ChunkType::Thinking`
- `tool_use` start → `ChunkType::Command` header

## Error mapping

| Code | Mapped |
|---|---|
| `invalid_request_error` | `InvalidConfiguration(msg)` |
| `authentication_error` | `CredentialError` |
| `rate_limit_error` | `Internal` (retryable) |
| `overloaded_error` | `NetworkTimeout` |
| `api_error` | `Internal(msg)` |

## Related pages

- [[ai-providers]]
- [[ai-agent]]
- [[agent-tools]]
- [[flow-agent-query]]
