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
  UserMinus,
  UserCheck,
} from 'lucide-angular';

import {
  DrawerDialogComponent,
  ListStatesComponent,
} from '../../../shared/components/a11y';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
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
 *
 * CON-134 — the Members table gained an `Active` status column and a
 * per-row Deactivate/Reactivate action that drives
 * `PATCH /api/admin/users/{userId}` (CON-119). The action is hidden for
 * non-admins and for the caller's own row, mirroring the server-side
 * self-deactivation 400 so the button never appears broken.
 */
type ToastKind = 'success' | 'error';

interface StatusToast {
  readonly message: string;
  readonly kind: ToastKind;
}

@Component({
  selector: 'app-people',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    ListStatesComponent,
    DrawerDialogComponent,
    ConfirmDialogComponent,
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
  readonly UserMinus = UserMinus;
  readonly UserCheck = UserCheck;

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

  /**
   * CON-134 — destructive confirm for Deactivate. Reactivate skips the modal
   * because it has no side effects on sessions/MFA; flipping a false-positive
   * back on shouldn't need a two-tap ceremony.
   */
  readonly deactivateOpen = signal(false);
  readonly deactivateTarget = signal<ProjectMember | null>(null);
  readonly deactivateBusy = signal(false);
  readonly deactivateTrigger = signal<HTMLElement | null>(null);
  /** userIds currently mid-flight — disables their row action + shows busy state. */
  readonly pendingActiveFlip = signal<ReadonlySet<string>>(new Set());

  readonly toast = signal<StatusToast | null>(null);
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  readonly roleById = computed(() => {
    const map = new Map<string, Role>();
    for (const r of this.roles()) map.set(r.id, r);
    return map;
  });

  /**
   * Caller's own user id. Used to hide the Deactivate/Reactivate action on
   * the caller's own row — the backend returns 400 for self-targeting, but
   * we'd rather not render a button that's guaranteed to fail.
   */
  readonly currentUserId = computed(
    () => this.backend.connectedBackends().find(c => c.id === this.connectionId())?.user?.id ?? null,
  );

  /**
   * CON-134 — gate the Deactivate/Reactivate UI on `users.deactivate` OR
   * company-admin. We intentionally do not use `hasPermission` with a
   * project id here: deactivation is a company-wide operation, so the
   * control has to be visible regardless of which project is selected in
   * the project picker.
   */
  readonly canDeactivateUsers = computed(() => {
    const conn = this.backend.connectedBackends().find(c => c.id === this.connectionId());
    if (!conn) return false;
    return Object.values(conn.projectPermissions).some(
      p => p.isCompanyAdmin || p.permissions.includes('users.deactivate'),
    );
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

  /**
   * CON-134 — open the destructive confirm for Deactivate. We capture the
   * triggering button so the dialog can restore focus to it on close,
   * matching the invite drawer's focus-return contract.
   */
  openDeactivateConfirm(member: ProjectMember, event: Event): void {
    this.deactivateTrigger.set(event.currentTarget as HTMLElement);
    this.deactivateTarget.set(member);
    this.deactivateOpen.set(true);
  }

  onDeactivateCancelled(): void {
    this.deactivateOpen.set(false);
    // Return focus to whatever triggered the confirm so keyboard users don't
    // lose their place in the members table.
    const trigger = this.deactivateTrigger();
    if (trigger) {
      queueMicrotask(() => trigger.focus());
    }
    this.deactivateTarget.set(null);
  }

  async onDeactivateConfirmed(): Promise<void> {
    const member = this.deactivateTarget();
    if (!member) return;
    this.deactivateBusy.set(true);
    try {
      await this.setUserActive(member, false);
      this.deactivateOpen.set(false);
      this.deactivateTarget.set(null);
    } finally {
      this.deactivateBusy.set(false);
    }
  }

  /**
   * CON-134 — reactivation has no destructive side-effects (sessions stay
   * revoked, MFA stays cleared — the backend intentionally doesn't restore
   * those because it would be hostile to ops flipping a false-positive back
   * on). One-tap is fine.
   */
  async reactivateMember(member: ProjectMember): Promise<void> {
    await this.setUserActive(member, true);
  }

  private async setUserActive(member: ProjectMember, isActive: boolean): Promise<void> {
    const connectionId = this.connectionId();
    if (!connectionId) return;

    this.markPending(member.userId, true);
    try {
      const updated = await this.backend.setUserActiveFor(connectionId, member.userId, isActive);
      // Patch the row in place so the status column + action flip without a
      // full reload flicker.
      this.members.update(list =>
        list.map(m =>
          m.userId === updated.id ? { ...m, isActive: updated.isActive } : m,
        ),
      );
      this.announceToast({
        kind: 'success',
        message: isActive
          ? `${member.email} reactivated.`
          : `${member.email} deactivated. Sessions revoked and MFA cleared.`,
      });
    } catch (e: any) {
      this.announceToast({
        kind: 'error',
        message: e?.message ?? `Failed to ${isActive ? 'reactivate' : 'deactivate'} ${member.email}.`,
      });
    } finally {
      this.markPending(member.userId, false);
    }
  }

  private markPending(userId: string, pending: boolean): void {
    const next = new Set(this.pendingActiveFlip());
    if (pending) next.add(userId);
    else next.delete(userId);
    this.pendingActiveFlip.set(next);
  }

  isPending(userId: string): boolean {
    return this.pendingActiveFlip().has(userId);
  }

  private announceToast(t: StatusToast): void {
    this.toast.set(t);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    // Success toasts self-dismiss, errors stick until the user acts again.
    if (t.kind === 'success') {
      this.toastTimer = setTimeout(() => this.toast.set(null), 5000);
    }
  }

  dismissToast(): void {
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    this.toast.set(null);
  }

  /**
   * CON-134 — guard used by the template to decide whether to render the
   * Deactivate (when active) or Reactivate (when inactive) row action, or
   * nothing at all (self-row / non-admin / unknown isActive).
   */
  canFlipActive(member: ProjectMember): boolean {
    if (!this.canDeactivateUsers()) return false;
    if (member.userId === this.currentUserId()) return false;
    // If the backend didn't project `is_active` (older server, field
    // optional in the model), fall back to showing nothing rather than
    // rendering an action that could mean either direction.
    return member.isActive !== undefined;
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
