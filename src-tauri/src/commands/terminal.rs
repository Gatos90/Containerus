use std::collections::HashMap;
#[cfg(not(target_os = "android"))]
use std::io::{Read, Write};
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex, RwLock};

#[cfg(not(target_os = "android"))]
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use russh::ChannelMsg;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::models::container::ContainerRuntime;
use crate::models::error::ContainerError;
use crate::models::system::ConnectionType;
use crate::ssh;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSession {
    pub id: String,
    pub system_id: String,
    pub container_id: Option<String>,
    pub shell: String,
}

/// Represents a terminal session handle - either local PTY or SSH channel
#[allow(dead_code)]
pub enum SessionHandle {
    #[cfg(not(target_os = "android"))]
    Local {
        master: Box<dyn MasterPty + Send>,
        writer: Box<dyn Write + Send>,
    },
    Ssh {
        /// Sender for input data to the SSH channel task
        input_tx: mpsc::Sender<TerminalInput>,
    },
}

/// Messages that can be sent to a terminal session
pub enum TerminalInput {
    Data(Vec<u8>),
    Resize { cols: u16, rows: u16 },
    Close,
}

/// Manages all active terminal sessions
#[derive(Clone)]
pub struct TerminalSessions {
    sessions: Arc<Mutex<HashMap<String, SessionHandle>>>,
    /// Output listeners for agent commands - keyed by terminal session ID
    output_listeners: Arc<RwLock<HashMap<String, mpsc::Sender<String>>>>,
}

impl Default for TerminalSessions {
    fn default() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            output_listeners: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

impl TerminalSessions {
    pub fn get_sessions(&self) -> Arc<Mutex<HashMap<String, SessionHandle>>> {
        self.sessions.clone()
    }

    /// Register an output listener for a terminal session.
    /// Returns a receiver that will get all terminal output while registered.
    pub async fn register_output_listener(&self, session_id: &str) -> mpsc::Receiver<String> {
        let (tx, rx) = mpsc::channel(256);
        self.output_listeners
            .write()
            .await
            .insert(session_id.to_string(), tx);
        rx
    }

    /// Unregister an output listener for a terminal session.
    pub async fn unregister_output_listener(&self, session_id: &str) {
        self.output_listeners.write().await.remove(session_id);
    }

    /// Send output to a registered listener (if any).
    /// This is called by terminal output handlers to forward output to waiting tools.
    pub async fn notify_output(&self, session_id: &str, output: &str) {
        let listeners = self.output_listeners.read().await;
        if let Some(tx) = listeners.get(session_id) {
            // Don't block if receiver is full - just drop
            let _ = tx.try_send(output.to_string());
        }
    }
}

/// Start a new terminal session
#[tauri::command]
pub async fn start_terminal_session(
    app: AppHandle,
    state: State<'_, AppState>,
    sessions: State<'_, TerminalSessions>,
    system_id: String,
    container_id: Option<String>,
    shell: String,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<TerminalSession, ContainerError> {
    let cols = cols.unwrap_or(80);
    let rows = rows.unwrap_or(24);
    let session_id = Uuid::new_v4().to_string();

    // Get system to determine connection type
    let system = state
        .get_system(&system_id)
        .ok_or_else(|| ContainerError::SystemNotFound(system_id.clone()))?;

    let command = build_terminal_command(&container_id, &shell, &system.primary_runtime);

    match system.connection_type {
        ConnectionType::Local => {
            #[cfg(not(target_os = "android"))]
            {
                start_local_session(
                    app,
                    sessions.inner().clone(),
                    session_id.clone(),
                    command,
                    cols,
                    rows,
                )
                .await?
            }
            #[cfg(target_os = "android")]
            {
                return Err(ContainerError::Internal(
                    "Local terminal sessions are not supported on Android".to_string(),
                ));
            }
        }
        ConnectionType::Remote => {
            start_ssh_session(
                app,
                sessions.inner().clone(),
                session_id.clone(),
                &system_id,
                command,
                cols,
                rows,
            )
            .await?
        }
    }

    Ok(TerminalSession {
        id: session_id,
        system_id,
        container_id,
        shell,
    })
}

/// Build the command to run in the terminal
fn build_terminal_command(
    container_id: &Option<String>,
    shell: &str,
    runtime: &ContainerRuntime,
) -> Option<String> {
    container_id.as_ref().map(|cid| {
        let runtime_cmd = match runtime {
            ContainerRuntime::Docker => "docker",
            ContainerRuntime::Podman => "podman",
            ContainerRuntime::Apple => "container",
        };
        format!("{} exec -it {} {}", runtime_cmd, cid, shell)
    })
}

/// Start a local PTY session (desktop only - not available on Android)
#[cfg(not(target_os = "android"))]
async fn start_local_session(
    app: AppHandle,
    terminal_sessions: TerminalSessions,
    session_id: String,
    command: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<(), ContainerError> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| ContainerError::Internal(e.to_string()))?;

    let cmd = if let Some(ref cmd_str) = command {
        #[cfg(target_os = "windows")]
        {
            // On Windows, use cmd.exe /c to handle paths with spaces correctly
            let mut c = CommandBuilder::new("cmd.exe");
            c.args(["/c", cmd_str]);
            c
        }
        #[cfg(not(target_os = "windows"))]
        {
            // On Unix, parse and execute directly
            let parts: Vec<&str> = cmd_str.split_whitespace().collect();
            let mut c = CommandBuilder::new(parts[0]);
            if parts.len() > 1 {
                c.args(&parts[1..]);
            }
            c
        }
    } else {
        #[cfg(target_os = "windows")]
        {
            CommandBuilder::new("cmd.exe")
        }
        #[cfg(not(target_os = "windows"))]
        {
            CommandBuilder::new("/bin/sh")
        }
    };

    pair.slave
        .spawn_command(cmd)
        .map_err(|e| ContainerError::Internal(e.to_string()))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| ContainerError::Internal(e.to_string()))?;
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| ContainerError::Internal(e.to_string()))?;

    // Store session
    terminal_sessions.sessions.lock().await.insert(
        session_id.clone(),
        SessionHandle::Local {
            master: pair.master,
            writer,
        },
    );

    // Spawn reader thread to forward PTY output to frontend
    // Note: Local PTY uses std::thread, so we use a tokio task to bridge async notification
    let sid = session_id.clone();
    let sessions_for_notify = terminal_sessions.clone();
    let rt = tokio::runtime::Handle::current(); // Capture handle before spawning thread
    std::thread::spawn(move || {
        // Use the captured runtime handle for async notifications
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app.emit(
                        "terminal:output",
                        serde_json::json!({
                            "sessionId": sid,
                            "data": &data
                        }),
                    );
                    // Notify any registered output listeners
                    let sid_clone = sid.clone();
                    let sessions_clone = sessions_for_notify.clone();
                    rt.spawn(async move {
                        sessions_clone.notify_output(&sid_clone, &data).await;
                    });
                }
                Err(_) => break,
            }
        }
    });

    Ok(())
}

