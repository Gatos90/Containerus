-- Containerus Server: Full Schema
-- Single consolidated migration for development

-- ============================================================================
-- Users
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    auth_provider TEXT NOT NULL DEFAULT 'local',
    external_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_external_identity
    ON users (auth_provider, external_id)
    WHERE external_id IS NOT NULL;

-- ============================================================================
-- Company (singleton: one row per deployment)
-- ============================================================================

CREATE TABLE IF NOT EXISTS company (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    license_tier TEXT NOT NULL DEFAULT 'community',
    settings JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_company_singleton ON company ((true));

-- ============================================================================
-- Company Admins (super-admin users)
-- ============================================================================

CREATE TABLE IF NOT EXISTS company_admins (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    granted_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- ============================================================================
-- Projects (multi-tenant project grouping)
-- ============================================================================

CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_company ON projects(company_id);

-- ============================================================================
-- Permissions (canonical permission definitions)
-- ============================================================================

CREATE TABLE IF NOT EXISTS permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT UNIQUE NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- Roles (company-scoped custom + built-in roles)
-- ============================================================================

CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES company(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    is_system BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_system_slug ON roles(slug) WHERE company_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_company_slug ON roles(company_id, slug) WHERE company_id IS NOT NULL;

-- ============================================================================
-- Role-Permission mapping
-- ============================================================================

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);

-- ============================================================================
-- Project Members
-- ============================================================================

CREATE TABLE IF NOT EXISTS project_members (
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_project_members_role ON project_members(role_id);

-- ============================================================================
-- Resource ACLs (per-resource permission overrides)
-- ============================================================================

CREATE TABLE IF NOT EXISTS resource_acls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    resource_type TEXT NOT NULL CHECK (resource_type IN ('system', 'cluster', 'environment')),
    resource_id UUID NOT NULL,
    role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
    extra_permissions JSONB NOT NULL DEFAULT '[]',
    denied_permissions JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, project_id, resource_type, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_resource_acls_user_project ON resource_acls(user_id, project_id);
CREATE INDEX IF NOT EXISTS idx_resource_acls_resource ON resource_acls(resource_type, resource_id);

-- ============================================================================
-- Environments (project sub-grouping)
-- ============================================================================

CREATE TABLE IF NOT EXISTS environments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_environments_project ON environments(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_environments_project_slug ON environments(project_id, slug);
CREATE UNIQUE INDEX IF NOT EXISTS idx_environments_single_default
    ON environments(project_id) WHERE is_default = true;

-- ============================================================================
-- Systems (SSH-connected servers with container runtimes)
-- ============================================================================

CREATE TABLE IF NOT EXISTS systems (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    hostname TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 22
        CONSTRAINT chk_systems_port CHECK (port > 0 AND port <= 65535),
    username TEXT NOT NULL,
    primary_runtime TEXT NOT NULL DEFAULT 'docker'
        CHECK (primary_runtime IN ('docker', 'podman', 'apple')),
    available_runtimes JSONB NOT NULL DEFAULT '["docker"]',
    auth_method TEXT NOT NULL DEFAULT 'password'
        CHECK (auth_method IN ('password', 'publicKey')),
    ssh_options JSONB,
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_connected_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_systems_environment ON systems(environment_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_systems_environment_name ON systems(environment_id, name);

-- ============================================================================
-- System Credentials (encrypted SSH credentials)
-- ============================================================================

CREATE TABLE IF NOT EXISTS system_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    system_id UUID NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    credential_type TEXT NOT NULL
        CHECK (credential_type IN ('password', 'private_key', 'passphrase')),
    encrypted_data BYTEA NOT NULL,
    nonce BYTEA NOT NULL,
    jump_host_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_credentials_system ON system_credentials(system_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_credentials_unique
    ON system_credentials(system_id, credential_type, COALESCE(jump_host_key, ''));

-- ============================================================================
-- Kubernetes Clusters
-- ============================================================================

CREATE TABLE IF NOT EXISTS clusters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    api_server_url TEXT NOT NULL,
    kubeconfig_encrypted BYTEA NOT NULL,
    kubeconfig_nonce BYTEA NOT NULL,
    context_name TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_connected_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clusters_environment ON clusters(environment_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clusters_environment_name ON clusters(environment_id, name);

-- ============================================================================
-- Refresh Tokens (for JWT refresh flow)
-- ============================================================================

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);

-- ============================================================================
-- IDP Configurations (per-company SSO setup)
-- ============================================================================

CREATE TABLE IF NOT EXISTS idp_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
    protocol TEXT NOT NULL DEFAULT 'oidc',
    display_name TEXT NOT NULL,
    issuer_url TEXT NOT NULL,
    client_id TEXT NOT NULL,
    client_secret_encrypted BYTEA NOT NULL,
    client_secret_nonce BYTEA NOT NULL,
    auto_provision_users BOOLEAN NOT NULL DEFAULT true,
    default_role TEXT NOT NULL DEFAULT 'viewer'
        CHECK (default_role IN ('project-admin', 'operator', 'developer', 'viewer')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_idp_configs_company ON idp_configs(company_id);

-- ============================================================================
-- Audit Log
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    details JSONB,
    ip_address TEXT,
    environment_id UUID REFERENCES environments(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_project ON audit_log(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_environment ON audit_log(environment_id, created_at DESC);

-- ============================================================================
-- Functions & Triggers
-- ============================================================================

-- Prevent deleting users who have created clusters
CREATE OR REPLACE FUNCTION prevent_user_delete_with_clusters()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM clusters WHERE created_by = OLD.id) THEN
        RAISE EXCEPTION 'Cannot delete user % because they have created clusters', OLD.id;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_user_delete_clusters
    BEFORE DELETE ON users
    FOR EACH ROW
    EXECUTE FUNCTION prevent_user_delete_with_clusters();

-- Auto-update updated_at triggers

CREATE OR REPLACE FUNCTION update_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_users_updated_at
    BEFORE UPDATE ON users FOR EACH ROW
    EXECUTE FUNCTION update_users_updated_at();

CREATE OR REPLACE FUNCTION update_projects_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_projects_updated_at
    BEFORE UPDATE ON projects FOR EACH ROW
    EXECUTE FUNCTION update_projects_updated_at();

CREATE OR REPLACE FUNCTION update_systems_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_systems_updated_at
    BEFORE UPDATE ON systems FOR EACH ROW
    EXECUTE FUNCTION update_systems_updated_at();

CREATE OR REPLACE FUNCTION update_system_credentials_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_system_credentials_updated_at
    BEFORE UPDATE ON system_credentials FOR EACH ROW
    EXECUTE FUNCTION update_system_credentials_updated_at();

CREATE OR REPLACE FUNCTION update_idp_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_idp_configs_updated_at
    BEFORE UPDATE ON idp_configs FOR EACH ROW
    EXECUTE FUNCTION update_idp_configs_updated_at();

CREATE OR REPLACE FUNCTION update_clusters_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_clusters_updated_at
    BEFORE UPDATE ON clusters FOR EACH ROW
    EXECUTE FUNCTION update_clusters_updated_at();

CREATE OR REPLACE FUNCTION update_roles_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_roles_updated_at
    BEFORE UPDATE ON roles FOR EACH ROW
    EXECUTE FUNCTION update_roles_updated_at();

CREATE OR REPLACE FUNCTION update_company_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_company_updated_at
    BEFORE UPDATE ON company FOR EACH ROW
    EXECUTE FUNCTION update_company_updated_at();

CREATE OR REPLACE FUNCTION update_resource_acls_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_resource_acls_updated_at
    BEFORE UPDATE ON resource_acls FOR EACH ROW
    EXECUTE FUNCTION update_resource_acls_updated_at();

CREATE OR REPLACE FUNCTION update_environments_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_environments_updated_at
    BEFORE UPDATE ON environments FOR EACH ROW
    EXECUTE FUNCTION update_environments_updated_at();

-- ============================================================================
-- Seed: Permissions
-- ============================================================================

INSERT INTO permissions (id, key, description, category) VALUES
    -- Systems
    (gen_random_uuid(), 'systems.view', 'View systems and their status', 'systems'),
    (gen_random_uuid(), 'systems.create', 'Create new systems', 'systems'),
    (gen_random_uuid(), 'systems.edit', 'Edit system configuration', 'systems'),
    (gen_random_uuid(), 'systems.delete', 'Delete systems', 'systems'),
    (gen_random_uuid(), 'systems.connect', 'Connect/disconnect systems', 'systems'),
    -- Containers
    (gen_random_uuid(), 'containers.view', 'View containers and their details', 'containers'),
    (gen_random_uuid(), 'containers.start', 'Start containers', 'containers'),
    (gen_random_uuid(), 'containers.stop', 'Stop containers', 'containers'),
    (gen_random_uuid(), 'containers.restart', 'Restart containers', 'containers'),
    (gen_random_uuid(), 'containers.delete', 'Remove containers', 'containers'),
    (gen_random_uuid(), 'containers.exec', 'Execute commands in containers (terminal)', 'containers'),
    (gen_random_uuid(), 'containers.logs', 'View container logs', 'containers'),
    (gen_random_uuid(), 'containers.manage', 'Pause/unpause containers', 'containers'),
    -- Images
    (gen_random_uuid(), 'images.view', 'View container images', 'images'),
    (gen_random_uuid(), 'images.pull', 'Pull container images', 'images'),
    (gen_random_uuid(), 'images.delete', 'Remove container images', 'images'),
    -- Volumes
    (gen_random_uuid(), 'volumes.view', 'View volumes', 'volumes'),
    (gen_random_uuid(), 'volumes.create', 'Create volumes', 'volumes'),
    (gen_random_uuid(), 'volumes.delete', 'Remove volumes', 'volumes'),
    -- Networks
    (gen_random_uuid(), 'networks.view', 'View networks', 'networks'),
    (gen_random_uuid(), 'networks.create', 'Create networks', 'networks'),
    (gen_random_uuid(), 'networks.delete', 'Remove networks', 'networks'),
    (gen_random_uuid(), 'networks.manage', 'Connect/disconnect containers to networks', 'networks'),
    -- Files
    (gen_random_uuid(), 'files.view', 'Browse files and directories', 'files'),
    (gen_random_uuid(), 'files.read', 'Read file contents', 'files'),
    (gen_random_uuid(), 'files.write', 'Write files and create directories', 'files'),
    (gen_random_uuid(), 'files.delete', 'Delete files and directories', 'files'),
    (gen_random_uuid(), 'files.download', 'Download files', 'files'),
    (gen_random_uuid(), 'files.upload', 'Upload files', 'files'),
    -- Clusters (K8s)
    (gen_random_uuid(), 'clusters.view', 'View Kubernetes clusters', 'clusters'),
    (gen_random_uuid(), 'clusters.create', 'Add Kubernetes clusters', 'clusters'),
    (gen_random_uuid(), 'clusters.edit', 'Edit cluster configuration', 'clusters'),
    (gen_random_uuid(), 'clusters.delete', 'Remove Kubernetes clusters', 'clusters'),
    (gen_random_uuid(), 'clusters.manage', 'Scale deployments, apply YAML', 'clusters'),
    -- Projects
    (gen_random_uuid(), 'projects.view', 'View project details', 'projects'),
    (gen_random_uuid(), 'projects.create', 'Create new projects', 'projects'),
    (gen_random_uuid(), 'projects.edit', 'Edit project settings', 'projects'),
    (gen_random_uuid(), 'projects.members.view', 'View project members', 'projects'),
    (gen_random_uuid(), 'projects.members.manage', 'Invite/remove members, change roles', 'projects'),
    -- Environments
    (gen_random_uuid(), 'environments.view', 'View environments', 'environments'),
    (gen_random_uuid(), 'environments.create', 'Create environments', 'environments'),
    (gen_random_uuid(), 'environments.edit', 'Edit environment settings', 'environments'),
    (gen_random_uuid(), 'environments.delete', 'Delete environments', 'environments'),
    -- Audit
    (gen_random_uuid(), 'audit.view', 'View audit logs', 'audit'),
    -- Company
    (gen_random_uuid(), 'company.admin', 'Full company administration access', 'company')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- Seed: Built-in Roles (fixed UUIDs)
-- ============================================================================

INSERT INTO roles (id, company_id, name, slug, description, is_system) VALUES
    ('00000000-0000-0000-0000-000000000001', NULL, 'Project Admin', 'project-admin', 'Full access to all resources within a project', true),
    ('00000000-0000-0000-0000-000000000002', NULL, 'Operator', 'operator', 'Can manage systems, containers, and K8s resources but not project members', true),
    ('00000000-0000-0000-0000-000000000003', NULL, 'Developer', 'developer', 'Can view systems and interact with containers (start/stop/exec/logs)', true),
    ('00000000-0000-0000-0000-000000000004', NULL, 'Viewer', 'viewer', 'Read-only access to all resources', true)
ON CONFLICT (id) DO NOTHING;

-- Project Admin: ALL permissions except company.admin
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-000000000001'::UUID, id FROM permissions WHERE key != 'company.admin'
ON CONFLICT DO NOTHING;

-- Operator: systems, containers, images, volumes, networks, files, clusters, audit + projects.view/members.view + environments
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-000000000002'::UUID, id FROM permissions
WHERE category IN ('systems', 'containers', 'images', 'volumes', 'networks', 'files', 'clusters', 'audit')
   OR key IN ('projects.view', 'projects.members.view', 'environments.view', 'environments.create')
ON CONFLICT DO NOTHING;

-- Developer: view + container interaction + file browse/read + cluster view + environments view
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-000000000003'::UUID, id FROM permissions
WHERE key IN (
    'systems.view', 'systems.connect',
    'containers.view', 'containers.start', 'containers.stop', 'containers.restart',
    'containers.exec', 'containers.logs',
    'images.view', 'images.pull',
    'volumes.view',
    'networks.view',
    'files.view', 'files.read', 'files.download',
    'clusters.view',
    'projects.view', 'projects.members.view',
    'environments.view',
    'audit.view'
)
ON CONFLICT DO NOTHING;

-- Viewer: all *.view + file read/download + container logs + environments view
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-000000000004'::UUID, id FROM permissions
WHERE key IN (
    'systems.view',
    'containers.view', 'containers.logs',
    'images.view',
    'volumes.view',
    'networks.view',
    'files.view', 'files.read', 'files.download',
    'clusters.view',
    'projects.view', 'projects.members.view',
    'environments.view',
    'audit.view'
)
ON CONFLICT DO NOTHING;
