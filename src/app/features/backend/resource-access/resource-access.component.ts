import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import {
  LucideAngularModule,
  KeyRound,
  Plus,
  Trash2,
  Loader2,
} from 'lucide-angular';

import {
  DrawerDialogComponent,
  ListStatesComponent,
  PermissionKeyComponent,
} from '../../../shared/components/a11y';
import { BackendService } from '../../../core/services/backend.service';
import {
  K8sCluster,
  PermissionDef,
  Project,
  ProjectMember,
  ResourceAcl,
  Role,
  RoleWithPermissions,
} from '../../../core/models/backend.model';
import { ResourceAccessDrawerComponent } from './resource-access-drawer.component';

/**
 * Phase-1 scope: `resource_type ∈ { system, cluster, environment }`. Container
 * scope is gated behind [CON-117](/CON/issues/CON-117) per CON-115 §8 Q1, so
 * the picker hides it until that ticket lands.
 */
export type AclResourceType = 'system' | 'cluster' | 'environment';

export const PHASE1_RESOURCE_TYPES: readonly AclResourceType[] = [
  'system',
  'cluster',
  'environment',
];

@Component({
  selector: 'app-resource-access',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    ListStatesComponent,
    PermissionKeyComponent,
    DrawerDialogComponent,
    ResourceAccessDrawerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './resource-access.component.html',
})
export class ResourceAccessComponent implements OnInit {
  private readonly backend = inject(BackendService);

  readonly KeyRound = KeyRound;
  readonly Plus = Plus;
  readonly Trash2 = Trash2;
  readonly Loader2 = Loader2;

