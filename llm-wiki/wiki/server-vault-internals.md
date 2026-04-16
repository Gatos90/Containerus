# Server vault internals

**Summary**: Server-side credential storage. Argon2id derives an AES-256 key from `ENCRYPTION_KEY` + `ENCRYPTION_SALT`. Each credential is encrypted with AES-GCM (96-bit nonce) and stored in `system_credentials` alongside its nonce. Per-jump-host variants use an extra composite key column.

**Sources**: `crates/containerus-server/src/vault/mod.rs`, `crates/containerus-server/migrations/0001_initial_schema.sql`.

**Last updated**: 2026-04-16

**Parent**: [[credentials-and-vault]]
**Siblings**: [[auth-and-rbac]], [[ssh-connection-pooling]]

---

## Key derivation

Server startup calls `ServerVault::new(encryption_key, salt)`:

```rust
let key = argon2_default().hash_password_into(
    encryption_key, salt, &mut derived_key  // 32 bytes
)?;
let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&derived_key));
```

Argon2id defaults: `m_cost=19 MiB, t_cost=2, p_cost=1`. Derivation happens once per server startup and the `Aes256Gcm` instance is held in `AppState.vault`.

## Encrypt / decrypt

```rust
pub fn encrypt(&self, plaintext: &[u8]) -> (Vec<u8>, [u8; 12]) {
    let nonce_bytes: [u8; 12] = random();        // OS RNG
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = self.cipher.encrypt(nonce, plaintext).expect("encrypt");
    (ct, nonce_bytes)
}

pub fn decrypt(&self, ciphertext: &[u8], nonce: &[u8; 12]) -> Vec<u8> {
    self.cipher.decrypt(Nonce::from_slice(nonce), ciphertext).expect("decrypt")
}
```

Every encryption uses a fresh random nonce — nonce reuse with AES-GCM is catastrophic. A 96-bit random nonce gives birthday-bound safety for up to ~2^32 encryptions per key.

## Storage row

```sql
CREATE TABLE system_credentials (
    system_id UUID NOT NULL,
    credential_type TEXT NOT NULL,            -- 'password' | 'passphrase' | 'private_key'
    jump_host_key TEXT NULL,                  -- 'hostname:port' for ProxyJump hops, NULL for terminal host
    encrypted_data BYTEA NOT NULL,
    nonce BYTEA NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (system_id, credential_type, jump_host_key)
);
```

`jump_host_key` uses the string `'<null>'` when NULL in the primary key if the DB isn't nullable-PK-friendly; the implementation uses PostgreSQL's ability to include NULL in a unique index with a `COALESCE` or a NULLS NOT DISTINCT style. Check the initial migration for the exact DDL.

## Store / get

```rust
pub async fn store_credential(
    &self, db, system_id, credential_type, plaintext, jump_host_key
) -> Result<()> {
    let (ct, nonce) = self.encrypt(plaintext.as_bytes());
    sqlx::query!(
        "INSERT INTO system_credentials ... ON CONFLICT ... DO UPDATE ...",
        system_id, credential_type, jump_host_key, ct, nonce.as_ref()
    ).execute(db).await?;
    Ok(())
}

pub async fn get_credential(
    &self, db, system_id, credential_type, jump_host_key
) -> Result<Option<String>> {
    let row = sqlx::query!(
        "SELECT encrypted_data, nonce FROM system_credentials WHERE ...",
        system_id, credential_type, jump_host_key
    ).fetch_optional(db).await?;
    Ok(row.map(|r| String::from_utf8(self.decrypt(&r.encrypted_data, r.nonce.as_slice().try_into().unwrap())).unwrap()))
}
```

## Usage by `ConnectionManager`

`create_ssh_client(db, system)` pulls:
1. `(system.id, "password", NULL)` — if auth is password
2. `(system.id, "passphrase", NULL)` — if auth uses a passphrase-protected key
3. `(system.id, "private_key", NULL)` — if auth is public key
4. For each `ProxyJump` hop h: `(system.id, "password|passphrase|private_key", "{h.hostname}:{h.port}")`

Then routes to direct / ProxyJump / ProxyCommand SSH.

## Rotation

`ENCRYPTION_KEY` rotation requires re-encrypting every row. Today the server has no rotation tool — operators would need a custom script that decrypts with the old key and re-encrypts with the new one. An "ops CLI" is on the backlog.

## Compromise scenarios

- **DB snapshot leaked** — ciphertext + nonce, no key. Safe unless attacker also gets `ENCRYPTION_KEY`.
- **`ENCRYPTION_KEY` leaked** — ciphertext decryptable. Rotate key + re-encrypt + rotate every affected SSH credential upstream.
- **Both `ENCRYPTION_KEY` and `ENCRYPTION_SALT` leaked but different entries have different data** — the same because both are server-global; this vault uses a single key for the whole DB.

## Why Argon2id over HKDF?

Argon2 is memory-hard so brute-forcing the key from a guessed `ENCRYPTION_KEY` requires large RAM per guess. HKDF is faster but trivially brute-forceable if the input has low entropy. The trade-off: server startup spends ~100ms in Argon2 — negligible.

## Related pages

- [[credentials-and-vault]]
- [[ssh-connection-pooling]]
- [[crate-containerus-server]]
- [[database-schema]]
