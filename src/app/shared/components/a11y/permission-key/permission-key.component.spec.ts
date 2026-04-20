import '@angular/compiler';
import { describe, it, expect, vi } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { PermissionKeyComponent } from './permission-key.component';
import { PermissionCatalogService } from './permission-catalog.service';

function makeComponent(catalog: Record<string, string> = {}): PermissionKeyComponent {
  const svc = { ensureLoaded: vi.fn().mockResolvedValue(undefined), descriptionFor: (k: string) => catalog[k] ?? null } as unknown as PermissionCatalogService;
  const injector = Injector.create({
    providers: [{ provide: PermissionCatalogService, useValue: svc }],
  });
  return runInInjectionContext(injector, () => new PermissionKeyComponent());
}

describe('PermissionKeyComponent', () => {
  describe('affordance visibility', () => {
    it('omits the popover affordance when no description exists', () => {
      const c = makeComponent({});
      (c.value as any) = () => 'container:exec';
      expect(c.hasDescription()).toBe(false);
      expect(c.description()).toBeNull();
    });

    it('surfaces the popover affordance when the catalog has a description', () => {
      const c = makeComponent({ 'container:exec': 'Execute shells inside containers' });
      (c.value as any) = () => 'container:exec';
      expect(c.hasDescription()).toBe(true);
      expect(c.description()).toBe('Execute shells inside containers');
    });
  });

  describe('keyboard toggling', () => {
    it('opens on Enter and Space, closes on Esc', () => {
      const c = makeComponent({ 'x': 'y' });
      (c.value as any) = () => 'x';
      const ev = (key: string) => ({ key, preventDefault: vi.fn(), stopPropagation: vi.fn() }) as unknown as KeyboardEvent;

      expect(c.open()).toBe(false);
      c.onKey(ev('Enter'));
      expect(c.open()).toBe(true);
      c.onKey(ev('Escape'));
      expect(c.open()).toBe(false);
      c.onKey(ev(' '));
      expect(c.open()).toBe(true);
    });

    it('ignores unrelated keys', () => {
      const c = makeComponent({ 'x': 'y' });
      (c.value as any) = () => 'x';
      c.onKey({ key: 'a', preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as KeyboardEvent);
      expect(c.open()).toBe(false);
    });
  });

  describe('click toggling', () => {
    it('toggles open on click', () => {
      const c = makeComponent({ 'x': 'y' });
      (c.value as any) = () => 'x';
      const ev = { stopPropagation: vi.fn() } as unknown as MouseEvent;
      c.toggle(ev);
      expect(c.open()).toBe(true);
      c.toggle(ev);
      expect(c.open()).toBe(false);
    });
  });

  describe('Tab-away close', () => {
    it('closes when the button is blurred (Tab-away or outside click moves focus)', () => {
      const c = makeComponent({ 'x': 'y' });
      (c.value as any) = () => 'x';
      c.toggle({ stopPropagation: vi.fn() } as unknown as MouseEvent);
      expect(c.open()).toBe(true);
      c.onBlur();
      expect(c.open()).toBe(false);
    });

    it('onBlur is a no-op when popover is already closed', () => {
      const c = makeComponent({ 'x': 'y' });
      (c.value as any) = () => 'x';
      c.onBlur();
      expect(c.open()).toBe(false);
    });
  });

  describe('lifecycle', () => {
    it('calls ensureLoaded() on init', () => {
      const load = vi.fn().mockResolvedValue(undefined);
      const svc = { ensureLoaded: load, descriptionFor: () => null } as unknown as PermissionCatalogService;
      const injector = Injector.create({ providers: [{ provide: PermissionCatalogService, useValue: svc }] });
      const c = runInInjectionContext(injector, () => new PermissionKeyComponent());
      c.ngOnInit();
      expect(load).toHaveBeenCalled();
    });
  });
});
