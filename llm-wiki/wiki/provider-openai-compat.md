# Provider: OpenAI-compatible (Groq, DeepSeek, Mistral)

**Summary**: Generic OpenAI-compatible provider used for three different backends. Same request shape, different base URL, different model catalogue, slightly different quirks.

**Sources**: `crates/containerus-core/src/ai/openai_compat.rs`, `crates/containerus-core/src/ai/mod.rs`.

**Last updated**: 2026-04-16

**Parent**: [[ai-providers]]
**Siblings**: [[provider-openai]], [[provider-anthropic]], [[provider-ollama]], [[provider-azure]], [[provider-gemini]]

---

## Backends mapped to this provider

| Provider | Endpoint | Notable models | Summary fallback |
|---|---|---|---|
| Groq | `https://api.groq.com/openai/v1` | `llama-3.1-70b-versatile`, `llama-3.1-8b-instant`, `mixtral-8x7b-32768` | `llama-3.1-8b-instant` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat`, `deepseek-coder`, `deepseek-reasoner` | `deepseek-chat` |
| Mistral | `https://api.mistral.ai/v1` | `mistral-large-latest`, `mistral-small-latest`, `open-mixtral-8x22b` | `mistral-small-latest` |

## Construction

`create_provider` picks this class for `AiProviderType::Groq | DeepSeek | Mistral`:

```rust
Arc::new(OpenAiCompatProvider::new(
    api_key,
    model_name,
    endpoint_url_for_provider(),
    models_for_provider(), // static list
))
```

The static model list is baked into `openai_compat.rs` because none of these expose a reliable `/v1/models` catalogue with the metadata Containerus wants.

## Protocol

Exactly OpenAI's chat-completions API:

- `POST {endpoint}/chat/completions`
- `Authorization: Bearer {api_key}`
- Same streaming SSE format
- Same tool / function-call format

Everything in [[provider-openai]] applies — tools, JSON mode (where supported), streaming.

## Per-provider quirks

### Groq

- Fastest token rate of the three (custom LPU hardware). Tool calls supported on Llama 3.1 tool models.
- Strict rate limits per tier — 429s are common under load. Retry with backoff upstream of this provider.

### DeepSeek

- `deepseek-chat` supports JSON mode and tools.
- `deepseek-reasoner` produces `reasoning_content` *alongside* the final answer — Containerus treats `reasoning_content` deltas as `ChunkType::Thinking` events for the agent UI.

### Mistral

- Tool calling on `mistral-large-latest` and newer.
- Does not (yet) support response format JSON schema; `json_mode` falls back to "JSON-in-prompt" behavior.

## Model enumeration

Because the static list lives in the code, adding a new model requires a code change. A future enhancement could read a canonical catalogue at startup. For now the model dropdown in settings is pinned to what `openai_compat.rs` knows.

## Key storage

Keys live in the keyring vault under:
- `CredentialVault.ai_api_keys["groq"]`
- `CredentialVault.ai_api_keys["deepseek"]`
- `CredentialVault.ai_api_keys["mistral"]`

See [[credentials-and-vault]].

## Related pages

- [[ai-providers]]
- [[provider-openai]]
- [[ai-agent]]
