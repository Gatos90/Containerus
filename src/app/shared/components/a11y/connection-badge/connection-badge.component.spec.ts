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

    it('activates on Enter and Space keys', () => {
      const c = makeComponent();
      (c.connectionId as any) = () => 'c1';
      (c.interactive as any) = () => true;
      const spy = vi.fn();
      c.activated.subscribe(spy);
      const ev = (key: string) => ({ key, preventDefault: vi.fn() }) as unknown as KeyboardEvent;
      c.onKeydown(ev('Enter'));
      c.onKeydown(ev(' '));
      c.onKeydown(ev('Tab'));
      expect(spy).toHaveBeenCalledTimes(2);
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
