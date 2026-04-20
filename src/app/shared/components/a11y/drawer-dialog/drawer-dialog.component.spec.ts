import '@angular/compiler';
import { describe, it, expect, vi } from 'vitest';
import { Injector, runInInjectionContext, ɵChangeDetectionScheduler, ɵEffectScheduler } from '@angular/core';
import { ConfigurableFocusTrapFactory } from '@angular/cdk/a11y';
import { DrawerDialogComponent } from './drawer-dialog.component';

function makeComponent(): DrawerDialogComponent {
  const stubTrap = { destroy: vi.fn(), focusInitialElement: vi.fn(() => false) };
  const stubFactory = { create: vi.fn(() => stubTrap) } as unknown as ConfigurableFocusTrapFactory;
  const injector = Injector.create({
    providers: [
      { provide: ConfigurableFocusTrapFactory, useValue: stubFactory },
      { provide: ɵChangeDetectionScheduler, useValue: { notify: vi.fn(), runningTick: false } },
      { provide: ɵEffectScheduler, useValue: { add: vi.fn(), remove: vi.fn(), schedule: vi.fn(), flush: vi.fn() } },
    ],
  });
  return runInInjectionContext(injector, () => new DrawerDialogComponent());
}

describe('DrawerDialogComponent', () => {
  describe('pristine vs dirty close semantics', () => {
    it('closes straight through when pristine', () => {
      const c = makeComponent();
      (c.dirty as any) = () => false;
      const closed = vi.fn();
      const dirty = vi.fn();
      c.closed.subscribe(closed);
      c.dirtyCloseAttempt.subscribe(dirty);
      c.requestClose();
      expect(closed).toHaveBeenCalledOnce();
      expect(dirty).not.toHaveBeenCalled();
    });

    it('emits dirtyCloseAttempt instead of closed when dirty', () => {
      const c = makeComponent();
      (c.dirty as any) = () => true;
      const closed = vi.fn();
      const dirty = vi.fn();
      c.closed.subscribe(closed);
      c.dirtyCloseAttempt.subscribe(dirty);
      c.requestClose();
      expect(dirty).toHaveBeenCalledOnce();
      expect(closed).not.toHaveBeenCalled();
    });

    it('backdrop clicks route through requestClose', () => {
      const c = makeComponent();
      (c.dirty as any) = () => false;
      const closed = vi.fn();
      c.closed.subscribe(closed);
      c.onBackdropClick();
      expect(closed).toHaveBeenCalledOnce();
    });
  });

  describe('Escape behavior', () => {
    it('closes on Esc when open and not disabled', () => {
      const c = makeComponent();
      (c.open as any) = () => true;
      (c.dirty as any) = () => false;
      (c.disableEscape as any) = () => false;
      const closed = vi.fn();
      c.closed.subscribe(closed);
      c.onEscape({ stopPropagation: vi.fn() } as unknown as Event);
      expect(closed).toHaveBeenCalledOnce();
    });

    it('does nothing on Esc when drawer is closed', () => {
      const c = makeComponent();
      (c.open as any) = () => false;
      const closed = vi.fn();
      c.closed.subscribe(closed);
      c.onEscape({ stopPropagation: vi.fn() } as unknown as Event);
      expect(closed).not.toHaveBeenCalled();
    });

    it('respects disableEscape', () => {
      const c = makeComponent();
      (c.open as any) = () => true;
      (c.disableEscape as any) = () => true;
      const closed = vi.fn();
      c.closed.subscribe(closed);
      c.onEscape({ stopPropagation: vi.fn() } as unknown as Event);
      expect(closed).not.toHaveBeenCalled();
    });

    it('routes dirty close through dirtyCloseAttempt even from Esc', () => {
      const c = makeComponent();
      (c.open as any) = () => true;
      (c.dirty as any) = () => true;
      const closed = vi.fn();
      const dirty = vi.fn();
      c.closed.subscribe(closed);
      c.dirtyCloseAttempt.subscribe(dirty);
      c.onEscape({ stopPropagation: vi.fn() } as unknown as Event);
      expect(dirty).toHaveBeenCalledOnce();
      expect(closed).not.toHaveBeenCalled();
    });
  });

  describe('titleId default', () => {
    it('provides a unique default id for aria-labelledby', () => {
      const a = makeComponent();
      const b = makeComponent();
      expect(a.titleId()).not.toBe(b.titleId());
      expect(a.titleId()).toMatch(/^drawer-title-\d+$/);
    });
  });
});
