# Settings and preferences

**Summary**: The Settings page is a tabbed panel — AI providers, SSH config paths, changelog view, theme, backend connections. Settings are persisted in singleton SQLite tables (`app_settings`, `ai_settings`, `agent_preferences`), all with the `id INTEGER PRIMARY KEY CHECK (id = 1)` pattern.

**Sources**: `src/app/features/settings/*`, `src-tauri/src/database.rs` (settings functions), `src-tauri/src/commands/ai.rs`, `src-tauri/src/commands/system.rs` (app settings commands).

**Last updated**: 2026-04-16

**Parent**: [[frontend-features]]
**Siblings**: [[command-templates]], [[compose-projects]]

---

## Singleton pattern

Every settings table uses:

```sql
id INTEGER PRIMARY KEY CHECK (id = 1)
```

Guarantees at most one row. Reads always use `WHERE id = 1`. Writes are `INSERT OR REPLACE` upserts. If no row exists yet, getters return defaults.

## AI settings — `ai_settings`

Fields: `provider`, `api_key (nullable post-migration)`, `model_name`, `endpoint_url`, `temperature`, `max_tokens`, `memory_enabled`, `summary_model`, `summary_max_tokens`, `api_version`.

Commands:
- `get_ai_settings_cmd` — hydrates API key from keyring cache.
- `update_ai_settings_cmd` — stores key in keyring on desktop (not DB); mobile still uses DB.
- `list_ai_models` / `list_models_for_provider`
- `test_ai_connection` / `test_ai_connection_with_settings`
- `get_shell_suggestion`
- `pull_ollama_model` / `delete_ollama_model`

See [[ai-providers]] for provider details.

## Agent preferences — `agent_preferences`

Fields: `auto_execute_safe_commands`, `show_thinking_process`, `confirm_all_commands`, `max_auto_execute_steps`, `confirmation_timeout_secs`, `preferred_shell`, `dangerous_command_patterns` (JSON array).

Commands: `get_agent_preferences`, `update_agent_preferences`.

See [[agent-safety]] for how these gate execution and [[ai-agent]] for the loop.

## App settings — `app_settings`

Fields: `ssh_config_paths` (JSON array of paths), `last_seen_version`, `vault_migration_done`.

Commands: `get_app_settings`, `update_app_settings`.

Usage:
- `ssh_config_paths` — drives the multi-path SSH config parser. Default is `["~/.ssh/config"]`; users can add company-provisioned configs. See [[ssh-config-parsing]].
- `last_seen_version` — the changelog modal shows only when the current version differs.
- `vault_migration_done` — prevents the credential sweep from running repeatedly.

## Backend connections

Not a singleton — users can have many backends. See [[backend-service]].

## Theme

Currently a single dark theme. The UI uses Tailwind CSS variables for colors; switching requires CSS toggles, not settings storage. Light mode is on the roadmap.

## Changelog display

On launch, `MainLayoutComponent` calls `ChangelogState.checkForChangelog()` which:
1. Reads the bundled changelog via `get_changelog` command.
2. Compares against `app_settings.last_seen_version`.
3. If newer entries exist, opens the `whats-new-modal`.
4. On dismiss, writes the current version to `last_seen_version`.

## Desktop vs mobile differences

On Android (no keyring support), sensitive values stay in SQLite:
- AI `api_key` column remains populated.
- Credential migration is a no-op.
- `keyring_store` functions are stubs.

See [[credentials-and-vault]].

## Related pages

- [[frontend-features]]
- [[ai-providers]]
- [[agent-safety]]
- [[credentials-and-vault]]
- [[database-schema]]
