-- CON-119 — admin user deactivation / reactivation endpoint.
--
-- Adds the `users.deactivate` permission key so the new PATCH /api/admin/users/{id}
-- handler can declare it via `#[require_permissions(...)]` and the CON-83
-- coverage scan stays happy. The endpoint itself still gates on
-- `auth.claims.is_company_admin` for defence in depth — there is no
-- company-scoped role model today, so we intentionally do NOT attach this
-- permission to any built-in project-scoped role. A future custom-role system
-- that can grant company-wide capabilities can hang off this key.

INSERT INTO permissions (id, key, description, category) VALUES
    (gen_random_uuid(), 'users.deactivate',
        'Deactivate or reactivate a user account (company admin override)',
        'users')
ON CONFLICT (key) DO NOTHING;
