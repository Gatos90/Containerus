# Entity Relationship Diagram: Company / Projects / RBAC

## Intended Hierarchy

```
Company (the hoster)
│
├── Company Admins          (super-admins who manage the instance)
├── Users                   (company-wide accounts)
├── Roles & Permissions     (company-wide role definitions)
├── IDP Configs             (company-wide SSO)
│
└── Projects                (customer software, internal tools, etc.)
    │                       created by admins OR users with "projects.create" permission
    │
    ├── Project Members     (users assigned to this project with a role)
    │
    └── Environments        (dev, staging, production, etc.)
        │                   created by project members with sufficient permissions
        │
        ├── Systems         (SSH servers with container runtimes)
        │   └── Credentials (encrypted SSH keys/passwords)
        │
        └── Clusters        (Kubernetes clusters)
            └── Kubeconfig  (encrypted)
```

## Current Schema (What Actually Exists)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          CURRENT ENTITY RELATIONSHIPS                        │
└──────────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────┐
  │      COMPANY        │  (singleton: 1 row per deployment)
  │─────────────────────│
  │ id (PK)             │
  │ name                │
  │ slug (UNIQUE)       │
  │ license_tier        │
  │ settings (JSONB)    │
  └────────┬────────────┘
           │
           │ FK (company_id)               FK (user_id)
           ▼                               ▼
  ┌─────────────────────┐       ┌─────────────────────┐
  │       ROLES         │       │   COMPANY_ADMINS    │
  │─────────────────────│       │─────────────────────│
  │ id (PK)             │       │ user_id (PK, FK→U)  │
  │ company_id (FK→C)   │       │ granted_by (FK→U)   │
  │ name                │       │ granted_at          │
  │ slug (UNIQUE)       │       └─────────────────────┘
  │ is_system           │
  │ description         │
  └────────┬────────────┘
           │
           │ FK (role_id)
           ▼
  ┌─────────────────────┐
  │  ROLE_PERMISSIONS   │
  │─────────────────────│       ┌─────────────────────┐
  │ role_id (PK, FK→R)  │──────▶│    PERMISSIONS      │
  │ permission_id(PK,FK)│       │─────────────────────│
  └─────────────────────┘       │ id (PK)             │
                                │ key (UNIQUE)        │
                                │ description         │
                                │ category            │
                                └─────────────────────┘


  ┌─────────────────────┐
  │     PROJECTS        │  (renamed from organizations)
  │─────────────────────│
  │ id (PK)             │
  │ name                │  ⚠️  NO company_id COLUMN
  │ slug (UNIQUE)       │  ⚠️  Projects are free-floating!
  │ description         │
  └────────┬────────────┘
           │
     ┌─────┼──────────────┬──────────────────┬───────────────────┐
     │     │              │                  │                   │
     ▼     ▼              ▼                  ▼                   ▼
  ┌──────────────┐  ┌───────────┐  ┌──────────────┐  ┌──────────────────┐
  │PROJECT_MEMBERS│  │ SYSTEMS   │  │  CLUSTERS    │  │  RESOURCE_ACLS   │
  │──────────────│  │───────────│  │──────────────│  │──────────────────│
  │project_id(FK)│  │id (PK)    │  │id (PK)       │  │id (PK)           │
  │user_id (FK)  │  │project_id │  │project_id    │  │user_id (FK→U)    │
  │role_id (FK→R)│  │name       │  │name          │  │project_id (FK→P) │
  │joined_at     │  │hostname   │  │api_server_url│  │resource_type     │
  └──────────────┘  │port       │  │kubeconfig_enc│  │resource_id       │
                    │username   │  │context_name  │  │role_id (FK→R)    │
  ┌───────────┐     │auth_method│  │created_by(FK)│  │extra_permissions │
  │  USERS    │     │created_by │  └──────────────┘  │denied_permissions│
  │───────────│     └─────┬─────┘                    └──────────────────┘
  │id (PK)    │           │
  │email      │           ▼
  │password   │  ┌──────────────────┐     ┌─────────────────┐
  │display_nm │  │SYSTEM_CREDENTIALS│     │   IDP_CONFIGS   │
  │auth_provdr│  │──────────────────│     │─────────────────│
  │external_id│  │id (PK)           │     │id (PK)          │
  └───────────┘  │system_id (FK→S)  │     │project_id (FK→P)│  ⚠️ SSO per-project?
                 │encrypted_data    │     │protocol         │
                 │nonce             │     │client_id        │
                 └──────────────────┘     │client_secret_enc│
                                          │auto_provision   │
                                          └─────────────────┘

  ┌──────────────────┐
  │    AUDIT_LOG     │
  │──────────────────│
  │id (PK)           │
  │project_id (FK→P) │  (nullable)
  │user_id (FK→U)    │  (nullable, ON DELETE SET NULL)
  │action            │
  │resource_type     │
  │resource_id       │
  │details (JSONB)   │
  │ip_address        │
  └──────────────────┘
