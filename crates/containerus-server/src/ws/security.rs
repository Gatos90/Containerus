//! WebSocket hardening helpers.
//!
//! CSWSH (Cross-Site WebSocket Hijacking) protection and periodic
//! authorization re-checks for long-lived PTY/tunnel sockets.

use axum::http::{header::ORIGIN, HeaderMap};

/// Check whether the `Origin` header is acceptable for a WebSocket upgrade.
///
/// Matches semantics of the configured `CORS_ORIGINS`:
/// - `"*"`: any non-empty Origin is accepted (dev convenience; still rejects
///   missing Origin to stop cross-site/cli-forged upgrades).
/// - comma-separated list: exact-match against a normalised origin
///   (scheme + host + optional non-default port).
/// - An empty/missing `Origin` header is always rejected.
pub fn origin_allowed(headers: &HeaderMap, cors_origins: &str) -> bool {
    let origin = match headers.get(ORIGIN).and_then(|v| v.to_str().ok()) {
        Some(v) if !v.is_empty() => v.trim(),
        _ => return false,
    };

    let trimmed = cors_origins.trim();
    if trimmed == "*" {
        return true;
    }

    let request_origin = normalise_origin(origin);
    if request_origin.is_empty() {
        return false;
    }

    trimmed
        .split(',')
        .map(|s| normalise_origin(s.trim()))
        .filter(|s| !s.is_empty())
        .any(|allowed| allowed == request_origin)
}

/// Strip trailing slash and lowercase the scheme+host. Keeps a non-default port.
fn normalise_origin(raw: &str) -> String {
    let s = raw.trim().trim_end_matches('/');
    if s.is_empty() {
        return String::new();
    }
    // RFC 6454 origins are case-sensitive except for the scheme and host,
    // which are ASCII. Lowercase the whole thing — origins shouldn't contain
    // user-data, only scheme://host[:port].
    s.to_ascii_lowercase()
}

/// Interval for re-checking authorization/permissions on long-lived sockets.
pub const REVOCATION_CHECK_INTERVAL: std::time::Duration = std::time::Duration::from_secs(30);

/// Returns true if the access-token's `exp` timestamp has passed.
pub fn token_expired(exp: i64) -> bool {
    let now = chrono::Utc::now().timestamp();
    exp <= now
}

/// Live authorization context captured at WS auth time.
///
/// Used for periodic re-checks during long-lived PTY/tunnel sessions so that
/// role changes, project membership removal, or token expiry close the socket
/// within `REVOCATION_CHECK_INTERVAL` instead of running until the client
/// disconnects.
#[derive(Clone)]
pub struct LiveAuthz {
    pub user_id: uuid::Uuid,
    pub project_id: uuid::Uuid,
    pub is_company_admin: bool,
    pub token_exp: i64,
    pub required_permission: &'static str,
}

impl LiveAuthz {
    /// Re-verify that the authenticated user still has the required permission
    /// for the scoped project. Returns false (→ close socket) if the token is
    /// expired, the user is no longer a project member, or the current role
    /// has lost the required permission.
    ///
    /// Company admins are always authorized as long as the token is valid.
    pub async fn still_authorized(&self, state: &crate::AppState) -> bool {
        if token_expired(self.token_exp) {
            return false;
        }
        if self.is_company_admin {
            return true;
        }

        // Look up the user's current role in project_members (DB is source of
        // truth; JWT memberships are a snapshot that may be stale).
        let current_role_id: Option<uuid::Uuid> = match sqlx::query_scalar(
            "SELECT role_id FROM project_members WHERE user_id = $1 AND project_id = $2",
        )
        .bind(self.user_id)
        .bind(self.project_id)
        .fetch_optional(&state.db)
        .await
        {
            Ok(row) => row,
            Err(e) => {
                tracing::error!(
                    "Live authz DB error for user {} project {}: {}",
                    self.user_id,
                    self.project_id,
                    e
                );
                // Fail open on transient DB errors rather than mass-disconnecting
                // every live session; connection-level errors will surface via
                // normal request paths.
                return true;
            }
        };

        let role_id = match current_role_id {
            Some(id) => id,
            None => return false, // Removed from project.
        };

        let perms = state.permission_cache.get_permissions(&role_id);
        perms.contains(self.required_permission)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn hdrs(origin: Option<&str>) -> HeaderMap {
        let mut h = HeaderMap::new();
        if let Some(o) = origin {
            h.insert(ORIGIN, HeaderValue::from_str(o).unwrap());
        }
        h
    }

    #[test]
    fn rejects_missing_origin() {
        assert!(!origin_allowed(&hdrs(None), "http://localhost:1420"));
    }

    #[test]
    fn rejects_empty_origin() {
        assert!(!origin_allowed(&hdrs(Some("")), "http://localhost:1420"));
    }

    #[test]
    fn accepts_exact_match() {
        assert!(origin_allowed(
            &hdrs(Some("http://localhost:1420")),
            "http://localhost:1420"
        ));
    }

    #[test]
    fn accepts_match_in_list() {
        assert!(origin_allowed(
            &hdrs(Some("https://app.example.com")),
            "http://localhost:1420,https://app.example.com,https://admin.example.com"
        ));
    }

    #[test]
    fn rejects_non_listed_origin() {
        assert!(!origin_allowed(
            &hdrs(Some("https://evil.example.com")),
            "http://localhost:1420,https://app.example.com"
        ));
    }

    #[test]
    fn rejects_prefix_attack() {
        // "https://app.example.com.evil.com" must NOT match "https://app.example.com"
        assert!(!origin_allowed(
            &hdrs(Some("https://app.example.com.evil.com")),
            "https://app.example.com"
        ));
    }

    #[test]
    fn case_insensitive_host() {
        assert!(origin_allowed(
            &hdrs(Some("HTTP://LOCALHOST:1420")),
            "http://localhost:1420"
        ));
    }

    #[test]
    fn trailing_slash_ignored() {
        assert!(origin_allowed(
            &hdrs(Some("http://localhost:1420/")),
            "http://localhost:1420"
        ));
    }

    #[test]
    fn wildcard_accepts_any_present_origin() {
        assert!(origin_allowed(&hdrs(Some("https://whatever.com")), "*"));
    }

    #[test]
    fn wildcard_still_rejects_missing_origin() {
        // Missing Origin is suspicious (cURL, server-side script, cross-site
        // upgrade without Fetch): reject even under wildcard CORS.
        assert!(!origin_allowed(&hdrs(None), "*"));
    }

    #[test]
    fn token_expiry_detection() {
        let past = chrono::Utc::now().timestamp() - 10;
        let future = chrono::Utc::now().timestamp() + 600;
        assert!(token_expired(past));
        assert!(!token_expired(future));
    }
}
