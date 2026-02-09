import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { BackendService } from '../../../core/services/backend.service';
import { AppState } from '../../../state/app.state';
import {
  LucideAngularModule,
  Server, Plus, LogOut, X, ChevronRight,
} from 'lucide-angular';

@Component({
  selector: 'app-backend-view',
  imports: [LucideAngularModule],
  templateUrl: './backend-view.component.html',
})
export class BackendViewComponent {
  private router = inject(Router);
  private appState = inject(AppState);
  readonly backend = inject(BackendService);

  readonly Server = Server;
  readonly Plus = Plus;
  readonly LogOut = LogOut;
  readonly X = X;
  readonly ChevronRight = ChevronRight;

  confirmingRemoveId = signal<string | null>(null);

  selectBackend(connId: string): void {
    this.router.navigate(['/backends', connId]);
  }

  addBackend(): void {
    this.router.navigate(['/backend-connect']);
  }

  loginTo(connId: string, event: Event): void {
    event.stopPropagation();
    this.router.navigate(['/login'], { queryParams: { connectionId: connId } });
  }

  async logoutFrom(connId: string, event: Event): Promise<void> {
    event.stopPropagation();
    try {
      await this.backend.logoutFrom(connId);
      await this.appState.onBackendLogout();
    } catch (error) {
      console.error('Logout failed:', error);
    }
  }

  promptRemoveBackend(connId: string, event: Event): void {
    event.stopPropagation();
    this.confirmingRemoveId.set(connId);
  }

  removeBackend(connId: string, event: Event): void {
    event.stopPropagation();
    this.backend.removeBackend(connId);
    this.confirmingRemoveId.set(null);
  }

  cancelRemove(event: Event): void {
    event.stopPropagation();
    this.confirmingRemoveId.set(null);
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'connected': return 'bg-green-500';
      case 'connecting': return 'bg-amber-500 animate-pulse';
      case 'error': return 'bg-red-500';
      default: return 'bg-zinc-500';
    }
  }

  getStatusLabel(status: string): string {
    return status.charAt(0).toUpperCase() + status.slice(1);
  }
}
