import { Injectable, signal } from '@angular/core';

/**
 * CON-126 §4.7 stop-gap: after a role/ACL mutation from this client, show an
 * in-page banner offering a manual refresh. This is a temporary bridge until
 * CON-122 wires server-pushed permission invalidation.
 */
@Injectable({ providedIn: 'root' })
export class PermissionBannerState {
  private _visible = signal(false);
  private _connectionId = signal<string | null>(null);
  private _returnFocusTo: HTMLElement | null = null;

  readonly visible = this._visible.asReadonly();
  readonly connectionId = this._connectionId.asReadonly();

  show(connectionId: string): void {
    // Capture the currently-focused element so we can restore focus on
    // dismiss — otherwise keyboard/SR users lose their place when the
    // banner disappears.
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    this._returnFocusTo = active instanceof HTMLElement ? active : null;
    this._connectionId.set(connectionId);
    this._visible.set(true);
  }

  dismiss(): void {
    this._visible.set(false);
    this._connectionId.set(null);
    const target = this._returnFocusTo;
    this._returnFocusTo = null;
    if (target && target.isConnected) {
      queueMicrotask(() => target.focus());
    }
  }
}
