import { Injectable, signal } from '@angular/core';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: number;
  type: ToastType;
  message: string;
  duration: number;
}

@Injectable({ providedIn: 'root' })
export class ToastState {
  private _toasts = signal<Toast[]>([]);
  private nextId = 0;

  readonly toasts = this._toasts.asReadonly();

  show(message: string, type: ToastType = 'info', duration = 3000): void {
    const id = this.nextId++;
    this._toasts.update(t => [...t, { id, type, message, duration }]);

    if (duration > 0) {
      setTimeout(() => this.dismiss(id), duration);
    }
  }

  success(message: string, duration = 3000): void {
    this.show(message, 'success', duration);
  }

  error(message: string, duration = 5000): void {
    this.show(message, 'error', duration);
  }

  warning(message: string, duration = 4000): void {
    this.show(message, 'warning', duration);
  }

  info(message: string, duration = 3000): void {
    this.show(message, 'info', duration);
  }

  dismiss(id: number): void {
    this._toasts.update(t => t.filter(toast => toast.id !== id));
  }
}
