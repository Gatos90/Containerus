# Agent tools

**Summary**: Three tools that the LLM can call: `shell_execute` (run a command), `state_query` (inspect current system/container state), and `history_query` (search past commands). JSON-schema definitions live in `tools/definitions.rs` and get serialized into each provider's native tool format.

**Sources**: `src-tauri/src/agent/tools/*.rs`.

**Last updated**: 2026-04-16

**Parent**: [[ai-agent]]
**Siblings**: [[agent-session-context]], [[agent-events]], [[agent-safety]]

---

## `shell_execute`

The primary tool. Executes a shell command, captures output, returns the result.

### Input

```json
{
  "command": "docker ps -a",
  "cwd": "/home/user/project",   // optional
  "timeout_ms": 30000            // optional
}
```

### Behavior

1. `DangerClassifier::classify(command)` → if above `Safe`, emit `ConfirmationRequired` and wait. See [[agent-safety]].
2. `executor::execute_shell_command(command, cwd)` spawns `/bin/sh -c <command>` (Unix) or `cmd /C <command>` (Windows).
3. Stream stdout/stderr as `CommandOutput` events.
4. Return `{ stdout, stderr, exit_code, success }` to the model.

### Where it executes

Locally in the Tauri process, using the local shell. Even when the terminal session is SSH, the agent's tool execution is local — the model can then SSH or `docker exec` as part of the command itself. This keeps tool dispatch simple and predictable.

A future enhancement is to run the tool *in the same PTY as the attached terminal session*, so cwd / env drift is shared. For now the `cwd` argument is the workaround.

## `state_query`

Inspects currently-known state without shelling out.

### Input

```json
{
  "resource": "containers" | "images" | "volumes" | "networks" | "processes",
  "filter": { "system_id?": "...", "status?": "running" }
}
```

### Behavior

Reads the appropriate state from the frontend's cache (via cached command results) or the agent's `TerminalContext`. Returns a compact JSON summary.

Intended to let the model answer "which containers are running?" without proposing `docker ps` (which would round-trip through SSH).

## `history_query`

Searches the session's `command_history` for prior commands.

### Input

```json
{ "query": "docker run", "limit": 5 }
```

### Behavior

Case-insensitive substring match against the stored commands. Returns the last N matches with command, exit code, truncated output, and timestamp.

Useful for queries like "what was the last thing I ran that touched this container?" — the model can answer without asking the user.

## Tool registration — `tools/definitions.rs`

`build_tool_definitions() -> Vec<ToolDefinition>` emits the canonical schema list:

```rust
ToolDefinition {
    name: "shell_execute",
    description: "Execute a shell command and return its output...",
    input_schema: {
        type: "object",
        properties: {
            command: { type: "string", description: "..." },
            cwd:     { type: "string", description: "..." },
            timeout_ms: { type: "integer", minimum: 1000, maximum: 300000 },
        },
        required: ["command"],
    },
}
```

Each provider's tool translator serializes this into its native shape:
- Anthropic: `{ name, description, input_schema }`
- OpenAI / Ollama / compat: `{ type: "function", function: { name, description, parameters } }`
- Gemini: `{ functionDeclarations: [{ name, description, parameters }] }`

## Why only three

Resist tool sprawl. Each new tool is a surface for the model to misfire on; simpler is safer. `shell_execute` covers everything imperative, and the other two cover read-only common-case queries that would otherwise be unsafe or expensive to translate to shell commands.

## Related pages

- [[ai-agent]]
- [[agent-events]]
- [[agent-safety]]
- [[flow-agent-query]]