/// Start an SSH terminal session using existing connection from pool
async fn start_ssh_session(
    app: AppHandle,
    terminal_sessions: TerminalSessions,
    session_id: String,
    system_id: &str,
    command: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<(), ContainerError> {
    // Create channel for sending input to the SSH task
    let (input_tx, mut input_rx) = mpsc::channel::<TerminalInput>(256);

    // Reuse existing SSH connection from pool and open a PTY channel
    let pool = ssh::get_pool();
    let pool_guard = pool.read().await;

    // Get the client and open a PTY channel
    let client = pool_guard
        .get_client(system_id)
        .ok_or_else(|| ContainerError::SystemNotFound(system_id.to_string()))?;

    let mut client_guard = client.lock().await;
    let mut channel = client_guard
        .open_pty_channel_raw(cols as u32, rows as u32, command.as_deref())
        .await?;
    drop(client_guard);
    drop(pool_guard);

    // Store session with input sender
    terminal_sessions
        .sessions
        .lock()
        .await
        .insert(session_id.clone(), SessionHandle::Ssh { input_tx });

    // Spawn task to handle SSH channel I/O
    let sid = session_id.clone();
    let sessions_clone = terminal_sessions.clone();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                // Handle input from user
                Some(input) = input_rx.recv() => {
                    match input {
                        TerminalInput::Data(data) => {
                            if channel.data(&data[..]).await.is_err() {
                                break;
                            }
                        }
                        TerminalInput::Resize { cols, rows } => {
                            let _ = channel.window_change(cols as u32, rows as u32, 0, 0).await;
                        }
                        TerminalInput::Close => {
                            let _ = channel.close().await;
                            break;
                        }
                    }
                }
                // Handle output from SSH channel
                msg = channel.wait() => {
                    match msg {
                        Some(ChannelMsg::Data { data }) => {
                            let output = String::from_utf8_lossy(&data).to_string();

                            // Send to frontend
                            let _ = app.emit(
                                "terminal:output",
                                serde_json::json!({
                                    "sessionId": sid,
                                    "data": &output
                                }),
                            );

                            // Notify any registered output listeners (for AI agent)
                            sessions_clone.notify_output(&sid, &output).await;
                        }
                        Some(ChannelMsg::Eof) | None => break,
                        _ => {}
                    }
                }
            }
        }
        // Clean up session when done
        sessions_clone.sessions.lock().await.remove(&sid);
    });

    Ok(())
}

/// Send input to a terminal session
#[tauri::command]
pub async fn send_terminal_input(
    sessions: State<'_, TerminalSessions>,
    session_id: String,
    data: String,
) -> Result<(), ContainerError> {
    let mut sessions_guard = sessions.sessions.lock().await;

    match sessions_guard.get_mut(&session_id) {
        #[cfg(not(target_os = "android"))]
        Some(SessionHandle::Local { writer, .. }) => {
            writer
                .write_all(data.as_bytes())
                .map_err(|e| ContainerError::Internal(e.to_string()))?;
            writer
                .flush()
                .map_err(|e| ContainerError::Internal(e.to_string()))?;
        }
        Some(SessionHandle::Ssh { input_tx }) => {
            input_tx
                .send(TerminalInput::Data(data.into_bytes()))
                .await
                .map_err(|e| ContainerError::Internal(e.to_string()))?;
        }
        None => return Err(ContainerError::Internal("Session not found".to_string())),
    }

    Ok(())
}

