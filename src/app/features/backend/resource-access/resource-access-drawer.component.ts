import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  Input,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, X } from 'lucide-angular';

import {
  PermissionKeyComponent,
} from '../../../shared/components/a11y';
import { BackendService } from '../../../core/services/backend.service';
import {
  Container,
  getDisplayName as getContainerDisplayName,
} from '../../../core/models/container.model';
import {
  K8sCluster,
  PermissionDef,
  ProjectMember,
  Role,
} from '../../../core/models/backend.model';
import { containerAclResourceId } from '../../../shared/utils/container-acl-id';
import { AclResourceType, RESOURCE_TYPES } from './resource-access.component';

interface ResourceOption {
  readonly id: string;
  readonly label: string;
}

interface CreateAclPayload {
  userId: string;
  resourceType: AclResourceType;
  resourceId: string;
  /** Only set when `resourceType === 'container'`; required by CON-117. */
  systemId?: string;
  roleId?: string;
  extraPermissions: string[];
  deniedPermissions: string[];
}

// Cap per-page container count so screen-reader users don't have to tab
// through a thousand containers and the DOM stays small enough for 400%
// zoom + 320px reflow to render without horizontal scroll.
export const CONTAINER_PAGE_SIZE = 25;

@Component({
  selector: 'app-resource-access-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, PermissionKeyComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './resource-access-drawer.component.html',
})
export class ResourceAccessDrawerComponent implements OnInit {
  private readonly backend = inject(BackendService);

  readonly X = X;

  readonly titleId = input<string>('resource-access-drawer-title');
  readonly members = input<readonly ProjectMember[]>([]);
  readonly roles = input<readonly Role[]>([]);
  readonly permissions = input<readonly PermissionDef[]>([]);
  readonly systems = input<readonly ResourceOption[]>([]);
  readonly clusters = input<readonly K8sCluster[]>([]);
  readonly envs = input<readonly ResourceOption[]>([]);
  readonly saving = input<boolean>(false);

  @Input() connectionId = '';

  readonly create = output<CreateAclPayload>();
  readonly cancel = output<void>();
  readonly dirtyChange = output<boolean>();

  readonly resourceTypes = RESOURCE_TYPES;

  readonly userId = signal('');
  readonly resourceType = signal<AclResourceType>('system');
  readonly resourceId = signal('');
  readonly roleId = signal<string>('');
  readonly extraSet = signal<Set<string>>(new Set());
  readonly deniedSet = signal<Set<string>>(new Set());

  // --- Container picker state (Phase 2) ---
  // A container ACL needs the parent system id to be sent to the server (so
  // the FK cascade-delete works) and the runtime id to hash into resourceId.
  // We load containers lazily per-system so users don't pay for the list on
  // unrelated systems.
  readonly containerSystemId = signal<string>('');
  readonly containerSearch = signal<string>('');
  readonly containerPage = signal<number>(1);
  readonly containers = signal<readonly Container[]>([]);
  readonly containersLoading = signal<boolean>(false);
  readonly containersError = signal<string | null>(null);
  readonly selectedContainerRuntimeId = signal<string>('');

  // Causal phrase for the polite live region: set whenever a toggle crosses
  // sides (Extra ⇄ Deny) so a screen-reader user hears *what* moved, not just
  // the effective-count delta. Cleared on any same-side toggle.
  readonly lastMovement = signal<string | null>(null);

  // The selected role's full permission list, fetched lazily so the
  // "effective" preview is correct.
  readonly rolePermissions = signal<readonly string[]>([]);

  readonly resourceOptions = computed<readonly ResourceOption[]>(() => {
    switch (this.resourceType()) {
      case 'system':
        return this.systems();
      case 'cluster':
        return this.clusters().map((c) => ({ id: c.id, label: c.name }));
      case 'environment':
        return this.envs();
      // 'container' is handled by a dedicated picker, not this list.
      default:
        return [];
    }
  });

  readonly containerSystemLabel = computed<string>(() => {
    const id = this.containerSystemId();
    if (!id) return '';
    return this.systems().find((s) => s.id === id)?.label ?? '';
  });

