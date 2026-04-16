# Wiki Index

**Summary**: Map of content for the Containerus wiki. Pages are organized as a tree — every article has a **Parent** and most have children. Start from the top-level concept you're interested in; each page links downward to detail and sideways to related topics.

**Sources**: Codebase at `/Users/kevin/Projects/Containerus/`.

**Last updated**: 2026-04-16

---

## How to read this wiki

Every page follows the same shape: a short summary, source pointers, a **Parent** / **Children** / **See also** navigation block, and the content itself. Walk downward by clicking children; walk sideways for related concepts; jump to the [[glossary]] when a term is unfamiliar.

Two map-of-content pages index the rest:

- **[[index]]** — this page. Tree of everything.
- **[[glossary]]** — flat table of terms with one-line definitions.

---

## Tree

### [[containerus]] — what it is

- [[architecture]] — the two-mode layered diagram
  - [[dual-mode-operation]] — local vs backend, what lives where
  - [[tech-stack]] — languages, frameworks, versions
  - [[pattern-three-database-pattern]] — SQLite vs keyring vs PostgreSQL
  - [[concept-event-streams]] — Tauri events / WS / mpsc / signals
  - **Crates**
    - [[crate-src-tauri]] — the Tauri desktop app
      - [[database-schema]] — SQLite + PostgreSQL tables
      - [[credentials-and-vault]] — keyring vault
        - [[server-vault-internals]] — server-side AES-GCM variant
      - [[monitoring]] — background metrics collection
      - [[command-templates]] — saved shell templates
      - [[ai-agent]] — agentic loop
        - [[agent-session-context]] — session and TerminalContext
        - [[agent-events]] — the AgentEvent enum
        - [[agent-tools]] — shell_execute, state_query, history_query
        - [[agent-safety]] — DangerClassifier
        - [[flow-agent-query]] — query start-to-finish
    - [[crate-containerus-core]] — shared Rust library
      - [[domain-models]] — Container, System, Volume, …
      - [[error-model]] — ContainerError variants
      - [[executor-abstraction]] — CommandExecutor trait
      - [[ssh-subsystem]] — russh, ProxyJump, known_hosts
        - [[ssh-known-hosts]] — fingerprint verification
        - [[ssh-proxies]] — ProxyJump and ProxyCommand
        - [[ssh-config-parsing]] — ~/.ssh/config reader
        - [[ssh-connection-pooling]] — desktop pool + server dual-tier
      - [[container-runtimes]] — Docker, Podman, Apple builder/parser
      - [[ai-providers]] — multi-provider abstraction
        - [[provider-openai]] — OpenAI
        - [[provider-anthropic]] — Anthropic
        - [[provider-ollama]] — Ollama (local)
        - [[provider-azure]] — Azure OpenAI
        - [[provider-gemini]] — Google Gemini
        - [[provider-openai-compat]] — Groq, DeepSeek, Mistral
    - [[crate-containerus-server]] — Axum backend server
      - [[auth-and-rbac]] — JWT, Argon2, PermissionCache
      - [[server-vault-internals]] — AES-GCM credential storage
      - [[server-websockets]] — terminal, tunnel, k8s-exec, k8s-watch
      - [[ssh-connection-pooling]] — dual-tier shared vs per-user
      - [[kubernetes]] — kube-rs cluster management
      - [[audit-logging]] — audit_log table and queries
      - [[database-schema]] — migration list + columns
  - **Flows** (cross-cutting traces)
    - [[flow-connect-system]] — an SSH connect, full trace
    - [[flow-agent-query]] — one agent query, full trace
    - [[flow-port-forward]] — a port forward, full trace
  - **Subsystems** (architectural)
    - [[terminal-subsystem]] — PTY + SSH channel + WebSocket variants
    - [[port-forwarding]] — SSH and backend tunnel modes
      - [[flow-port-forward]]
  - **Frontend**
    - [[frontend-overview]] — Angular app structure
      - [[angular-state]] — signal-based state classes
      - [[backend-service]] — multi-connection hub
      - [[dual-path-routing]] — Tauri vs HTTP per system
      - [[frontend-features]] — feature catalogue
        - [[feature-containers]]
        - [[feature-systems]]
        - [[feature-warp-terminal]]
        - [[feature-backend]]
        - [[command-templates]]
        - [[compose-projects]]
        - [[settings-and-preferences]]
        - [[file-browser]]
      - **Patterns**
        - [[pattern-signals-and-state]]
        - [[pattern-dual-path]]
      - **Concepts**
        - [[concept-block]]
        - [[concept-system-id]]
        - [[concept-session]]
        - [[concept-connection-id]]
- [[tech-stack]] — versions
- [[build-and-dev]] — commands to build and run
  - [[testing]] — Vitest, Playwright, cargo test
- [[glossary]] — flat index of terms

---

## Browse by role

If you are …

- **New to the codebase** → start [[containerus]] → [[architecture]] → one flow like [[flow-connect-system]].
- **Debugging an SSH issue** → [[ssh-subsystem]] then [[flow-connect-system]] and [[ssh-known-hosts]].
- **Adding a new AI provider** → [[ai-providers]] then [[provider-openai]] as the template, [[ai-agent]] for how tools plug in.
- **Working on the agent** → [[ai-agent]] → [[agent-session-context]], [[agent-events]], [[agent-tools]], [[agent-safety]].
- **Writing backend API code** → [[crate-containerus-server]] → [[auth-and-rbac]], [[server-websockets]], [[ssh-connection-pooling]], [[audit-logging]].
- **Touching the frontend** → [[frontend-overview]] → [[angular-state]], [[backend-service]], [[pattern-signals-and-state]].
- **Evaluating security** → [[credentials-and-vault]] → [[server-vault-internals]], [[auth-and-rbac]], [[agent-safety]].
- **Stuck on a term** → [[glossary]].

---

## By depth count

65 content pages + `index.md` + `log.md` as of 2026-04-16. The tree's maximum depth is 5 (e.g. `index → containerus → architecture → crate-containerus-core → ai-providers → provider-openai`). Every subsystem has at least one child; every cross-cutting flow has a "flow-*" page; every shared concept has a "concept-*" page.
