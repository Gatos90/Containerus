import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  ShieldCheck,
  Plus,
  Save,
  Trash2,
  X,
  Lock,
  Loader2,
  AlertTriangle,
} from 'lucide-angular';

import { BackendService } from '../../../core/services/backend.service';
import {
  PermissionDef,
  Role,
  RoleWithPermissions,
} from '../../../core/models/backend.model';

/**
 * CON-125 §3.3 — "where used" snapshot for the selected role. Counts member
 * assignments and ACL overrides across every project on the active
 * connection. Per-project failures are absorbed (counted as `partial`) so a
 * single 403 on one project doesn't blank the panel.
 */
interface WhereUsedSummary {
  members: number;
  acls: number;
  projects: { projectId: string; projectName: string; members: number; acls: number }[];
  partial: boolean;
}

interface PermissionGroup {
  category: string;
  permissions: PermissionDef[];
}

@Component({
  selector: 'app-role-manager',
  imports: [FormsModule, LucideAngularModule],
  templateUrl: './role-manager.component.html',
})
export class RoleManagerComponent implements OnInit {
  private backend = inject(BackendService);

  readonly ShieldCheck = ShieldCheck;
  readonly Plus = Plus;
  readonly Save = Save;
  readonly Trash2 = Trash2;
  readonly X = X;
  readonly Lock = Lock;
  readonly Loader2 = Loader2;
  readonly AlertTriangle = AlertTriangle;

  loading = signal(false);
  saving = signal(false);
  loadError = signal<string | null>(null);
  saveError = signal<string | null>(null);

  roles = signal<Role[]>([]);
  permissions = signal<PermissionDef[]>([]);

  selectedRoleId = signal<string | null>(null);
  selectedRole = signal<RoleWithPermissions | null>(null);
  creating = signal(false);

  whereUsed = signal<WhereUsedSummary | null>(null);
  whereUsedLoading = signal(false);

  // Draft state for the currently-edited role. Keeping it as plain fields + a
  // Set for permissions keeps the permission grid toggles cheap.
  draftName = '';
  draftSlug = '';
  draftDescription = '';
  draftPermissions = signal<Set<string>>(new Set());

