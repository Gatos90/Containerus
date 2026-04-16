//! Local authenticated-encryption vault for credentials persisted in SQLite.
//!
//! Mirrors the server-side pattern in `crates/containerus-server/src/vault/mod.rs`:
//! AES-256-GCM with a random 12-byte nonce per encrypt operation.
//!
//! The master key lives in the OS keyring on desktop. Android has no keyring
//! backend wired up, so `LocalVault::from_os_keyring()` is desktop-only and
//! callers must handle `None` (refuse to write credentials locally — the UI
//! should steer Android users to backend mode or a future Keystore shim).

pub mod vault;

pub use vault::{LocalVault, VaultError, CRYPTO_VERSION_LEGACY_XOR, CRYPTO_VERSION_AES_GCM};
