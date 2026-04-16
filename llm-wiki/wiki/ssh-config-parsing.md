# SSH config parsing

**Summary**: Reader for `~/.ssh/config` style files with `Include` resolution, pattern matching, and multi-path support. Exposes `list_hosts` / `resolve_host` (single path) and `list_hosts_multi` / `resolve_host_multi` (multiple paths) in `containerus-core::ssh::config`.

**Sources**: `crates/containerus-core/src/ssh/config.rs`.

**Last updated**: 2026-04-16

**Parent**: [[ssh-subsystem]]
**Siblings**: [[ssh-known-hosts]], [[ssh-proxies]], [[ssh-connection-pooling]]

---

## What it parses

Standard OpenSSH configuration directives relevant to connection establishment:

- `Host <pattern>` — block header
- `HostName` — real hostname
- `User`, `Port`
- `IdentityFile`
- `ProxyJump` — single or comma-separated chain
- `ProxyCommand`
- `Include` — relative to the current file's directory, with glob expansion

Unrelated directives (e.g. `LocalForward`) are tolerated and ignored.

## Multi-file / Include handling

The parser keeps a shared `visited: HashSet<PathBuf>` across recursive `Include` resolution. That prevents both cycles and redundant parses when two top-level configs include the same shared file.

Multi-path use case: users may have a personal `~/.ssh/config` plus a work-provisioned config at `~/.config/containerus/ssh-work-config`. The app persists that list in `app_settings.ssh_config_paths` and calls `list_hosts_multi([...])`.

## Pattern expansion

`Host prod-*` matches `prod-web-1`, `prod-db-1`. The parser computes which block applies to a given hostname using OpenSSH's "first-match-wins" rule with negation (`Host * !prod-*`) support.

For hostname enumeration (`list_hosts`), patterns without wildcards are surfaced as concrete entries; wildcard blocks are not expanded but remain applicable during `resolve_host`.

## API surface

```rust
pub fn list_hosts(path: &Path) -> Result<Vec<SshHostEntry>>;
pub fn list_hosts_multi(paths: &[PathBuf]) -> Result<Vec<SshHostEntry>>;

pub fn resolve_host(path: &Path, host: &str) -> Result<SshHostEntry>;
pub fn resolve_host_multi(paths: &[PathBuf], host: &str) -> Result<SshHostEntry>;
```

`SshHostEntry` carries: `host_alias`, `hostname`, `user`, `port`, `identity_file`, `proxy_jump: Vec<String>`, `proxy_command: Option<String>`, source file path.

## Tauri commands

From `commands/system.rs`:

- `has_ssh_config() → bool`
- `list_ssh_config_hosts() → Vec<SshHostEntry>`
- `get_ssh_host_config(alias) → SshHostEntry`

Used by the Add-System dialog to pre-populate forms from the user's existing OpenSSH configuration — pick a `Host` block and the rest (hostname, user, port, identity file, ProxyJump chain) is filled in.

## App settings bridging

`AppSettings.ssh_config_paths` defaults to `["~/.ssh/config"]`. Users can add more paths in the SSH settings tab; `get_app_settings` / `update_app_settings` manage the array.

## Caveats

- Tokens like `%d`, `%u`, `%l`, `%h` are not all expanded — hostname (`%h`) and port (`%p`) are, username (`%r`) is, others aren't.
- `Match` blocks are not supported (only `Host`).
- Case-sensitivity follows OpenSSH: directive names are case-insensitive, hostnames are compared case-insensitively.

## Related pages

- [[ssh-subsystem]]
- [[ssh-proxies]]
- [[feature-systems]]
