//! Agent Tauri Commands
//!
//! Tauri commands for the AI agent system.


use tauri::{AppHandle, Emitter, State};

use crate::agent::events::{AgentEvent, AgentQueryRequest, ConfirmationResponse};
use crate::agent::session::AgentSessionManager;
use crate::commands::terminal::TerminalSessions;
use crate::database;
use crate::models::agent::{AgentError, AgentPreferences, AgentSessionInfo, ContextSummary};
use crate::state::AppState;

/// Start a new agent session linked to a terminal session
///
/// If `container_id` is provided, the agent context will be set to container environment
/// (Linux shell) so the AI knows it's inside a container and suggests appropriate commands.
#[tauri::command]
pub async fn start_agent_session(
    app: AppHandle,
    agent_sessions: State<'_, AgentSessionManager>,
    terminal_session_id: String,
    container_id: Option<String>,
) -> Result<AgentSessionInfo, String> {
    // Check if session already exists for this terminal
    if let Some(existing) = agent_sessions
        .get_session_by_terminal(&terminal_session_id)
        .await
    {
        return Ok(AgentSessionInfo {
            id: existing.id,
            terminal_session_id: existing.terminal_session_id,
            created_at: existing.created_at,
            last_activity: existing.last_activity,
            has_pending_confirmation: existing.pending_confirmation.is_some(),
            active_query_id: existing.active_query_id,
        });
    }

    // Create new session
    let (session, mut event_rx, _confirmation_rx, _cancel_rx) = agent_sessions
        .create_session(terminal_session_id.clone())
        .await;

    let session_id = session.id.clone();

    // If this is a container terminal, set container context so AI knows it's inside a container
    if let Some(cid) = container_id {
        if let Some(ctx_arc) = agent_sessions.get_context(&session_id).await {
            let mut ctx = ctx_arc.write().await;
            ctx.enter_container(
                cid.clone(),
                "docker".to_string(), // Default runtime
                "sh".to_string(),     // Default shell for containers
            );
            tracing::info!(
                "Agent session {} initialized with container context: {}",
                session_id,
                cid
            );
        }
    }

    let session_info = AgentSessionInfo {
        id: session.id.clone(),
        terminal_session_id: session.terminal_session_id.clone(),
        created_at: session.created_at,
        last_activity: session.last_activity,
        has_pending_confirmation: false,
        active_query_id: None,
    };

    // Spawn event forwarder to frontend
    let app_handle = app.clone();
    tokio::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            let event_name = match &event {
                AgentEvent::Thinking { .. } => "agent:thinking",
                AgentEvent::ResponseChunk { .. } => "agent:response-chunk",
                AgentEvent::CommandProposed { .. } => "agent:command-proposed",
                AgentEvent::ConfirmationRequired { .. } => "agent:confirmation-required",
                AgentEvent::CommandStarted { .. } => "agent:command-started",
                AgentEvent::CommandOutput { .. } => "agent:command-output",
                AgentEvent::CommandCompleted { .. } => "agent:command-completed",
                AgentEvent::ToolInvoked { .. } => "agent:tool-invoked",
                AgentEvent::ToolCompleted { .. } => "agent:tool-completed",
                AgentEvent::StepStarted { .. } => "agent:step-started",
                AgentEvent::StepCompleted { .. } => "agent:step-completed",
                AgentEvent::QueryCompleted { .. } => "agent:query-completed",
                AgentEvent::Error { .. } => "agent:error",
            };
            let _ = app_handle.emit(event_name, &event);
        }
        tracing::debug!("Agent event forwarder ended for session {}", session_id);
    });

    Ok(session_info)
}

/// Get agent session info
#[tauri::command]
pub async fn get_agent_session(
    agent_sessions: State<'_, AgentSessionManager>,
    session_id: String,
) -> Result<Option<AgentSessionInfo>, String> {
    let session = agent_sessions.get_session(&session_id).await;

    Ok(session.map(|s| AgentSessionInfo {
        id: s.id,
        terminal_session_id: s.terminal_session_id,
        created_at: s.created_at,
        last_activity: s.last_activity,
        has_pending_confirmation: s.pending_confirmation.is_some(),
        active_query_id: s.active_query_id,
    }))
}

