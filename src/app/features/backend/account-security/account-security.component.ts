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

  readonly Shield = Shield;
  readonly ShieldCheck = ShieldCheck;
  readonly Monitor = Monitor;
  readonly Trash2 = Trash2;
  readonly Loader2 = Loader2;
  readonly CheckCircle2 = CheckCircle2;
  readonly AlertTriangle = AlertTriangle;
  readonly Copy = Copy;

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
}
