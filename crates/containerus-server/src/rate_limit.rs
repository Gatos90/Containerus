use std::collections::VecDeque;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::extract::Request;
use dashmap::DashMap;

/// Sliding-window rate limiter keyed by client IP address.
///
/// Stores timestamps of recent requests per IP. On each request the window is
/// purged of entries older than `window`, then the count is checked against
/// `max_requests`. Approved requests record the current timestamp.
///
/// The inner state is `Arc`-wrapped, so `clone()` is cheap and shares state.
#[derive(Clone)]
pub struct RateLimiter {
    state: Arc<DashMap<IpAddr, VecDeque<Instant>>>,
    window: Duration,
    max_requests: usize,
}

impl RateLimiter {
    /// Create a new rate limiter that allows at most `max_requests` per IP
    /// within the rolling `window`.
    pub fn new(max_requests: usize, window: Duration) -> Self {
        Self {
            state: Arc::new(DashMap::new()),
            window,
            max_requests,
        }
    }

    /// Returns `true` if the request from `ip` is within the rate limit and
    /// records it; returns `false` if the limit has been exceeded.
    pub fn check(&self, ip: IpAddr) -> bool {
        let now = Instant::now();
        let cutoff = now - self.window;

        let mut entry = self.state.entry(ip).or_default();
        // Evict timestamps outside the sliding window.
        while entry.front().map(|&t| t < cutoff).unwrap_or(false) {
            entry.pop_front();
        }
        if entry.len() >= self.max_requests {
            return false;
        }
        entry.push_back(now);
        true
    }
}

/// Extract the real client IP from the request.
/// Prefers the first address in `X-Forwarded-For`; falls back to `0.0.0.0`.
pub fn client_ip(request: &Request<Body>) -> IpAddr {
    request
        .headers()
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(IpAddr::from([0, 0, 0, 0]))
}

/// String-keyed sliding-window rate limiter.
///
/// Mirrors [`RateLimiter`] but keys on an arbitrary owned `String` so callers
/// can throttle per normalised email, per user id, etc. Used by
/// `/api/auth/password/reset/request` to apply a per-email ceiling on top of
/// the generic per-IP limit attached to the whole `/api/auth` sub-router.
#[derive(Clone)]
pub struct KeyedRateLimiter {
    state: Arc<DashMap<String, VecDeque<Instant>>>,
    window: Duration,
    max_requests: usize,
}

impl KeyedRateLimiter {
    pub fn new(max_requests: usize, window: Duration) -> Self {
        Self {
            state: Arc::new(DashMap::new()),
            window,
            max_requests,
        }
    }

    /// Returns `true` if the request keyed on `key` is within the limit and
    /// records it; returns `false` if the limit has been exceeded.
    pub fn check(&self, key: &str) -> bool {
        let now = Instant::now();
        let cutoff = now - self.window;

        let mut entry = self.state.entry(key.to_owned()).or_default();
        while entry.front().map(|&t| t < cutoff).unwrap_or(false) {
            entry.pop_front();
        }
        if entry.len() >= self.max_requests {
            return false;
        }
        entry.push_back(now);
        true
    }
}
