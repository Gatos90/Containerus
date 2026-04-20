import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  LucideAngularModule,
  Shield,
  ShieldCheck,
  Monitor,
  Trash2,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Copy,
  KeyRound,
} from 'lucide-angular';

import {
  DrawerDialogComponent,
  ListStatesComponent,
  MfaCodeInputComponent,
} from '../../../shared/components/a11y';
import { BackendService } from '../../../core/services/backend.service';
import { UserSession, MfaEnrollResponse } from '../../../core/models/backend.model';

/**
 * CON-132 — Sessions & MFA management.
 *
 * The screen is one user-scoped page (no project selector) that pairs:
 * - Active sessions projected off `GET /api/users/me/sessions` (the backend
 *   already stamps one row with `isCurrent = true` — the UI trusts that
 *   marker rather than trying to decode the access token's JTI).
 * - TOTP-based MFA managed through `/api/auth/mfa/{enroll,verify,disable}`.
 *
 * Per-row revokes use a `confirm()` gate then an optimistic removal. Unlike
 * CON-130's ACL undo-toast, revoked refresh tokens are unrecoverable, so the
 * toast here is announcement-only (`role="status"`) — there's nothing to
 * re-POST. We keep the "optimistic UI + polite toast" half of the Phase-1
 * pattern and document the absent undo primitive for reviewers.
 *
 * Audit-log coverage (acceptance §5): `session.revoke`, `session.revoke_all`,
 * `mfa.enable`, and `mfa.disable` are emitted server-side (see
 * `crates/containerus-server/src/api/sessions.rs` and `…/mfa.rs`). They
 * surface through the existing audit-log page; no new filters required.
 */

type MfaStep = 'idle' | 'enrolling' | 'verify' | 'backup-codes' | 'disabling';

interface StatusToast {
  readonly message: string;
  readonly kind: 'success' | 'error';
}

@Component({
  selector: 'app-account-security',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    ListStatesComponent,
    DrawerDialogComponent,
    MfaCodeInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './account-security.component.html',
})
export class AccountSecurityComponent implements OnInit {
  private readonly backend = inject(BackendService);
  private readonly router = inject(Router);

  /** CON-133: matches server-side MIN_PASSWORD_LEN used by both change + confirm. */
  readonly PASSWORD_MIN_LENGTH = 8;

  readonly Shield = Shield;
  readonly ShieldCheck = ShieldCheck;
  readonly Monitor = Monitor;
  readonly Trash2 = Trash2;
  readonly Loader2 = Loader2;
  readonly CheckCircle2 = CheckCircle2;
  readonly AlertTriangle = AlertTriangle;
  readonly Copy = Copy;
  readonly KeyRound = KeyRound;

  private readonly mfaCodeInput = viewChild(MfaCodeInputComponent);

  readonly connectionId = signal<string>('');
  readonly userEmail = signal<string>('');
  readonly mfaEnabled = signal<boolean>(false);

  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly sessionsBusy = signal(false);

  readonly sessions = signal<UserSession[]>([]);
  readonly toast = signal<StatusToast | null>(null);
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  // ---------------------------------------------------------------------------
  // MFA flow state
  // ---------------------------------------------------------------------------
  readonly mfaDrawerOpen = signal(false);
  readonly mfaTrigger = signal<HTMLElement | null>(null);
  readonly mfaStep = signal<MfaStep>('idle');
  readonly mfaError = signal<string | null>(null);
  readonly mfaBusy = signal(false);
  readonly enrollResponse = signal<MfaEnrollResponse | null>(null);
  readonly backupCodes = signal<string[]>([]);
  readonly mfaCode = signal('');

  readonly otherSessionsCount = computed(
    () => this.sessions().filter((s) => !s.isCurrent).length,
  );

  /**
   * Id for the drawer's error container. Mirrors the `describedById` the MFA
   * input consumes so `aria-describedby` actually resolves to a live element.
   */
  readonly mfaErrorId = computed(() => {
    switch (this.mfaStep()) {
      case 'verify':
        return 'mfa-verify-error';
      case 'disabling':
        return 'mfa-disable-error';
      default:
        return null;
    }
  });

