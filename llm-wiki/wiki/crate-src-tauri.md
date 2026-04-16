# Crate: src-tauri

**Summary**: The Tauri desktop shell. Owns window lifecycle, the SQLite database, the OS keyring vault, and ~94 Tauri commands across 13 modules. Also hosts the AI agent session manager and the local terminal/port-forward managers.

**Sources**: `src-tauri/src/`.

**Last updated**: 2026-04-16

**Parent**: [[architecture]]
**Siblings**: [[crate-containerus-core]], [[crate-containerus-server]]
**Children**: [[database-schema]], [[credentials-and-vault]], [[ai-agent]], [[monitoring]], [[command-templates]]

---

## Startup — `lib.rs`

`containerus_lib::run()` is the entry point (`src-tauri/src/lib.rs:26-224`). Ordered work:

1. `tracing_subscriber` init, default filter `containerus=debug,info` (lines 27-34).
2. Resolve app data dir via Tauri path manager; open SQLite at `{app_data_dir}/containerus.db` (39-49).
3. Desktop-only credential sweep: `credential_migration::migrate_credentials_to_keychain()` moves SSH creds and AI keys from SQLite into the OS keyring vault, then NULLs the DB columns (51-85). Subsequent starts just load the vault.
4. Construct shared session managers (87-98):
   - `commands::terminal::TerminalSessions` — `Arc<TerminalSessions>`
   - `agent::AgentSessionManager`
   - SSH port forward manager: `Arc<ssh::PortForwardManager>` (from `containerus-core`)
   - Backend port forward manager: `Arc<backend_forward::BackendPortForwardManager>`
   - `monitoring::MonitoringManager`
5. Register Tauri plugins (102-107): `plugin_opener`, `plugin_dialog`, `plugin_keychain`, `plugin_os`, `plugin_updater`, `plugin_process`.
6. Register ~94 Tauri commands via `invoke_handler!` (108-221).

`main.rs` is a 7-line launcher that suppresses the Windows console in release mode and calls `containerus_lib::run()`.

## Application state — `state.rs`

`AppState` (`src-tauri/src/state.rs:18-58`):

```rust
pub struct AppState {
    pub db: Mutex<Connection>,                             // SQLite
    systems: RwLock<Vec<ContainerSystem>>,                 // in-memory
    connection_states: DashMap<String, ConnectionState>,
    ssh_credential_cache: DashMap<String, SshCredentials>, // from vault
    ai_key_cache: DashMap<String, String>,                 // from vault
    backend_token_cache: DashMap<String, BackendTokens>,   // from vault
}
```

Key surfaces:
- Systems CRUD (62-154) — DB-backed, with `update_system_runtimes` for runtime detection
- Connection state getters/setters (156-172)
- Command template CRUD (174-340) — enforces immutability of built-in templates
- Cached credential accessors (385-431) — backed by the vault
- `flush_vault()` (434-457) — one atomic write of every cache into `CredentialVault`

## Database — `database.rs`

SQLite schema (see [[database-schema]] for full column lists). Tables:

| Table | Purpose |
|---|---|
| `systems` | Container systems (local or remote hosts) |
| `ssh_credentials` | Obfuscated credentials (kept NULL post-migration) |
| `command_templates` | Saved shell templates (built-ins re-seeded each boot) |
| `ai_settings` | Singleton AI provider config (`id = 1`) |
| `agent_preferences` | Singleton agent behavior tuning (`id = 1`) |
| `backend_connections` | Persistent list of backend server URLs |
| `app_settings` | Singleton app preferences (`id = 1`): ssh_config paths, `last_seen_version`, `vault_migration_done` |

Obfuscation (`database.rs:730-753`) is XOR + base64 — explicitly **not** a security mechanism, just enough to discourage casual reading in the SQLite file. Real secrecy comes from moving to the keyring (see [[credentials-and-vault]]).

## Keyring vault — `keyring_store.rs`

One keyring entry (`containerus.vault` / `default`) carries a single JSON blob with:

- `ssh_credentials: HashMap<String, SshCredentials>` keyed by system id; each entry also carries a `jump_host_credentials` map for ProxyJump hops
- `ai_api_keys: HashMap<String, String>` keyed by provider
- `backend_tokens: HashMap<String, BackendTokens>` keyed by backend connection id
- `version: 1`

