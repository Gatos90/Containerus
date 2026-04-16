use rusqlite::{Connection, Result as SqliteResult};

use crate::models::command_template::{
    category_to_str, get_built_in_templates, str_to_category, CommandTemplate,
};

/// Sync built-in command templates with the database.
/// Called from init_database during startup.
pub(super) fn seed_built_in_templates(conn: &Connection) -> SqliteResult<()> {
    let templates = get_built_in_templates();

    // Only consider templates with deterministic IDs (starting with "builtin-")
    let mut stmt = conn.prepare(
        "SELECT id, is_favorite FROM command_templates WHERE is_built_in = 1 AND id LIKE 'builtin-%'",
    )?;
    let existing: std::collections::HashMap<String, bool> = stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let is_favorite: i32 = row.get(1)?;
            Ok((id, is_favorite != 0))
        })?
        .filter_map(|r| r.ok())
        .collect();

    // Delete old built-in templates with random UUIDs (the duplicate bug)
    conn.execute(
        "DELETE FROM command_templates WHERE is_built_in = 1 AND id NOT LIKE 'builtin-%'",
        [],
    )?;

    for template in templates {
        if let Some(&is_favorite) = existing.get(&template.id) {
            let tags_json = serde_json::to_string(&template.tags).unwrap_or_default();
            let variables_json = serde_json::to_string(&template.variables).unwrap_or_default();
            let compatibility_json =
                serde_json::to_string(&template.compatibility).unwrap_or_default();

            conn.execute(
                "UPDATE command_templates
                 SET name = ?1, description = ?2, command = ?3, category = ?4, tags = ?5, variables = ?6, compatibility = ?7, updated_at = ?8
                 WHERE id = ?9",
                (
                    &template.name,
                    &template.description,
                    &template.command,
                    category_to_str(template.category),
                    &tags_json,
                    &variables_json,
                    &compatibility_json,
                    &template.updated_at,
                    &template.id,
                ),
            )?;

            let _ = is_favorite; // preserve user's favorite status — do not overwrite
        } else {
            insert_command_template(conn, &template)?;
        }
    }

    Ok(())
}

pub fn insert_command_template(conn: &Connection, template: &CommandTemplate) -> SqliteResult<()> {
    let tags_json = serde_json::to_string(&template.tags).unwrap_or_default();
    let variables_json = serde_json::to_string(&template.variables).unwrap_or_default();
    let compatibility_json = serde_json::to_string(&template.compatibility).unwrap_or_default();

    conn.execute(
        "INSERT INTO command_templates (id, name, description, command, category, tags, variables, compatibility, is_favorite, is_built_in, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        (
            &template.id,
            &template.name,
            &template.description,
            &template.command,
            category_to_str(template.category),
            &tags_json,
            &variables_json,
            &compatibility_json,
            template.is_favorite as i32,
            template.is_built_in as i32,
            &template.created_at,
            &template.updated_at,
        ),
    )?;

    Ok(())
}

pub fn get_all_command_templates(conn: &Connection) -> SqliteResult<Vec<CommandTemplate>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, description, command, category, tags, variables, compatibility, is_favorite, is_built_in, created_at, updated_at
         FROM command_templates
         ORDER BY is_favorite DESC, name ASC",
    )?;

    let templates = stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let name: String = row.get(1)?;
            let description: String = row.get(2)?;
            let command: String = row.get(3)?;
            let category_str: String = row.get(4)?;
            let tags_json: String = row.get(5)?;
            let variables_json: String = row.get(6)?;
            let compatibility_json: String = row.get(7)?;
            let is_favorite: i32 = row.get(8)?;
            let is_built_in: i32 = row.get(9)?;
            let created_at: String = row.get(10)?;
            let updated_at: String = row.get(11)?;

            Ok(CommandTemplate {
                id,
                name,
                description,
                command,
                category: str_to_category(&category_str),
                tags: serde_json::from_str(&tags_json).unwrap_or_default(),
                variables: serde_json::from_str(&variables_json).unwrap_or_default(),
                compatibility: serde_json::from_str(&compatibility_json).unwrap_or_default(),
                is_favorite: is_favorite != 0,
                is_built_in: is_built_in != 0,
                created_at,
                updated_at,
            })
        })?
        .collect::<SqliteResult<Vec<_>>>()?;

    Ok(templates)
}

pub fn get_command_template(conn: &Connection, id: &str) -> SqliteResult<Option<CommandTemplate>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, description, command, category, tags, variables, compatibility, is_favorite, is_built_in, created_at, updated_at
         FROM command_templates
         WHERE id = ?1",
    )?;

    let mut rows = stmt.query([id])?;

    if let Some(row) = rows.next()? {
        let id: String = row.get(0)?;
        let name: String = row.get(1)?;
        let description: String = row.get(2)?;
        let command: String = row.get(3)?;
        let category_str: String = row.get(4)?;
        let tags_json: String = row.get(5)?;
        let variables_json: String = row.get(6)?;
        let compatibility_json: String = row.get(7)?;
        let is_favorite: i32 = row.get(8)?;
        let is_built_in: i32 = row.get(9)?;
        let created_at: String = row.get(10)?;
        let updated_at: String = row.get(11)?;

        Ok(Some(CommandTemplate {
            id,
            name,
            description,
            command,
            category: str_to_category(&category_str),
            tags: serde_json::from_str(&tags_json).unwrap_or_default(),
            variables: serde_json::from_str(&variables_json).unwrap_or_default(),
            compatibility: serde_json::from_str(&compatibility_json).unwrap_or_default(),
            is_favorite: is_favorite != 0,
            is_built_in: is_built_in != 0,
            created_at,
            updated_at,
        }))
    } else {
        Ok(None)
    }
}

pub fn update_command_template(
    conn: &Connection,
    template: &CommandTemplate,
) -> SqliteResult<bool> {
    let tags_json = serde_json::to_string(&template.tags).unwrap_or_default();
    let variables_json = serde_json::to_string(&template.variables).unwrap_or_default();
    let compatibility_json = serde_json::to_string(&template.compatibility).unwrap_or_default();

    let rows_affected = conn.execute(
        "UPDATE command_templates
         SET name = ?1, description = ?2, command = ?3, category = ?4, tags = ?5, variables = ?6, compatibility = ?7, is_favorite = ?8, updated_at = ?9
         WHERE id = ?10",
        (
            &template.name,
            &template.description,
            &template.command,
            category_to_str(template.category),
            &tags_json,
            &variables_json,
            &compatibility_json,
            template.is_favorite as i32,
            &template.updated_at,
            &template.id,
        ),
    )?;

    Ok(rows_affected > 0)
}

pub fn delete_command_template(conn: &Connection, id: &str) -> SqliteResult<bool> {
    let rows_affected = conn.execute(
        "DELETE FROM command_templates WHERE id = ?1 AND is_built_in = 0",
        [id],
    )?;
    Ok(rows_affected > 0)
}

pub fn toggle_command_favorite(conn: &Connection, id: &str) -> SqliteResult<bool> {
    let rows_affected = conn.execute(
        "UPDATE command_templates SET is_favorite = NOT is_favorite, updated_at = ?1 WHERE id = ?2",
        (chrono::Utc::now().to_rfc3339(), id),
    )?;
    Ok(rows_affected > 0)
}