  async ngOnInit(): Promise<void> {
    const conn = this.backend.connectedBackends()[0];
    if (!conn) {
      this.loadError.set('No active backend connection.');
      return;
    }
    this.connectionId.set(conn.id);
    this.userEmail.set(conn.user?.email ?? '');
    this.mfaEnabled.set(conn.user?.mfaEnabled ?? false);
    await this.loadSessions();
  }

  async loadSessions(): Promise<void> {
    const connectionId = this.connectionId();
    if (!connectionId) return;
    this.loading.set(true);
    this.loadError.set(null);
    try {
      // Backend already returns sessions ordered by COALESCE(last_used_at,
      // created_at) DESC, so the UI trusts that order.
      const list = await this.backend.listMySessionsFor(connectionId);
      this.sessions.set(list);
    } catch (e: any) {
      this.loadError.set(e?.message ?? 'Failed to load sessions');
    } finally {
      this.loading.set(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Session revocation
  // ---------------------------------------------------------------------------

  async revokeSession(session: UserSession): Promise<void> {
    if (session.isCurrent) {
      // Belt-and-braces: the backend rejects self-revoke of the current
      // session on revoke-all, but the per-row DELETE does not. Guard it
      // client-side so users don't accidentally log themselves out mid-flow.
      this.flashToast(
        'Revoking the current session would log you out — use "Sign out" instead.',
        'error',
      );
      return;
    }
    const label = this.sessionLabel(session);
    if (!confirm(`Revoke session "${label}"? Anyone signed in on that device will be signed out.`)) {
      return;
    }

    const connectionId = this.connectionId();
    if (!connectionId) return;

    const snapshot = this.sessions();
    this.sessions.update((list) => list.filter((s) => s.id !== session.id));

    try {
      await this.backend.revokeMySessionFor(connectionId, session.id);
      this.flashToast(`Revoked ${label}.`, 'success');
    } catch (e: any) {
      // Roll back: the server rejected the delete, so restore the row.
      this.sessions.set(snapshot);
      this.flashToast(e?.message ?? 'Failed to revoke session', 'error');
    }
  }

  async revokeAllOtherSessions(): Promise<void> {
    const count = this.otherSessionsCount();
    if (count === 0) return;
    if (
      !confirm(
        `Sign out of ${count} other session${count === 1 ? '' : 's'}? The device you're on will stay signed in.`,
      )
    ) {
      return;
    }
    const connectionId = this.connectionId();
    if (!connectionId) return;

    this.sessionsBusy.set(true);
    try {
      const { revoked } = await this.backend.revokeAllOtherSessionsFor(connectionId);
      this.flashToast(`Revoked ${revoked} other session${revoked === 1 ? '' : 's'}.`, 'success');
      await this.loadSessions();
    } catch (e: any) {
      this.flashToast(e?.message ?? 'Failed to revoke other sessions', 'error');
    } finally {
      this.sessionsBusy.set(false);
    }
  }

  // ---------------------------------------------------------------------------
  // MFA: enroll → verify → backup codes
  // ---------------------------------------------------------------------------

  async openEnableMfa(event: Event): Promise<void> {
    this.mfaTrigger.set(event.currentTarget as HTMLElement);
    this.mfaCode.set('');
    this.mfaError.set(null);
    this.backupCodes.set([]);
    this.mfaStep.set('enrolling');
    this.mfaDrawerOpen.set(true);
    this.mfaBusy.set(true);
    try {
      const resp = await this.backend.enrollMfaFor(this.connectionId());
      this.enrollResponse.set(resp);
      this.mfaStep.set('verify');
      // Focus the TOTP field once the drawer settles. Deferred so the
      // focus-trap claims first-focus before we override.
      queueMicrotask(() => this.mfaCodeInput()?.focusInput());
    } catch (e: any) {
      this.mfaError.set(e?.message ?? 'Failed to start MFA enrollment');
    } finally {
      this.mfaBusy.set(false);
    }
  }

  async openDisableMfa(event: Event): Promise<void> {
    this.mfaTrigger.set(event.currentTarget as HTMLElement);
    this.mfaCode.set('');
    this.mfaError.set(null);
    this.mfaStep.set('disabling');
    this.mfaDrawerOpen.set(true);
    queueMicrotask(() => this.mfaCodeInput()?.focusInput());
  }

  onMfaCodeChanged(value: string): void {
    this.mfaCode.set(value);
    if (this.mfaError()) this.mfaError.set(null);
  }

  async submitVerify(): Promise<void> {
    const code = this.mfaCode().trim();
    if (code.length !== 6) {
      this.mfaError.set('Enter the 6-digit code from your authenticator app.');
      return;
    }
    this.mfaBusy.set(true);
    this.mfaError.set(null);
    try {
      const result = await this.backend.verifyMfaEnrollmentFor(this.connectionId(), code);
      this.backupCodes.set(result.backupCodes);
      this.mfaEnabled.set(true);
      this.mfaStep.set('backup-codes');
      this.flashToast('Two-factor authentication enabled.', 'success');
    } catch (e: any) {
      this.mfaError.set(e?.message ?? 'Invalid verification code');
      this.mfaCodeInput()?.clear();
    } finally {
      this.mfaBusy.set(false);
    }
  }

  async submitDisable(): Promise<void> {
    const code = this.mfaCode().trim();
    if (!code) {
      this.mfaError.set('Enter a current TOTP code or a backup code.');
      return;
    }
    this.mfaBusy.set(true);
    this.mfaError.set(null);
    try {
      await this.backend.disableMfaFor(this.connectionId(), code);
      this.mfaEnabled.set(false);
      this.mfaDrawerOpen.set(false);
      this.mfaStep.set('idle');
      this.flashToast('Two-factor authentication disabled.', 'success');
    } catch (e: any) {
      this.mfaError.set(e?.message ?? 'Invalid verification code');
      this.mfaCodeInput()?.clear();
    } finally {
      this.mfaBusy.set(false);
    }
  }

  finishBackupCodes(): void {
    this.backupCodes.set([]);
    this.enrollResponse.set(null);
    this.mfaStep.set('idle');
    this.mfaDrawerOpen.set(false);
  }

  onMfaDrawerClosed(): void {
    // The drawer owns focus restore; we only reset mode state so reopening
    // doesn't leak the prior step.
    this.mfaDrawerOpen.set(false);
    if (this.mfaStep() !== 'backup-codes') {
      this.mfaStep.set('idle');
      this.enrollResponse.set(null);
      this.mfaCode.set('');
      this.mfaError.set(null);
    }
  }

  async copyBackupCodes(): Promise<void> {
    const codes = this.backupCodes();
    if (codes.length === 0) return;
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      this.flashToast('Backup codes copied to clipboard.', 'success');
    } catch {
      this.flashToast('Copy failed — select the codes manually.', 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // Display helpers + toast
  // ---------------------------------------------------------------------------

  sessionLabel(session: UserSession): string {
    const ua = this.humanizeUserAgent(session.userAgent);
    const ip = session.ipAddress ?? 'unknown IP';
    return `${ua} · ${ip}`;
  }

  /**
   * Crude UA parser — enough to show "Safari on macOS" without pulling in a
   * dependency. Strings we don't recognise fall back to the raw UA truncated
   * to 80 chars so screen-reader announcements stay tractable.
   */
  humanizeUserAgent(ua: string | null): string {
    if (!ua) return 'Unknown device';
    const os = this.detectOs(ua);
    const browser = this.detectBrowser(ua);
    if (browser && os) return `${browser} on ${os}`;
    if (browser) return browser;
    if (os) return os;
    return ua.length > 80 ? `${ua.slice(0, 77)}…` : ua;
  }

  private detectOs(ua: string): string | null {
    if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
    if (/Mac OS X|Macintosh/.test(ua)) return 'macOS';
    if (/Android/.test(ua)) return 'Android';
    if (/Windows/.test(ua)) return 'Windows';
    if (/Linux/.test(ua)) return 'Linux';
    return null;
  }

  private detectBrowser(ua: string): string | null {
    // Order matters: Chrome's UA string also contains "Safari"; check Edge/
    // Chrome first so Safari isn't misattributed.
    if (/Edg\//.test(ua)) return 'Edge';
    if (/OPR\/|Opera/.test(ua)) return 'Opera';
    if (/Firefox\//.test(ua)) return 'Firefox';
    if (/Chrome\//.test(ua)) return 'Chrome';
    if (/Safari\//.test(ua)) return 'Safari';
    return null;
  }

  private flashToast(message: string, kind: 'success' | 'error'): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toast.set({ message, kind });
    this.toastTimer = setTimeout(() => {
      this.toast.set(null);
      this.toastTimer = null;
    }, 5000);
  }

  dismissToast(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = null;
    this.toast.set(null);
  }

  // ---------------------------------------------------------------------------
  // CON-133 — self-service password change
  // ---------------------------------------------------------------------------
  // The form stays inline rather than living in a drawer: it has no
  // multi-step branching, the password manager needs a stable DOM to offer
  // autofill, and we want the inline error announcer to sit next to the
  // fields so SR users hear "Passwords do not match" on the row they typed.
  //
  // We do *not* surface the backend's min-length verbatim — we validate the
  // same threshold client-side so users aren't round-tripping the server for
  // "your password is too short". A weak-password rejection still maps to
  // the server message via `flashToast('error')` for anything we miss.

  readonly currentPassword = signal('');
  readonly newPassword = signal('');
  readonly confirmPassword = signal('');
  readonly passwordBusy = signal(false);
  readonly passwordError = signal<string | null>(null);
  readonly passwordSubmitted = signal(false);

  readonly passwordMismatch = computed(
    () =>
      this.passwordSubmitted() &&
      this.newPassword().length > 0 &&
      this.confirmPassword().length > 0 &&
      this.newPassword() !== this.confirmPassword(),
  );

  readonly passwordTooShort = computed(
    () =>
      this.passwordSubmitted() &&
      this.newPassword().length > 0 &&
      this.newPassword().length < this.PASSWORD_MIN_LENGTH,
  );

  readonly passwordSame = computed(
    () =>
      this.passwordSubmitted() &&
      this.currentPassword().length > 0 &&
      this.newPassword().length > 0 &&
      this.currentPassword() === this.newPassword(),
  );

  onCurrentPasswordChanged(value: string): void {
    this.currentPassword.set(value);
    if (this.passwordError()) this.passwordError.set(null);
  }
  onNewPasswordChanged(value: string): void {
    this.newPassword.set(value);
    if (this.passwordError()) this.passwordError.set(null);
  }
  onConfirmPasswordChanged(value: string): void {
    this.confirmPassword.set(value);
    if (this.passwordError()) this.passwordError.set(null);
  }

  async submitPasswordChange(): Promise<void> {
    this.passwordSubmitted.set(true);
    this.passwordError.set(null);

    const current = this.currentPassword();
    const next = this.newPassword();
    const confirm = this.confirmPassword();

    if (!current || !next || !confirm) {
      this.passwordError.set('Fill in all three password fields.');
      return;
    }
    if (next.length < this.PASSWORD_MIN_LENGTH) {
      this.passwordError.set(
        `New password must be at least ${this.PASSWORD_MIN_LENGTH} characters.`,
      );
      return;
    }
    if (next !== confirm) {
      this.passwordError.set('New password and confirmation do not match.');
      return;
    }
    if (current === next) {
      this.passwordError.set('New password must differ from your current password.');
      return;
    }

    const connectionId = this.connectionId();
    if (!connectionId) {
      this.passwordError.set('No active backend connection.');
      return;
    }

    this.passwordBusy.set(true);
    try {
      await this.backend.changePasswordFor(connectionId, {
        currentPassword: current,
        newPassword: next,
      });
      // `changePasswordFor` already cleared the local session; send the user
      // to /login so they re-authenticate with their new password.
      this.flashToast('Password changed. Signing you out…', 'success');
      setTimeout(() => {
        this.router.navigate(['/login'], { queryParams: { connectionId } });
      }, 800);
    } catch (e: any) {
      this.passwordError.set(e?.message ?? 'Failed to change password.');
    } finally {
      this.passwordBusy.set(false);
    }
  }
}