Keeping everything in one entry minimizes macOS Keychain prompts (one grant covers all secrets). Android stubs return defaults — credentials stay in SQLite there.

## Credential migration — `credential_migration.rs`

Runs once, desktop only (`lib.rs:59`). Flow (`credential_migration.rs:10-44`):

1. Load current vault from keyring (may be empty).
2. Sweep SSH creds and AI keys from SQLite.
3. If anything changed, write the vault back (one write).
4. Only after the vault write succeeds, NULL the DB columns.

This ordering ensures no window where the only copy of a credential exists in an unwritten buffer.

## Commands — `commands/`

Thirteen modules, ~94 commands:

| Module | Count | Highlights |
|---|---|---|
| `system.rs` | ~17 | add/connect/disconnect/detect_runtimes, monitoring toggles, `get_extended_system_info`, `list_ssh_config_hosts`, `remove_known_host`, settings |
| `container.rs` | 4 | `list_containers`, `perform_container_action`, `get_container_logs`, `inspect_container` |
| `compose.rs` | 4 | `compose_up|down|restart|logs` |
| `image.rs` | 4 | list / pull / build / remove |
| `network.rs` | 5 | list / create / remove / connect / disconnect |
| `volume.rs` | 3 | list / create / remove |
| `terminal.rs` | 7 | start, send_input, resize, close, `execute_in_terminal`, `list_terminal_sessions`, `fetch_shell_history` |
| `port_forward.rs` | 6 | create/stop/list/get/open/is_forwarded — routes between SSH and WebSocket backends |
| `command_template.rs` | 7 | list/get/create/update/delete/toggle_favorite/duplicate |
| `ai.rs` | 8 | settings, list models, test connection, `get_shell_suggestion`, Ollama pull/delete |
| `agent.rs` | 12 | session lifecycle, `submit_agent_query`, confirmation response, context updates, preferences |
| `file_browser.rs` | 8 | list / read / write / mkdir / delete / rename / download / upload (all optional `container_id`, `runtime`) |
| `backend.rs` | 4 | list/save/delete/delete_all backend connections (tokens hydrated from cache, flushed to vault) |

`commands/mod.rs` just re-exports each submodule.

## Agent module — `agent/`

See [[ai-agent]] and [[agent-safety]] for the full story. Module layout:

- `mod.rs` — exports
- `executor.rs` — `run_agentic_loop`, `AgentResponse`, `execute_shell_command`, `parse_agent_response`
- `events.rs` — `AgentEvent` enum streamed to the frontend
- `session.rs` — `AgentSession`, `AgentSessionManager`, `TerminalContext`, conversation history caps
- `pty_bridge.rs` — `CommandExecution`, `PtyBridge` wrapping `TerminalSessions`
- `rig_executor.rs` — earlier Rig.rs wiring, being superseded by native Anthropic tool-use
- `summarizer.rs` — collapses long user inputs into 1-2 sentence summaries (uses a smaller model)
- `providers/mod.rs` — `get_agent_preamble()`, provider selection
- `tools/` — `definitions.rs`, `shell_execute.rs`, `state_query.rs`, `history_query.rs`
- `safety/classifier.rs` — `DangerLevel`, `DangerClassification`, `DangerClassifier`

## Monitoring — `monitoring/mod.rs`

`MonitoringManager` owns a `DashMap<system_id, MonitorHandle>`. `start_monitoring` spawns a tokio task that ticks on an interval, calls the executor to gather CPU/memory/disk/network metrics, and emits `system:metrics` Tauri events. Stops on disconnect or explicit call. See [[monitoring]].

## Backend port forwarding — `backend_forward.rs`

Used when the frontend asks for a port forward on a backend-owned system. Opens a local TCP listener, then for each accepted connection spins up a WebSocket to `ws(s)://server/api/ws/tunnel/{systemId}` with the access token and relays bytes bidirectionally. The server side dials the remote container port via its per-user SSH connection. See [[port-forwarding]].

## Related pages

- [[architecture]]
- [[database-schema]]
- [[credentials-and-vault]]
- [[ai-agent]]
- [[port-forwarding]]
- [[monitoring]]
