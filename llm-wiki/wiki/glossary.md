# Glossary

**Summary**: Compact definitions of Containerus-specific terms. Use this when a wiki page mentions a concept without explaining it in full.

**Sources**: rest of the wiki; no external sources.

**Last updated**: 2026-04-16

**Parent**: [[index]]
**Siblings**: [[architecture]], [[containerus]]

---

| Term | One-line definition | Page |
|---|---|---|
| **Block** | One visible chunk in the Warp terminal — command, AI prompt, or AI response with its output | [[concept-block]] |
| **ContainerSystem** | A host Containerus can manage — local machine or remote over SSH | [[domain-models]] |
| **Connection id** | UUID identifying one configured backend server | [[concept-connection-id]] |
| **Container runtime** | Docker, Podman, or Apple Container — the daemon behind the CLI | [[container-runtimes]] |
| **Dual-path routing** | Frontend pattern: pick Tauri or HTTP per system based on ownership | [[dual-path-routing]] |
| **Dual-tier SSH** | Server-side model: shared connection for queries, per-user for interactive traffic | [[ssh-connection-pooling]] |
| **Executor** | Trait that abstracts "run this command" over local shell or SSH | [[executor-abstraction]] |
| **ProxyJump** | SSH multi-hop through `direct-tcpip` channels | [[ssh-proxies]] |
| **ProxyCommand** | External subprocess whose stdio becomes the SSH transport | [[ssh-proxies]] |
| **PortForward** | A TCP relay from localhost to a remote container port | [[port-forwarding]] |
| **Session** | Either a terminal (PTY/SSH) or an agent (AI conversation) — linked together | [[concept-session]] |
| **System id** | UUID identifying a managed host | [[concept-system-id]] |
| **System ownership** | Frontend mapping of system id → connection id (or undefined for local) | [[dual-path-routing]] |
| **Tauri command** | Frontend-to-Rust RPC handler (`invoke('name', args)`) | [[crate-src-tauri]] |
| **Vault** | Single keyring blob (desktop) or AES-GCM Postgres table (server) for secrets | [[credentials-and-vault]] |
| **Warp terminal** | Richer Warp.dev-style terminal with command blocks and AI composer | [[feature-warp-terminal]] |
| **`AiProvider`** | Async trait implemented by every LLM backend (OpenAI, Anthropic, Ollama, …) | [[ai-providers]] |
| **`AppState`** | The Tauri app's top-level Arc'd state container | [[crate-src-tauri]] |
| **`BackendService`** | Angular service that owns every backend connection | [[backend-service]] |
| **`CommandExecutor`** | See Executor | [[executor-abstraction]] |
| **`ConnectionManager`** | Server-side SSH connection coordinator | [[ssh-connection-pooling]] |
| **`ContainerError`** | Unified error enum with retry + recovery hints | [[error-model]] |
| **`CredentialVault`** | Serializable struct of all client-side secrets | [[credentials-and-vault]] |
| **`DangerClassifier`** | Agent-side command risk analyzer | [[agent-safety]] |
| **`PermissionCache`** | Server-side role→permissions map | [[auth-and-rbac]] |
| **`ServerVault`** | Server-side AES-GCM credential store | [[server-vault-internals]] |
| **`SshClient`** | russh session + jump sessions + proxy child | [[ssh-subsystem]] |
| **`SshConnectionPool`** | Desktop global pool of `SshClient`s | [[ssh-connection-pooling]] |
| **`TerminalContext`** | Agent-visible shell state (cwd, git, recent output, history) | [[agent-session-context]] |

## Common acronyms

- **RBAC** — Role-Based Access Control. Server-side permissions model, see [[auth-and-rbac]].
- **JWT** — JSON Web Token. Server access + refresh tokens.
- **PTY** — Pseudo-TeleTYpe. The kernel primitive behind interactive shells.
- **K8s** — Kubernetes. See [[kubernetes]].
- **MOC** — Map of Content. A wiki page that indexes related pages rather than containing information itself; `index.md` and this glossary function as MOCs.

## Related pages

- [[index]]
- [[architecture]]
- [[domain-models]]
