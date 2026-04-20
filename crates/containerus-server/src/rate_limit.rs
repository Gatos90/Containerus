use std::collections::VecDeque;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::extract::{connect_info::ConnectInfo, Request};
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
///
/// Pulls `ConnectInfo<SocketAddr>` out of request extensions (installed by
/// `into_make_service_with_connect_info::<SocketAddr>()` in `lib.rs`). We
/// intentionally do **not** trust `X-Forwarded-For` here: there's no
/// reverse-proxy allowlist in this deployment, so accepting XFF would let
/// an attacker trivially bypass per-IP throttling by rotating the header
/// on every request — defeating the `auth_limiter` that wraps `/api/auth`
/// (including the password routes). If/when a trusted proxy boundary is
/// introduced, gate XFF behind an explicit allowlist env var rather than
/// re-enabling it unconditionally here.
///
/// Keeps the `0.0.0.0` sentinel as the fallback so a missing `ConnectInfo`
/// (shouldn't happen in production, but e.g. constructed requests in tests)
/// doesn't panic — the limiter will treat all such requests as sharing one
/// bucket, which is the safer default when the IP is unknowable.
pub fn client_ip(request: &Request<Body>) -> IpAddr {
    request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ci| ci.0.ip())
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
