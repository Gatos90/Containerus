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
  Users,
  UserPlus,
  Trash2,
  Send,
  X,
} from 'lucide-angular';

import {
  DrawerDialogComponent,
  ListStatesComponent,
} from '../../../shared/components/a11y';
import { BackendService } from '../../../core/services/backend.service';
import {
  PendingInvite,
  Project,
  ProjectMember,
  Role,
} from '../../../core/models/backend.model';

/**
 * CON-125 §3.3 — People screen. Lists project members and pending invites
 * side-by-side. The pending-invites endpoint is a Phase-1 follow-up
 * (BackendEngineer subtask spawned from CON-125); when it 404s the column
 * collapses to a friendly "not yet available" empty state rather than
 * surfacing the raw error.
 */
@Component({
  selector: 'app-people',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    ListStatesComponent,
    DrawerDialogComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './people.component.html',
})
export class PeopleComponent implements OnInit {
  private readonly backend = inject(BackendService);

  readonly Users = Users;
  readonly UserPlus = UserPlus;
  readonly Trash2 = Trash2;
  readonly Send = Send;
  readonly X = X;

  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);

  readonly connectionId = signal<string>('');
  readonly projects = signal<Project[]>([]);
  readonly selectedProjectId = signal<string>('');

  readonly members = signal<ProjectMember[]>([]);
  readonly roles = signal<Role[]>([]);
  readonly invites = signal<PendingInvite[]>([]);
  readonly invitesUnavailable = signal(false);

  readonly inviteOpen = signal(false);
  readonly inviteTrigger = signal<HTMLElement | null>(null);
  readonly inviteEmail = signal('');
  readonly inviteRoleId = signal('');
  readonly inviteSaving = signal(false);
  readonly inviteError = signal<string | null>(null);

  readonly roleById = computed(() => {
    const map = new Map<string, Role>();
    for (const r of this.roles()) map.set(r.id, r);
    return map;
  });

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
      const [members, roles] = await Promise.all([
        this.backend.getProjectMembersFor(connectionId, projectId),
        this.backend.listRolesFor(connectionId).catch(() => [] as Role[]),
      ]);
      this.members.set(members);
      this.roles.set(roles);
      if (roles.length > 0 && !this.inviteRoleId()) {
        this.inviteRoleId.set(roles[0].id);
      }

      // Pending invites endpoint is a follow-up — degrade silently on 404
      // so the rest of the screen remains useful.
      try {
        const invites = await this.backend.listInvitesFor(connectionId, projectId);
        this.invites.set(invites);
        this.invitesUnavailable.set(false);
      } catch {
        this.invites.set([]);
        this.invitesUnavailable.set(true);
      }
    } catch (e: any) {
      this.loadError.set(e?.message ?? 'Failed to load members');
    } finally {
      this.loading.set(false);
    }
  }

  openInvite(event: Event): void {
    this.inviteTrigger.set(event.currentTarget as HTMLElement);
    this.inviteError.set(null);
    this.inviteOpen.set(true);
  }

  onInviteClosed(): void {
    this.inviteOpen.set(false);
  }

  async submitInvite(): Promise<void> {
    const email = this.inviteEmail().trim();
    const roleId = this.inviteRoleId();
    const connectionId = this.connectionId();
    const projectId = this.selectedProjectId();
    if (!email || !roleId || !connectionId || !projectId) return;

    this.inviteSaving.set(true);
    this.inviteError.set(null);
    try {
      await this.backend.inviteMemberFor(connectionId, projectId, { email, roleId });
      this.inviteEmail.set('');
      this.inviteOpen.set(false);
      await this.loadAll();
    } catch (e: any) {
      this.inviteError.set(e?.message ?? 'Failed to send invite');
    } finally {
      this.inviteSaving.set(false);
    }
  }

  async resendInvite(invite: PendingInvite): Promise<void> {
    const connectionId = this.connectionId();
    const projectId = this.selectedProjectId();
    if (!connectionId || !projectId) return;
    try {
      await this.backend.resendInviteFor(connectionId, projectId, invite.id);
    } catch (e: any) {
      this.loadError.set(e?.message ?? 'Failed to resend invite');
    }
  }

  async revokeInvite(invite: PendingInvite): Promise<void> {
    const connectionId = this.connectionId();
    const projectId = this.selectedProjectId();
    if (!connectionId || !projectId) return;
    // Destructive confirm — name the invitee email per CON-115 §3.3.
    if (!confirm(`Revoke invite for ${invite.email}?`)) return;
    try {
      await this.backend.revokeInviteFor(connectionId, projectId, invite.id);
      await this.loadAll();
    } catch (e: any) {
      this.loadError.set(e?.message ?? 'Failed to revoke invite');
    }
  }

  async removeMember(member: ProjectMember): Promise<void> {
    const connectionId = this.connectionId();
    const projectId = this.selectedProjectId();
    if (!connectionId || !projectId) return;
    // Destructive confirm — name the member email per CON-115 §3.3.
    if (!confirm(`Remove ${member.email} from this project?`)) return;
    try {
      await this.backend.removeMemberFor(connectionId, projectId, member.userId);
      await this.loadAll();
    } catch (e: any) {
      this.loadError.set(e?.message ?? 'Failed to remove member');
    }
  }

  formatDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }
}