  readonly resourceTypes = PHASE1_RESOURCE_TYPES;

  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);

  readonly connectionId = signal<string>('');
  readonly projects = signal<Project[]>([]);
  readonly selectedProjectId = signal<string>('');

  readonly acls = signal<ResourceAcl[]>([]);
  readonly members = signal<ProjectMember[]>([]);
  readonly roles = signal<Role[]>([]);
  readonly permissions = signal<PermissionDef[]>([]);
  readonly systems = signal<{ id: string; label: string }[]>([]);
  readonly clusters = signal<K8sCluster[]>([]);
  readonly envs = signal<{ id: string; label: string }[]>([]);

  readonly drawerOpen = signal(false);
  readonly drawerTrigger = signal<HTMLElement | null>(null);

  // Lookups so the table can show user.email + role name without N+1 calls.
  readonly memberByUserId = computed(() => {
    const map = new Map<string, ProjectMember>();
    for (const m of this.members()) map.set(m.userId, m);
    return map;
  });
  readonly roleById = computed(() => {
    const map = new Map<string, Role>();
    for (const r of this.roles()) map.set(r.id, r);
    return map;
  });

  // Build a label per ACL row covering Phase-1 resource types only.
  resourceLabel(acl: ResourceAcl): string {
    if (acl.resourceType === 'system') {
      return this.systems().find((s) => s.id === acl.resourceId)?.label ?? acl.resourceId;
    }
    if (acl.resourceType === 'cluster') {
      return this.clusters().find((c) => c.id === acl.resourceId)?.name ?? acl.resourceId;
    }
    if (acl.resourceType === 'environment') {
      return this.envs().find((e) => e.id === acl.resourceId)?.label ?? acl.resourceId;
    }
    return acl.resourceId;
  }

  async ngOnInit(): Promise<void> {
    const conn = this.backend.connectedBackends()[0];
    if (!conn) {
      this.loadError.set('No active backend connection.');
      return;
    }
    this.connectionId.set(conn.id);
    this.projects.set(conn.projects ?? []);
    const first = conn.projects?.[0];
    if (first) {
      this.selectedProjectId.set(first.id);
      await this.loadAll();
    }
  }

  async onProjectChange(projectId: string): Promise<void> {
    this.selectedProjectId.set(projectId);
    await this.loadAll();
  }

  async loadAll(): Promise<void> {
    const connectionId = this.connectionId();
    const projectId = this.selectedProjectId();
    if (!connectionId || !projectId) return;

    this.loading.set(true);
    this.loadError.set(null);
    try {
      const [acls, members, roles, permissions, envs] = await Promise.all([
        this.backend.listAclsFor(connectionId, projectId),
        this.backend.getProjectMembersFor(connectionId, projectId).catch(() => [] as ProjectMember[]),
        this.backend.listRolesFor(connectionId).catch(() => [] as Role[]),
        this.backend.listPermissionDefsFor(connectionId).catch(() => [] as PermissionDef[]),
        this.backend.listEnvironmentsFor(connectionId, projectId).catch(() => []),
      ]);

      this.acls.set(acls);
      this.members.set(members);
      this.roles.set(roles);
      this.permissions.set(permissions);
      this.envs.set(envs.map((e) => ({ id: e.id, label: e.name })));

      // Walk this project's environments to build resource pickers for the
      // system + cluster scopes — both are env-scoped on the server today.
      const systemBuckets = await Promise.all(
        envs.map((e) =>
          this.backend
            .listSystemsInEnvironmentFor(connectionId, projectId, e.id)
            .catch(() => [])
            .then((list) =>
              list.map((s) => ({ id: s.id, label: `${s.name} · ${e.name}` })),
            ),
        ),
      );
      this.systems.set(systemBuckets.flat());

      const clusterBuckets = await Promise.all(
        envs.map((e) =>
          this.backend
            .listClustersInEnvironmentFor(connectionId, projectId, e.id)
            .catch(() => [] as K8sCluster[]),
        ),
      );
      this.clusters.set(clusterBuckets.flat());
    } catch (e: any) {
      this.loadError.set(e?.message ?? 'Failed to load resource access');
    } finally {
      this.loading.set(false);
    }
  }

  openDrawer(event: Event): void {
    // Capture the trigger for explicit focus restore — DrawerDialog
    // intentionally does not read document.activeElement on close.
    this.drawerTrigger.set(event.currentTarget as HTMLElement);
    this.drawerOpen.set(true);
  }

  onDrawerClosed(): void {
    this.drawerOpen.set(false);
  }

  async onCreateAcl(payload: {
    userId: string;
    resourceType: AclResourceType;
    resourceId: string;
    roleId?: string;
    extraPermissions: string[];
    deniedPermissions: string[];
  }): Promise<void> {
    const connectionId = this.connectionId();
    const projectId = this.selectedProjectId();
    if (!connectionId || !projectId) return;
    this.saving.set(true);
    try {
      await this.backend.createAclFor(connectionId, projectId, payload);
      this.drawerOpen.set(false);
      await this.loadAll();
    } catch (e: any) {
      this.loadError.set(e?.message ?? 'Failed to save override');
    } finally {
      this.saving.set(false);
    }
  }

  async deleteAcl(acl: ResourceAcl): Promise<void> {
    const connectionId = this.connectionId();
    const projectId = this.selectedProjectId();
    if (!connectionId || !projectId) return;

    const member = this.memberByUserId().get(acl.userId);
    const target = member?.email ?? acl.userId;
    const resourceLabel = this.resourceLabel(acl);
    if (!confirm(`Remove access override for ${target} on ${acl.resourceType} "${resourceLabel}"?`)) {
      return;
    }

    try {
      await this.backend.deleteAclFor(connectionId, projectId, acl.id);
      await this.loadAll();
    } catch (e: any) {
      this.loadError.set(e?.message ?? 'Failed to delete override');
    }
  }

  async loadRoleDetails(roleId: string): Promise<RoleWithPermissions | null> {
    const connectionId = this.connectionId();
    if (!connectionId) return null;
    try {
      return await this.backend.getRoleFor(connectionId, roleId);
    } catch {
      return null;
    }
  }
}
