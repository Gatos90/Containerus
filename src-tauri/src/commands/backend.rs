use serde::{Deserialize, Serialize};
use tauri::State;

use crate::database;
use crate::models::credentials::BackendTokens;
use crate::state::AppState;

/// Response shape for list_backend_connections (camelCase for JS).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedBackendResponse {
    pub id: String,
    pub server_url: String,
    pub label: String,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
}

#[tauri::command]
pub fn list_backend_connections(
    state: State<'_, AppState>,
) -> Result<Vec<SavedBackendResponse>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let rows = database::get_all_backend_connections(&db).map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let tokens = state.get_cached_backend_tokens(&row.id);
            SavedBackendResponse {
                id: row.id,
                server_url: row.server_url,
                label: row.label,
                access_token: tokens.as_ref().map(|t| t.access_token.clone()),
                refresh_token: tokens.map(|t| t.refresh_token),
            }
        })
        .collect())
}

#[tauri::command]
pub fn save_backend_connection(
    state: State<'_, AppState>,
    id: String,
    server_url: String,
    label: String,
    access_token: Option<String>,
    refresh_token: Option<String>,
) -> Result<(), String> {
    // Upsert connection metadata into SQLite
    let db = state.db.lock().map_err(|e| e.to_string())?;
    database::upsert_backend_connection(&db, &id, &server_url, &label)
        .map_err(|e| e.to_string())?;
    drop(db);

    // Store tokens in vault cache if provided
    match (access_token, refresh_token) {
        (Some(at), Some(rt)) => {
            state.cache_backend_tokens(
                &id,
                BackendTokens {
                    access_token: at,
                    refresh_token: rt,
                },
            );
        }
        _ => {
            // No tokens → remove any stale cached tokens
            state.remove_cached_backend_tokens(&id);
        }
    }

    // Flush vault to keyring so tokens survive restart
    #[cfg(not(target_os = "android"))]
    state.flush_vault()?;

    Ok(())
}

#[tauri::command]
pub fn delete_backend_connection(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    database::delete_backend_connection(&db, &id).map_err(|e| e.to_string())?;
    drop(db);

    state.remove_cached_backend_tokens(&id);

    #[cfg(not(target_os = "android"))]
    state.flush_vault()?;

    Ok(())
}

#[tauri::command]
pub fn delete_all_backend_connections(state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    database::delete_all_backend_connections(&db).map_err(|e| e.to_string())?;
    drop(db);

    state.clear_all_backend_tokens();

    #[cfg(not(target_os = "android"))]
    state.flush_vault()?;

    Ok(())
}
