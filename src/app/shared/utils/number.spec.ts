import { describe, it, expect } from 'vitest';
import { clamp, roundToStep, convertValueToPercentage } from './number';

describe('Number Utilities', () => {
  describe('clamp', () => {
    it('should return value when within range', () => {
      expect(clamp(5, [0, 10])).toBe(5);
    });

    it('should clamp to min when below range', () => {
      expect(clamp(-5, [0, 10])).toBe(0);
    });

    it('should clamp to max when above range', () => {
      expect(clamp(15, [0, 10])).toBe(10);
    });

    it('should handle equal min and max', () => {
      expect(clamp(5, [5, 5])).toBe(5);
    });

    it('should handle value equal to min', () => {
      expect(clamp(0, [0, 10])).toBe(0);
    });

    it('should handle value equal to max', () => {
      expect(clamp(10, [0, 10])).toBe(10);
    });

    it('should handle negative ranges', () => {
      expect(clamp(-5, [-10, -1])).toBe(-5);
      expect(clamp(0, [-10, -1])).toBe(-1);
      expect(clamp(-15, [-10, -1])).toBe(-10);
    });

    it('should handle decimal values', () => {
      expect(clamp(0.5, [0, 1])).toBe(0.5);
      expect(clamp(1.5, [0, 1])).toBe(1);
    });
  });

  describe('roundToStep', () => {
    it('should round to nearest step', () => {
      expect(roundToStep(5, 0, 1)).toBe(5);
      expect(roundToStep(5.3, 0, 1)).toBe(5);
      expect(roundToStep(5.7, 0, 1)).toBe(6);
    });

    it('should round with step of 5', () => {
      expect(roundToStep(12, 0, 5)).toBe(10);
      expect(roundToStep(13, 0, 5)).toBe(15);
    });

    it('should respect min offset', () => {
      expect(roundToStep(4, 2, 5)).toBe(2);
      expect(roundToStep(6, 2, 5)).toBe(7);
    });

    it('should handle decimal steps', () => {
      expect(roundToStep(0.3, 0, 0.5)).toBe(0.5);
      expect(roundToStep(0.2, 0, 0.5)).toBe(0);
    });

    it('should handle step of 10', () => {
      expect(roundToStep(25, 0, 10)).toBe(30);
      expect(roundToStep(24, 0, 10)).toBe(20);
    });
  });

  describe('convertValueToPercentage', () => {
    it('should convert value to percentage within range', () => {
      expect(convertValueToPercentage(50, 0, 100)).toBe(50);
    });

    it('should return 0 for min value', () => {
      expect(convertValueToPercentage(0, 0, 100)).toBe(0);
    });

    it('should return 100 for max value', () => {
      expect(convertValueToPercentage(100, 0, 100)).toBe(100);
    });

    it('should handle non-zero min', () => {
      expect(convertValueToPercentage(15, 10, 20)).toBe(50);
    });

    it('should handle decimal percentages', () => {
      expect(convertValueToPercentage(1, 0, 3)).toBeCloseTo(33.33, 1);
    });

    it('should return 0 for value at min', () => {
      expect(convertValueToPercentage(10, 10, 20)).toBe(0);
    });
  });
});
