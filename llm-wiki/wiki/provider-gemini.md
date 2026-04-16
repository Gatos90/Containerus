# Provider: Gemini

**Summary**: Google Gemini via the Generative Language API. Distinct shape from OpenAI — uses `contents` instead of `messages`, has its own tool schema, and a different streaming protocol.

**Sources**: `crates/containerus-core/src/ai/gemini.rs`.

**Last updated**: 2026-04-16

**Parent**: [[ai-providers]]
**Siblings**: [[provider-openai]], [[provider-anthropic]], [[provider-ollama]], [[provider-azure]], [[provider-openai-compat]]

---

## Defaults

- `endpoint_url`: `https://generativelanguage.googleapis.com`
- `model_name`: `gemini-2.0-flash` or similar
- Summary fallback: `gemini-2.0-flash-lite`

## URL shape

```
POST {endpoint}/v1beta/models/{model_name}:streamGenerateContent?alt=sse&key={api_key}
```

Uses a **query string** API key (`?key=...`). The server rejects bearer tokens.

## Request

```json
{
  "contents": [
    { "role": "user", "parts": [{ "text": "..." }] }
  ],
  "systemInstruction": { "parts": [{ "text": "..." }] },
  "generationConfig": {
    "temperature": 0.3,
    "maxOutputTokens": 256,
    "responseMimeType": "application/json",
    "responseSchema": { ... }     // structured output
  },
  "tools": [{
    "functionDeclarations": [{ "name": "shell_execute", "description": "...", "parameters": {...} }]
  }]
}
```

Note the shape differences from OpenAI:
- `contents` instead of `messages`.
- `role: "model"` instead of `assistant`.
- Text wrapped in `parts[]` (to allow mixing text + images).
- Tools under `tools.functionDeclarations[]`.

## Streaming

SSE with `data: {...}` lines. Each chunk has `candidates[0].content.parts[]`. Text parts stream as text; `functionCall` parts indicate tool invocations. `finishReason` in the terminal chunk marks completion.

## Tool calls

Emitted as:

```json
{ "functionCall": { "name": "shell_execute", "args": { "command": "..." } } }
```

Tool results are fed back as:

```json
{ "role": "function", "parts": [{ "functionResponse": { "name": "shell_execute", "response": { ... } } }] }
```

`run_agentic_loop` translates between the internal tool shape and Gemini's representation.

## Model list

`list_models()` → GET `/v1beta/models?key={api_key}`. Filters to `supportedGenerationMethods` containing `"generateContent"`. Returns `AiModel` with `id`, `name`, and `context_window` from `inputTokenLimit`.

## Auth

API key in the query string. Containerus stores under `CredentialVault.ai_api_keys["gemini"]`.

## Error mapping

| Status | Mapped |
|---|---|
| 400 | `InvalidConfiguration` (usually prompt too big or bad schema) |
| 403 | `CredentialError` (key invalid or API not enabled) |
| 429 | rate limit — upstream retry |
| 500 | `NetworkTimeout` |

## Related pages

- [[ai-providers]]
- [[ai-agent]]
