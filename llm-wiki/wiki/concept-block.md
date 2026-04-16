# Concept: block

**Summary**: A "block" is one user-visible unit of terminal activity — a command + its output, or an AI prompt + its response, or an AI-proposed command. The Warp terminal renders its entire view as a chronological list of blocks; `BlockState` is the signal-backed store.

**Sources**: `src/app/state/block.state.ts`, `src/app/features/warp-terminal/*`, `src-tauri/src/agent/events.rs`.

**Last updated**: 2026-04-16

**Parent**: [[frontend-overview]]
**Siblings**: [[concept-system-id]], [[concept-session]], [[concept-connection-id]]

---

## Types

```ts
type BlockKind =
  | 'command'        // user ran a shell command
  | 'ai-prompt'      // user asked the agent in natural language
  | 'ai-response'    // final AI answer
  | 'ai-command';    // agent proposed/ran a shell command
```

Every block carries:
- `id: string` (UUID)
- `kind: BlockKind`
- `createdAt: Date`
- `collapsed: boolean`
- `focused: boolean`
- Kind-specific payload (command string, output chunks, exit code, query_id, etc.)

## Where blocks come from

- **Shell command** — typed directly in the composer; the terminal service runs it and emits `terminal:block_created` / `terminal:block_ended` events from `commands/terminal.rs::execute_in_terminal`.
- **AI prompt** — user submits a query via `submit_agent_query`; block opens immediately.
- **AI command** — agent fires `CommandProposed` / `CommandStarted` events (see [[agent-events]]).
- **AI response** — final text after `QueryCompleted`.

## State — `BlockState`

```ts
@Injectable({ providedIn: 'root' })
class BlockState {
  private _blocks = signal<Map<string, Block>>(new Map());
  private _collapsedIds = signal<Set<string>>(new Set());
  private _focusedBlockId = signal<string | null>(null);

  readonly blockList = computed(() => [...this._blocks().values()]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()));
  readonly commandBlocks = computed(() => this.blockList().filter(b => b.kind === 'command' || b.kind === 'ai-command'));
  readonly runningCommands = computed(() => this.commandBlocks().filter(b => b.running));
}
```

Mutations (`appendChunk`, `closeCommandBlock`, `finishQuery`, …) go through typed methods — components never write signals directly.

## Visual states

| State | Meaning | Styling |
|---|---|---|
| running | command is still streaming | Spinner + dim output tail |
| success | exit code 0 | Green dot |
| failure | non-zero exit | Red dot |
| pending-confirm | agent is waiting for Approve/Deny | Yellow badge + action buttons |
| collapsed | hidden body | Header only |
| focused | single-block view | Dims siblings |

## Why "block" and not "entry"?

The term comes from Warp.dev's terminal UX. The point is: each command's output is bounded to its own scroll region so users can copy/rerun/share without the typical "where does this command's output end?" problem of classic streaming terminals. Search finds text *in a block*, not in a stream.

## Related pages

- [[feature-warp-terminal]]
- [[terminal-subsystem]]
- [[ai-agent]]
- [[agent-events]]
