-- Add clusters.exec and clusters.logs permissions for K8s pod exec and log streaming

INSERT INTO permissions (id, key, description, category)
VALUES
    (gen_random_uuid(), 'clusters.exec', 'Execute commands in K8s pods (terminal)', 'clusters'),
    (gen_random_uuid(), 'clusters.logs', 'View K8s pod logs', 'clusters')
ON CONFLICT (key) DO NOTHING;

-- Grant clusters.exec to Project Admin and Operator
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-000000000001'::UUID, id FROM permissions WHERE key = 'clusters.exec'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-000000000002'::UUID, id FROM permissions WHERE key = 'clusters.exec'
ON CONFLICT DO NOTHING;

-- Grant clusters.logs to Project Admin, Operator, Developer, and Viewer
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-000000000001'::UUID, id FROM permissions WHERE key = 'clusters.logs'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-000000000002'::UUID, id FROM permissions WHERE key = 'clusters.logs'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-000000000003'::UUID, id FROM permissions WHERE key = 'clusters.logs'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-000000000004'::UUID, id FROM permissions WHERE key = 'clusters.logs'
ON CONFLICT DO NOTHING;
