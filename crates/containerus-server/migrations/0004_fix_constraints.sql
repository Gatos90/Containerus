-- Fix system_credentials unique index: replace COALESCE-based index with
-- two partial indexes for proper NULL handling.
DROP INDEX IF EXISTS idx_system_credentials_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_credentials_unique_with_jump
    ON system_credentials(system_id, credential_type, jump_host_key)
    WHERE jump_host_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_credentials_unique_without_jump
    ON system_credentials(system_id, credential_type)
    WHERE jump_host_key IS NULL;

-- Fix clusters.created_by: make nullable with ON DELETE SET NULL so that
-- deleting a user doesn't require removing their clusters first.
ALTER TABLE clusters ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE clusters DROP CONSTRAINT IF EXISTS clusters_created_by_fkey;
ALTER TABLE clusters
    ADD CONSTRAINT clusters_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

-- Remove the trigger that prevented user deletion when they owned clusters,
-- since ON DELETE SET NULL now handles this gracefully.
DROP TRIGGER IF EXISTS trg_prevent_user_delete_clusters ON users;
DROP FUNCTION IF EXISTS prevent_user_delete_with_clusters();
