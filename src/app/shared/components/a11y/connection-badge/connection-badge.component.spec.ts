import { describe, it, expect, vi } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { ConnectionBadgeComponent } from './connection-badge.component';

function makeComponent(): ConnectionBadgeComponent {
  const injector = Injector.create({ providers: [] });
  return runInInjectionContext(injector, () => new ConnectionBadgeComponent());
}

describe('ConnectionBadgeComponent', () => {
  describe('sizing', () => {
    it('renders at 24px for size=md (hit target baseline)', () => {
      const c = makeComponent();
      (c.connectionId as any) = () => 'c1';
      (c.size as any) = () => 'md';
      expect(c.dimension()).toBe(24);
    });

    it('renders at 16px for size=sm (decorative only)', () => {
      const c = makeComponent();
      (c.connectionId as any) = () => 'c1';
      (c.size as any) = () => 'sm';
      expect(c.dimension()).toBe(16);
    });
  });

  describe('aria-label', () => {
    it('uses connectionLabel when provided', () => {
      const c = makeComponent();
      (c.connectionId as any) = () => 'c1';
      (c.connectionLabel as any) = () => 'Prod East';
      expect(c.ariaLabel()).toBe('Connection Prod East');
    });

    it('falls back to connectionId when no label', () => {
      const c = makeComponent();
      (c.connectionId as any) = () => 'c1';
      (c.connectionLabel as any) = () => null;
      expect(c.ariaLabel()).toBe('Connection c1');
    });
  });

  describe('interactive emission', () => {
    it('emits activated on click when interactive', () => {
      const c = makeComponent();
      (c.connectionId as any) = () => 'c1';
      (c.interactive as any) = () => true;
      const spy = vi.fn();
      c.activated.subscribe(spy);
      const ev = { stopPropagation: vi.fn() } as unknown as MouseEvent;
      c.onClick(ev);
      expect(spy).toHaveBeenCalledOnce();
    });

    it('ignores clicks when not interactive', () => {
      const c = makeComponent();
      (c.connectionId as any) = () => 'c1';
      (c.interactive as any) = () => false;
      const spy = vi.fn();
      c.activated.subscribe(spy);
      c.onClick({ stopPropagation: vi.fn() } as unknown as MouseEvent);
      expect(spy).not.toHaveBeenCalled();
    });

    it('relies on the native <button> for Enter/Space activation (no custom keydown handler)', () => {
      // Enter/Space on a <button> synthesize a click event in every browser;
      // a custom (keydown) handler would double-emit. We assert the method is
      // gone so a future edit doesn't silently add it back.
      const c = makeComponent();
      expect((c as unknown as { onKeydown?: unknown }).onKeydown).toBeUndefined();
    });
  });

  describe('sm + interactive guard', () => {
    it('throws in ngOnInit when size=sm is paired with interactive=true', () => {
      const c = makeComponent();
      (c.connectionId as any) = () => 'c1';
      (c.size as any) = () => 'sm';
      (c.interactive as any) = () => true;
      expect(() => c.ngOnInit()).toThrow(/decorative-only/i);
    });

    it('does not throw for sm when non-interactive', () => {
      const c = makeComponent();
      (c.connectionId as any) = () => 'c1';
      (c.size as any) = () => 'sm';
      (c.interactive as any) = () => false;
      expect(() => c.ngOnInit()).not.toThrow();
    });

    it('does not throw for md + interactive', () => {
      const c = makeComponent();
      (c.connectionId as any) = () => 'c1';
      (c.size as any) = () => 'md';
      (c.interactive as any) = () => true;
      expect(() => c.ngOnInit()).not.toThrow();
    });
  });

  describe('palette integration', () => {
    it('resolves palette and glyph deterministically', () => {
      const c = makeComponent();
      (c.connectionId as any) = () => 'backend-prod';
      const p1 = c.palette();
      const g1 = c.glyph();
      (c.connectionId as any) = () => 'backend-prod';
      expect(c.palette()).toEqual(p1);
      expect(c.glyph()).toBe(g1);
    });
  });
});
