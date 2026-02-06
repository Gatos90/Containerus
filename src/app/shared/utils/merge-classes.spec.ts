import { describe, it, expect } from 'vitest';
import { mergeClasses, transform, generateId, noopFn } from './merge-classes';

describe('Merge Classes Utilities', () => {
  describe('mergeClasses', () => {
    it('should merge simple classes', () => {
      const result = mergeClasses('px-2', 'py-4');
      expect(result).toContain('px-2');
      expect(result).toContain('py-4');
    });

    it('should handle conditional classes', () => {
      const result = mergeClasses('base', true && 'active', false && 'hidden');
      expect(result).toContain('base');
      expect(result).toContain('active');
      expect(result).not.toContain('hidden');
    });

    it('should merge conflicting tailwind classes', () => {
      const result = mergeClasses('px-2', 'px-4');
      expect(result).toBe('px-4');
    });

    it('should handle empty inputs', () => {
      const result = mergeClasses();
      expect(result).toBe('');
    });

    it('should handle null/undefined inputs', () => {
      const result = mergeClasses('base', null, undefined);
      expect(result).toBe('base');
    });
  });

  describe('transform', () => {
    it('should return true for empty string', () => {
      expect(transform('')).toBe(true);
    });

    it('should return false for non-empty string', () => {
      expect(transform('false')).toBe(false);
    });

    it('should pass through boolean true', () => {
      expect(transform(true)).toBe(true);
    });

    it('should pass through boolean false', () => {
      expect(transform(false)).toBe(false);
    });
  });

  describe('generateId', () => {
    it('should generate a UUID', () => {
      const id = generateId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('should generate a prefixed UUID', () => {
      const id = generateId('block');
      expect(id).toMatch(/^block-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('should generate unique IDs', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateId()));
      expect(ids.size).toBe(100);
    });
  });

  describe('noopFn', () => {
    it('should return undefined', () => {
      expect(noopFn()).toBeUndefined();
    });

    it('should be callable', () => {
      expect(() => noopFn()).not.toThrow();
    });
  });
});
