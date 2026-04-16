import { describe, it, expect, vi } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { ToastContainerComponent } from './toast-container.component';
import { ToastState, ToastType } from '../../../state/toast.state';

function makeComponent(toastsMock?: ReturnType<typeof vi.fn>) {
  const mockToastState: any = {
    toasts: toastsMock ?? vi.fn(() => []),
    dismiss: vi.fn(),
  };
  const injector = Injector.create({
    providers: [{ provide: ToastState, useValue: mockToastState }],
  });
  return {
    component: runInInjectionContext(injector, () => new ToastContainerComponent()),
    mockToastState,
  };
}

describe('ToastContainerComponent', () => {
  describe('getIcon()', () => {
    it('returns CheckCircle2 for success type', () => {
      const { component } = makeComponent();
      const icon = component.getIcon('success');
      expect(icon).toBe(component.CheckCircle2);
    });

    it('returns XCircle for error type', () => {
      const { component } = makeComponent();
      const icon = component.getIcon('error');
      expect(icon).toBe(component.XCircle);
    });

    it('returns AlertTriangle for warning type', () => {
      const { component } = makeComponent();
      const icon = component.getIcon('warning');
      expect(icon).toBe(component.AlertTriangle);
    });

    it('returns Info for info type', () => {
      const { component } = makeComponent();
      const icon = component.getIcon('info');
      expect(icon).toBe(component.Info);
    });
  });

  describe('getToastClasses()', () => {
    it('returns green classes for success type', () => {
      const { component } = makeComponent();
      const classes = component.getToastClasses('success');
      expect(classes).toContain('bg-green-900/90');
      expect(classes).toContain('text-green-100');
    });

    it('returns red classes for error type', () => {
      const { component } = makeComponent();
      const classes = component.getToastClasses('error');
      expect(classes).toContain('bg-red-900/90');
      expect(classes).toContain('text-red-100');
    });

    it('returns amber classes for warning type', () => {
      const { component } = makeComponent();
      const classes = component.getToastClasses('warning');
      expect(classes).toContain('bg-amber-900/90');
      expect(classes).toContain('text-amber-100');
    });

    it('returns zinc classes for info type', () => {
      const { component } = makeComponent();
      const classes = component.getToastClasses('info');
      expect(classes).toContain('bg-zinc-800/90');
      expect(classes).toContain('text-zinc-100');
    });

    it('returns border classes for each type', () => {
      const { component } = makeComponent();
      expect(component.getToastClasses('success')).toContain('border-green-700/50');
      expect(component.getToastClasses('error')).toContain('border-red-700/50');
      expect(component.getToastClasses('warning')).toContain('border-amber-700/50');
      expect(component.getToastClasses('info')).toContain('border-zinc-700/50');
    });
  });

  describe('toastState injection', () => {
    it('exposes the injected toastState', () => {
      const { component, mockToastState } = makeComponent();
      expect(component.toastState).toBe(mockToastState);
    });
  });

  describe('icon constants', () => {
    it('exposes X icon for dismiss button', () => {
      const { component } = makeComponent();
      expect(component.X).toBeDefined();
    });

    it('all icon constants are defined', () => {
      const { component } = makeComponent();
      expect(component.CheckCircle2).toBeDefined();
      expect(component.XCircle).toBeDefined();
      expect(component.AlertTriangle).toBeDefined();
      expect(component.Info).toBeDefined();
    });
  });
});
