import { computed, Injectable, signal } from '@angular/core';
import {
  CreatePortForwardRequest,
  PortForward,
} from '../core/models/port-forward.model';
import { PortForwardService } from '../core/services/port-forward.service';

@Injectable({ providedIn: 'root' })
export class PortForwardState {
  private _forwards = signal<PortForward[]>([]);
  private _loading = signal<Record<string, boolean>>({});
  private _error = signal<string | null>(null);

  readonly forwards = this._forwards.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  readonly forwardsByContainer = computed(() => {
    const grouped: Record<string, PortForward[]> = {};
    for (const forward of this._forwards()) {
      if (!grouped[forward.containerId]) {
        grouped[forward.containerId] = [];
      }
      grouped[forward.containerId].push(forward);
    }
    return grouped;
  });

  readonly activeForwards = computed(() =>
    this._forwards().filter((f) => f.status === 'active')
  );

  constructor(private portForwardService: PortForwardService) {}

  async loadForwards(systemId?: string, containerId?: string): Promise<void> {
    try {
      const forwards = await this.portForwardService.listForwards(
        systemId,
        containerId
      );
      this._forwards.set(forwards);
    } catch (err) {
      this._error.set(
        err instanceof Error ? err.message : 'Failed to load port forwards'
      );
    }
  }

  async createForward(
    request: CreatePortForwardRequest
  ): Promise<PortForward | null> {
    const key = `${request.containerId}:${request.containerPort}`;
    this._loading.update((l) => ({ ...l, [key]: true }));
    this._error.set(null);

    try {
      const forward = await this.portForwardService.createForward(request);
      this._forwards.update((forwards) => [...forwards, forward]);
      return forward;
    } catch (err) {
      this._error.set(
        err instanceof Error ? err.message : 'Failed to create port forward'
      );
      return null;
    } finally {
      this._loading.update((l) => ({ ...l, [key]: false }));
    }
  }

  async stopForward(forwardId: string): Promise<boolean> {
    this._loading.update((l) => ({ ...l, [forwardId]: true }));
    this._error.set(null);

    try {
      await this.portForwardService.stopForward(forwardId);
      this._forwards.update((forwards) =>
        forwards.filter((f) => f.id !== forwardId)
      );
      return true;
    } catch (err) {
      this._error.set(
        err instanceof Error ? err.message : 'Failed to stop port forward'
      );
      return false;
    } finally {
      this._loading.update((l) => ({ ...l, [forwardId]: false }));
    }
  }

  async openInBrowser(forwardId: string): Promise<void> {
    try {
      await this.portForwardService.openInBrowser(forwardId);
    } catch (err) {
      this._error.set(
        err instanceof Error ? err.message : 'Failed to open in browser'
      );
    }
  }

  isPortForwarded(containerId: string, containerPort: number): boolean {
    return this._forwards().some(
      (f) =>
        f.containerId === containerId &&
        f.containerPort === containerPort &&
        f.status === 'active'
    );
  }

  getForward(containerId: string, containerPort: number): PortForward | null {
    return (
      this._forwards().find(
        (f) =>
          f.containerId === containerId &&
          f.containerPort === containerPort &&
          f.status === 'active'
      ) ?? null
    );
  }

  isLoading(containerId: string, containerPort: number): boolean {
    const key = `${containerId}:${containerPort}`;
    return this._loading()[key] ?? false;
  }

  clearError(): void {
    this._error.set(null);
  }
}
