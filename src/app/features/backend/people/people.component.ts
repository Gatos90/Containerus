import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  OnInit,
  signal,
  viewChild,
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
  Upload,
} from 'lucide-angular';

import {
  DrawerDialogComponent,
  ListStatesComponent,
} from '../../../shared/components/a11y';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { BackendService } from '../../../core/services/backend.service';
import {
  BulkInviteResponse,
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

/** CON-135 — client-side cap matching the server `BULK_INVITE_MAX` in CON-120. */
export const BULK_INVITE_MAX = 100;

/**
 * CON-135 — a single parsed bulk-invite row. `id` is a monotonic local id
 * (not the server user id) so fix-in-place edits and deletes can track rows
 * stably even when two rows share the same email during editing.
 */
export interface BulkInviteRow {
  id: number;
  email: string;
  /** Selected role id, or '' when the row's role label could not be matched. */
  roleId: string;
  /**
   * Raw role label as it appeared in the CSV (or null when the row was
   * seeded from an email-only paste line and inherited the default role).
   * Kept so the preview can show "unknown role: foo" instead of dropping it.
   */
  rawRoleLabel: string | null;
}

type BulkRowIssue = 'invalid_email' | 'unknown_role' | 'missing_role';

export interface BulkRowValidation {
  row: BulkInviteRow;
  issues: BulkRowIssue[];
}

/**
 * Accepts most practical emails without trying to be RFC 5322. Kept tight
 * enough to reject "a", "a@", "a@b", and whitespace-only input so the preview
 * surfaces obviously-bad rows before submit.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
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
  readonly Upload = Upload;

  readonly BULK_MAX = BULK_INVITE_MAX;

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
   * CON-135 — invite mode toggle inside the drawer. Single-email is the
   * default (Phase-1 behaviour); operators opt in to bulk mode only when
   * they have a list to import, so no existing workflow is re-routed.
   */
  readonly inviteMode = signal<'single' | 'bulk'>('single');

  /**
   * CON-135 a11y — template refs for focus management:
   *   - `inviteModeGroup`: the radiogroup wrapper; we focus() the matching
   *     child radio after an Arrow/Home/End keystroke so keyboard users see
   *     the roving-tabindex follow their navigation.
   *   - `loadPreviewBtn`: focus fallback when the last preview row is
   *     deleted (the Clear button disappears with the rows, so it can't be
   *     the target). Matches the a11y reviewer's recommendation.
   */
  private readonly inviteModeGroup = viewChild<ElementRef<HTMLElement>>('inviteModeGroup');
  private readonly loadPreviewBtn = viewChild<ElementRef<HTMLButtonElement>>('loadPreviewBtn');

  /** CON-135 — raw textarea content. Re-parsed into `bulkRows` on demand. */
  readonly bulkPaste = signal('');
  readonly bulkRows = signal<BulkInviteRow[]>([]);
  /**
   * Role applied to paste/CSV rows that don't specify one (email-only lines,
   * or rows with a blank second column). Defaults to the first role once
   * roles load.
   */
  readonly bulkDefaultRoleId = signal('');
  readonly bulkParseError = signal<string | null>(null);
  readonly bulkSubmitting = signal(false);
  readonly bulkSubmitError = signal<string | null>(null);
  readonly bulkResult = signal<BulkInviteResponse | null>(null);
  private bulkRowSeq = 0;

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

  /**
   * A11y: mount two *always-present* sr-only live regions — one polite, one
   * assertive — and route each toast to the matching one. Swapping
   * role/aria-live on a single persistent node (the previous approach)
   * caused NVDA to drop the second announcement when the kind changed.
   * Keeping both nodes mounted and only mutating their text is the stable
   * pattern.
   */
  readonly politeAnnouncement = computed(() =>
    this.toast()?.kind === 'success' ? (this.toast()?.message ?? '') : '',
  );
  readonly assertiveAnnouncement = computed(() =>
    this.toast()?.kind === 'error' ? (this.toast()?.message ?? '') : '',
  );

  readonly roleById = computed(() => {
    const map = new Map<string, Role>();
    for (const r of this.roles()) map.set(r.id, r);
    return map;
  });

  /**
   * CON-135 — per-row validation annotations. Computed (not stored on the row)
   * so a role being added after parse or an email edit re-validates instantly
   * without having to re-walk the list by hand.
   */
  readonly bulkRowValidation = computed<BulkRowValidation[]>(() => {
    const roles = this.roleById();
    return this.bulkRows().map(row => {
      const issues: BulkRowIssue[] = [];
      if (!isValidEmail(row.email)) issues.push('invalid_email');
      if (!row.roleId) {
        issues.push(row.rawRoleLabel ? 'unknown_role' : 'missing_role');
      } else if (!roles.has(row.roleId)) {
        issues.push('unknown_role');
      }
      return { row, issues };
    });
  });

  readonly bulkErrorCount = computed(
    () => this.bulkRowValidation().filter(v => v.issues.length > 0).length,
  );

  readonly bulkOverCap = computed(() => this.bulkRows().length > this.BULK_MAX);

  readonly bulkCanSubmit = computed(() => {
    const count = this.bulkRows().length;
    if (count === 0) return false;
    if (count > this.BULK_MAX) return false;
    if (this.bulkErrorCount() > 0) return false;
    return !this.bulkSubmitting();
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
      // CON-135 — seed the bulk default so email-only paste rows land on a
      // valid role without the operator having to pick one first.
      if (roles.length > 0 && !this.bulkDefaultRoleId()) {
        this.bulkDefaultRoleId.set(roles[0].id);
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
    this.resetBulkState();
    this.inviteMode.set('single');
    this.inviteOpen.set(true);
  }

  onInviteClosed(): void {
    this.inviteOpen.set(false);
  }

  /**
   * CON-135 — switching mode in the drawer should not silently discard
   * paste content on a stray click. The textarea/rows only reset when the
   * drawer is re-opened (or the operator clicks Clear).
   */
  setInviteMode(mode: 'single' | 'bulk'): void {
    this.inviteMode.set(mode);
    if (mode === 'single') {
      this.bulkSubmitError.set(null);
    }
  }

  /**
   * CON-135 a11y — radiogroup arrow-key nav. The two modes are mutually
   * exclusive, so we follow the standard WAI-ARIA Radio Group pattern:
   * ArrowLeft/ArrowRight cycle (wrapping), Home = first, End = last. The
   * newly-selected radio is focused so the roving-tabindex follows the
   * keystroke — without this, focus stays on a now-untabbable radio.
   */
  onInviteModeKeydown(event: KeyboardEvent): void {
    const order: ReadonlyArray<'single' | 'bulk'> = ['single', 'bulk'];
    const current = this.inviteMode();
    const idx = order.indexOf(current);
    let next: 'single' | 'bulk' | null = null;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = order[(idx + 1) % order.length];
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = order[(idx - 1 + order.length) % order.length];
        break;
      case 'Home':
        next = order[0];
        break;
      case 'End':
        next = order[order.length - 1];
        break;
      default:
        return;
    }
    event.preventDefault();
    if (next === current) return;
    this.setInviteMode(next);
    // setTimeout so we run after the OnPush re-render flips tabindex; both
    // radios are always mounted, so we can focus the target directly by
    // data-attr selector within the group.
    const group = this.inviteModeGroup()?.nativeElement;
    if (!group) return;
    setTimeout(() => {
      const target = group.querySelector<HTMLElement>(`[data-invite-mode="${next}"]`);
      target?.focus();
    });
  }

  private resetBulkState(): void {
    this.bulkPaste.set('');
    this.bulkRows.set([]);
    this.bulkParseError.set(null);
    this.bulkSubmitError.set(null);
    this.bulkResult.set(null);
    this.bulkRowSeq = 0;
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
    let succeeded = false;
    try {
      succeeded = await this.setUserActive(member, false);
      this.deactivateOpen.set(false);
      this.deactivateTarget.set(null);
    } finally {
      this.deactivateBusy.set(false);
    }
    // A11y: AppModalDirective restores focus to `previouslyFocused` (the
    // Deactivate button), but that button is removed from the DOM as soon
    // as `isActive` flips to false and the template swaps in Reactivate —
    // the directive's queueMicrotask restore then silently fails and
    // keyboard/SR users land on <body>. On success, move focus to the
    // freshly-rendered Reactivate button for this row. setTimeout (macro)
    // runs after the directive's cleanup microtask so we win the race.
    if (succeeded) {
      const email = member.email;
      setTimeout(() => {
        const next = Array.from(
          document.querySelectorAll<HTMLElement>('button[aria-label]'),
        ).find(b => b.getAttribute('aria-label') === `Reactivate ${email}`);
        next?.focus();
      }, 0);
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

  private async setUserActive(member: ProjectMember, isActive: boolean): Promise<boolean> {
    const connectionId = this.connectionId();
    if (!connectionId) return false;

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
          : `${member.email} deactivated. Sessions ended and sign-in blocked.`,
      });
      return true;
    } catch (e: any) {
      this.announceToast({
        kind: 'error',
        message: e?.message ?? `Failed to ${isActive ? 'reactivate' : 'deactivate'} ${member.email}.`,
      });
      return false;
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

  // CON-135 — bulk invite -------------------------------------------------

  /**
   * Parse paste/CSV text into preview rows. Accepts one entry per line in
   * either `email` or `email,role` form. Role tokens match case-insensitively
   * against role name or slug; unmatched labels are kept on the row so the
   * preview can render a specific "unknown role: X" message instead of
   * silently falling back to the default role (which would be surprising
   * when the operator explicitly typed a role label).
   */
  parseBulkInput(raw: string): BulkInviteRow[] {
    const defaultRoleId = this.bulkDefaultRoleId();
    const roles = this.roles();
    const rows: BulkInviteRow[] = [];
    const seen = new Set<string>();

    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Comma or tab — CSV exports from Numbers/Excel tend to use tabs when
      // pasting; accepting both keeps the UX forgiving.
      const parts = trimmed.split(/[,\t]/, 2).map(s => s.trim());
      const email = parts[0] ?? '';
      const roleLabel = parts[1] && parts[1].length > 0 ? parts[1] : null;

      // Deduplicate within the paste itself so the preview doesn't carry
      // obvious duplicates the server will just skip with
      // `duplicate_in_payload`. Case-insensitive — the server normalises too.
      const dedupeKey = email.toLowerCase();
      if (dedupeKey && seen.has(dedupeKey)) continue;
      if (dedupeKey) seen.add(dedupeKey);

      let roleId = defaultRoleId;
      if (roleLabel) {
        const lower = roleLabel.toLowerCase();
        const match = roles.find(
          r => r.name.toLowerCase() === lower || r.slug.toLowerCase() === lower,
        );
        roleId = match ? match.id : '';
      }

      rows.push({
        id: ++this.bulkRowSeq,
        email,
        roleId,
        rawRoleLabel: roleLabel,
      });
    }

    return rows;
  }

  /**
   * CON-135 — re-parse the textarea on demand. We don't auto-parse on every
   * keystroke because CSV pastes commonly arrive in chunks; operators click
   * "Load preview" (or upload a file) once and then fix individual rows.
   */
  loadBulkPreview(): void {
    this.bulkParseError.set(null);
    this.bulkSubmitError.set(null);
    this.bulkResult.set(null);
    const raw = this.bulkPaste();
    if (!raw.trim()) {
      this.bulkRows.set([]);
      return;
    }
    const parsed = this.parseBulkInput(raw);
    this.bulkRows.set(parsed);
  }

  /**
   * CON-135 — CSV upload path. Reads the file client-side and feeds the
   * textarea + preview so keyboard users (who interact with the paste area)
   * and mouse users (who drop a file) see exactly the same preview state.
   */
  async onBulkFileChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      this.bulkPaste.set(text);
      this.loadBulkPreview();
    } catch (e: any) {
      this.bulkParseError.set(e?.message ?? 'Failed to read file');
    } finally {
      // Allow selecting the same file twice in a row (some browsers suppress
      // the `change` event otherwise).
      input.value = '';
    }
  }

  updateBulkRowEmail(id: number, email: string): void {
    this.bulkRows.update(list =>
      list.map(row => (row.id === id ? { ...row, email } : row)),
    );
  }

  updateBulkRowRole(id: number, roleId: string): void {
    this.bulkRows.update(list =>
      list.map(row =>
        row.id === id
          ? { ...row, roleId, rawRoleLabel: null }
          : row,
      ),
    );
  }

  /**
   * CON-135 a11y — row removal focus management. Deleting the focused row
   * drops focus to `<body>` on AT, which loses the operator's place. We
   * restore focus to the next sibling row's delete button (same index in
   * the new list), or the last row if the deleted one was last, or the
   * `Load preview` button as the final fallback when no rows remain (the
   * `Clear` button disappears with the rows, so it can't be the target).
   */
  removeBulkRow(id: number, event?: MouseEvent): void {
    const rows = this.bulkRows();
    const removedIdx = rows.findIndex(r => r.id === id);
    this.bulkRows.update(list => list.filter(row => row.id !== id));
    if (!event || removedIdx < 0) return;
    const tbody = (event.currentTarget as HTMLElement | null)?.closest('tbody');
    setTimeout(() => {
      const remaining = this.bulkRows().length;
      if (remaining === 0) {
        this.loadPreviewBtn()?.nativeElement.focus();
        return;
      }
      const buttons = tbody?.querySelectorAll<HTMLButtonElement>('[data-bulk-remove-row]');
      if (!buttons || buttons.length === 0) return;
      const targetIdx = Math.min(removedIdx, buttons.length - 1);
      buttons[targetIdx]?.focus();
    });
  }

  clearBulk(): void {
    this.resetBulkState();
  }

  /**
   * CON-135 — hard client-side cap at BULK_INVITE_MAX. Surfacing the cap in
   * the preview footer (not only as a submit-time error) lets the operator
   * delete rows before they bother clicking send.
   */
  async submitBulk(): Promise<void> {
    if (!this.bulkCanSubmit()) return;

    const connectionId = this.connectionId();
    const projectId = this.selectedProjectId();
    if (!connectionId || !projectId) return;

    const rows = this.bulkRows();
    const payload = {
      invites: rows.map(r => ({ email: r.email.trim(), roleId: r.roleId })),
    };

    this.bulkSubmitting.set(true);
    this.bulkSubmitError.set(null);
    this.bulkResult.set(null);
    try {
      const result = await this.backend.inviteMembersBulkFor(connectionId, projectId, payload);
      this.bulkResult.set(result);
      // Refresh members + pending invites so the tables reflect the new
      // state without forcing the operator to re-open the screen.
      await this.loadAll();
      this.announceToast({
        kind: result.errored.length > 0 ? 'error' : 'success',
        message: this.summariseBulkResult(result),
      });
    } catch (e: any) {
      this.bulkSubmitError.set(e?.message ?? 'Failed to send bulk invites');
    } finally {
      this.bulkSubmitting.set(false);
    }
  }

  private summariseBulkResult(r: BulkInviteResponse): string {
    const parts: string[] = [];
    if (r.invited.length > 0) parts.push(`${r.invited.length} invited`);
    if (r.skipped.length > 0) parts.push(`${r.skipped.length} skipped`);
    if (r.errored.length > 0) parts.push(`${r.errored.length} errored`);
    return parts.length > 0 ? `Bulk invite: ${parts.join(', ')}.` : 'Bulk invite: no changes.';
  }

  /**
   * CON-135 — human labels for server reason codes. Unknown codes fall
   * through as-is so forward-compat strings from the server still render
   * something legible rather than being swallowed.
   */
  describeReason(reason: string): string {
    switch (reason) {
      case 'already_member':
        return 'Already a member of this project';
      case 'duplicate_in_payload':
        return 'Duplicate email in this batch';
      case 'invalid_email':
        return 'Invalid email address';
      case 'invalid_role':
        return 'Role does not exist';
      case 'unknown_user':
        return 'No user with that email exists yet';
      case 'rate_limited':
        return 'Rate limit reached — retry in a few minutes';
      case 'internal_error':
        return 'Internal server error';
      default:
        return reason;
    }
  }

  describeIssue(issue: BulkRowIssue): string {
    switch (issue) {
      case 'invalid_email':
        return 'Invalid email';
      case 'unknown_role':
        return 'Unknown role';
      case 'missing_role':
        return 'Pick a role';
    }
  }
}
