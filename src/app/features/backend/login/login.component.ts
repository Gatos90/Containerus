import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { BackendService } from '../../../core/services/backend.service';
import { BackendConnection } from '../../../core/models/backend.model';
import { AppState } from '../../../state/app.state';
import {
  LucideAngularModule,
  LogIn,
  UserPlus,
  Loader2,
  ArrowLeft,
  Mail,
  CheckCircle2,
} from 'lucide-angular';

/**
 * Three-mode auth entry:
 *   - `login`    → POST /api/auth/login (existing)
 *   - `register` → POST /api/auth/register (existing)
 *   - `forgot`   → POST /api/auth/password/reset/request (CON-133)
 *
 * The forgot mode reuses the same connectionId selector as login/register so
 * the user targets the same backend. The server is enumeration-proof (always
 * 200 with a generic body), so the UI swaps in a confirmation view regardless
 * of whether the email maps to a real account. Transport failures surface via
 * the same inline-error row the other modes use.
 */
type Mode = 'login' | 'register' | 'forgot';

@Component({
  selector: 'app-login',
  imports: [FormsModule, LucideAngularModule],
  template: `
    <div class="min-h-screen flex items-center justify-center bg-zinc-950 p-4">
      <div class="w-full max-w-md">
        <div class="text-center mb-8">
          <h1 class="text-2xl font-bold text-zinc-100">
            {{ headingText() }}
          </h1>
          <p class="text-zinc-400 mt-2 text-sm">
            {{ connection()?.label || connection()?.serverUrl || 'Unknown server' }}
          </p>
        </div>

        <div class="bg-zinc-900 rounded-xl border border-zinc-800 p-6 space-y-4">
          @if (mode() === 'forgot' && resetRequested()) {
            <!-- Confirmation view — the server's response is identical whether
                 the email exists or not, so we show the same message to
                 everyone. Announced politely (not assertive) because the
                 sighted cue is already the layout swap. -->
            <div
              role="status"
              aria-live="polite"
              class="flex flex-col items-center text-center gap-3 py-4"
            >
              <lucide-icon [img]="CheckCircle2" [size]="40" class="text-emerald-400" aria-hidden="true" />
              <p class="text-zinc-100 font-medium">Check your email</p>
              <p class="text-sm text-zinc-400">
                If an account exists for <span class="text-zinc-200">{{ email }}</span>, we've sent a
                link to reset your password. The link expires in a short window — request a new
                one if it does.
              </p>
              <button
                type="button"
                (click)="returnToLogin()"
                class="mt-2 text-blue-400 hover:text-blue-300 text-sm flex items-center gap-1.5"
              >
                <lucide-icon [img]="ArrowLeft" [size]="14" aria-hidden="true" />
                Back to sign in
              </button>
            </div>
          } @else {
            @if (mode() === 'register') {
              <div>
                <label for="displayName" class="block text-sm font-medium text-zinc-300 mb-1.5">Display Name</label>
                <input
                  id="displayName"
                  name="displayName"
                  type="text"
                  [(ngModel)]="displayName"
                  autocomplete="name"
                  placeholder="John Doe"
                  class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            }

            <div>
              <label for="email" class="block text-sm font-medium text-zinc-300 mb-1.5">Email</label>
              <input
                id="email"
                name="email"
                type="email"
                [(ngModel)]="email"
                autocomplete="email"
                placeholder="you@company.com"
                [attr.aria-invalid]="error() ? 'true' : null"
                [attr.aria-describedby]="error() ? 'auth-error' : null"
                class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                (keydown.enter)="submit()"
              />
            </div>

            @if (mode() !== 'forgot') {
              <div>
                <div class="flex items-center justify-between mb-1.5">
                  <label for="password" class="block text-sm font-medium text-zinc-300">Password</label>
                  @if (mode() === 'login') {
                    <button
                      type="button"
                      (click)="switchMode('forgot')"
                      class="text-xs text-blue-400 hover:text-blue-300"
                    >Forgot password?</button>
                  }
                </div>
                <input
                  id="password"
                  name="password"
                  type="password"
                  [(ngModel)]="password"
                  [autocomplete]="mode() === 'register' ? 'new-password' : 'current-password'"
                  placeholder="Enter password"
                  [attr.aria-invalid]="error() ? 'true' : null"
                  [attr.aria-describedby]="error() ? 'auth-error' : null"
                  class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  (keydown.enter)="submit()"
                />
              </div>
            }

            @if (error()) {
              <div id="auth-error" role="alert" class="text-red-400 text-sm bg-red-950/30 rounded-lg p-3">
                {{ error() }}
              </div>
            }

            <button
              (click)="submit()"
              [disabled]="loading() || !canSubmit()"
              class="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg py-2.5 font-medium transition-colors flex items-center justify-center gap-2"
            >
              @if (loading()) {
                <lucide-icon [img]="Loader2" [size]="16" class="animate-spin" aria-hidden="true" />
                {{ busyText() }}
              } @else {
                <lucide-icon [img]="primaryIcon()" [size]="16" aria-hidden="true" />
                {{ submitText() }}
              }
            </button>

            <div class="text-center text-sm">
              @switch (mode()) {
                @case ('login') {
                  <span class="text-zinc-400">Don't have an account?</span>
                  <button type="button" (click)="switchMode('register')" class="text-blue-400 hover:text-blue-300 ml-1">
                    Register
                  </button>
                }
                @case ('register') {
                  <span class="text-zinc-400">Already have an account?</span>
                  <button type="button" (click)="switchMode('login')" class="text-blue-400 hover:text-blue-300 ml-1">
                    Sign in
                  </button>
                }
                @case ('forgot') {
                  <button type="button" (click)="switchMode('login')" class="text-blue-400 hover:text-blue-300 inline-flex items-center gap-1">
                    <lucide-icon [img]="ArrowLeft" [size]="12" aria-hidden="true" />
                    Back to sign in
                  </button>
                }
              }
            </div>

            @if (mode() !== 'forgot') {
              <button
                (click)="cancel()"
                class="w-full text-zinc-400 hover:text-zinc-300 py-2 text-sm flex items-center justify-center gap-1.5 transition-colors"
              >
                <lucide-icon [img]="ArrowLeft" [size]="14" aria-hidden="true" />
                Cancel
              </button>
            }
          }
        </div>
      </div>
    </div>
  `,
})
export class LoginComponent implements OnInit {
  private backend = inject(BackendService);
  private appState = inject(AppState);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  readonly LogIn = LogIn;
  readonly UserPlus = UserPlus;
  readonly Loader2 = Loader2;
  readonly ArrowLeft = ArrowLeft;
  readonly Mail = Mail;
  readonly CheckCircle2 = CheckCircle2;

