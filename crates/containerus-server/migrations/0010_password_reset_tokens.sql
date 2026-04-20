-- CON-118 — password self-service (change + reset)
--
-- Adds the `password_reset_tokens` table used by
--   POST /api/auth/password/reset/request  (creates a row)
--   POST /api/auth/password/reset/confirm  (consumes a row)
--
-- Design notes:
--   * Only the SHA-256 hash of the raw token is stored. The raw value is
--     returned exactly once (either mailed to the user once email transport
--     lands, or surfaced via the admin-only issue endpoint for Phase 1).
--   * Exactly one active reset may exist per user. The partial unique index
--     below enforces this at the database level — the request handler also
--     clears prior unused rows defensively, but the constraint is the line of
--     defense if two concurrent requests race.
--   * TTL cleanup runs opportunistically on insert via
--     `trigger_password_reset_tokens_cleanup`. We do not rely on `pg_cron`
--     because it is not guaranteed to be enabled on the target deploys;
--     amortising the cleanup on the write path keeps the table bounded.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ip_address TEXT
);

-- Fast lookup on confirm — the token hash is the credential the client
-- presents, so this index must exist before the endpoint is callable.
CREATE UNIQUE INDEX IF NOT EXISTS idx_password_reset_tokens_hash
    ON password_reset_tokens(token_hash);

-- At most one unused, unexpired reset per user. The handler deletes prior
-- rows, but this is the database-level guard against a race between two
-- concurrent reset/request calls for the same email.
CREATE UNIQUE INDEX IF NOT EXISTS idx_password_reset_tokens_one_active
    ON password_reset_tokens(user_id)
    WHERE used_at IS NULL;

-- Supports TTL sweeps and the "recently used" audit window.
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at
    ON password_reset_tokens(expires_at);

-- ============================================================================
-- Opportunistic TTL cleanup
--   Fires on insert. Deletes rows whose `expires_at` is older than 24h and
--   rows that were used more than 7 days ago. Keeps recent used rows so the
--   audit trail can correlate a confirm event with the originating request.
-- ============================================================================

CREATE OR REPLACE FUNCTION password_reset_tokens_cleanup()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM password_reset_tokens
     WHERE expires_at < now() - interval '1 day'
        OR (used_at IS NOT NULL AND used_at < now() - interval '7 days');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_password_reset_tokens_cleanup ON password_reset_tokens;
CREATE TRIGGER trigger_password_reset_tokens_cleanup
    BEFORE INSERT ON password_reset_tokens
    FOR EACH STATEMENT
    EXECUTE FUNCTION password_reset_tokens_cleanup();

-- ============================================================================
-- New permission key for the admin-only reset issue endpoint (Phase 1
-- fallback while no email transport is wired up).
-- ============================================================================

INSERT INTO permissions (id, key, description, category) VALUES
    (gen_random_uuid(), 'users.password.reset.issue',
        'Issue a password reset token on behalf of another user (admin override)',
        'users')
ON CONFLICT (key) DO NOTHING;
