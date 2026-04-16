# Wiki Log

Append-only record of wiki operations.

---

## 2026-04-16 — initial build

Initial wiki build from the Containerus codebase. Deep exploration of the Angular frontend, Tauri backend, and two Rust crates via three parallel sub-agents.

- Created `index.md` — flat TOC
- Top-level pages: `containerus`, `architecture`, `dual-mode-operation`, `tech-stack`
- Crate pages: `crate-src-tauri`, `crate-containerus-core`, `crate-containerus-server`
- Frontend: `frontend-overview`, `angular-state`, `backend-service`, `dual-path-routing`, `frontend-features`
- Subsystems: `ssh-subsystem`, `ssh-connection-pooling`, `container-runtimes`, `terminal-subsystem`, `port-forwarding`, `ai-providers`, `ai-agent`, `agent-safety`, `credentials-and-vault`, `auth-and-rbac`, `kubernetes`, `monitoring`, `database-schema`, `file-browser`
- Domain pages: `domain-models`, `error-model`
- Operational: `build-and-dev`, `testing`

30 pages + `index.md` + `log.md`.

## 2026-04-16 — restructured into a tree

Promoted the wiki from a flat list of siblings into a real hierarchy. Goal: walk downward from any concept to its detail; walk sideways to related topics; hit a glossary when lost.

**Added 24 new pages**:

- **Flows** (cross-cutting traces): `flow-connect-system`, `flow-agent-query`, `flow-port-forward`
- **SSH variants**: `ssh-known-hosts`, `ssh-proxies`, `ssh-config-parsing`
- **Individual AI providers**: `provider-openai`, `provider-anthropic`, `provider-ollama`, `provider-azure`, `provider-gemini`, `provider-openai-compat`
- **Agent internals**: `agent-session-context`, `agent-events`, `agent-tools`
- **Feature pages**: `feature-containers`, `feature-systems`, `feature-warp-terminal`, `feature-backend`
- **Concepts**: `concept-block`, `concept-system-id`, `concept-session`, `concept-connection-id`, `concept-event-streams`
- **Server subsystems**: `server-vault-internals`, `server-websockets`, `audit-logging`
- **Domain-specific**: `command-templates`, `compose-projects`, `settings-and-preferences`, `executor-abstraction`
- **Patterns**: `pattern-signals-and-state`, `pattern-dual-path`, `pattern-three-database-pattern`
- **Reference**: `glossary`

**Added navigation headers** to all 30 pre-existing pages — each now declares **Parent**, optional **Children**, and **See also**.

**Rewrote `index.md`** as a tree. Max depth 5, grouped by crate / subsystem / flow / frontend / patterns / concepts. Added "Browse by role" section so newcomers can start from their intent, not from a giant TOC.

65 content pages total (plus `index.md` and `log.md`). Every article has at least one inbound link from a parent or sibling.
