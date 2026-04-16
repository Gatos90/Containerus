# SSH known_hosts verification

**Summary**: Every russh connection runs a fingerprint check against `~/.ssh/known_hosts` via `HostKeyWatcher` + `check_host_key_against_content`. Matched / Unknown / Mismatch / Revoked map to distinct outcomes: accept, accept-new, refuse-with-UI, refuse.

**Sources**: `crates/containerus-core/src/ssh/known_hosts.rs`, `crates/containerus-core/src/ssh/client.rs`.

**Last updated**: 2026-04-16

**Parent**: [[ssh-subsystem]]
**Siblings**: [[ssh-proxies]], [[ssh-config-parsing]], [[ssh-connection-pooling]]

---

## The `HostKeyCheckResult` enum

```rust
pub enum HostKeyCheckResult {
    Matched,
    Unknown { key_type: String, fingerprint: String },
    Mismatch { expected_fingerprint: String, actual_fingerprint: String },
    Revoked,
}
```

Fingerprints use SHA-256 (`SHA256:...` OpenSSH format).

## Verification flow

russh invokes `SshHandler::check_server_key(pubkey)` on every connect. Implementation:

1. Resolve the `known_hosts` path from `dirs::home_dir()/.ssh/known_hosts`.
2. Read the file into memory.
3. Call `check_host_key_against_content(content, hostname, port, &pubkey)`:
   - Iterate non-comment, non-blank lines.
   - Parse each entry into `(marker?, hostnames, key_type, key_material)`.
   - `@revoked` marker → if this hostname matches → `Revoked`.
   - Hostname match + key bytes match → `Matched`.
   - Hostname match + key bytes differ → `Mismatch` with both fingerprints.
   - No host match at all → `Unknown`.
4. Decide policy:
   - `Matched` → accept silently.
   - `Unknown` → AcceptNew policy: call `add_host_key(hostname, port, pubkey)` to append and accept.
   - `Mismatch` / `Revoked` → stash the rejection in `HostKeyWatcher::last_rejection` and refuse.

`HostKeyWatcher` is a simple `Arc<Mutex<Option<HostKeyRejection>>>` — the caller reads it after a failed connect to surface the details to the UI.

## AcceptNew policy

When the host is unknown, Containerus accepts *and* records on first connect. This matches the OpenSSH `StrictHostKeyChecking=accept-new` behavior. Pros: new machines just work. Cons: MITM on the very first connection isn't detected.

If the user wants stricter behavior, they can pre-populate `known_hosts` via `ssh-keyscan` before ever connecting through the app. There is no in-app "strict" toggle yet.

## `add_host_key`

1. Resolve the `known_hosts` file (create parent directory if missing; `0700` on the dir, `0600` on the file).
2. Format: `{hostname}:{port} {key_type} {base64_key}` — or without the `:port` part for the default port 22.
3. Append with a trailing newline, preserving existing content.

## `remove_known_host`

Tauri command `remove_known_host(hostname, port) -> usize`:

1. Read `known_hosts`.
2. Filter out any line whose hostname matches.
3. Write the file atomically (write to temp, rename).
4. Return the number of removed lines.

Used by the host-key mismatch dialog so users can recover from a legitimate rotation (new server, same hostname).

## Fingerprint format

`SHA256:abcd...` — base64-encoded SHA-256 digest of the serialized public key. This is what OpenSSH shows in `ssh-keygen -lf` output, and it matches what the UI displays during a mismatch dialog.

## Known failure modes

| Failure | Cause | Remedy |
|---|---|---|
| `HostKeyVerificationFailed { hostname, reason: "mismatch" }` | Server key changed | Verify with server admin; if legitimate, `remove_known_host` then reconnect. |
| `HostKeyVerificationFailed { reason: "revoked" }` | Entry explicitly marked `@revoked` | Do not connect — the key has been compromised. |
| `known_hosts is binary / unreadable` | File corruption | Rebuild with `ssh-keyscan` or accept-new flow from scratch. |

## Why not `StrictHostKeyChecking=no`?

It would disable the warning entirely. That undermines the basic integrity guarantee of SSH. Containerus instead accepts new hosts once, refuses mismatches, and gives users the tooling to decide.

## Related pages

- [[ssh-subsystem]]
- [[ssh-proxies]]
- [[flow-connect-system]]
- [[error-model]]
