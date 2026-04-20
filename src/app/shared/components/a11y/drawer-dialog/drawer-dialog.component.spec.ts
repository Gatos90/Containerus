import { describe, it, expect, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { DrawerDialogComponent } from './drawer-dialog.component';

@Component({
  standalone: true,
  imports: [DrawerDialogComponent],
  template: `
    <button #trigger type="button">Open</button>
    <app-drawer-dialog
      [open]="open()"
      [dirty]="dirty()"
      [restoreFocusTo]="trigger"
      (closed)="onClosed()"
      (dirtyCloseAttempt)="onDirtyAttempt()"
    >
      <h2>Drawer</h2>
      <button #first type="button">Save</button>
    </app-drawer-dialog>
  `,
})
class HostComponent {
  readonly open = signal(false);
  readonly dirty = signal(false);
  closedCount = 0;
  dirtyCount = 0;
  onClosed() { this.closedCount += 1; }
  onDirtyAttempt() { this.dirtyCount += 1; }
}

describe('DrawerDialogComponent', () => {
  describe('backdrop / dirty semantics', () => {
    it('closes straight through when pristine', () => {
      const fix = TestBed.createComponent(HostComponent);
      fix.componentInstance.open.set(true);
      fix.detectChanges();
      const drawer = fix.debugElement.children[1].componentInstance as DrawerDialogComponent;
      drawer.onBackdropClick();
      expect(fix.componentInstance.closedCount).toBe(1);
      expect(fix.componentInstance.dirtyCount).toBe(0);
    });

    it('emits dirtyCloseAttempt instead of closed when dirty', () => {
      const fix = TestBed.createComponent(HostComponent);
      fix.componentInstance.open.set(true);
      fix.componentInstance.dirty.set(true);
      fix.detectChanges();
      const drawer = fix.debugElement.children[1].componentInstance as DrawerDialogComponent;
      drawer.onBackdropClick();
      expect(fix.componentInstance.closedCount).toBe(0);
      expect(fix.componentInstance.dirtyCount).toBe(1);
    });
  });

  describe('Esc key', () => {
    it('closes on Esc when not disabled', () => {
      const fix = TestBed.createComponent(HostComponent);
      fix.componentInstance.open.set(true);
      fix.detectChanges();
      const drawer = fix.debugElement.children[1].componentInstance as DrawerDialogComponent;
      drawer.onEscape({ stopPropagation: vi.fn() } as unknown as Event);
      expect(fix.componentInstance.closedCount).toBe(1);
    });

    it('does nothing when drawer is closed', () => {
      const fix = TestBed.createComponent(HostComponent);
      fix.componentInstance.open.set(false);
      fix.detectChanges();
      const drawer = fix.debugElement.children[1].componentInstance as DrawerDialogComponent;
      drawer.onEscape({ stopPropagation: vi.fn() } as unknown as Event);
      expect(fix.componentInstance.closedCount).toBe(0);
    });
  });

  describe('aria wiring', () => {
    it('renders role=dialog + aria-modal=true + aria-labelledby when open', () => {
      const fix = TestBed.createComponent(HostComponent);
      fix.componentInstance.open.set(true);
      fix.detectChanges();
      const panel = fix.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
      expect(panel).toBeTruthy();
      expect(panel.getAttribute('aria-modal')).toBe('true');
      expect(panel.getAttribute('aria-labelledby')).toMatch(/^drawer-title-\d+$/);
    });
  });

  describe('focus restoration', () => {
    it('restores focus to the explicit restoreFocusTo element on close', async () => {
      const fix = TestBed.createComponent(HostComponent);
      fix.componentInstance.open.set(true);
      fix.detectChanges();
      const trigger = fix.nativeElement.querySelector('button') as HTMLButtonElement;
      const focusSpy = vi.spyOn(trigger, 'focus');

      fix.componentInstance.open.set(false);
      fix.detectChanges();
      // teardownTrap() schedules restore via queueMicrotask.
      await Promise.resolve();
      expect(focusSpy).toHaveBeenCalled();
    });
  });
});
