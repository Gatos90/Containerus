# Feature: Warp terminal

**Summary**: The Warp-style rich terminal. Every command becomes its own block with isolated output; an AI composer translates prompts; search spans all blocks; split layouts run multiple shells simultaneously. Distinct from the dockable classic terminal — this is its own full-screen feature.

**Sources**: `src/app/features/warp-terminal/*`, `src/app/state/block.state.ts`.

**Last updated**: 2026-04-16

**Parent**: [[frontend-features]]
**Siblings**: [[feature-containers]], [[feature-systems]], [[feature-backend]]

---

## Where it lives

- Route: `/warp-terminal`
- Folder: `src/app/features/warp-terminal/`
- Sub-state: `warp-terminal/state/` plus shared `BlockState`

## Components

| Component | Purpose |
|---|---|
| `warp-terminal-view` | The container page |
| `block-list` | Renders the chronological list of blocks |
| `output-viewport` | A block's output with virtual scrolling |
| `command-block-card` | Header + output + actions (rerun, copy, share) per block |
| `composer-bar` | Bottom input — command or natural language |
| `search-overlay` | Full-text search across all blocks |

## Block model

A block represents one user action and its result. Types:

- **Command block** — user ran a shell command; output follows
- **AI prompt block** — user asked the agent in natural language
- **AI response block** — final AI answer text
- **AI command block** — AI-proposed command (with the same exec semantics as a user-run command, plus confirmation UI)

See [[concept-block]] for the full state model.

## AI integration

The composer has two modes: "shell" and "ask". In ask mode, the input is routed to `submit_agent_query`. Event flow:

1. User types and submits.
2. An AI-prompt block materializes.
3. Agent streams events: Thinking, ResponseChunk, ToolInvoked, CommandProposed, ConfirmationRequired, CommandStarted, CommandOutput, CommandCompleted, QueryCompleted. See [[agent-events]].
4. Each command the agent runs spawns its own AI-command block inline, stacked under the prompt.
5. The final AI-response block closes the sequence.

The composer remains responsive — the user can submit another prompt while the previous one is still running; blocks track their own `query_id` and render in parallel.

## Search

The `search-overlay` indexes block output client-side. Arrow keys navigate matches; Enter jumps to the block. Regex mode is available via the search bar.

## Split layouts

Inherits the `TerminalSlot` concept from the docked workspace (`single` / `split-h` / `split-v` / `quad`) — each slot is an independent terminal session with its own block list. Switching slots swaps the rendered `BlockList`; all sessions keep running.

## Block actions

Per block:
- Copy command / copy output
- Rerun (re-submits the same command to the terminal)
- Collapse / expand
- Focus (isolates that block, dims others)
- Share (exports as markdown — command + output fence)

## Persistence

Blocks live in memory only. Closing the warp view drops them; the terminal session itself continues in the dock (or closes, depending on user setting). A future backlog item is a persistent "block history" across sessions.

## Distinct from `/terminal`

The `/terminal` route uses the same underlying PTY/SSH infrastructure but renders a classic streaming terminal inside a dockable workspace. `/warp-terminal` is a richer, full-window experience driven by the block model. Users pick the feel they prefer.

## Related pages

- [[frontend-features]]
- [[terminal-subsystem]]
- [[concept-block]]
- [[ai-agent]]
- [[flow-agent-query]]
