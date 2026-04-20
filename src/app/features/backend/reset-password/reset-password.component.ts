import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Loader2,
  AlertTriangle,
} from 'lucide-angular';

import { BackendService } from '../../../core/services/backend.service';
import {
  BackendConnection,
  PasswordResetErrorReason,
} from '../../../core/models/backend.model';

interface ResetReasonDescriptor {
  readonly reason: PasswordResetErrorReason;
  /** Short label announced by SR. */
  readonly label: string;
  /** Body text shown under the chip. */
  readonly explanation: string;
  /** Where the page's recovery CTA should send the user. */
  readonly cta: 'request_new_link' | 'retry' | 'none';
}

/**
 * CON-133 §3 — named reasons for the reset completion page. The server
 * intentionally collapses expired / used / non-existent tokens into one
 * generic 400 to avoid enumeration, so `token_invalid_or_expired` covers
 * every server-side rejection. `network_error` catches transport failures
 * and gives the user a retry affordance; `weak_password` is the client-side
 * min-length guard so users aren't round-tripping the server for "too
 * short".
 *
 * Shape mirrors CON-126's `ReasonDescriptor` so reviewers recognise the
 * pattern; we don't import `StatusChipComponent` here because the page's
 * chip is a bespoke failing-state variant inline-styled to match the login
 * screen surface.
 */
const RESET_REASONS: Record<PasswordResetErrorReason, ResetReasonDescriptor> = {
  token_invalid_or_expired: {
    reason: 'token_invalid_or_expired',
    label: 'Link invalid or expired',
    explanation:
      'This reset link is no longer valid. Reset links expire shortly after they are sent, ' +
      'and each link can only be used once. Request a new one to try again.',
    cta: 'request_new_link',
  },
  network_error: {
    reason: 'network_error',
    label: 'Could not reach the server',
    explanation:
      "We couldn't reach the backend to confirm your new password. Check your connection and try again.",
    cta: 'retry',
  },
  weak_password: {
    reason: 'weak_password',
    label: 'Password too short',
    explanation:
      'Pick a longer password — at least 8 characters. Long passphrases are stronger than short complex ones.',
    cta: 'none',
  },
};

