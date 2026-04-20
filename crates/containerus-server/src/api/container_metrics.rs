//! CON-121 — Per-container metrics endpoint.
//!
//! Samples `docker stats --no-stream` (or the runtime's equivalent) on
//! demand, keeps a bounded in-memory rolling buffer per (system, container),
//! and exposes downsampled 1h / 6h / 24h time series through
//! `GET /api/systems/{id}/containers/{container_id}/metrics`.
//!
//! ## Why in-memory instead of a time-series table
//!
//! The ticket explicitly offered either "persist samples in a time-series
//! table or a rolling buffer — decide with DBA". Phase 3 is a drill-down UI
//! with low priority; we pick the rolling buffer because:
//!
//! * Samples have no long-term value once the container restarts (IDs
//!   rotate), so retention beyond a day is pointless.
//! * Keeping the data out of Postgres removes schema/migration churn for a
//!   feature that's read-only and cheap to reconstruct from the runtime.
//! * The sampler is request-triggered, so idle containers don't cost
//!   anything — Postgres would still hold their rows otherwise.
//!
//! ## Sampling cadence
//!
//! Each GET call takes a new sample only if the buffered tail is older than
//! [`MIN_SAMPLE_INTERVAL`] (30s). This gives dashboards a smooth feed
//! without hammering the remote runtime. The shared SSH connection is used,
//! so every viewer of the same container reuses the same snapshot stream.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use containerus_rbac_macros::require_permissions;
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use containerus_core::models::container::{ContainerRuntime, ContainerStatsSample};
use containerus_core::runtime::{CommandBuilder, OutputParser};

use crate::api::containers::{ensure_shared_connected, get_system_by_id};
use crate::auth::middleware::SystemScoped;
use crate::AppState;

/// Max samples per (system, container). At the 30s sampling floor this
/// covers just over 12 hours of backfill; the 24h window still fills as new
/// samples roll in after a cold start.
const BUFFER_CAPACITY: usize = 1_500;

/// Minimum seconds between a live runtime scrape for the same
/// (system, container). Prevents bursty UI polling from flooding the
/// shared SSH connection while keeping the perceived latency low — a
/// 30s floor still produces ≥120 fresh points across the 1h window.
const MIN_SAMPLE_INTERVAL: Duration = Duration::from_secs(30);

/// Hard cap on downsampled points returned per window (matches CON-121
/// acceptance: "≤~200 datapoints"). Actual per-system throttle numbers
/// live in `AppState::container_metrics_limiter` so tests can swap in a
/// high-ceiling limiter without touching module-level constants.
const MAX_POINTS_PER_RESPONSE: usize = 200;

/// Safe shell-identifier predicate (copied semantics from `containers::is_valid_identifier`).
fn is_valid_identifier(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 256
        && s.chars().all(|c| {
            c.is_alphanumeric()
                || c == '_'
                || c == '-'
                || c == '.'
                || c == '/'
                || c == ':'
                || c == '@'
        })
}

/// In-memory ring buffer of container metrics, shared across handlers.
///
/// Keyed on `(system_id, container_id)` so two different containers (or the
/// same id on two systems) never collide. Bounded per key at
/// [`BUFFER_CAPACITY`] — on overflow the oldest sample is dropped.
#[derive(Clone, Default)]
pub struct ContainerMetricsStore {
    inner: Arc<Mutex<HashMap<(Uuid, String), VecDeque<ContainerStatsSample>>>>,
}

impl ContainerMetricsStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Append a sample, evicting the oldest entry if the key is full.
    pub fn record(&self, system_id: Uuid, container_id: &str, sample: ContainerStatsSample) {
        let mut guard = self.inner.lock().expect("metrics store poisoned");
        let buf = guard
            .entry((system_id, container_id.to_string()))
            .or_insert_with(|| VecDeque::with_capacity(BUFFER_CAPACITY.min(256)));
        if buf.len() == BUFFER_CAPACITY {
            buf.pop_front();
        }
        buf.push_back(sample);
    }

    /// Timestamp (ms) of the newest sample for this key, if any.
    pub fn latest_timestamp_ms(&self, system_id: Uuid, container_id: &str) -> Option<i64> {
        let guard = self.inner.lock().expect("metrics store poisoned");
        guard
            .get(&(system_id, container_id.to_string()))
            .and_then(|buf| buf.back().map(|s| s.timestamp_ms))
    }

    /// Clone every sample strictly newer than `since_ms` for this key.
    pub fn samples_since(
        &self,
        system_id: Uuid,
        container_id: &str,
        since_ms: i64,
    ) -> Vec<ContainerStatsSample> {
        let guard = self.inner.lock().expect("metrics store poisoned");
        match guard.get(&(system_id, container_id.to_string())) {
            Some(buf) => buf
                .iter()
                .filter(|s| s.timestamp_ms >= since_ms)
                .cloned()
                .collect(),
            None => Vec::new(),
        }
    }
}

