# Command templates

**Summary**: Saved shell templates with variable substitution. Backed by SQLite (desktop-only — no backend path yet). Built-in templates are seeded on every launch; user-created templates are freely editable; favorites surface first.

**Sources**: `src-tauri/src/commands/command_template.rs`, `src-tauri/src/database.rs` (template functions), `src/app/features/commands/*`, `src/app/state/command-template.state.ts`.

**Last updated**: 2026-04-16

**Parent**: [[frontend-features]]
**Siblings**: [[compose-projects]], [[feature-containers]], [[feature-systems]]

---

## Model

```rust
pub struct CommandTemplate {
    pub id: String,
    pub name: String,
    pub description: String,
    pub command: String,         // may contain ${variable}
    pub category: CommandCategory,
    pub tags: Vec<String>,
    pub variables: Vec<TemplateVariable>,
    pub compatibility: CommandCompatibility,
    pub is_favorite: bool,
    pub is_built_in: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub enum CommandCategory {
    ContainerManagement, Debugging, Networking,
    Images, Volumes, System, Pods, Custom,
}

pub struct TemplateVariable {
    pub name: String,
    pub description: String,
    pub default_value: Option<String>,
    pub required: bool,
}

pub struct CommandCompatibility {
    pub runtimes: Vec<ContainerRuntime>,
    pub system_ids: Option<Vec<String>>,
}
```

## Tauri commands — `command_template.rs`

Thin wrappers around `AppState`:

- `list_command_templates()` — all, ordered by `is_favorite DESC, name ASC`
- `get_command_template(id)`
- `create_command_template(request)` — returns the created template with generated UUID
- `update_command_template(request)` — merges non-null fields
- `delete_command_template(id)` — refuses built-ins
- `toggle_command_favorite(id)` — flips flag, updates timestamp
- `duplicate_command_template(id)` — clones with new id and ` (Copy)` suffix

## Built-in templates

Seeded on every startup by `seed_built_in_templates(db)`:

- Detects and removes legacy random-UUID built-ins from older versions (cleanup).
- Inserts or updates each canonical built-in with a deterministic id.
- Preserves the user's favorite flag on update (so marking a built-in as favorite survives restarts).
- Marks each with `is_built_in = true`; deletes are refused at the command layer.

Examples of shipped built-ins (abbreviated):
- "Tail container logs"
- "Remove stopped containers"
- "Inspect network"
- "Check disk usage inside a container"
- "List all pods in a namespace"

## Variable substitution

UI flow:
1. User picks a template.
2. If `variables` is non-empty, a dialog (`variable-input-modal` in `shared/`) prompts for each.
3. On submit, the frontend replaces `${var}` tokens in `command` with the input values.
4. The resolved command runs in the active terminal (or gets copied to clipboard, depending on the user's action).

Required variables show a red asterisk; defaults pre-populate inputs; optional variables that are empty substitute to empty string.

## Compatibility

`compatibility.runtimes` restricts the template to specific runtimes (e.g., Podman-only). `compatibility.system_ids` optionally pins it to specific systems. The UI filters templates accordingly — a template targeting Docker isn't shown when the active system only has Podman.

## State — `CommandTemplateState`

- `templates: CommandTemplate[]`
- Filters: `category`, `runtime`, `systemId`, `search`
- `sortBy: 'name' | 'updated' | 'favorite'`

Computed: `filteredTemplates`, `favoriteTemplates`, `byCategory`.

## Why no backend path

Command templates are user-specific productivity snippets. Sharing them across users hasn't been needed yet. A future "team templates" layer would fit naturally into a project — tracked in the backlog.

## Related pages

- [[frontend-features]]
- [[crate-src-tauri]]
- [[database-schema]]