  readonly filteredContainers = computed<readonly Container[]>(() => {
    const q = this.containerSearch().trim().toLowerCase();
    if (!q) return this.containers();
    return this.containers().filter(
      (c) =>
        getContainerDisplayName(c).toLowerCase().includes(q) ||
        c.image.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q),
    );
  });

  readonly containerPageCount = computed<number>(() =>
    Math.max(1, Math.ceil(this.filteredContainers().length / CONTAINER_PAGE_SIZE)),
  );

  readonly containerPageSlice = computed<readonly Container[]>(() => {
    const page = Math.min(this.containerPage(), this.containerPageCount());
    const start = (page - 1) * CONTAINER_PAGE_SIZE;
    return this.filteredContainers().slice(start, start + CONTAINER_PAGE_SIZE);
  });

  readonly permissionsByCategory = computed(() => {
    const groups = new Map<string, PermissionDef[]>();
    for (const p of this.permissions()) {
      const cat = p.category || 'other';
      const list = groups.get(cat) ?? [];
      list.push(p);
      groups.set(cat, list);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, perms]) => ({
        category,
        perms: perms.sort((a, b) => a.key.localeCompare(b.key)),
      }));
  });

  readonly effectivePermissions = computed<readonly string[]>(() => {
    const base = new Set<string>(this.rolePermissions());
    for (const k of this.extraSet()) base.add(k);
    for (const k of this.deniedSet()) base.delete(k);
    return Array.from(base).sort();
  });

  readonly canSubmit = computed<boolean>(() => {
    if (!this.userId() || !this.resourceType()) return false;
    if (this.resourceType() === 'container') {
      // Need both the parent system (FK) and a picked container.
      return !!this.containerSystemId() && !!this.selectedContainerRuntimeId();
    }
    return !!this.resourceId();
  });

  readonly dirty = computed<boolean>(
    () =>
      !!this.userId()
      || !!this.resourceId()
      || !!this.containerSystemId()
      || !!this.selectedContainerRuntimeId()
      || !!this.roleId()
      || this.extraSet().size > 0
      || this.deniedSet().size > 0,
  );

  constructor() {
    // Surface dirty state to the host so it can wire up DrawerDialog's
    // pristine-vs-dirty close semantics.
    effect(() => this.dirtyChange.emit(this.dirty()));

    // When the role changes, fetch its permissions so the effective preview
    // is accurate.
    effect(async () => {
      const id = this.roleId();
      if (!id) {
        this.rolePermissions.set([]);
        return;
      }
      try {
        const role = await this.backend.getRoleFor(this.connectionId, id);
        this.rolePermissions.set(role.permissions);
      } catch {
        this.rolePermissions.set([]);
      }
    });

    // When resource type changes, reset resource ID so we never POST a
    // mismatched (type, id) pair. Also reset the container picker state.
    effect(() => {
      this.resourceType();
      queueMicrotask(() => {
        this.resourceId.set('');
        this.selectedContainerRuntimeId.set('');
        this.containerPage.set(1);
        this.containerSearch.set('');
      });
    });

    // When the container system changes, reload the container list.
    effect(async () => {
      const systemId = this.containerSystemId();
      if (this.resourceType() !== 'container' || !systemId || !this.connectionId) {
        return;
      }
      this.containersLoading.set(true);
      this.containersError.set(null);
      try {
        const list = await this.backend.listContainersFor(this.connectionId, systemId);
        this.containers.set(list);
        this.containerPage.set(1);
        this.selectedContainerRuntimeId.set('');
      } catch (e: any) {
        this.containers.set([]);
        this.containersError.set(e?.message ?? 'Failed to load containers for this system.');
      } finally {
        this.containersLoading.set(false);
      }
    });
  }

  ngOnInit(): void {
    // Pre-select the first non-system role if one is available; system roles
    // are typically the most useful starting point for an override base.
    const firstRole = this.roles().find((r) => !r.isSystem) ?? this.roles()[0];
    if (firstRole) this.roleId.set(firstRole.id);
  }

  onContainerSearch(value: string): void {
    this.containerSearch.set(value);
    this.containerPage.set(1);
  }

  onContainerPage(delta: number): void {
    const next = Math.min(
      this.containerPageCount(),
      Math.max(1, this.containerPage() + delta),
    );
    this.containerPage.set(next);
  }

  toggleExtra(key: string): void {
    const wasDenied = this.deniedSet().has(key);
    this.extraSet.update((set) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    // A permission cannot be both extra and denied. Flip-flopping clears the
    // opposite side rather than leaving an internally inconsistent draft.
    if (wasDenied) {
      this.deniedSet.update((set) => {
        const next = new Set(set);
        next.delete(key);
        return next;
      });
      this.lastMovement.set(`${key} moved from Deny to Extra.`);
    } else {
      this.lastMovement.set(null);
    }
  }

  toggleDenied(key: string): void {
    const wasExtra = this.extraSet().has(key);
    this.deniedSet.update((set) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (wasExtra) {
      this.extraSet.update((set) => {
        const next = new Set(set);
        next.delete(key);
        return next;
      });
      this.lastMovement.set(`${key} moved from Extra to Deny.`);
    } else {
      this.lastMovement.set(null);
    }
  }

  /**
   * Derive the `resource_id` for a container ACL exactly the way the server
   * middleware does (UUID-v5 over (system_id, runtime_id)), then emit the
   * full create payload. Exposed as a method instead of inlined in onSubmit()
   * so the unit spec can assert on the derivation without faking an event.
   */
  async buildContainerPayload(): Promise<CreateAclPayload | null> {
    const systemId = this.containerSystemId();
    const runtimeId = this.selectedContainerRuntimeId();
    if (!systemId || !runtimeId) return null;
    const resourceId = await containerAclResourceId(systemId, runtimeId);
    return {
      userId: this.userId(),
      resourceType: 'container',
      resourceId,
      systemId,
      roleId: this.roleId() || undefined,
      extraPermissions: Array.from(this.extraSet()),
      deniedPermissions: Array.from(this.deniedSet()),
    };
  }

  async onSubmit(): Promise<void> {
    if (!this.canSubmit()) return;
    if (this.resourceType() === 'container') {
      const payload = await this.buildContainerPayload();
      if (payload) this.create.emit(payload);
      return;
    }
    this.create.emit({
      userId: this.userId(),
      resourceType: this.resourceType(),
      resourceId: this.resourceId(),
      roleId: this.roleId() || undefined,
      extraPermissions: Array.from(this.extraSet()),
      deniedPermissions: Array.from(this.deniedSet()),
    });
  }

  onCancel(): void {
    this.cancel.emit();
  }

  containerDisplayName(c: Container): string {
    return getContainerDisplayName(c);
  }
}
