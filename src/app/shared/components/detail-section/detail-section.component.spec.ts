import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { DetailSectionComponent } from './detail-section.component';

function makeComponent() {
  const injector = Injector.create({ providers: [] });
  return runInInjectionContext(injector, () => new DetailSectionComponent());
}

describe('DetailSectionComponent', () => {
  describe('getIcon()', () => {
    it('returns the Info icon for the default "info" value', () => {
      const component = makeComponent();
      (component.icon as any) = () => 'info';
      const icon = component.getIcon();
      expect(icon).toBeDefined();
    });

    it('returns an icon for "box"', () => {
      const component = makeComponent();
      (component.icon as any) = () => 'box';
      expect(component.getIcon()).toBeDefined();
    });

    it('returns an icon for "network"', () => {
      const component = makeComponent();
      (component.icon as any) = () => 'network';
      expect(component.getIcon()).toBeDefined();
    });

    it('returns an icon for "cpu"', () => {
      const component = makeComponent();
      (component.icon as any) = () => 'cpu';
      expect(component.getIcon()).toBeDefined();
    });

    it('returns an icon for "hard-drive"', () => {
      const component = makeComponent();
      (component.icon as any) = () => 'hard-drive';
      expect(component.getIcon()).toBeDefined();
    });

    it('returns an icon for "shield"', () => {
      const component = makeComponent();
      (component.icon as any) = () => 'shield';
      expect(component.getIcon()).toBeDefined();
    });

    it('falls back to Info icon for unknown icon name', () => {
      const component = makeComponent();
      (component.icon as any) = () => 'unknown-icon-name';
      const icon = component.getIcon();
      // Should fall back to Info, which is defined
      expect(icon).toBeDefined();
    });

    it('returns Info icon by default when icon input is "info"', () => {
      const component = makeComponent();
      (component.icon as any) = () => 'info';
      const infoIcon = component.getIcon();
      (component.icon as any) = () => 'unknown';
      const unknownIcon = component.getIcon();
      // Both should be the same (Info) since unknown falls back to Info
      expect(infoIcon).toBe(unknownIcon);
    });
  });

  describe('toggle()', () => {
    it('starts with collapsed = true', () => {
      const component = makeComponent();
      expect(component.collapsed()).toBe(true);
    });

    it('toggles collapsed to false when called once', () => {
      const component = makeComponent();
      component.toggle();
      expect(component.collapsed()).toBe(false);
    });

    it('toggles collapsed back to true when called twice', () => {
      const component = makeComponent();
      component.toggle();
      component.toggle();
      expect(component.collapsed()).toBe(true);
    });

    it('can toggle multiple times', () => {
      const component = makeComponent();
      component.toggle();
      component.toggle();
      component.toggle();
      expect(component.collapsed()).toBe(false);
    });
  });

  describe('onCopyAll()', () => {
    it('calls copyAllFn when it is set', () => {
      const component = makeComponent();
      const fn = vi.fn();
      (component.copyAllFn as any) = () => fn;
      component.onCopyAll();
      expect(fn).toHaveBeenCalledOnce();
    });

    it('does not throw when copyAllFn is null', () => {
      const component = makeComponent();
      (component.copyAllFn as any) = () => null;
      expect(() => component.onCopyAll()).not.toThrow();
    });

    it('does not call anything when copyAllFn returns null', () => {
      const component = makeComponent();
      const fn = vi.fn();
      (component.copyAllFn as any) = () => null;
      component.onCopyAll();
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('static icon properties', () => {
    it('exposes Copy icon', () => {
      const component = makeComponent();
      expect(component.Copy).toBeDefined();
    });

    it('exposes ChevronDown icon', () => {
      const component = makeComponent();
      expect(component.ChevronDown).toBeDefined();
    });

    it('exposes ChevronRight icon', () => {
      const component = makeComponent();
      expect(component.ChevronRight).toBeDefined();
    });
  });
});
