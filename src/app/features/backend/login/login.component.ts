import { Component, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { BackendService } from '../../../core/services/backend.service';
import { BackendConnection } from '../../../core/models/backend.model';
import { AppState } from '../../../state/app.state';
import { LucideAngularModule, LogIn, UserPlus, Loader2, ArrowLeft } from 'lucide-angular';

@Component({
  selector: 'app-login',
  imports: [FormsModule, LucideAngularModule],
  template: `
    <div class="min-h-screen flex items-center justify-center bg-zinc-950 p-4">
      <div class="w-full max-w-md">
        <div class="text-center mb-8">
          <h1 class="text-2xl font-bold text-zinc-100">
            {{ isRegister() ? 'Create Account' : 'Login' }}
          </h1>
          <p class="text-zinc-400 mt-2 text-sm">
            {{ connection()?.label || connection()?.serverUrl || 'Unknown server' }}
          </p>
        </div>

        <div class="bg-zinc-900 rounded-xl border border-zinc-800 p-6 space-y-4">
          @if (isRegister()) {
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
              class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label for="password" class="block text-sm font-medium text-zinc-300 mb-1.5">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              [(ngModel)]="password"
              [autocomplete]="isRegister() ? 'new-password' : 'current-password'"
              placeholder="Enter password"
              class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              (keydown.enter)="submit()"
            />
          </div>

          @if (error()) {
            <div class="text-red-400 text-sm bg-red-950/30 rounded-lg p-3">
              {{ error() }}
            </div>
          }

          <button
            (click)="submit()"
            [disabled]="loading() || !email.trim() || !password.trim()"
            class="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg py-2.5 font-medium transition-colors flex items-center justify-center gap-2"
          >
            @if (loading()) {
              <lucide-icon [img]="Loader2" [size]="16" class="animate-spin" />
              {{ isRegister() ? 'Creating account...' : 'Signing in...' }}
            } @else {
              <lucide-icon [img]="isRegister() ? UserPlus : LogIn" [size]="16" />
              {{ isRegister() ? 'Create Account' : 'Sign In' }}
            }
          </button>

          <div class="text-center text-sm">
            @if (isRegister()) {
              <span class="text-zinc-400">Already have an account?</span>
              <button (click)="toggleMode()" class="text-blue-400 hover:text-blue-300 ml-1">
                Sign in
              </button>
            } @else {
              <span class="text-zinc-400">Don't have an account?</span>
              <button (click)="toggleMode()" class="text-blue-400 hover:text-blue-300 ml-1">
                Register
              </button>
            }
          </div>

          <button
            (click)="cancel()"
            class="w-full text-zinc-400 hover:text-zinc-300 py-2 text-sm flex items-center justify-center gap-1.5 transition-colors"
          >
            <lucide-icon [img]="ArrowLeft" [size]="14" />
            Cancel
          </button>
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

  email = '';
  password = '';
  displayName = '';
  loading = signal(false);
  error = signal<string | null>(null);
  isRegister = signal(false);
  connectionId = signal<string | null>(null);
  connection = signal<BackendConnection | null>(null);

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

  toggleMode(): void {
    this.isRegister.update((v) => !v);
    this.error.set(null);
  }

  async submit(): Promise<void> {
    if (this.loading()) return;
    if (!this.email.trim() || !this.password.trim()) return;

    const connId = this.connectionId();
    if (!connId) {
      this.error.set('No backend connection found');
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      if (this.isRegister()) {
        await this.backend.registerOnBackend(connId, {
          email: this.email.trim(),
          password: this.password,
          displayName: this.displayName.trim() || this.email.split('@')[0],
        });
      } else {
        await this.backend.loginToBackend(connId, {
          email: this.email.trim(),
          password: this.password,
        });
      }
      await this.appState.onBackendAuthenticated();
      this.router.navigate(['/containers']);
    } catch (e: any) {
      this.error.set(e.message || 'Authentication failed');
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