/// Resize a terminal session
#[tauri::command]
pub async fn resize_terminal(
    sessions: State<'_, TerminalSessions>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), ContainerError> {
    let mut sessions_guard = sessions.sessions.lock().await;

    match sessions_guard.get_mut(&session_id) {
        #[cfg(not(target_os = "android"))]
        Some(SessionHandle::Local { master, .. }) => {
            master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|e| ContainerError::Internal(e.to_string()))?;
        }
        Some(SessionHandle::Ssh { input_tx }) => {
            let _ = input_tx.send(TerminalInput::Resize { cols, rows }).await;
        }
        None => {}
    }

    Ok(())
}

/// Close a terminal session
#[tauri::command]
pub async fn close_terminal_session(
    sessions: State<'_, TerminalSessions>,
    session_id: String,
) -> Result<(), ContainerError> {
    let mut sessions_guard = sessions.sessions.lock().await;

    if let Some(handle) = sessions_guard.remove(&session_id) {
        match handle {
            SessionHandle::Ssh { input_tx } => {
                let _ = input_tx.send(TerminalInput::Close).await;
            }
            #[cfg(not(target_os = "android"))]
            SessionHandle::Local { .. } => {
                // Local sessions are cleaned up when dropped
            }
        }
    }

    Ok(())
}

/// Execute a command in a terminal session by sending it as input
/// This sends the command text followed by Enter key
#[tauri::command]
pub async fn execute_in_terminal(
    sessions: State<'_, TerminalSessions>,
    session_id: String,
    command: String,
) -> Result<(), ContainerError> {
    let mut sessions_guard = sessions.sessions.lock().await;

    // Append newline to execute the command
    let command_with_newline = format!("{}\n", command);

    match sessions_guard.get_mut(&session_id) {
        #[cfg(not(target_os = "android"))]
        Some(SessionHandle::Local { writer, .. }) => {
            writer
                .write_all(command_with_newline.as_bytes())
                .map_err(|e| ContainerError::Internal(e.to_string()))?;
            writer
                .flush()
                .map_err(|e| ContainerError::Internal(e.to_string()))?;
        }
        Some(SessionHandle::Ssh { input_tx }) => {
            input_tx
                .send(TerminalInput::Data(command_with_newline.into_bytes()))
                .await
                .map_err(|e| ContainerError::Internal(e.to_string()))?;
        }
        None => return Err(ContainerError::Internal(format!("Session not found: {}", session_id))),
    }

    Ok(())
}

/// List all active terminal session IDs
#[tauri::command]
pub async fn list_terminal_sessions(
    sessions: State<'_, TerminalSessions>,
) -> Result<Vec<String>, ContainerError> {
    let sessions_guard = sessions.sessions.lock().await;
    Ok(sessions_guard.keys().cloned().collect())
}

/// Fetch shell history from a remote system
/// Tries .bash_history and .zsh_history, returns the first found
/// Optionally filters using grep -i on the remote system
#[tauri::command]
pub async fn fetch_shell_history(
    system_id: String,
    max_entries: Option<u32>,
    filter: Option<String>,
) -> Result<Vec<String>, ContainerError> {
    let limit = max_entries.unwrap_or(500);

    // Build grep filter if provided (escape single quotes for shell safety)
    let grep_filter = filter
        .as_ref()
        .filter(|f| !f.trim().is_empty())
        .map(|f| format!(" | grep -i '{}'", f.replace('\'', "'\\''")))
        .unwrap_or_default();

    // Try common history files in order
    let history_commands = vec![
        // bash history - simple format, one command per line
        // When filtering: cat | grep | tail (filter first, then limit)
        format!(
            "[ -f ~/.bash_history ] && cat ~/.bash_history{} | tail -{}",
            grep_filter, limit
        ),
        // zsh history - may have timestamp format `: 1234567890:0;command`
        // Strip timestamps first with sed, then filter, then limit
        format!(
            "[ -f ~/.zsh_history ] && cat ~/.zsh_history | sed 's/^: [0-9]*:[0-9]*;//'{} | tail -{}",
            grep_filter, limit
        ),
    ];

    for cmd in history_commands {
        if let Ok(result) = crate::ssh::execute_on_system(&system_id, &cmd).await {
            if result.success() && !result.stdout.trim().is_empty() {
                return Ok(result
                    .stdout
                    .lines()
                    .filter(|s| !s.trim().is_empty())
                    .map(|s| s.to_string())
                    .collect());
            }
        }
    }

    // No history found - return empty (not an error)
    Ok(vec![])
}
