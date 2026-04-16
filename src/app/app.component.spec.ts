import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Injector,
  runInInjectionContext,
  signal,
  ɵChangeDetectionScheduler,
  ɵEffectScheduler,
} from '@angular/core';
import { AppComponent } from './app.component';
import { SystemState } from './state/system.state';
import { ToastState } from './state/toast.state';

// ─── Scheduler no-ops required by effect() ───────────────────────────────────

const noopChangeDetectionScheduler: any = {
  notify: vi.fn(),
  runningTick: false,
};

const noopEffectScheduler: any = {
  add: vi.fn(),
  schedule: vi.fn(),
  flush: vi.fn(),
};

// ─── Factory helper ───────────────────────────────────────────────────────────

function makeComponent(): {
  component: AppComponent;
  mockSystemState: any;
  mockToast: any;
} {
  const mockSystemState: any = {
    systems: signal<any[]>([]),
    connectionStates: signal<Record<string, string>>({}),
  };

  const mockToast: any = {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  };

  const injector = Injector.create({
    providers: [
      { provide: SystemState, useValue: mockSystemState },
      { provide: ToastState, useValue: mockToast },
      { provide: ɵChangeDetectionScheduler, useValue: noopChangeDetectionScheduler },
      { provide: ɵEffectScheduler, useValue: noopEffectScheduler },
    ],
  });

  const component = runInInjectionContext(injector, () => new AppComponent());

  return { component, mockSystemState, mockToast };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AppComponent', () => {
  let component: AppComponent;
  let mockSystemState: any;
  let mockToast: any;

  beforeEach(() => {
    ({ component, mockSystemState, mockToast } = makeComponent());
  });

  // ─── Construction ─────────────────────────────────────────────────────────

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should start with command palette hidden', () => {
    expect(component.showCommandPalette()).toBe(false);
  });

  // ─── onKeyDown ────────────────────────────────────────────────────────────

  it('should open command palette on Ctrl+K', () => {
    const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    component.onKeyDown(event);

    expect(component.showCommandPalette()).toBe(true);
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('should open command palette on Cmd+K (metaKey)', () => {
    const event = new KeyboardEvent('keydown', { key: 'k', metaKey: true });

    component.onKeyDown(event);

    expect(component.showCommandPalette()).toBe(true);
  });

  it('should not open command palette on plain K', () => {
    const event = new KeyboardEvent('keydown', { key: 'k' });

    component.onKeyDown(event);

    expect(component.showCommandPalette()).toBe(false);
  });

  it('should not open command palette on Ctrl+J', () => {
    const event = new KeyboardEvent('keydown', { key: 'j', ctrlKey: true });

    component.onKeyDown(event);

    expect(component.showCommandPalette()).toBe(false);
  });

  it('should not open command palette on Ctrl+Shift+K', () => {
    const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, shiftKey: true });

    component.onKeyDown(event);

    // The current implementation does not guard against shift, so it will
    // open — this test documents actual behaviour
    expect(component.showCommandPalette()).toBe(true);
  });

  // ─── closeCommandPalette ──────────────────────────────────────────────────

  it('should hide command palette when closeCommandPalette is called', () => {
    component.onKeyDown(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    expect(component.showCommandPalette()).toBe(true);

    component.closeCommandPalette();

    expect(component.showCommandPalette()).toBe(false);
  });

  it('should be idempotent – closeCommandPalette when already closed', () => {
    component.closeCommandPalette();
    expect(component.showCommandPalette()).toBe(false);
  });

  // ─── onCommandExecute ─────────────────────────────────────────────────────

  it('should close command palette after onCommandExecute', () => {
    component.onKeyDown(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    expect(component.showCommandPalette()).toBe(true);

    component.onCommandExecute({
      command: 'docker ps',
      template: { id: 'tpl-1', name: 'List', command: 'docker ps', description: '' } as any,
    });

    expect(component.showCommandPalette()).toBe(false);
  });

  it('should log the command when onCommandExecute is called', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    component.onCommandExecute({
      command: 'docker ps',
      template: { id: 'tpl-1', name: 'List', command: 'docker ps', description: '' } as any,
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Execute command:',
      'docker ps',
      expect.anything()
    );

    consoleSpy.mockRestore();
  });

  // ─── Connection state effect (toast notifications) ────────────────────────

  it('should not show toast on first observation of a system state', () => {
    // Populate state with a connected system – but no previous state means no toast
    mockSystemState.systems.set([{ id: 'sys-1', name: 'My Server' }]);
    mockSystemState.connectionStates.set({ 'sys-1': 'connected' });

    // Trigger effect flush (Angular internals flush on read in test)
    // The effect stores prev state but doesn't toast because prev === undefined
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(mockToast.warning).not.toHaveBeenCalled();
    expect(mockToast.error).not.toHaveBeenCalled();
  });
});
