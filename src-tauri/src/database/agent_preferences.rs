use rusqlite::Connection;

use crate::models::agent::AgentPreferences;

pub fn get_agent_preferences(conn: &Connection) -> Result<AgentPreferences, String> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS agent_preferences (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            auto_execute_safe_commands INTEGER NOT NULL DEFAULT 1,
            show_thinking_process INTEGER NOT NULL DEFAULT 0,
            confirm_all_commands INTEGER NOT NULL DEFAULT 0,
            max_auto_execute_steps INTEGER NOT NULL DEFAULT 5,
            confirmation_timeout_secs INTEGER NOT NULL DEFAULT 300,
            preferred_shell TEXT,
            dangerous_command_patterns TEXT NOT NULL DEFAULT '[]'
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT auto_execute_safe_commands, show_thinking_process, confirm_all_commands,
                max_auto_execute_steps, confirmation_timeout_secs, preferred_shell, dangerous_command_patterns
             FROM agent_preferences WHERE id = 1",
        )
        .map_err(|e| e.to_string())?;

    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;

    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let auto_execute: i32 = row.get(0).map_err(|e| e.to_string())?;
        let show_thinking: i32 = row.get(1).map_err(|e| e.to_string())?;
        let confirm_all: i32 = row.get(2).map_err(|e| e.to_string())?;
        let max_steps: i32 = row.get(3).map_err(|e| e.to_string())?;
        let timeout: i32 = row.get(4).map_err(|e| e.to_string())?;
        let shell: Option<String> = row.get(5).map_err(|e| e.to_string())?;
        let patterns_json: String = row.get(6).map_err(|e| e.to_string())?;

        Ok(AgentPreferences {
            auto_execute_safe_commands: auto_execute != 0,
            show_thinking_process: show_thinking != 0,
            confirm_all_commands: confirm_all != 0,
            max_auto_execute_steps: max_steps,
            confirmation_timeout_secs: timeout,
            preferred_shell: shell,
            dangerous_command_patterns: serde_json::from_str(&patterns_json).unwrap_or_default(),
        })
    } else {
        Ok(AgentPreferences::default())
    }
}

pub fn update_agent_preferences(
    conn: &Connection,
    preferences: &AgentPreferences,
) -> Result<(), String> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS agent_preferences (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            auto_execute_safe_commands INTEGER NOT NULL DEFAULT 1,
            show_thinking_process INTEGER NOT NULL DEFAULT 0,
            confirm_all_commands INTEGER NOT NULL DEFAULT 0,
            max_auto_execute_steps INTEGER NOT NULL DEFAULT 5,
            confirmation_timeout_secs INTEGER NOT NULL DEFAULT 300,
            preferred_shell TEXT,
            dangerous_command_patterns TEXT NOT NULL DEFAULT '[]'
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    let patterns_json =
        serde_json::to_string(&preferences.dangerous_command_patterns).unwrap_or_default();

    conn.execute(
        "INSERT INTO agent_preferences (id, auto_execute_safe_commands, show_thinking_process, confirm_all_commands, max_auto_execute_steps, confirmation_timeout_secs, preferred_shell, dangerous_command_patterns)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
             auto_execute_safe_commands = excluded.auto_execute_safe_commands,
             show_thinking_process = excluded.show_thinking_process,
             confirm_all_commands = excluded.confirm_all_commands,
             max_auto_execute_steps = excluded.max_auto_execute_steps,
             confirmation_timeout_secs = excluded.confirmation_timeout_secs,
             preferred_shell = excluded.preferred_shell,
             dangerous_command_patterns = excluded.dangerous_command_patterns",
        (
            preferences.auto_execute_safe_commands as i32,
            preferences.show_thinking_process as i32,
            preferences.confirm_all_commands as i32,
            preferences.max_auto_execute_steps,
            preferences.confirmation_timeout_secs,
            &preferences.preferred_shell,
            &patterns_json,
        ),
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}
