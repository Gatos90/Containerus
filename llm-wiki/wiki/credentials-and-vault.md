# Credentials and vault

**Summary**: Desktop stores all secrets in a single OS keyring blob (`containerus.vault` / `default`), minimizing prompts. The server encrypts credentials at rest with AES-256-GCM in PostgreSQL, using an Argon2-derived key. Neither side keeps the legacy XOR-obfuscated SQLite copies once migration completes.

**Sources**: `src-tauri/src/keyring_store.rs`, `src-tauri/src/credential_migration.rs`, `crates/containerus-core/src/models/credentials.rs`, `crates/containerus-server/src/vault/mod.rs`.

**Last updated**: 2026-04-16

---

## Shared models — `models/credentials.rs`

```rust
pub struct SshCredentials {
    pub password: Option<String>,
    pub passphrase: Option<String>,
    pub private_key: Option<String>,
    pub jump_host_credentials: HashMap<String, JumpHostCredentials>, // key: "host:port"
}

pub struct JumpHostCredentials {
    pub password: Option<String>,
    pub passphrase: Option<String>,
    pub private_key: Option<String>,
}

pub struct BackendTokens {
    pub access_token: String,
    pub refresh_token: String,
}

pub struct CredentialVault {
    pub version: u32,                                           // 1
    pub ssh_credentials: HashMap<String, SshCredentials>,       // system_id -> creds
    pub ai_api_keys: HashMap<String, String>,                   // provider -> key
    pub backend_tokens: HashMap<String, BackendTokens>,         // connection_id -> tokens
}
```

All `Debug` impls redact the secret fields — printing a struct never leaks credentials.

## Desktop — OS keyring vault

### Shape

- One keyring entry: service `"containerus.vault"`, account `"default"`.
- Value: `serde_json::to_string(&CredentialVault)`.
- Fetched at startup, mutated in-memory, written back via `flush_vault()` (one write per state change).

### Why one blob

macOS Keychain prompts for **each** entry. Storing many entries would prompt the user on every secret load. Packing everything into one blob means a single allow-once prompt covers the whole app.

### Functions — `keyring_store.rs`

```rust
pub fn load_vault() -> CredentialVault;  // returns default if not found
pub fn save_vault(&CredentialVault);
pub fn delete_vault();
fn get_secret/set_secret/delete_secret  // thin wrappers over the `keyring` crate
```

Android has stub functions that return defaults — credentials stay in SQLite there.

### In-memory caches

`AppState` keeps these as `DashMap`s hydrated from the vault at boot:

- `ssh_credential_cache: DashMap<String, SshCredentials>`
- `ai_key_cache: DashMap<String, String>`
- `backend_token_cache: DashMap<String, BackendTokens>`

All mutations (Tauri commands for connecting, saving AI keys, storing backend tokens) update the cache and then call `flush_vault()`.

### Migration — `credential_migration.rs`

Runs once on first launch after an upgrade. Desktop only. Ordered so there's never a window with no readable credential:

1. `load_vault()` (may be empty)
2. Sweep SSH creds from `ssh_credentials` table (XOR+base64 `deobfuscate_credential`) into vault
3. Sweep AI key from `ai_settings.api_key` into vault
4. If changed, `save_vault()` once
5. Only then, UPDATE the SQL columns to NULL

A successful vault write precedes any DB cleanup. `app_settings.vault_migration_done` is set so the sweep doesn't repeat.

## SQLite "obfuscation" is not encryption

`database.rs::obfuscate()` XORs with a constant key and base64-encodes the result. It exists only to make the SQLite file unreadable to casual inspection and to paper over the migration window. Post-migration, the columns are NULL. Real secrecy comes from the OS keyring.

## Server — `ServerVault`

`containerus-server::vault::mod`:

```rust
pub struct ServerVault {
    cipher: Aes256Gcm,
}

impl ServerVault {
    pub fn new(encryption_key: &[u8], salt: &[u8]) -> Result<Self>;
    pub fn encrypt(&self, plaintext: &[u8]) -> (Vec<u8>, [u8; 12]);   // (ciphertext, nonce)
    pub fn decrypt(&self, ct: &[u8], nonce: &[u8; 12]) -> Vec<u8>;
    pub async fn store_credential(&self, db, system_id, credential_type, plaintext, jump_host_key);
    pub async fn get_credential(&self, db, system_id, credential_type, jump_host_key) -> Option<String>;
}
```

- Argon2 derives the AES-256 key from (`encryption_key`, `encryption_salt`) env vars.
- Storage: `system_credentials` table with `(system_id, credential_type, encrypted_data, nonce, jump_host_key)`.
- `credential_type ∈ { "password", "passphrase", "private_key" }`.
- `jump_host_key` is either NULL (terminal host) or `"hostname:port"` (per-hop).

`ConnectionManager::create_ssh_client` pulls the right subset (direct host + each ProxyJump hop) when opening a session. See [[ssh-connection-pooling]].

## Config secrets

`ServerConfig` itself requires `JWT_SECRET` (min 32 bytes) and `ENCRYPTION_KEY` (min 32 bytes) + `ENCRYPTION_SALT` (min 16 bytes). The server refuses to start without them.

## Rotation

- Desktop vault: no user-facing rotation — the OS keyring handles storage. Users who want to rotate can delete the vault entry; on next launch Containerus re-migrates from DB (if still there) or starts fresh.
- Server: rotating `ENCRYPTION_KEY` requires re-encrypting every `system_credentials` row. No built-in rotation tool exists today.

## Related pages

- [[auth-and-rbac]]
- [[crate-src-tauri]]
- [[crate-containerus-server]]
- [[ssh-connection-pooling]]