```

## Current vs Intended — Gap Analysis

### What the hierarchy SHOULD be:
```
Company ──► Projects ──► Environments ──► Systems / Clusters
```

### What it IS today:
```
Company    (disconnected)     Projects ──► Systems / Clusters
```

### Gap 1: Projects not linked to Company

The `projects` table has **no `company_id` column**. It was renamed from `organizations` (which were the old top-level entity) and no FK was ever added. Projects are free-floating.

### Gap 2: Environments layer does not exist

There is no `environments` table at all. Systems and Clusters attach **directly** to Projects.
Today a project IS the environment — if you want dev/staging/prod you'd need 3 separate projects, which defeats the purpose.

### Gap 3: Roles reference Company, but Projects don't

Custom roles have `company_id FK → company`, making them company-scoped. But the projects where those roles are used (via `project_members`) don't reference company at all.

```
Company ──owns──► Roles ──used in──► Project_Members ──belongs to──► Projects ──(no link)──► Company
```

### Gap 4: IDP Configs are per-Project, not per-Company

SSO (`idp_configs`) has `project_id`. SSO should be a company-wide setting, not configured per-project.

### Gap 5: No "projects.create" permission for non-admins

The seeded permissions include `projects.edit` but no `projects.create`. Currently only company admins can create projects. The intent is that users with the right role can also create projects.

## Target Schema

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          TARGET ENTITY RELATIONSHIPS                         │
└──────────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────┐
  │      COMPANY        │  (singleton)
  │─────────────────────│
  │ id (PK)             │
  │ name, slug          │
  │ license_tier        │
  │ settings (JSONB)    │
  └────────┬────────────┘
           │
     ┌─────┼────────────┬──────────────────┬────────────────┐
     │     │            │                  │                │
     ▼     ▼            ▼                  ▼                ▼
  ┌────────────┐ ┌────────────┐ ┌──────────────┐ ┌─────────────────┐
  │  COMPANY   │ │   ROLES    │ │   PROJECTS   │ │   IDP_CONFIGS   │
  │  _ADMINS   │ │────────────│ │──────────────│ │─────────────────│
  │────────────│ │id (PK)     │ │id (PK)       │ │id (PK)          │
  │user_id(FK) │ │company_id  │ │company_id(FK)│ │company_id (FK)  │ ← moved from project
  │granted_by  │ │name, slug  │ │name, slug    │ │protocol         │
  └────────────┘ │is_system   │ │description   │ │client_id, etc.  │
                 │permissions │ └──────┬───────┘ └─────────────────┘
                 └──────┬─────┘        │
                        │              │
                        ▼              ▼
               ┌──────────────┐ ┌──────────────────┐
               │PROJECT_MEMBERS│ │  ENVIRONMENTS    │  ← NEW TABLE
               │──────────────│ │──────────────────│
               │project_id(FK)│ │id (PK)           │
               │user_id (FK)  │ │project_id (FK)   │
               │role_id (FK)  │ │name              │
               └──────────────┘ │slug              │
                                │description       │
                                └────────┬─────────┘
                                         │
                                   ┌─────┴──────┐
                                   │            │
                                   ▼            ▼
                             ┌───────────┐ ┌──────────────┐
                             │ SYSTEMS   │ │  CLUSTERS    │
                             │───────────│ │──────────────│
                             │id (PK)    │ │id (PK)       │
                             │env_id(FK) │ │env_id (FK)   │  ← changed from project_id
                             │name       │ │name          │
                             │hostname   │ │api_server_url│
                             │port       │ │kubeconfig_enc│
                             │username   │ │context_name  │
                             │auth_method│ │created_by    │
                             │created_by │ └──────────────┘
                             └─────┬─────┘
                                   │
                                   ▼
                          ┌──────────────────┐
                          │SYSTEM_CREDENTIALS│
                          │──────────────────│
                          │system_id (FK)    │
                          │encrypted_data    │
                          │nonce             │
                          └──────────────────┘


  CROSS-CUTTING (unchanged):

  ┌───────────┐   ┌──────────────────┐   ┌──────────────────┐
  │  USERS    │   │  RESOURCE_ACLS   │   │    AUDIT_LOG     │
  │───────────│   │──────────────────│   │──────────────────│
  │id (PK)    │   │id (PK)           │   │id (PK)           │
  │email      │   │user_id (FK)      │   │project_id (FK)   │
  │password   │   │project_id (FK)   │   │env_id (FK)       │  ← add env scope
  │display_nm │   │resource_type     │   │user_id (FK)      │
  │auth_provdr│   │resource_id       │   │action            │
  │external_id│   │role_id (FK)      │   │resource_type     │
  └───────────┘   │extra_permissions │   │resource_id       │
                  │denied_permissions│   │details, ip       │
                  └──────────────────┘   └──────────────────┘
```

## Summary of Changes Needed

| # | Change | Type |
|---|--------|------|
| 1 | Add `company_id FK` to `projects` table | Migration |
| 2 | Create `environments` table (id, project_id, name, slug, description) | Migration |
| 3 | Change `systems.project_id` → `systems.environment_id` | Migration |
| 4 | Change `clusters.project_id` → `clusters.environment_id` | Migration |
| 5 | Move `idp_configs.project_id` → `idp_configs.company_id` | Migration |
| 6 | Add `projects.create` permission to seed data | Migration |
| 7 | Add `environment_id` to `audit_log` for environment-level scoping | Migration |
| 8 | Update all API handlers and models for new hierarchy | Rust code |
| 9 | Update frontend models, services, and components | Angular code |
