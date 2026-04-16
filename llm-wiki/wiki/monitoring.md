# Monitoring

**Summary**: `MonitoringManager` runs per-system background tasks that periodically fetch CPU, memory, disk, and network metrics and emit them as Tauri `system:metrics` events. The frontend's `SystemMonitoringService` consumes those events and keeps a rolling 30-sample history.

**Sources**: `src-tauri/src/monitoring/mod.rs`, `src-tauri/src/commands/system.rs`, `src/app/core/services/system-monitoring.service.ts`, `crates/containerus-core/src/models/system.rs`.

**Last updated**: 2026-04-16

---

## What gets measured — `LiveSystemMetrics`

```rust
pub struct LiveSystemMetrics {
    pub system_id: String,
    pub timestamp: DateTime<Utc>,
    pub cpu_usage_percent: f64,
    pub memory_usage_percent: f64,
    pub memory_used: u64,
    pub memory_total: u64,
    pub load_average: Option<(f64, f64, f64)>,
    pub swap_usage_percent: Option<f64>,
    // plus disk and network I/O in `LiveSystemMetrics` extensions
}
```

Collected via runtime-specific shell probes:

- macOS: `top -l 1 -s 0`, `vm_stat`, `iostat`, `netstat`
- Linux: `/proc/stat`, `/proc/meminfo`, `/proc/diskstats`, `/proc/net/dev`
- Windows: WMI fallbacks

`OutputParser` has parallel parsing functions that produce typed metrics from each.

## Tauri side — `MonitoringManager`

```rust
pub struct MonitoringManager {
    active_monitors: DashMap<String, MonitorHandle>,
}

pub struct MonitorHandle {
    join: JoinHandle<()>,
    stop: oneshot::Sender<()>,
}
```

- `start_monitoring(app, system_id, interval_ms)` — spawns a tokio task:
  1. Verify the system is `Connected`. If not, exit.
  2. Tick on `interval_ms`. Each tick:
     - Call `fetch_metrics_internal(app, system_id)` — uses `get_executor_for_system` and the runtime parser.
     - `app.emit("system:metrics", metrics)` to the frontend.
  3. On `stop` signal or disconnect, clean up the map entry.
- `stop_monitoring(system_id)` — sends the oneshot signal and awaits the task.
- `is_monitoring`, `monitored_systems` — diagnostics.

The `get_live_metrics` command returns a single snapshot without starting a background monitor — useful for one-shot refreshes.

## Frontend — `SystemMonitoringService`

Tauri-owned systems:
- Listens to Tauri `system:metrics` events and funnels updates into `SystemState.monitoring`.
- Starts / stops with `start_system_monitoring` / `stop_system_monitoring` Tauri commands.
- Retains the last **30** samples per system for sparkline rendering (`MetricBar` component).

Backend-owned systems:
- Polls `/api/systems/:id/metrics` on an interval (no WS push on the server side).
- Same 30-sample history.

This is the one service that is *hybrid* rather than clean dual-path — it combines events and polling depending on ownership. See [[dual-path-routing]].

## Interval tuning

Default interval is 5 s for the desktop path. The server poll defaults to 10 s to reduce load on shared connections. Users can change it in settings; the signal flows through `SystemState.monitoring.intervalMs`.

## Stop conditions

- Explicit stop from the UI
- System moving to `Disconnected`
- Component unmount for per-page monitors (the detail page might monitor independently of the global list)

## Related pages

- [[container-runtimes]]
- [[ssh-subsystem]]
- [[angular-state]]
- [[dual-path-routing]]
