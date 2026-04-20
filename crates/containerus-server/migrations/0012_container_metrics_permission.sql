-- CON-121 — per-container metrics endpoint.
--
-- Gates `GET /api/systems/{id}/containers/{container_id}/metrics` and the
-- env-overview drill-down on a dedicated read permission. Split out of
-- `containers.view` so an operator can let a user see container listings
-- without granting access to per-container resource usage (CON-115 §7 acc.
-- criteria: "RBAC tests cover the new permission").
--
-- Default-grant to the built-in Viewer role (and therefore Developer /
-- Operator / Project Admin too, since each of those is a strict superset
-- of Viewer in migration 0001 seed). Custom roles start without it and
-- have to opt in explicitly.

INSERT INTO permissions (id, key, description, category) VALUES
    (gen_random_uuid(), 'containers.metrics.view',
        'View per-container CPU/memory/net/disk metrics',
        'containers')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE p.key = 'containers.metrics.view'
  AND r.id IN (
    '00000000-0000-0000-0000-000000000001'::UUID, -- Project Admin
    '00000000-0000-0000-0000-000000000002'::UUID, -- Operator
    '00000000-0000-0000-0000-000000000003'::UUID, -- Developer
    '00000000-0000-0000-0000-000000000004'::UUID  -- Viewer
  )
ON CONFLICT DO NOTHING;
