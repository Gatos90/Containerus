import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { BackendService } from '../../../core/services/backend.service';
import { LucideAngularModule, Server, ArrowLeft, Loader2, CheckCircle } from 'lucide-angular';

@Component({
  selector: 'app-backend-connect',
  imports: [FormsModule, LucideAngularModule],
  template: `
    <div class="min-h-screen flex items-center justify-center bg-zinc-950 p-4">
      <div class="w-full max-w-md">
        <div class="text-center mb-8">
          <h1 class="text-2xl font-bold text-zinc-100">Connect to Backend</h1>
          <p class="text-zinc-400 mt-2">
            Enter your company's Containerus server URL to connect.
          </p>
        </div>

        <div class="bg-zinc-900 rounded-xl border border-zinc-800 p-6 space-y-4">
          <div>
            <label for="serverUrlInput" class="block text-sm font-medium text-zinc-300 mb-1.5">Server URL</label>
            <input
              id="serverUrlInput"
              type="url"
              [(ngModel)]="serverUrl"
              placeholder="https://containerus.company.com"
              class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              (keydown.enter)="connect()"
            />
          </div>

          <div>
            <label for="labelInput" class="block text-sm font-medium text-zinc-300 mb-1.5">Label (optional)</label>
            <input
              id="labelInput"
              type="text"
              [(ngModel)]="label"
              placeholder="My Company"
              class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              (keydown.enter)="connect()"
            />
          </div>

          @if (error()) {
            <div class="text-red-400 text-sm bg-red-950/30 rounded-lg p-3">
              {{ error() }}
            </div>
          }

          <button
            (click)="connect()"
            [disabled]="connecting() || !serverUrl.trim()"
            class="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg py-2.5 font-medium transition-colors flex items-center justify-center gap-2"
          >
            @if (connecting()) {
              <lucide-icon [img]="Loader2" [size]="16" class="animate-spin" />
              Connecting...
            } @else {
              <lucide-icon [img]="Server" [size]="16" />
              Connect
            }
          </button>

          <button
            (click)="goBack()"
            class="w-full text-zinc-400 hover:text-zinc-300 py-2 text-sm flex items-center justify-center gap-1.5 transition-colors"
          >
            <lucide-icon [img]="ArrowLeft" [size]="14" />
            Back
          </button>
        </div>
      </div>
    </div>
  `,
})
export class BackendConnectComponent {
  private backend = inject(BackendService);
  private router = inject(Router);

  readonly Server = Server;
  readonly ArrowLeft = ArrowLeft;
  readonly Loader2 = Loader2;
  readonly CheckCircle = CheckCircle;

  serverUrl = '';
  label = '';
  connecting = signal(false);
  error = signal<string | null>(null);

  async connect(): Promise<void> {
    if (!this.serverUrl.trim() || this.connecting()) return;

    this.connecting.set(true);
    this.error.set(null);

    try {
      const connectionId = await this.backend.addBackend(
        this.serverUrl.trim(),
        this.label.trim() || undefined
      );
      this.router.navigate(['/login'], { queryParams: { connectionId } });
    } catch (e: any) {
      this.error.set(e.message || 'Failed to connect to server');
    } finally {
      this.connecting.set(false);
    }
  }

  goBack(): void {
    this.router.navigate(['/containers']);
  }
}
