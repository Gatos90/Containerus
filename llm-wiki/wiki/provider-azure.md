# Provider: Azure OpenAI

**Summary**: Azure's hosted OpenAI Service. Same chat-completions shape as OpenAI but routed through a deployment ID and guarded with the `api_version` query parameter.

**Sources**: `crates/containerus-core/src/ai/azure.rs`.

**Last updated**: 2026-04-16

**Parent**: [[ai-providers]]
**Siblings**: [[provider-openai]], [[provider-anthropic]], [[provider-ollama]], [[provider-gemini]], [[provider-openai-compat]]

---

## Defaults

- `endpoint_url`: user-supplied (e.g. `https://my-resource.openai.azure.com`)
- `api_version`: user-supplied (e.g. `2024-08-01-preview`)
- `model_name`: the **deployment** name, not the base model — Azure routes by deployment
- Summary fallback: `gpt-4o-mini` (assumes a deployment with this name exists)

## URL shape

```
POST {endpoint_url}/openai/deployments/{model_name}/chat/completions?api-version={api_version}
```

Header: `api-key: {api_key}` (note: *not* `Authorization: Bearer`).

`list_models`:

```
GET {endpoint_url}/openai/models?api-version={api_version}
```

The list returns *base* models, not deployments. Containerus surfaces both the base list and the user's deployment string in the settings UI.

## Request / response

Body structure is identical to OpenAI's `/v1/chat/completions`: `messages`, `temperature`, `max_tokens`, `response_format`, `tools`, streaming SSE. Tool calls use the OpenAI function-calling format.

Structured output (`response_format: json_schema`) is supported on GA `2024-08-01-preview` and newer. For older API versions the implementation falls back to embedding the schema in the system prompt.

## Auth quirks

- `api-key` header, not bearer token.
- Managed-identity auth isn't supported — Containerus expects a plain string key. Azure Entra ID token auth is on the roadmap but not implemented.
- Keys rotate — the keyring vault stores the current one under `CredentialVault.ai_api_keys["azure_openai"]`.

## Typical settings

```
provider: AzureOpenAi
endpoint_url: https://my-resource.openai.azure.com
api_version: 2024-08-01-preview
model_name: gpt-4o      # deployment name
api_key: <from portal>
```

If the deployment doesn't exist Azure returns `DeploymentNotFound`; Containerus maps that to `InvalidConfiguration` with a suggestion to check the deployment name.

## Related pages

- [[ai-providers]]
- [[provider-openai]]
- [[ai-agent]]
