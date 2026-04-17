-- CON-63 / CON-62 Phase A — split compound permission keys and forward-grant existing holders.
--
-- This migration is strictly additive: every existing permission key stays in place
-- so current code paths keep working. We add the finer-grained keys listed in the
-- parent plan §2 and seed role_permissions rows so that anyone who held the coarse
-- key also holds the new split keys. The feature flag CONTAINERUS_ENFORCE_ACLS
-- governs whether resource_acls are consulted at request time; those ACLs are read
-- directly from the table and do not need migration.

-- ============================================================================
-- New permission keys
-- ============================================================================

INSERT INTO permissions (id, key, description, category) VALUES
    -- systems.connect split (keep legacy key for backwards-compat)
    (gen_random_uuid(), 'systems.terminal.open',            'Open an SSH terminal (PTY) to a system',                'systems'),
    (gen_random_uuid(), 'systems.tunnel.open',              'Open a port-forward tunnel through a system',           'systems'),
    (gen_random_uuid(), 'systems.tunnel.allowlist.manage',  'Manage the destination allowlist for system tunnels',   'systems'),

    -- containers.logs split
    (gen_random_uuid(), 'containers.logs.read',             'Fetch a one-shot container log snapshot',               'containers'),
    (gen_random_uuid(), 'containers.logs.follow',           'Stream/tail container logs in real time',               'containers'),

    -- containers.lifecycle split (containers.start/stop/restart already exist; add pause)
    (gen_random_uuid(), 'containers.pause',                 'Pause/unpause containers',                              'containers'),

    -- clusters split: promote destructive apply/delete to their own keys
    (gen_random_uuid(), 'clusters.apply',                   'Apply raw Kubernetes YAML to a cluster',                'clusters'),
    (gen_random_uuid(), 'clusters.delete.workload',         'Delete Kubernetes workloads (pods, deployments, etc.)', 'clusters'),
    (gen_random_uuid(), 'clusters.logs.stream',             'Stream Kubernetes pod logs in real time',               'clusters'),
    (gen_random_uuid(), 'clusters.watch',                   'Watch Kubernetes resources (long-poll watch)',          'clusters')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- Forward-grant mapping: anyone who held the coarse key keeps the fine ones.
-- These are idempotent via (role_id, permission_id) PK + ON CONFLICT DO NOTHING.
-- ============================================================================

-- systems.connect → systems.terminal.open + systems.tunnel.open
-- (systems.tunnel.allowlist.manage stays admin-only; see explicit grants below)
INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, p_new.id
FROM role_permissions rp
JOIN permissions p_old ON p_old.id = rp.permission_id AND p_old.key = 'systems.connect'
CROSS JOIN permissions p_new
WHERE p_new.key IN ('systems.terminal.open', 'systems.tunnel.open')
ON CONFLICT DO NOTHING;

-- containers.logs → containers.logs.read + containers.logs.follow
INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, p_new.id
FROM role_permissions rp
JOIN permissions p_old ON p_old.id = rp.permission_id AND p_old.key = 'containers.logs'
CROSS JOIN permissions p_new
WHERE p_new.key IN ('containers.logs.read', 'containers.logs.follow')
ON CONFLICT DO NOTHING;

-- containers.manage → containers.pause
-- (containers.manage already describes pause/unpause; make it explicit.)
INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, p_new.id
FROM role_permissions rp
JOIN permissions p_old ON p_old.id = rp.permission_id AND p_old.key = 'containers.manage'
CROSS JOIN permissions p_new
WHERE p_new.key = 'containers.pause'
ON CONFLICT DO NOTHING;

-- clusters.manage → clusters.apply + clusters.delete.workload + clusters.watch
--
-- `clusters.apply` and `clusters.delete.workload` are the new fine-grained keys
-- that API handlers (`delete_resource` in api/clusters/resources.rs,
-- `delete_custom_resource` in api/clusters/discovery.rs) are already gated on.
-- Those keys did not exist before this migration, so pre-0006 those endpoints
-- were unreachable; forward-granting to existing `clusters.manage` holders
-- restores the intended operator capability rather than expanding authority.
--
-- `clusters.watch` (the WebSocket resource watch at ws/k8s_watch.rs) is added
-- here rather than under the `clusters.logs` mapping because the watch handler
-- exposes arbitrary Kubernetes resources (Secrets, Roles, RoleBindings,
-- ServiceAccounts, etc.) — i.e. operator-tier access, not log-adjacent read.
INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, p_new.id
FROM role_permissions rp
JOIN permissions p_old ON p_old.id = rp.permission_id AND p_old.key = 'clusters.manage'
CROSS JOIN permissions p_new
WHERE p_new.key IN ('clusters.apply', 'clusters.delete.workload', 'clusters.watch')
ON CONFLICT DO NOTHING;

-- clusters.logs → clusters.logs.stream
-- Intentionally does NOT include `clusters.watch`: the watch WS is not scoped
-- to log-stream-adjacent resources (see comment on the `clusters.manage` block
-- above). Granting it via `clusters.logs` would hand viewer/developer roles
-- read access to Secrets/Roles/RoleBindings.
INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, p_new.id
FROM role_permissions rp
JOIN permissions p_old ON p_old.id = rp.permission_id AND p_old.key = 'clusters.logs'
CROSS JOIN permissions p_new
WHERE p_new.key = 'clusters.logs.stream'
ON CONFLICT DO NOTHING;

-- Tunnel allowlist management is admin-only by default.
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-000000000001'::UUID, id
FROM permissions WHERE key = 'systems.tunnel.allowlist.manage'
ON CONFLICT DO NOTHING;
