# Agent safety

**Summary**: Every shell command the agent wants to run is first classified by `DangerClassifier` into `Safe | Warning | Dangerous | Critical`. Anything above `Safe` triggers a `ConfirmationRequired` event and blocks until the user approves or denies.

**Sources**: `src-tauri/src/agent/safety/classifier.rs`, `src-tauri/src/agent/events.rs`.

**Last updated**: 2026-04-16

---

## Levels

| Level | Meaning |
|---|---|
| `Safe` | Read-only, reversible, or obviously benign (`ls`, `ps`, `docker logs`) |
| `Warning` | Operational but not destructive (`docker restart`, `systemctl reload`) |
| `Dangerous` | Potentially destructive (`rm -rf <path>`, `docker volume rm`) |
| `Critical` | Catastrophic (`rm -rf /`, `dd of=/dev/sda`, `mkfs`, `shutdown`, `reboot`) |

## Output — `DangerClassification`

```rust
pub struct DangerClassification {
    pub level: DangerLevel,
    pub affected_resources: Vec<String>, // e.g., ["file: /etc/passwd", "container: db-prod"]
    pub warning: String,                  // human-readable explanation
    pub alternatives: Vec<String>,        // safer suggestions
}
```

## Classifier rules

`DangerClassifier::classify(command)` matches a command string against:

- Known destructive verbs and paths: `rm -rf`, `sudo rm`, `chmod 777 /`, `reboot`, `shutdown`, `kill -9 1`, `dd of=/dev/…`, `mkfs*`, `:(){ :|:& };:`, …
- Destructive package manager calls (`apt-get purge`, `yum remove`)
- Database destructive SQL / admin commands
- Container/host volume deletion
- User-provided regex patterns from `AgentPreferences.dangerous_command_patterns`

It extracts the affected resources (paths, container ids, network names) and populates `alternatives` with safer variants (e.g., `rm -i` instead of `rm -f`).

## Enforcement in the loop

`run_agentic_loop` calls the classifier before executing any shell-tool call. When:

- `level == Safe` and `auto_execute_safe_commands == true` → run immediately.
- `level == Safe` but `confirm_all_commands == true` → still prompt.
- `level == Warning` → always prompt.
- `level == Dangerous | Critical` → always prompt with the `warning` and `alternatives` displayed.

The event emitted is `AgentEvent::ConfirmationRequired`:

```rust
ConfirmationRequired {
    session_id, query_id,
    confirmation_id,
    command, risk_level,
    warning: Option<String>,
    alternatives: Vec<CommandAlternative>,
}
```

The frontend renders a confirmation card inside the Warp-style block. `respond_to_confirmation(session_id, ConfirmationResponse)` resolves it with `ConfirmationAction::Approve` or `Deny`, optionally with free-form notes.

## Timeout

`AgentPreferences.confirmation_timeout_secs` bounds how long the loop waits. On timeout, the command is implicitly denied and the turn continues with a tool error.

## Known false positives / negatives

These are tracked in project memory as pre-existing test issues:

- `test_preamble_not_empty` — assertion about the literal substring `"execute_shell"` in the preamble
- `test_dangerous_commands` — `chmod 777` classification edge cases

They predate the current wiki snapshot and are not actively blocking tasks.

## Related pages

- [[ai-agent]]
- [[ai-providers]]
- [[crate-src-tauri]]
