-- Add audit.view_ip permission for controlling IP address visibility in audit logs
INSERT INTO permissions (id, key, description, category)
VALUES (gen_random_uuid(), 'audit.view_ip', 'View IP addresses in audit logs', 'audit')
ON CONFLICT (key) DO NOTHING;

-- Grant to Project Admin and Operator roles
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-000000000001'::UUID, id FROM permissions WHERE key = 'audit.view_ip'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-000000000002'::UUID, id FROM permissions WHERE key = 'audit.view_ip'
ON CONFLICT DO NOTHING;
