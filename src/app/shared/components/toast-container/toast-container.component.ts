import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  LucideAngularModule,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  X,
} from 'lucide-angular';
import { ToastState, Toast, ToastType } from '../../../state/toast.state';

@Component({
  selector: 'app-toast-container',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm pointer-events-none">
      @for (toast of toastState.toasts(); track toast.id) {
        <div
          class="pointer-events-auto flex items-center gap-2.5 px-4 py-3 rounded-lg shadow-lg border backdrop-blur-sm animate-slide-in"
          [class]="getToastClasses(toast.type)"
        >
          <lucide-icon [img]="getIcon(toast.type)" class="w-4 h-4 flex-shrink-0"></lucide-icon>
          <span class="text-sm flex-1 min-w-0">{{ toast.message }}</span>
          <button
            (click)="toastState.dismiss(toast.id)"
            class="p-0.5 rounded hover:bg-white/10 transition-colors flex-shrink-0"
          >
            <lucide-icon [img]="X" class="w-3.5 h-3.5"></lucide-icon>
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    @keyframes slide-in {
      from {
        opacity: 0;
        transform: translateX(100%);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }
    .animate-slide-in {
      animation: slide-in 0.2s ease-out;
    }
  `],
})
export class ToastContainerComponent {
  readonly toastState = inject(ToastState);

  readonly CheckCircle2 = CheckCircle2;
  readonly XCircle = XCircle;
  readonly AlertTriangle = AlertTriangle;
  readonly Info = Info;
  readonly X = X;

  getIcon(type: ToastType) {
    switch (type) {
      case 'success': return this.CheckCircle2;
      case 'error': return this.XCircle;
      case 'warning': return this.AlertTriangle;
      case 'info': return this.Info;
    }
  }

  getToastClasses(type: ToastType): string {
    switch (type) {
      case 'success': return 'bg-green-900/90 border-green-700/50 text-green-100';
      case 'error': return 'bg-red-900/90 border-red-700/50 text-red-100';
      case 'warning': return 'bg-amber-900/90 border-amber-700/50 text-amber-100';
      case 'info': return 'bg-zinc-800/90 border-zinc-700/50 text-zinc-100';
    }
  }
}
