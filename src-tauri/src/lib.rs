pub mod agent;
pub mod ai;
pub mod commands;
pub mod database;
pub mod executor;
pub mod models;
pub mod monitoring;
pub mod runtime;
pub mod ssh;
pub mod state;

// Re-export AppState for commands
pub use state::AppState;

use std::sync::Arc;
use tauri::Manager;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize logging
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "containerus=debug,info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!("Starting Containerus application");

    tauri::Builder::default()
        .setup(|app| {
            // Get app data directory for database
            let app_data_dir = app.path().app_data_dir()
                .expect("Failed to get app data directory");
            let db_path = app_data_dir.join("containerus.db");

            tracing::info!("Database path: {:?}", db_path);

            // Initialize AppState with database
            let app_state = state::AppState::new(db_path);
            app.manage(app_state);

            // Initialize terminal sessions
            app.manage(commands::terminal::TerminalSessions::default());

            // Initialize agent session manager
            app.manage(agent::AgentSessionManager::new());

            // Initialize port forward manager
            app.manage(Arc::new(ssh::PortForwardManager::new()));

            // Initialize monitoring manager
            app.manage(monitoring::MonitoringManager::new());

            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_keychain::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            // System commands
            commands::add_system,
            commands::update_system,
            commands::remove_system,
            commands::list_systems,
            commands::connect_system,
            commands::disconnect_system,
            commands::get_connection_state,
            commands::store_ssh_password,
            commands::store_ssh_key_passphrase,
            commands::store_ssh_credentials,
            commands::get_ssh_credentials,
            commands::import_ssh_key_from_file,
            commands::get_extended_system_info,
            commands::has_ssh_config,
            commands::list_ssh_config_hosts,
            commands::get_ssh_host_config,
            commands::get_app_settings,
            commands::update_app_settings,
            // Container commands
            commands::list_containers,
            commands::perform_container_action,
            commands::get_container_logs,
            commands::inspect_container,
            // Image commands
            commands::list_images,
            commands::pull_image,
            commands::remove_image,
            // Volume commands
            commands::list_volumes,
            commands::create_volume,
            commands::remove_volume,
            // Network commands
            commands::list_networks,
            commands::create_network,
            commands::remove_network,
            commands::connect_container_to_network,
            commands::disconnect_container_from_network,
            // Runtime detection
            commands::detect_runtimes,
            // Terminal commands
            commands::start_terminal_session,
            commands::send_terminal_input,
            commands::resize_terminal,
            commands::close_terminal_session,
            commands::execute_in_terminal,
            commands::list_terminal_sessions,
            commands::fetch_shell_history,
            // Port forwarding commands
            commands::create_port_forward,
            commands::stop_port_forward,
            commands::list_port_forwards,
            commands::get_port_forward,
            commands::open_forwarded_port,
            commands::is_port_forwarded,
            // Command template commands
            commands::list_command_templates,
            commands::get_command_template,
            commands::create_command_template,
            commands::update_command_template,
            commands::delete_command_template,
            commands::toggle_command_favorite,
            commands::duplicate_command_template,
            // AI assistant commands
            commands::get_ai_settings_cmd,
            commands::update_ai_settings_cmd,
            commands::list_ai_models,
            commands::list_models_for_provider,
            commands::test_ai_connection,
            commands::test_ai_connection_with_settings,
            commands::get_shell_suggestion,
            commands::pull_ollama_model,
            commands::delete_ollama_model,
            // Agent commands
            commands::start_agent_session,
            commands::get_agent_session,
            commands::get_agent_session_by_terminal,
            commands::submit_agent_query,
            commands::respond_to_confirmation,
            commands::cancel_agent_query,
            commands::close_agent_session,
            commands::update_agent_context,
            commands::append_agent_output,
            commands::get_agent_context_summary,
            commands::get_agent_preferences,
            commands::update_agent_preferences,
            // File browser commands
            commands::list_directory,
            commands::read_file,
            commands::write_file,
            commands::create_directory,
            commands::delete_path,
            commands::rename_path,
            commands::download_file,
            commands::upload_file,
            // Monitoring commands
            commands::start_system_monitoring,
            commands::stop_system_monitoring,
            commands::is_system_monitoring,
            commands::list_monitored_systems,
            commands::get_live_metrics,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