  readonly permissionGroups = computed<PermissionGroup[]>(() => {
    const byCategory = new Map<string, PermissionDef[]>();
    for (const perm of this.permissions()) {
      const cat = perm.category || 'other';
      const list = byCategory.get(cat) ?? [];
      list.push(perm);
      byCategory.set(cat, list);
    }
    return Array.from(byCategory.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, permissions]) => ({
        category,
        permissions: permissions.sort((a, b) => a.key.localeCompare(b.key)),
      }));
  });

  readonly isSystemRole = computed(() => this.selectedRole()?.isSystem === true);

  readonly totalPermissions = computed(() => this.permissions().length);
  readonly draftPermissionCount = computed(() => this.draftPermissions().size);

  // Diff vs the original role snapshot — drives the "changed" badge.
  private originalPermissions = signal<Set<string>>(new Set());
  readonly hasChanges = computed(() => {
    const original = this.originalPermissions();
    const draft = this.draftPermissions();
    if (this.creating()) {
      return draft.size > 0 || this.draftName.length > 0 || this.draftSlug.length > 0;
    }
    const role = this.selectedRole();
    if (!role) return false;
    if (role.name !== this.draftName) return true;
    if (role.slug !== this.draftSlug) return true;
    if ((role.description ?? '') !== this.draftDescription) return true;
    if (original.size !== draft.size) return true;
    for (const p of draft) if (!original.has(p)) return true;
    return false;
  });

  get connectionId(): string | null {
    return this.backend.connectedBackends()[0]?.id ?? null;
  }

  async ngOnInit(): Promise<void> {
    await this.loadAll();
  }

  async loadAll(): Promise<void> {
    const connectionId = this.connectionId;
    if (!connectionId) {
      this.loadError.set('No active backend connection.');
      return;
    }
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const [roles, permissions] = await Promise.all([
        this.backend.listRolesFor(connectionId),
        this.backend.listPermissionDefsFor(connectionId),
      ]);
      this.roles.set(
        [...roles].sort((a, b) => {
          if (a.isSystem !== b.isSystem) return a.isSystem ? -1 : 1;
          return a.name.localeCompare(b.name);
        }),
      );
      this.permissions.set(permissions);
    } catch (err) {
      this.loadError.set(err instanceof Error ? err.message : 'Failed to load roles.');
    } finally {
      this.loading.set(false);
    }
  }

  async selectRole(roleId: string): Promise<void> {
    const connectionId = this.connectionId;
    if (!connectionId) return;
    this.creating.set(false);
    this.selectedRoleId.set(roleId);
    this.selectedRole.set(null);
    this.whereUsed.set(null);
    this.saveError.set(null);
    try {
      const role = await this.backend.getRoleFor(connectionId, roleId);
      this.selectedRole.set(role);
      this.draftName = role.name;
      this.draftSlug = role.slug;
      this.draftDescription = role.description ?? '';
      const perms = new Set(role.permissions);
      this.draftPermissions.set(new Set(perms));
      this.originalPermissions.set(perms);
      // Don't await — load the panel in the background so the editor renders fast.
      void this.loadWhereUsed(roleId);
    } catch (err) {
      this.saveError.set(err instanceof Error ? err.message : 'Failed to load role.');
    }
  }

  private async loadWhereUsed(roleId: string): Promise<void> {
    const connectionId = this.connectionId;
    if (!connectionId) return;
    const conn = this.backend.connectedBackends().find((c) => c.id === connectionId);
    const projects = conn?.projects ?? [];
    if (projects.length === 0) {
      this.whereUsed.set({ members: 0, acls: 0, projects: [], partial: false });
      return;
    }

    this.whereUsedLoading.set(true);
    let partial = false;
    const perProject = await Promise.all(
      projects.map(async (p) => {
        const [members, acls] = await Promise.all([
          this.backend.getProjectMembersFor(connectionId, p.id).catch(() => {
            partial = true;
            return [] as { roleId: string }[];
          }),
          this.backend.listAclsFor(connectionId, p.id).catch(() => {
            partial = true;
            return [] as { roleId: string | null }[];
          }),
        ]);
        return {
          projectId: p.id,
          projectName: p.name,
          members: members.filter((m) => m.roleId === roleId).length,
          acls: acls.filter((a) => a.roleId === roleId).length,
        };
      }),
    );

    // Bail if the user picked another role mid-flight.
    if (this.selectedRoleId() !== roleId) {
      this.whereUsedLoading.set(false);
      return;
    }

    const totalMembers = perProject.reduce((acc, p) => acc + p.members, 0);
    const totalAcls = perProject.reduce((acc, p) => acc + p.acls, 0);
    this.whereUsed.set({
      members: totalMembers,
      acls: totalAcls,
      projects: perProject.filter((p) => p.members > 0 || p.acls > 0),
      partial,
    });
    this.whereUsedLoading.set(false);
  }

  startCreate(): void {
    this.creating.set(true);
    this.selectedRoleId.set(null);
    this.selectedRole.set(null);
    this.saveError.set(null);
    this.draftName = '';
    this.draftSlug = '';
    this.draftDescription = '';
    this.draftPermissions.set(new Set());
    this.originalPermissions.set(new Set());
  }

  cancelEdit(): void {
    this.creating.set(false);
    this.selectedRoleId.set(null);
    this.selectedRole.set(null);
    this.draftPermissions.set(new Set());
    this.originalPermissions.set(new Set());
    this.whereUsed.set(null);
    this.saveError.set(null);
  }

  togglePermission(key: string): void {
    if (this.isSystemRole()) return;
    this.draftPermissions.update((set) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  toggleCategory(category: string, enable: boolean): void {
    if (this.isSystemRole()) return;
    const keys = this.permissions()
      .filter((p) => (p.category || 'other') === category)
      .map((p) => p.key);
    this.draftPermissions.update((set) => {
      const next = new Set(set);
      for (const key of keys) {
        if (enable) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }

  isCategoryFullyEnabled(category: string): boolean {
    const keys = this.permissions()
      .filter((p) => (p.category || 'other') === category)
      .map((p) => p.key);
    if (keys.length === 0) return false;
    const draft = this.draftPermissions();
    return keys.every((k) => draft.has(k));
  }

  async save(): Promise<void> {
    const connectionId = this.connectionId;
    if (!connectionId) return;
    if (this.isSystemRole()) return;

    const name = this.draftName.trim();
    const slug = this.draftSlug.trim();
    if (!name || !slug) {
      this.saveError.set('Name and slug are required.');
      return;
    }
    const permissions = Array.from(this.draftPermissions());

    this.saving.set(true);
    this.saveError.set(null);
    try {
      if (this.creating()) {
        const created = await this.backend.createRoleFor(connectionId, {
          name,
          slug,
          description: this.draftDescription || undefined,
          permissions,
        });
        await this.loadAll();
        await this.selectRole(created.id);
      } else {
        const roleId = this.selectedRoleId();
        if (!roleId) return;
        await this.backend.updateRoleFor(connectionId, roleId, {
          name,
          slug,
          description: this.draftDescription || undefined,
          permissions,
        });
        await this.loadAll();
        await this.selectRole(roleId);
      }
    } catch (err) {
      this.saveError.set(err instanceof Error ? err.message : 'Failed to save role.');
    } finally {
      this.saving.set(false);
    }
  }

  async deleteRole(): Promise<void> {
    const connectionId = this.connectionId;
    const role = this.selectedRole();
    if (!connectionId || !role) return;
    if (role.isSystem) return;
    if (!confirm(`Delete role "${role.name}"? This cannot be undone.`)) return;

    this.saving.set(true);
    this.saveError.set(null);
    try {
      await this.backend.deleteRoleFor(connectionId, role.id);
      this.cancelEdit();
      await this.loadAll();
    } catch (err) {
      this.saveError.set(err instanceof Error ? err.message : 'Failed to delete role.');
    } finally {
      this.saving.set(false);
    }
  }

  hasPermission(key: string): boolean {
    return this.draftPermissions().has(key);
  }
}
