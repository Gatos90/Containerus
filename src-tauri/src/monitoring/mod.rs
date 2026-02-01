use dashmap::DashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::executor::local::LocalExecutor;
use crate::executor::CommandExecutor;
use crate::models::system::{ConnectionState, ConnectionType, LiveSystemMetrics};
use crate::runtime::{CommandBuilder, OutputParser};
use crate::state::AppState;

/// Event name for live metrics updates
pub const METRICS_EVENT: &str = "system:metrics";

/// Manages background monitoring tasks for connected systems
pub struct MonitoringManager {
    /// Active monitoring tasks, keyed by system_id
    active_monitors: DashMap<String, MonitorHandle>,
}

struct MonitorHandle {
    /// Handle to the spawned task
    task: JoinHandle<()>,
    /// Channel to signal stop
    stop_tx: mpsc::Sender<()>,
}

impl Default for MonitoringManager {
    fn default() -> Self {
        Self::new()
    }
}

impl MonitoringManager {
    pub fn new() -> Self {
        Self {
            active_monitors: DashMap::new(),
        }
    }

    /// Start monitoring a system at the specified interval
    pub fn start_monitoring(
        &self,
        app: AppHandle,
        system_id: String,
        interval_ms: u64,
    ) -> bool {
        // Don't start if already monitoring
        if self.active_monitors.contains_key(&system_id) {
            tracing::debug!("Already monitoring system {}", system_id);
            return false;
        }

        let (stop_tx, mut stop_rx) = mpsc::channel::<()>(1);
        let system_id_clone = system_id.clone();
        let app_clone = app.clone();

        let task = tokio::spawn(async move {
            let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(interval_ms));

            tracing::info!("Started monitoring for system {} (interval: {}ms)", system_id_clone, interval_ms);

            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        // Get state from app handle
                        let state = app_clone.state::<AppState>();

                        // Check if system is still connected
                        if state.connection_state(&system_id_clone) != ConnectionState::Connected {
                            tracing::debug!("System {} disconnected, stopping monitor", system_id_clone);
                            break;
                        }

                        // Fetch metrics
                        match Self::fetch_metrics_internal(&app_clone, &system_id_clone).await {
                            Ok(metrics) => {
                                // Emit event to frontend
                                if let Err(e) = app_clone.emit(METRICS_EVENT, &metrics) {
                                    tracing::warn!("Failed to emit metrics event for {}: {}", system_id_clone, e);
                                }
                            }
                            Err(e) => {
                                tracing::debug!("Failed to fetch metrics for {}: {}", system_id_clone, e);
                            }
                        }
                    }
                    _ = stop_rx.recv() => {
                        tracing::info!("Received stop signal for system {}", system_id_clone);
                        break;
                    }
                }
            }

            tracing::info!("Monitoring stopped for system {}", system_id_clone);
        });

        self.active_monitors.insert(
            system_id.clone(),
            MonitorHandle { task, stop_tx },
        );

        true
    }

    /// Stop monitoring a system
    pub async fn stop_monitoring(&self, system_id: &str) -> bool {
        if let Some((_, handle)) = self.active_monitors.remove(system_id) {
            // Send stop signal
            let _ = handle.stop_tx.send(()).await;
            // Wait for task to finish (with timeout)
            let _ = tokio::time::timeout(
                tokio::time::Duration::from_secs(2),
                handle.task,
            ).await;
            tracing::info!("Stopped monitoring for system {}", system_id);
            true
        } else {
            false
        }
    }

    /// Check if a system is being monitored
    pub fn is_monitoring(&self, system_id: &str) -> bool {
        self.active_monitors.contains_key(system_id)
    }

    /// Get list of systems being monitored
    pub fn monitored_systems(&self) -> Vec<String> {
        self.active_monitors
            .iter()
            .map(|r| r.key().clone())
            .collect()
    }

    /// Stop all monitoring tasks
    pub async fn stop_all(&self) {
        let system_ids: Vec<String> = self.active_monitors
            .iter()
            .map(|r| r.key().clone())
            .collect();

        for system_id in system_ids {
            self.stop_monitoring(&system_id).await;
        }
    }

    /// Fetch metrics for a system (internal version for the monitoring loop)
    async fn fetch_metrics_internal(
        app: &AppHandle,
        system_id: &str,
    ) -> Result<LiveSystemMetrics, String> {
        let state = app.state::<AppState>();

        let system = state
            .get_system(system_id)
            .ok_or_else(|| format!("System {} not found", system_id))?;

        // Build the platform-appropriate command
        let command = match system.connection_type {
            ConnectionType::Local => CommandBuilder::get_live_metrics_for_local(),
            ConnectionType::Remote => CommandBuilder::get_live_metrics_for_remote(),
        };

        // Execute command based on connection type
        let result = match system.connection_type {
            ConnectionType::Local => {
                let executor = LocalExecutor::new();
                if cfg!(windows) {
                    executor.execute_powershell(command).await
                } else {
                    executor.execute(command).await
                }
            }
            ConnectionType::Remote => {
                crate::ssh::execute_on_system(system_id, command).await
            }
        };

        match result {
            Ok(res) if res.success() => {
                Ok(OutputParser::parse_live_metrics(&res.stdout, system_id))
            }
            Ok(res) => Err(format!("Command failed: {}", res.stderr)),
            Err(e) => Err(format!("Execution error: {}", e)),
        }
    }
}

impl Drop for MonitoringManager {
    fn drop(&mut self) {
        // Cancel all tasks on drop
        for entry in self.active_monitors.iter() {
            entry.value().task.abort();
        }
    }
}