/// Get agent session by terminal session ID
#[tauri::command]
pub async fn get_agent_session_by_terminal(
    agent_sessions: State<'_, AgentSessionManager>,
    terminal_session_id: String,
) -> Result<Option<AgentSessionInfo>, String> {
    let session = agent_sessions
        .get_session_by_terminal(&terminal_session_id)
        .await;

    Ok(session.map(|s| AgentSessionInfo {
        id: s.id,
        terminal_session_id: s.terminal_session_id,
        created_at: s.created_at,
        last_activity: s.last_activity,
        has_pending_confirmation: s.pending_confirmation.is_some(),
        active_query_id: s.active_query_id,
    }))
}

/// Submit a query to the agent
///
/// Uses the multi-turn agentic loop with tool use for ALL providers:
/// - Anthropic: Uses Claude's native tool_use
/// - OpenAI: Uses function calling
/// - Ollama: Uses tool calling (for compatible models like llama3.1+, mistral)
///
/// Commands are executed ONE AT A TIME, and the AI sees the output before
/// deciding the next command.
#[tauri::command]
pub async fn submit_agent_query(
    app: AppHandle,
    state: State<'_, AppState>,
    agent_sessions: State<'_, AgentSessionManager>,
    terminal_sessions: State<'_, TerminalSessions>,
    request: AgentQueryRequest,
) -> Result<String, String> {
    use crate::agent::executor::run_agentic_loop;
    use std::sync::Arc;

    // Get the agent session
    let session = agent_sessions
        .get_session(&request.session_id)
        .await
        .ok_or_else(|| AgentError::SessionNotFound(request.session_id.clone()).to_string())?;

    // Use provided query ID or generate one
    let query_id = request.query_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    // Get AI settings
    let settings = {
        let db = state
            .db
            .lock()
            .map_err(|e| AgentError::Internal(e.to_string()).to_string())?;
        database::get_ai_settings(&db)
            .map_err(|e| AgentError::DatabaseError(e.to_string()).to_string())?
    };

    // Get the terminal session ID from the agent session
    let terminal_session_id = session.terminal_session_id.clone();

    // Get event sender for the session
    let event_tx = agent_sessions
        .get_event_sender(&request.session_id)
        .await
        .ok_or_else(|| AgentError::SessionNotFound(request.session_id.clone()).to_string())?;

    // Get terminal sessions as Arc for the agentic loop
    let terminal_sessions_arc = Arc::new(terminal_sessions.inner().clone());

    // Get context for the agentic loop
    let context = agent_sessions
        .get_context(&request.session_id)
        .await
        .ok_or_else(|| AgentError::SessionNotFound(request.session_id.clone()).to_string())?;

    // Clone values for spawned task
    let session_id = request.session_id.clone();
    let query = request.query.clone();
    let query_id_clone = query_id.clone();
    let app_clone = app.clone();

    tracing::info!(
        "Starting agentic query - Provider: {:?}, Model: {}",
        settings.provider,
        settings.model_name
    );

    // Use the multi-turn agentic loop for ALL providers
    tokio::spawn(async move {
        match run_agentic_loop(
            &app_clone,
            &session_id,
            &query_id_clone,
            &query,
            &terminal_session_id,
            &settings,
            terminal_sessions_arc,
            context,
            event_tx.clone(),
        )
        .await
        {
            Ok(()) => {
                tracing::info!("Agentic loop completed successfully");
            }
            Err(e) => {
                tracing::error!("Agentic loop failed: {:?}", e);
                let _ = event_tx
                    .send(AgentEvent::Error {
                        session_id: session_id.clone(),
                        query_id: Some(query_id_clone),
                        error_type: crate::agent::events::AgentErrorType::ProviderUnavailable,
                        message: format!("{:?}", e),
                        recoverable: true,
                        suggestion: Some("Check your AI provider settings".to_string()),
                    })
                    .await;
            }
        }
    });

    Ok(query_id)
}

