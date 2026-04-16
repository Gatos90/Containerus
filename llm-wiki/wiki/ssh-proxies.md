# SSH proxies: ProxyJump and ProxyCommand

**Summary**: Two ways to tunnel to a host through an intermediary — ProxyJump opens `direct-tcpip` channels on a chain of SSH sessions, ProxyCommand spawns an external process whose stdio becomes the transport. Both are implemented in `containerus-core::ssh::client`.

**Sources**: `crates/containerus-core/src/ssh/client.rs`, `crates/containerus-core/src/models/system.rs`.

**Last updated**: 2026-04-16

**Parent**: [[ssh-subsystem]]
**Siblings**: [[ssh-known-hosts]], [[ssh-config-parsing]], [[ssh-connection-pooling]]

---

## ProxyJump — `SshClient::connect_via_jump`

Used when `SshConfig.proxy_jump: Option<Vec<JumpHost>>` is set.

### Walk

For a chain `[hop1, hop2, hop3, target]`:

```rust
// hop1 — direct TCP
let s1 = russh::client::connect(cfg, (hop1.host, hop1.port), SshHandler::new()).await?;
authenticate_jump_host(&mut s1, hop1.creds)?;

// hop2 — tunneled through s1
let stream12 = s1.channel_open_direct_tcpip(hop2.host, hop2.port, ...).await?.into_stream();
let s2 = russh::client::connect_stream(cfg, stream12, SshHandler::new()).await?;
authenticate_jump_host(&mut s2, hop2.creds)?;

// hop3 — tunneled through s2
let stream23 = s2.channel_open_direct_tcpip(hop3.host, hop3.port, ...).await?.into_stream();
let s3 = russh::client::connect_stream(cfg, stream23, SshHandler::new()).await?;
authenticate_jump_host(&mut s3, hop3.creds)?;

// target — tunneled through s3
let stream3t = s3.channel_open_direct_tcpip(target.host, target.port, ...).await?.into_stream();
let session = russh::client::connect_stream(cfg, stream3t, SshHandler::new()).await?;
authenticate(&mut session, target_creds)?;
```

The intermediate session handles (`s1`, `s2`, `s3`) must stay alive for the duration of the terminal connection — if any of them drops, the tunneled channel dies. So they're stored in `SshClient._jump_sessions: Vec<Handle<SshHandler>>`.

### Credentials per hop

`JumpHostCredentials` is a flat `{ password, passphrase, private_key }`. The frontend builds `SshCredentials.jump_host_credentials: HashMap<String, JumpHostCredentials>` keyed by `"hostname:port"` for every hop. At connect time the backend looks up the right creds per hop.

`JumpHost` itself (from `models/system.rs`) holds static parameters: `hostname`, `port`, `username`, `identity_file`, `auth_method`, `private_key_content`.

### Host-key checks on every hop

Every hop runs through [[ssh-known-hosts]] verification independently. A Mismatch at hop 2 fails the whole connect; the UI surfaces *which* hop rejected.

### Why not just `ssh -J`?

Containerus doesn't shell out to `ssh` — it uses russh in-process. Same semantics as `-J`, different implementation: opens `direct-tcpip` channels instead of spawning.

## ProxyCommand — the subprocess transport

Used when `SshConfig.proxy_command: Option<String>` is set (and `proxy_jump` isn't).

### Walk

```rust
let child = tokio::process::Command::new("/bin/sh")
    .arg("-c")
    .arg(&proxy_command)
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::null())
    .spawn()?;

let proxy_stream = ProxyStream::new(child.stdout.take().unwrap(), child.stdin.take().unwrap());
let session = russh::client::connect_stream(cfg, proxy_stream, SshHandler::new()).await?;
authenticate(&mut session, target_creds)?;
```

`ProxyStream` (defined in `client.rs`) implements `AsyncRead + AsyncWrite` by delegating to the child's stdout/stdin. russh doesn't care that its transport isn't a socket — as long as it implements those traits, the handshake works.

The child process is kept alive in `SshClient._proxy_child` so it dies when the session drops.

### Variable substitution

Standard OpenSSH `%h`, `%p`, `%r` substitutions are resolved before spawning:
- `%h` → target hostname
- `%p` → target port
- `%r` → target username

Typical usage: `ProxyCommand ssh -W %h:%p bastion.example.com`.

### Caveats

- Whatever `proxy_command` specifies must be on `PATH` for the Tauri app (which inherits the login shell PATH on macOS via `LocalExecutor::get_path_env`-style logic).
- `stderr` is redirected to `null`; to debug a failing ProxyCommand, adjust the command itself to redirect or use `-v` into a file.

## Choosing between them

| Scenario | Pick |
|---|---|
| Multi-hop with pure SSH | ProxyJump |
| Need to go through an HTTP CONNECT proxy, `corkscrew`, `cloudflared access ssh`, etc. | ProxyCommand |
| Want in-app per-hop credential prompts | ProxyJump (ProxyCommand hops use OpenSSH config or agent) |
| Performance-sensitive | ProxyJump (single process, no fork/exec, lower overhead) |

## Frontend interaction

- `src/app/features/systems/` parses `ProxyJump` from the user's SSH config or from explicit form input into `JumpHost[]`.
- Jump-host credential prompts are rendered by the system form — the user enters password / passphrase / key per hop.
- `JumpHost.identity_file` vs `JumpHost.private_key_content` — the former points at `~/.ssh/id_...`, the latter is pasted key material. Both supported.

## Related pages

- [[ssh-subsystem]]
- [[ssh-known-hosts]]
- [[ssh-config-parsing]]
- [[flow-connect-system]]
- [[credentials-and-vault]]
