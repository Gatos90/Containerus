-- CON-66 / CON-62d — MFA (TOTP) + session management
--
-- Additive migration — no existing rows are modified, no existing columns are
-- removed. Adds:
--   * user_mfa             — per-user TOTP secret + enablement state
--   * mfa_backup_codes     — single-use recovery codes (hashed)
--   * refresh_tokens       — user_agent/ip_address columns so sessions UI
--                            can render "Safari on macOS · 203.0.113.1"
--   * new permission keys  — users.sessions.revoke_others,
--                            company.security.mfa.require
--
-- Company-admin toggle (`company.security.mfa.require`) lives in the existing
-- company.settings JSONB column; no schema change there. CEO ruling Q1 makes
-- MFA opt-in at GA and default-on for new companies post-Phase-B — the
-- default value is therefore applied at registration / company-create time,
-- not in the migration.

-- ============================================================================
-- user_mfa — one row per user when MFA is being enrolled / is enabled
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_mfa (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    method TEXT NOT NULL DEFAULT 'totp' CHECK (method IN ('totp')),
    -- Secret is encrypted with the server vault (AES-256-GCM). We reuse the
    -- same encrypt/decrypt path as system_credentials so there is a single
    -- key-rotation story for every secret in the database.
    secret_encrypted BYTEA NOT NULL,
    secret_nonce BYTEA NOT NULL,
    -- enabled_at NULL means the user has scanned the QR code but has not yet
    -- confirmed a working TOTP. The login flow only enforces MFA once this
    -- is set — a pending enrollment is invisible to the login path.
    enabled_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_mfa_enabled ON user_mfa(user_id) WHERE enabled_at IS NOT NULL;

CREATE OR REPLACE FUNCTION update_user_mfa_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_user_mfa_updated_at ON user_mfa;
CREATE TRIGGER trigger_user_mfa_updated_at
    BEFORE UPDATE ON user_mfa FOR EACH ROW
    EXECUTE FUNCTION update_user_mfa_updated_at();

-- ============================================================================
-- mfa_backup_codes — single-use recovery codes
--   * Codes are hashed with the same deterministic SHA-256 used for refresh
--     token storage; collision resistance is sufficient for a per-user,
--     per-code lookup and lets us do a constant-time match.
--   * used_at is set atomically at redemption time; a non-NULL value means
--     the code has been spent and MUST NOT be accepted again.
-- ============================================================================

CREATE TABLE IF NOT EXISTS mfa_backup_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mfa_backup_codes_user_hash
    ON mfa_backup_codes(user_id, code_hash);
CREATE INDEX IF NOT EXISTS idx_mfa_backup_codes_unused
    ON mfa_backup_codes(user_id) WHERE used_at IS NULL;

-- ============================================================================
-- refresh_tokens — session projection columns
--   * user_agent / ip_address / last_used_at let us render the session list
--     without a separate sessions table — a session IS a refresh token.
--   * All nullable so existing rows stay valid; new writes populate them.
-- ============================================================================

ALTER TABLE refresh_tokens
    ADD COLUMN IF NOT EXISTS user_agent TEXT,
    ADD COLUMN IF NOT EXISTS ip_address TEXT,
    ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

-- ============================================================================
-- New permission keys
-- ============================================================================

INSERT INTO permissions (id, key, description, category) VALUES
    (gen_random_uuid(), 'users.sessions.revoke_others',
        'Revoke another user''s active sessions (force sign-out)', 'users'),
    (gen_random_uuid(), 'company.security.mfa.require',
        'Toggle the company-wide MFA mandate', 'company')
ON CONFLICT (key) DO NOTHING;

-- Project-admin (built-in) picks up the user-session revoke; company-level
-- settings remain gated on is_company_admin in handler code.
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-000000000001'::UUID, id
FROM permissions WHERE key = 'users.sessions.revoke_others'
ON CONFLICT DO NOTHING;
