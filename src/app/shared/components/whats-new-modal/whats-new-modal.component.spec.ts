import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { WhatsNewModalComponent } from './whats-new-modal.component';

function makeComponent(): WhatsNewModalComponent {
  const injector = Injector.create({ providers: [] });
  return runInInjectionContext(injector, () => new WhatsNewModalComponent());
}

describe('WhatsNewModalComponent', () => {
  let component: WhatsNewModalComponent;

  beforeEach(() => {
    component = makeComponent();
  });

  describe('parseSections', () => {
    it('should return empty array for empty content', () => {
      expect(component.parseSections('')).toEqual([]);
    });

    it('should parse a single section with items', () => {
      const content = '### Added\n- New feature A\n- New feature B';
      const result = component.parseSections(content);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Added');
      expect(result[0].items).toEqual(['New feature A', 'New feature B']);
    });

    it('should parse multiple sections', () => {
      const content = '### Added\n- Feature 1\n### Fixed\n- Bug fix 1\n- Bug fix 2';
      const result = component.parseSections(content);
      expect(result).toHaveLength(2);
      expect(result[0].title).toBe('Added');
      expect(result[1].title).toBe('Fixed');
    });

    it('should skip blank lines within sections', () => {
      const content = '### Added\n- Feature 1\n\n- Feature 2';
      const result = component.parseSections(content);
      expect(result[0].items).toEqual(['Feature 1', 'Feature 2']);
    });

    it('should handle content without sections', () => {
      const content = 'Some text without sections';
      const result = component.parseSections(content);
      expect(result).toHaveLength(0);
    });

    it('should trim item text', () => {
      const content = '### Changed\n-   Trimmed item   ';
      const result = component.parseSections(content);
      expect(result[0].items[0]).toBe('Trimmed item');
    });
  });

  describe('getSectionBadge', () => {
    it('should return green for Added', () => {
      expect(component.getSectionBadge('Added')).toContain('green');
    });

    it('should return blue for Changed', () => {
      expect(component.getSectionBadge('Changed')).toContain('blue');
    });

    it('should return yellow for Fixed', () => {
      expect(component.getSectionBadge('Fixed')).toContain('yellow');
    });

    it('should return red for Removed', () => {
      expect(component.getSectionBadge('Removed')).toContain('red');
    });

    it('should return default zinc for unknown section', () => {
      expect(component.getSectionBadge('Other')).toContain('zinc');
    });

    it('should be case-insensitive', () => {
      expect(component.getSectionBadge('ADDED')).toContain('green');
      expect(component.getSectionBadge('fixed')).toContain('yellow');
    });
  });

  describe('onDismiss', () => {
    it('should have dismiss output defined', () => {
      expect(component.dismiss).toBeDefined();
    });

    it('should emit dismiss when onDismiss is called', () => {
      const spy = vi.fn();
      component.dismiss.subscribe(spy);
      component.onDismiss();
      expect(spy).toHaveBeenCalled();
    });
  });
});
