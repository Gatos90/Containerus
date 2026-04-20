-- CON-117: per-container ACL (resource_type = 'container').
--
-- Containers are not Postgres rows — they are Docker/Podman runtime objects —
-- so we can't FK `resource_acls.resource_id` to a containers table. Instead we
-- piggy-back on the parent `systems` row: every container lives on exactly one
-- system, so a new nullable `system_id` column carries that link for container
-- ACL rows and lets ON DELETE CASCADE clean them up when the system goes away.
-- Non-container rows continue to carry a NULL `system_id`.

ALTER TABLE resource_acls
    ADD COLUMN IF NOT EXISTS system_id UUID REFERENCES systems(id) ON DELETE CASCADE;

-- Expand the resource_type CHECK to accept 'container' rows.
ALTER TABLE resource_acls DROP CONSTRAINT IF EXISTS resource_acls_resource_type_check;
ALTER TABLE resource_acls
    ADD CONSTRAINT resource_acls_resource_type_check
    CHECK (resource_type IN ('system', 'cluster', 'environment', 'container'));

-- Invariant: container rows MUST carry a system_id; all other rows MUST NOT.
-- This keeps the cleanup contract explicit and prevents a half-wired row
-- that survives its parent system's teardown.
ALTER TABLE resource_acls
    ADD CONSTRAINT resource_acls_container_system_id_consistent
    CHECK (
        (resource_type = 'container' AND system_id IS NOT NULL)
        OR (resource_type <> 'container' AND system_id IS NULL)
    );

-- Lookup index for the resolver's container-scoped load:
--   WHERE user_id=? AND project_id=? AND resource_type='container'
--     AND system_id=? AND resource_id=?
-- The existing idx_resource_acls_user_project covers (user_id, project_id).
CREATE INDEX IF NOT EXISTS idx_resource_acls_container_lookup
    ON resource_acls(system_id, resource_id)
    WHERE resource_type = 'container';