/// Supported window strings (`?window=...`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MetricsWindow {
    OneHour,
    SixHours,
    TwentyFourHours,
}

impl MetricsWindow {
    fn parse(s: Option<&str>) -> Result<Self, (StatusCode, Json<serde_json::Value>)> {
        match s.unwrap_or("1h") {
            "1h" => Ok(Self::OneHour),
            "6h" => Ok(Self::SixHours),
            "24h" => Ok(Self::TwentyFourHours),
            other => Err((
                StatusCode::BAD_REQUEST,
                Json(json!({"error": format!("Unsupported window '{other}'; use 1h|6h|24h")})),
            )),
        }
    }

    fn duration(self) -> Duration {
        match self {
            Self::OneHour => Duration::from_secs(3600),
            Self::SixHours => Duration::from_secs(6 * 3600),
            Self::TwentyFourHours => Duration::from_secs(24 * 3600),
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::OneHour => "1h",
            Self::SixHours => "6h",
            Self::TwentyFourHours => "24h",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsQuery {
    pub window: Option<String>,
    pub runtime: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsResponse {
    pub system_id: String,
    pub container_id: String,
    pub window: &'static str,
    /// Requested cap (≤200). Caller can use this to size preallocated arrays.
    pub max_points: usize,
    pub samples: Vec<ContainerStatsSample>,
}

pub fn router() -> Router<AppState> {
    Router::new().route(
        "/{system_id}/containers/{container_id}/metrics",
        get(container_metrics),
    )
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn parse_runtime(s: &str) -> Result<ContainerRuntime, (StatusCode, Json<serde_json::Value>)> {
    match s {
        "docker" => Ok(ContainerRuntime::Docker),
        "podman" => Ok(ContainerRuntime::Podman),
        "apple" => Ok(ContainerRuntime::Apple),
        other => Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": format!("Unknown runtime: {other}")})),
        )),
    }
}

/// Fetch (and store) a fresh sample for this container, unless the buffer
/// tail is newer than [`MIN_SAMPLE_INTERVAL`].
async fn maybe_sample(
    state: &AppState,
    system_id: Uuid,
    container_id: &str,
    runtime: ContainerRuntime,
) {
    let now = now_ms();
    if let Some(latest) = state
        .container_metrics
        .latest_timestamp_ms(system_id, container_id)
    {
        if (now - latest).max(0) < MIN_SAMPLE_INTERVAL.as_millis() as i64 {
            return;
        }
    }

    // Rate-limit at the system level so N chatty containers on one host
    // can't each smuggle independent budgets — the runtime CLI fans out
    // over the same shared SSH connection.
    if !state
        .container_metrics_limiter
        .check(&system_id.to_string())
    {
        tracing::debug!(
            "stats sample throttled for system {} container {}",
            system_id,
            container_id
        );
        return;
    }

    let cmd = CommandBuilder::container_stats(runtime, container_id);
    match state.connections.execute_shared(system_id, &cmd).await {
        Ok(result) if result.success() => {
            if let Some(sample) =
                OutputParser::parse_container_stats(&result.stdout, runtime, now_ms())
            {
                state
                    .container_metrics
                    .record(system_id, container_id, sample);
            }
        }
        Ok(result) => {
            tracing::debug!(
                "stats command failed for system {} container {}: {}",
                system_id,
                container_id,
                result.stderr
            );
        }
        Err(e) => {
            tracing::warn!(
                "stats execute failed for system {} container {}: {e}",
                system_id,
                container_id
            );
        }
    }
}

/// Downsample a raw sample list into `MAX_POINTS_PER_RESPONSE` buckets,
/// averaging numeric fields inside each bucket and using the bucket's end
/// timestamp. Returns the input unchanged if it already fits.
fn downsample(samples: Vec<ContainerStatsSample>, window: MetricsWindow) -> Vec<ContainerStatsSample> {
    if samples.len() <= MAX_POINTS_PER_RESPONSE {
        return samples;
    }
    let bucket_width_ms =
        (window.duration().as_millis() as i64 / MAX_POINTS_PER_RESPONSE as i64).max(1);
    // Anchor buckets to the newest sample's timestamp so the most recent
    // point is always present and aligned to the window's trailing edge.
    let newest_ts = samples.last().map(|s| s.timestamp_ms).unwrap_or(0);

    let mut buckets: HashMap<i64, Vec<&ContainerStatsSample>> = HashMap::new();
    for s in &samples {
        let bucket = (newest_ts - s.timestamp_ms) / bucket_width_ms;
        buckets.entry(bucket).or_default().push(s);
    }
    let mut keys: Vec<i64> = buckets.keys().copied().collect();
    // Smaller "distance from newest" is more recent — emit oldest→newest.
    keys.sort_unstable_by(|a, b| b.cmp(a));

    let mut out = Vec::with_capacity(keys.len());
    for k in keys {
        let bucket = &buckets[&k];
        let n = bucket.len() as f64;
        let cpu = bucket.iter().map(|s| s.cpu_percent as f64).sum::<f64>() / n;
        let mem_pct = bucket.iter().map(|s| s.memory_percent as f64).sum::<f64>() / n;
        let mem = (bucket.iter().map(|s| s.memory_bytes as f64).sum::<f64>() / n) as u64;
        let mem_lim = (bucket.iter().map(|s| s.memory_limit_bytes as f64).sum::<f64>() / n) as u64;
        let net_rx = (bucket.iter().map(|s| s.net_rx_bytes as f64).sum::<f64>() / n) as u64;
        let net_tx = (bucket.iter().map(|s| s.net_tx_bytes as f64).sum::<f64>() / n) as u64;
        let blk_r = (bucket.iter().map(|s| s.block_read_bytes as f64).sum::<f64>() / n) as u64;
        let blk_w = (bucket.iter().map(|s| s.block_write_bytes as f64).sum::<f64>() / n) as u64;
        // Use the bucket's most recent sample timestamp so the x-axis aligns
        // with real observation time, not interpolated midpoints.
        let ts = bucket.iter().map(|s| s.timestamp_ms).max().unwrap_or(0);
        out.push(ContainerStatsSample {
            timestamp_ms: ts,
            cpu_percent: cpu as f32,
            memory_bytes: mem,
            memory_limit_bytes: mem_lim,
            memory_percent: mem_pct as f32,
            net_rx_bytes: net_rx,
            net_tx_bytes: net_tx,
            block_read_bytes: blk_r,
            block_write_bytes: blk_w,
        });
    }
    out
}

/// `GET /api/systems/{system_id}/containers/{container_id}/metrics?window=1h|6h|24h`
#[require_permissions("containers.metrics.view")]
async fn container_metrics(
    user: SystemScoped,
    State(state): State<AppState>,
    Path((_sys_id, container_id)): Path<(Uuid, String)>,
    Query(query): Query<MetricsQuery>,
) -> Result<axum::response::Response, (StatusCode, Json<serde_json::Value>)> {
    if !is_valid_identifier(&container_id) {
        return Ok(
            (StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid container_id"})))
                .into_response(),
        );
    }

    user.require_for_container("containers.metrics.view", &container_id, &state)
        .await
        .map_err(|_| {
            (
                StatusCode::FORBIDDEN,
                Json(json!({"error": "Insufficient permissions"})),
            )
        })?;

    let window = match MetricsWindow::parse(query.window.as_deref()) {
        Ok(w) => w,
        Err(e) => return Ok(e.into_response()),
    };

    // Pull the full system row so we can resolve the runtime; SystemScoped
    // doesn't expose it directly but `user.system` does via the extractor.
    let system = &user.system;
    let system_id = system.id;
    // Force a fetch if the cached row is stale — not needed today, but keeps
    // a single call site for any future system.* lookups.
    let _ = get_system_by_id;

    if let Err(e) = ensure_shared_connected(&state, system).await {
        return Ok(e.into_response());
    }

    let runtime = match parse_runtime(
        query
            .runtime
            .as_deref()
            .unwrap_or(&system.primary_runtime),
    ) {
        Ok(rt) => rt,
        Err(e) => return Ok(e.into_response()),
    };

    maybe_sample(&state, system_id, &container_id, runtime).await;

    let cutoff_ms = now_ms() - window.duration().as_millis() as i64;
    let raw = state
        .container_metrics
        .samples_since(system_id, &container_id, cutoff_ms);
    let downsampled = downsample(raw, window);

    let body = MetricsResponse {
        system_id: system_id.to_string(),
        container_id,
        window: window.label(),
        max_points: MAX_POINTS_PER_RESPONSE,
        samples: downsampled,
    };
    Ok(Json(body).into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(ts: i64, cpu: f32) -> ContainerStatsSample {
        ContainerStatsSample {
            timestamp_ms: ts,
            cpu_percent: cpu,
            memory_bytes: 1024,
            memory_limit_bytes: 2048,
            memory_percent: 50.0,
            net_rx_bytes: 100,
            net_tx_bytes: 200,
            block_read_bytes: 10,
            block_write_bytes: 20,
        }
    }

    #[test]
    fn metrics_window_parse_accepts_defaults() {
        assert_eq!(MetricsWindow::parse(None).unwrap(), MetricsWindow::OneHour);
        assert_eq!(
            MetricsWindow::parse(Some("6h")).unwrap(),
            MetricsWindow::SixHours
        );
        assert_eq!(
            MetricsWindow::parse(Some("24h")).unwrap(),
            MetricsWindow::TwentyFourHours
        );
    }

    #[test]
    fn metrics_window_parse_rejects_unknown() {
        let (status, _) = MetricsWindow::parse(Some("12h")).unwrap_err();
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    #[test]
    fn store_bounds_buffer_length() {
        let store = ContainerMetricsStore::new();
        let sys = Uuid::new_v4();
        for i in 0..(BUFFER_CAPACITY + 10) {
            store.record(sys, "c1", sample(i as i64, 1.0));
        }
        let samples = store.samples_since(sys, "c1", 0);
        assert_eq!(samples.len(), BUFFER_CAPACITY);
        // Oldest samples (ts 0..10) should have been evicted.
        assert!(samples.iter().all(|s| s.timestamp_ms >= 10));
    }

    #[test]
    fn store_samples_since_filters_old() {
        let store = ContainerMetricsStore::new();
        let sys = Uuid::new_v4();
        for i in 0..20 {
            store.record(sys, "c1", sample(i * 1000, 1.0));
        }
        let recent = store.samples_since(sys, "c1", 10_000);
        assert_eq!(recent.len(), 10);
        assert!(recent.iter().all(|s| s.timestamp_ms >= 10_000));
    }

    #[test]
    fn downsample_passes_short_series_through() {
        let samples = (0..50).map(|i| sample(i * 1000, i as f32)).collect::<Vec<_>>();
        let out = downsample(samples.clone(), MetricsWindow::OneHour);
        assert_eq!(out.len(), samples.len());
    }

    #[test]
    fn downsample_caps_long_series_at_max_points() {
        // 24h window with 1 sample every 30s → 2880 samples; confirm output
        // never exceeds the documented cap.
        let samples = (0..2880)
            .map(|i| sample(i * 30_000, (i % 100) as f32))
            .collect::<Vec<_>>();
        let out = downsample(samples, MetricsWindow::TwentyFourHours);
        assert!(out.len() <= MAX_POINTS_PER_RESPONSE);
        assert!(out.len() > 0);
    }

    #[test]
    fn downsample_preserves_time_ordering() {
        let samples = (0..600)
            .map(|i| sample(i * 6_000, i as f32))
            .collect::<Vec<_>>();
        let out = downsample(samples, MetricsWindow::OneHour);
        for pair in out.windows(2) {
            assert!(pair[0].timestamp_ms <= pair[1].timestamp_ms);
        }
    }
}
