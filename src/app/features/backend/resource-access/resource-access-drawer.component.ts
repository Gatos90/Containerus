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
  K8sCluster,
  PermissionDef,
  ProjectMember,
  Role,
} from '../../../core/models/backend.model';
import { AclResourceType, PHASE1_RESOURCE_TYPES } from './resource-access.component';

interface ResourceOption {
  readonly id: string;
  readonly label: string;
}

interface CreateAclPayload {
  userId: string;
  resourceType: AclResourceType;
  resourceId: string;
  roleId?: string;
  extraPermissions: string[];
  deniedPermissions: string[];
}

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

  readonly resourceTypes = PHASE1_RESOURCE_TYPES;

  readonly userId = signal('');
  readonly resourceType = signal<AclResourceType>('system');
  readonly resourceId = signal('');
  readonly roleId = signal<string>('');
  readonly extraSet = signal<Set<string>>(new Set());
  readonly deniedSet = signal<Set<string>>(new Set());

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
      default:
        return [];
    }
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

  readonly canSubmit = computed<boolean>(
    () => !!this.userId() && !!this.resourceType() && !!this.resourceId(),
  );

  readonly dirty = computed<boolean>(
    () =>
      !!this.userId()
      || !!this.resourceId()
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
    // mismatched (type, id) pair.
    effect(() => {
      this.resourceType();
      // untracked write — clear without re-triggering this effect
      queueMicrotask(() => this.resourceId.set(''));
    });
  }

  ngOnInit(): void {
    // Pre-select the first non-system role if one is available; system roles
    // are typically the most useful starting point for an override base.
    const firstRole = this.roles().find((r) => !r.isSystem) ?? this.roles()[0];
    if (firstRole) this.roleId.set(firstRole.id);
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

  onSubmit(): void {
    if (!this.canSubmit()) return;
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
}
