use rusqlite::{Connection, Result as SqliteResult};
use serde::{Deserialize, Serialize};

/// A saved backend connection row from the database.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedBackendRow {
    pub id: String,
    pub server_url: String,
    pub label: String,
}

pub fn upsert_backend_connection(
    conn: &Connection,
    id: &str,
    server_url: &str,
    label: &str,
) -> SqliteResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO backend_connections (id, server_url, label, created_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET
             server_url = excluded.server_url,
             label = excluded.label",
        (id, server_url, label, &now),
    )?;
    Ok(())
}

pub fn get_all_backend_connections(conn: &Connection) -> SqliteResult<Vec<SavedBackendRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, server_url, label FROM backend_connections ORDER BY created_at ASC",
    )?;

    let rows = stmt
        .query_map([], |row| {
            Ok(SavedBackendRow {
                id: row.get(0)?,
                server_url: row.get(1)?,
                label: row.get(2)?,
            })
        })?
        .collect::<SqliteResult<Vec<_>>>()?;

    Ok(rows)
}

pub fn delete_backend_connection(conn: &Connection, id: &str) -> SqliteResult<bool> {
    let rows_affected =
        conn.execute("DELETE FROM backend_connections WHERE id = ?1", [id])?;
    Ok(rows_affected > 0)
}

pub fn delete_all_backend_connections(conn: &Connection) -> SqliteResult<()> {
    conn.execute("DELETE FROM backend_connections", [])?;
    Ok(())
}
