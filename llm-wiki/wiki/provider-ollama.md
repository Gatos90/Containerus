# Provider: Ollama

**Summary**: Local LLM provider — talks to a locally running Ollama daemon at `http://localhost:11434`. Supports streaming, tools (on models that implement them), and lifecycle operations (pull/delete models).

**Sources**: `crates/containerus-core/src/ai/ollama.rs`.

**Last updated**: 2026-04-16

**Parent**: [[ai-providers]]
**Siblings**: [[provider-openai]], [[provider-anthropic]], [[provider-azure]], [[provider-gemini]], [[provider-openai-compat]]

---

## Defaults

- `endpoint_url`: `http://localhost:11434`
- `model_name`: `llama3.2` (the default in `AiSettings::default`)
- Summary fallback: `llama3.2:1b`
- No API key required

## Endpoints

| Path | Purpose |
|---|---|
| `/api/chat` | Chat completion, streaming |
| `/api/generate` | Raw completion (used by the summarizer for some models) |
| `/api/tags` | List locally available models |
| `/api/pull` | Download a model |
| `/api/delete` | Remove a model |

## Request

`OllamaProvider::get_completion` POSTs to `/api/chat`:

```json
{
  "model": "llama3.2",
  "messages": [{ "role": "system", "content": "..." }, { "role": "user", "content": "..." }],
  "stream": true,
  "options": { "temperature": 0.3, "num_predict": 256 },
  "format": "json",         // when json_mode
  "tools": [ ... ]          // when agent supplies them
}
```

Streams NDJSON — one `{...}` per line. Each line has `message.content`, optional `message.tool_calls`, and a final `done: true` line.

## Tools

Ollama's tool-call payload format mirrors OpenAI's — same names, same shape. Models must be tool-capable (Llama 3.1 / 3.2 / 3.3 family, Qwen, etc.); older models silently ignore the `tools` field.

## `pull_ollama_model` / `delete_ollama_model`

Exposed as Tauri commands:

- `pull_ollama_model(model_name)` — POSTs `/api/pull`, streams progress (`pulling manifest`, `downloading layer xxx`, `verifying sha256`, `writing manifest`, `success`). The frontend's model manager renders a progress bar from these events.
- `delete_ollama_model(model_name)` — DELETE `/api/delete` with `{ name }`.

## `list_models`

GET `/api/tags` → `{ models: [{ name, size, parameter_size, quantization_level, modified_at }] }`. Mapped into `AiModel`:

- `id` = name (e.g. `llama3.2:latest`)
- `parameter_size` = e.g. `"3.2B"`
- `quantization_level` = e.g. `"Q4_0"`
- `context_window` = looked up per-family from a static table

## is_available / test_connection

- `is_available()` — returns `true` unconditionally (the daemon presence is checked at connection time).
- `test_connection()` — GET `/api/tags`. 200 → OK; any other → `NetworkTimeout` or `InvalidConfiguration`.

## Why it matters

Ollama is the default provider in `AiSettings::default()`. A fresh Containerus install that hasn't configured anything will try Ollama first. If it isn't running, the AI Settings page shows a "No AI configured" state with a link to the Ollama install page.

## Related pages

- [[ai-providers]]
- [[ai-agent]]
- [[tech-stack]]
