# Auth and RBAC

**Summary**: The server uses HS256 JWT access + refresh tokens, Argon2id password hashing, a revocation cache for logout, and role→permission mappings cached in memory. Auth endpoints are sliding-window rate-limited per IP.

**Sources**: `crates/containerus-server/src/auth/*`, `crates/containerus-server/src/rate_limit.rs`, `crates/containerus-server/src/api/auth.rs`.

**Last updated**: 2026-04-16

---

## Tokens — `auth/jwt.rs`

```rust
pub struct AccessClaims {
    pub sub: Uuid,                          // user id
    pub iss: String,                        // "containerus"
    pub aud: String,                        // "containerus-client"
    pub jti: Uuid,                          // unique per-token id (revocation key)
    pub email: String,
    pub memberships: Vec<ProjectMembership>,// { project_id, role_id } per project
    pub is_company_admin: bool,
    pub iat: i64,
    pub exp: i64,
}
pub struct RefreshClaims { sub, iss, aud, jti, iat, exp }  // minimal
```

Access token TTL defaults to 900 s (15 min). Refresh to 604800 s (7 d). Both configurable via `JWT_ACCESS_EXPIRY_SECS` / `JWT_REFRESH_EXPIRY_SECS`.

Functions:

- `create_access_token(secret, user, memberships, is_company_admin, ttl) → (String, Uuid)` — returns the token and its `jti`
- `create_refresh_token(...)`
- `decode_access_token(token, secret) → AccessClaims`
- `decode_refresh_token(token, secret) → RefreshClaims`

Signing algorithm: HS256 with the `JWT_SECRET` from env (min 32 bytes).

## Password hashing — `auth/password.rs`

- `hash_password(plaintext) → encoded` — Argon2id with a random salt (OS RNG), default Argon2 parameters. Returns the encoded hash string (PHC format).
- `verify_password(plaintext, encoded) → bool` — parses and compares.

## Middleware — `auth/middleware.rs`

### `AuthUser` extractor

Axum extractor pulled from `Authorization: Bearer <token>`:

1. Decode with the server's secret.
2. Check `revocation_cache.is_revoked(jti)` — revoked → 401.
3. Return `AccessClaims` via `AuthUser { claims }`.

### `AuthUserWithPermission`

Wraps `AuthUser` and, given a target project, resolves the user's permission set:

- Reads `memberships.role_for_project(pid)` from the claims.
- Looks up `permission_cache.get_permissions(role_id) → HashSet<String>`.
- Adds `is_company_admin` → implicit superset.

Handlers declare the permission they need; the middleware refuses the request if it's absent.

### `TokenRevocationCache`

`DashMap<Uuid, i64>` of `jti → exp`. `revoke(jti, exp)` is called on logout. `is_revoked(jti)` is O(1). A `prune_expired()` sweep periodically drops entries whose `exp` passed.

Design note: revocation here is a *soft* list — since a restart discards the cache, the upper bound is the access-token TTL (15 minutes by default). For hard revocation, shorten access TTL and rotate refresh tokens; the refresh-token `jti` is also revoked on logout so a compromised refresh token can't be reused.

### `PermissionCache`

`DashMap<Uuid, HashSet<String>>` of `role_id → set of permission keys`. `load_from_db()` runs at startup. `invalidate_role(role_id)` reloads a single role from DB after edits. `reload_all()` refreshes everything.

## Rate limiting — `rate_limit.rs`

Sliding-window per-IP:

```rust
pub struct RateLimiter {
    state: Arc<DashMap<IpAddr, VecDeque<Instant>>>,
    window: Duration,
    max_requests: usize,
}
```

- `check(ip) → bool` — evicts timestamps older than `window`, counts, records the new hit if under limit. Otherwise returns false (HTTP 429).
- Applied to `/api/auth/*` at **10 requests / 60 s** per IP.
- `client_ip(request)` prefers the first value in `X-Forwarded-For`, falling back to `0.0.0.0` if absent.

## Auth endpoints — `api/auth.rs`

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Create user (Argon2 hash) |
| POST | `/api/auth/login` | Verify password, issue tokens |
| POST | `/api/auth/refresh` | Swap a valid refresh token for new pair |
| POST | `/api/auth/logout` | Revoke access + refresh JTIs |
| GET | `/api/auth/me` | Return current `AccessClaims` summary |
| POST | `/api/auth/change-password` | Verify current + hash + store new |

All are rate-limited. Refresh also rotates refresh tokens — the old `jti` is revoked so stolen tokens don't indefinitely extend sessions.

## Seeding

`main.rs` checks for `ADMIN_EMAIL` and `ADMIN_PASSWORD` env vars. If both present and no matching user exists, it seeds a company-admin user at startup. This is the bootstrap path for a brand-new server.

## Frontend side — `BackendService`

See [[backend-service]]. The client:
- Stores access + refresh tokens in the keyring vault (per-connection).
- Adds `Authorization: Bearer ...` to every `requestFor` call.
- Serializes token refresh so concurrent 401s coalesce into one refresh call.
- Drops and marks `disconnected` when refresh fails.

## Project-level permissions

Each membership carries one `role_id`. Role→permission mapping is stored in `role_permissions` and hot-loaded into `PermissionCache`. Permission keys look like `containers:read`, `containers:action`, `systems:admin`, `k8s:exec`, etc. Migration `0003_k8s_permissions.sql` adds the Kubernetes-specific ones.

`is_company_admin` is a super-admin flag that implicitly grants every permission. Used for bootstrap admins and Ops roles outside the RBAC model.

## Related pages

- [[credentials-and-vault]]
- [[crate-containerus-server]]
- [[backend-service]]
- [[database-schema]]