  email = '';
  password = '';
  displayName = '';
  loading = signal(false);
  error = signal<string | null>(null);
  mode = signal<Mode>('login');
  resetRequested = signal(false);
  connectionId = signal<string | null>(null);
  connection = signal<BackendConnection | null>(null);

  readonly headingText = computed(() => {
    switch (this.mode()) {
      case 'register':
        return 'Create Account';
      case 'forgot':
        return 'Reset password';
      default:
        return 'Login';
    }
  });

  readonly submitText = computed(() => {
    switch (this.mode()) {
      case 'register':
        return 'Create Account';
      case 'forgot':
        return 'Send reset link';
      default:
        return 'Sign In';
    }
  });

  readonly busyText = computed(() => {
    switch (this.mode()) {
      case 'register':
        return 'Creating account...';
      case 'forgot':
        return 'Sending reset link...';
      default:
        return 'Signing in...';
    }
  });

  readonly primaryIcon = computed(() => {
    switch (this.mode()) {
      case 'register':
        return this.UserPlus;
      case 'forgot':
        return this.Mail;
      default:
        return this.LogIn;
    }
  });

  readonly canSubmit = computed(() => {
    if (this.mode() === 'forgot') {
      return this.email.trim().length > 0;
    }
    return this.email.trim().length > 0 && this.password.trim().length > 0;
  });

  ngOnInit(): void {
    const id = this.route.snapshot.queryParamMap.get('connectionId');
    if (id) {
      this.connectionId.set(id);
      const conn = this.backend.getConnection(id);
      if (conn) {
        this.connection.set(conn);
      } else {
        this.error.set('Backend connection not found. It may have been removed.');
      }
    } else {
      // Fallback: use the latest connection
      const latest = this.backend.getLatestConnection();
      if (latest) {
        this.connectionId.set(latest.id);
        this.connection.set(latest);
      }
    }

    if (!this.connectionId() && !this.error()) {
      this.error.set('No backend connection configured. Please add a backend first.');
    }
  }

  switchMode(next: Mode): void {
    this.mode.set(next);
    this.error.set(null);
    this.resetRequested.set(false);
  }

  returnToLogin(): void {
    this.switchMode('login');
    this.password = '';
  }

  async submit(): Promise<void> {
    if (this.loading() || !this.canSubmit()) return;

    const connId = this.connectionId();
    if (!connId) {
      this.error.set('No backend connection found');
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      switch (this.mode()) {
        case 'register':
          await this.backend.registerOnBackend(connId, {
            email: this.email.trim(),
            password: this.password,
            displayName: this.displayName.trim() || this.email.split('@')[0],
          });
          await this.appState.onBackendAuthenticated();
          this.router.navigate(['/containers']);
          break;
        case 'forgot':
          await this.backend.requestPasswordResetFor(connId, this.email.trim());
          this.resetRequested.set(true);
          break;
        default:
          await this.backend.loginToBackend(connId, {
            email: this.email.trim(),
            password: this.password,
          });
          await this.appState.onBackendAuthenticated();
          this.router.navigate(['/containers']);
      }
    } catch (e: any) {
      this.error.set(
        e?.message ??
          (this.mode() === 'forgot'
            ? 'Could not reach the backend. Try again.'
            : 'Authentication failed'),
      );
    } finally {
      this.loading.set(false);
    }
  }

  cancel(): void {
    const connId = this.connectionId();
    if (connId) {
      const conn = this.backend.getConnection(connId);
      if (!conn?.tokens) {
        this.backend.removeBackend(connId);
      }
    }
    this.router.navigate(['/containers']);
  }
}