/// Respond to a confirmation request
#[tauri::command]
pub async fn respond_to_confirmation(
    agent_sessions: State<'_, AgentSessionManager>,
    session_id: String,
    response: ConfirmationResponse,
) -> Result<(), String> {
    let confirmed = matches!(
        response.action,
        crate::agent::events::ConfirmationAction::Approve
    );

    agent_sessions
        .send_confirmation(&session_id, confirmed)
        .await
        .map_err(|e| AgentError::Internal(e).to_string())?;

    // Clear pending confirmation
    if let Some(mut session) = agent_sessions.get_session(&session_id).await {
        session.clear_pending_confirmation();
        let _ = agent_sessions.update_session(session).await;
    }

    Ok(())
}

/// Cancel an in-progress agent query
#[tauri::command]
pub async fn cancel_agent_query(
    agent_sessions: State<'_, AgentSessionManager>,
    session_id: String,
) -> Result<(), String> {
    agent_sessions
        .cancel_session(&session_id)
        .await
        .map_err(|e| AgentError::Internal(e).to_string())?;

    // Send cancel event
    let _ = agent_sessions
        .send_event(
            &session_id,
            AgentEvent::QueryCompleted {
                session_id: session_id.clone(),
                query_id: String::new(),
                status: crate::agent::events::QueryCompletionStatus::Cancelled,
                summary: Some("Query cancelled by user".to_string()),
                blocks_created: vec![],
            },
        )
        .await;

    Ok(())
}

/// Close an agent session
#[tauri::command]
pub async fn close_agent_session(
    agent_sessions: State<'_, AgentSessionManager>,
    session_id: String,
) -> Result<(), String> {
    agent_sessions.remove_session(&session_id).await;
    Ok(())
}

/// Update terminal context for agent session
#[tauri::command]
pub async fn update_agent_context(
    agent_sessions: State<'_, AgentSessionManager>,
    session_id: String,
    cwd: Option<String>,
    git_branch: Option<String>,
    last_exit_code: Option<i32>,
) -> Result<(), String> {
    let mut session = agent_sessions
        .get_session(&session_id)
        .await
        .ok_or_else(|| AgentError::SessionNotFound(session_id.clone()).to_string())?;

    if let Some(cwd) = cwd {
        session.terminal_context.cwd = cwd;
    }
    if let Some(branch) = git_branch {
        session.terminal_context.git_branch = Some(branch);
    }
    if let Some(code) = last_exit_code {
        session.terminal_context.last_exit_code = Some(code);
    }

    agent_sessions
        .update_session(session)
        .await
        .map_err(|e| AgentError::Internal(e).to_string())?;

    Ok(())
}

/// Append terminal output to agent context
#[tauri::command]
pub async fn append_agent_output(
    agent_sessions: State<'_, AgentSessionManager>,
    session_id: String,
    output: String,
) -> Result<(), String> {
    agent_sessions
        .append_output(&session_id, &output)
        .await
        .map_err(|e| AgentError::Internal(e).to_string())?;

    Ok(())
}

/// Get context summary for display
#[tauri::command]
pub async fn get_agent_context_summary(
    agent_sessions: State<'_, AgentSessionManager>,
    session_id: String,
) -> Result<ContextSummary, String> {
    let session = agent_sessions
        .get_session(&session_id)
        .await
        .ok_or_else(|| AgentError::SessionNotFound(session_id.clone()).to_string())?;

    Ok(ContextSummary {
        attached_blocks: vec![],
        recent_commands: session
            .history
            .iter()
            .filter(|m| matches!(m.role, crate::agent::session::MessageRole::User))
            .map(|m| m.content.clone())
            .collect(),
        cwd: session.terminal_context.cwd,
        git_branch: session.terminal_context.git_branch,
    })
}

/// Get agent preferences
#[tauri::command]
pub async fn get_agent_preferences(
    state: State<'_, AppState>,
) -> Result<AgentPreferences, String> {
    let db = state
        .db
        .lock()
        .map_err(|e| AgentError::Internal(e.to_string()).to_string())?;

    database::get_agent_preferences(&db).map_err(|e| AgentError::DatabaseError(e).to_string())
}

/// Update agent preferences
#[tauri::command]
pub async fn update_agent_preferences(
    state: State<'_, AppState>,
    preferences: AgentPreferences,
) -> Result<(), String> {
    let db = state
        .db
        .lock()
        .map_err(|e| AgentError::Internal(e.to_string()).to_string())?;

    database::update_agent_preferences(&db, &preferences)
        .map_err(|e| AgentError::DatabaseError(e).to_string())
}
