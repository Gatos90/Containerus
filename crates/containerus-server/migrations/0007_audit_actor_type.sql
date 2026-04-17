-- CON-64 — audit_log.actor_type
--
-- Adds an actor_type column to audit_log as groundwork for API tokens /
-- service accounts (CON-62g). Existing rows were all written by human users,
-- so the column defaults to 'user' and is backfilled in-place. Future writers
-- can emit 'api_token' or 'system' without another migration.

ALTER TABLE audit_log
    ADD COLUMN IF NOT EXISTS actor_type TEXT NOT NULL DEFAULT 'user';

-- Accept only the three known actor kinds today. New kinds require an
-- explicit migration so audit consumers don't see unexpected values.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'audit_log_actor_type_check'
    ) THEN
        ALTER TABLE audit_log
            ADD CONSTRAINT audit_log_actor_type_check
            CHECK (actor_type IN ('user', 'api_token', 'system'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_audit_log_actor_type
    ON audit_log(actor_type, created_at DESC);
