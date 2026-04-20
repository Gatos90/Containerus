-- CON-129 — pending project invites.
--
-- Backs GET/POST/DELETE /api/projects/{id}/invites*. Until now,
-- POST /members/invite added an existing user straight into
-- project_members and rejected unknown emails with 400. The People screen
-- (CON-125) expects a pending-invite list for emails that haven't signed
-- up yet, so we split that case into its own table.
--
-- Rows live here until the invitee either redeems the invite (promoting
-- to project_members) or an admin revokes it via DELETE. Uniqueness is
-- (project_id, lower(email)) so the same address can't be pending twice
-- on the same project.
CREATE TABLE IF NOT EXISTS project_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_invites_project_email
    ON project_invites(project_id, lower(email));
CREATE INDEX IF NOT EXISTS idx_project_invites_role ON project_invites(role_id);
CREATE INDEX IF NOT EXISTS idx_project_invites_invited_by
    ON project_invites(invited_by);