type PageState = 'form' | 'success' | 'error';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [FormsModule, LucideAngularModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="min-h-screen flex items-center justify-center bg-zinc-950 p-4">
      <div class="w-full max-w-md">
        <div class="text-center mb-8">
          <h1 class="text-2xl font-bold text-zinc-100 flex items-center justify-center gap-2">
            <lucide-icon [img]="KeyRound" [size]="22" aria-hidden="true" />
            Reset your password
          </h1>
          <p class="text-zinc-400 mt-2 text-sm">
            {{ connection()?.label || connection()?.serverUrl || 'Containerus backend' }}
          </p>
        </div>

        @switch (state()) {
          @case ('success') {
            <div
              role="status"
              aria-live="polite"
              class="bg-zinc-900 rounded-xl border border-zinc-800 p-6 flex flex-col items-center text-center gap-3"
            >
              <lucide-icon [img]="CheckCircle2" [size]="40" class="text-emerald-400" aria-hidden="true" />
              <h2 class="text-zinc-100 font-medium">Password updated</h2>
              <p class="text-sm text-zinc-400">
                You can now sign in with your new password. Any other devices that were signed in
                have been logged out.
              </p>
              <a
                [routerLink]="['/login']"
                [queryParams]="connectionId() ? { connectionId: connectionId() } : null"
                class="mt-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg px-4 py-2"
              >Continue to sign in</a>
            </div>
          }

          @case ('error') {
            <!-- Named-reason chip + explanation + recovery CTA. The chip is a
                 static presentational element; the CTA is a real button that
                 receives keyboard focus on first render. -->
            <div class="bg-zinc-900 rounded-xl border border-zinc-800 p-6 space-y-4">
              @if (reasonDescriptor(); as reason) {
                <div role="alert" class="space-y-3">
                  <h2
                    #errorHeading
                    id="reset-error-heading"
                    tabindex="-1"
                    class="text-zinc-100 font-medium flex items-center gap-2 focus:outline-none"
                  >
                    <span
                      aria-hidden="true"
                      class="bg-red-700 text-white text-[11px] font-semibold tracking-wide uppercase rounded px-2 py-0.5 inline-flex items-center"
                    >■</span>
                    {{ reason.label }}
                  </h2>
                  <p class="text-sm text-zinc-300">{{ reason.explanation }}</p>
                </div>

                <div class="flex flex-wrap gap-2">
                  @switch (reason.cta) {
                    @case ('request_new_link') {
                      <a
                        [routerLink]="['/login']"
                        [queryParams]="loginQueryParams()"
                        class="bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg px-3 py-2"
                      >Request a new link</a>
                    }
                    @case ('retry') {
                      <button
                        type="button"
                        (click)="resetToForm()"
                        class="bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg px-3 py-2"
                      >Try again</button>
                    }
                    @case ('none') {
                      <button
                        type="button"
                        (click)="resetToForm()"
                        class="bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg px-3 py-2"
                      >Edit password</button>
                    }
                  }
                  <a
                    [routerLink]="['/login']"
                    [queryParams]="connectionId() ? { connectionId: connectionId() } : null"
                    class="text-zinc-400 hover:text-zinc-200 text-sm rounded-lg px-3 py-2 flex items-center gap-1.5"
                  >
                    <lucide-icon [img]="ArrowLeft" [size]="14" aria-hidden="true" />
                    Back to sign in
                  </a>
                </div>
              }
            </div>
          }

          @default {
            <form
              (ngSubmit)="submit()"
              novalidate
              class="bg-zinc-900 rounded-xl border border-zinc-800 p-6 space-y-4"
            >
              <p class="text-sm text-zinc-400">
                Enter a new password for your account. You'll be signed out of every other device.
              </p>

              <!-- Hidden username input so password managers save the entry
                   under the right account. We don't know the email from the
                   token, so this falls back to an empty string — managers
                   still use the site origin + new-password autocomplete. -->
              <input
                type="email"
                name="username"
                autocomplete="username"
                value=""
                readonly
                tabindex="-1"
                aria-hidden="true"
                class="sr-only"
              />

              <div class="space-y-1.5">
                <label for="reset-new-password" class="block text-sm font-medium text-zinc-300">
                  New password
                </label>
                <input
                  #newPasswordInput
                  id="reset-new-password"
                  name="new-password"
                  type="password"
                  autocomplete="new-password"
                  [attr.minlength]="PASSWORD_MIN_LENGTH"
                  [(ngModel)]="newPassword"
                  [disabled]="busy()"
                  [attr.aria-invalid]="formError() ? 'true' : null"
                  [attr.aria-describedby]="'reset-new-password-hint' + (formError() ? ' reset-error' : '')"
                  required
                  class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
                <p id="reset-new-password-hint" class="text-[11px] text-zinc-500">
                  At least {{ PASSWORD_MIN_LENGTH }} characters.
                </p>
              </div>

              <div class="space-y-1.5">
                <label for="reset-confirm-password" class="block text-sm font-medium text-zinc-300">
                  Confirm new password
                </label>
                <input
                  id="reset-confirm-password"
                  name="confirm-password"
                  type="password"
                  autocomplete="new-password"
                  [(ngModel)]="confirmPassword"
                  [disabled]="busy()"
                  [attr.aria-invalid]="formError() ? 'true' : null"
                  [attr.aria-describedby]="formError() ? 'reset-error' : null"
                  required
                  class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>

              @if (formError(); as err) {
                <div
                  id="reset-error"
                  role="alert"
                  class="bg-red-950/30 text-red-300 rounded-lg p-3 text-sm flex items-start gap-2"
                >
                  <lucide-icon [img]="AlertTriangle" [size]="14" aria-hidden="true" class="mt-0.5" />
                  <span>{{ err }}</span>
                </div>
              }

              <button
                type="submit"
                [disabled]="busy() || !token()"
                class="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg py-2.5 font-medium flex items-center justify-center gap-2"
              >
                @if (busy()) {
                  <lucide-icon [img]="Loader2" [size]="16" class="animate-spin" aria-hidden="true" />
                  Updating password...
                } @else {
                  Update password
                }
              </button>

              <a
                [routerLink]="['/login']"
                [queryParams]="connectionId() ? { connectionId: connectionId() } : null"
                class="w-full text-zinc-400 hover:text-zinc-300 py-2 text-sm flex items-center justify-center gap-1.5"
              >
                <lucide-icon [img]="ArrowLeft" [size]="14" aria-hidden="true" />
                Back to sign in
              </a>
            </form>
          }
        }
      </div>
    </div>
  `,
})
export class ResetPasswordComponent implements OnInit {
  private readonly backend = inject(BackendService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly PASSWORD_MIN_LENGTH = 8;

  readonly ArrowLeft = ArrowLeft;
  readonly CheckCircle2 = CheckCircle2;
  readonly KeyRound = KeyRound;
  readonly Loader2 = Loader2;
  readonly AlertTriangle = AlertTriangle;

  newPassword = '';
  confirmPassword = '';

  // Focus targets for state transitions. Flipping `state()` between
  // `form` / `error` unmounts the previously-focused control (submit
  // button on error, "Try again" on retry), so we re-anchor focus.
  // `role="alert"` only announces dynamic insertions; moving focus to
  // the heading ensures SR users hear the failure reason on direct
  // navigation to an already-error page (no-token case).
  private readonly newPasswordInputEl =
    viewChild<ElementRef<HTMLInputElement>>('newPasswordInput');
  private readonly errorHeadingEl =
    viewChild<ElementRef<HTMLHeadingElement>>('errorHeading');

  readonly token = signal<string>('');
  readonly connectionId = signal<string | null>(null);
  readonly connection = signal<BackendConnection | null>(null);

  readonly busy = signal(false);
  readonly state = signal<PageState>('form');
  readonly formError = signal<string | null>(null);
  readonly errorReason = signal<PasswordResetErrorReason | null>(null);

  readonly reasonDescriptor = computed(() => {
    const r = this.errorReason();
    return r ? RESET_REASONS[r] : null;
  });

  readonly loginQueryParams = computed(() => {
    const id = this.connectionId();
    const base: Record<string, string> = { forgotPassword: '1' };
    if (id) base['connectionId'] = id;
    return base;
  });

  ngOnInit(): void {
    const token = this.route.snapshot.paramMap.get('token') ?? '';
    this.token.set(token);

    const connIdParam = this.route.snapshot.queryParamMap.get('connectionId');
    const connId = connIdParam ?? this.backend.getLatestConnection()?.id ?? null;
    this.connectionId.set(connId);
    if (connId) {
      this.connection.set(this.backend.getConnection(connId) ?? null);
    }

    if (!token) {
      this.errorReason.set('token_invalid_or_expired');
      this.state.set('error');
      this.focusErrorHeading();
      return;
    }
    if (!connId) {
      this.formError.set(
        'No backend is configured. Connect one from the backends screen before resetting.',
      );
    }
  }

  resetToForm(): void {
    this.state.set('form');
    this.errorReason.set(null);
    this.formError.set(null);
    queueMicrotask(() => this.newPasswordInputEl()?.nativeElement.focus());
  }

  private focusErrorHeading(): void {
    queueMicrotask(() => this.errorHeadingEl()?.nativeElement.focus());
  }

  async submit(): Promise<void> {
    if (this.busy()) return;
    const connId = this.connectionId();
    const token = this.token();
    if (!connId || !token) return;

    this.formError.set(null);

    if (this.newPassword.length < this.PASSWORD_MIN_LENGTH) {
      this.errorReason.set('weak_password');
      this.formError.set(
        `New password must be at least ${this.PASSWORD_MIN_LENGTH} characters.`,
      );
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.formError.set('New password and confirmation do not match.');
      return;
    }

    this.busy.set(true);
    try {
      await this.backend.confirmPasswordResetFor(connId, {
        token,
        newPassword: this.newPassword,
      });
      this.state.set('success');
    } catch (e: any) {
      // Server collapses every token failure into one generic 400 to prevent
      // enumeration (api/password.rs). Transport errors surface as thrown
      // `Error` with `server_unreachable`-style messages; we map them to
      // `network_error` so the retry CTA appears instead of "get a new link".
      const msg: string = e?.message ?? '';
      const isNetwork =
        /time(d)? out|unreachable|Failed to fetch|NetworkError|could not reach/i.test(
          msg,
        );
      this.errorReason.set(isNetwork ? 'network_error' : 'token_invalid_or_expired');
      this.state.set('error');
      this.focusErrorHeading();
    } finally {
      this.busy.set(false);
    }
  }
}
