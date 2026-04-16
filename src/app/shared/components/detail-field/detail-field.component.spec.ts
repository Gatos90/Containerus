import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { DetailFieldComponent } from './detail-field.component';
import { ClipboardService } from '../../../core/services/clipboard.service';

function makeComponent(overrides?: Partial<{ copyValue: ReturnType<typeof vi.fn> }>) {
  const mockClipboard: any = {
    copyValue: overrides?.copyValue ?? vi.fn().mockResolvedValue(true),
  };
  const injector = Injector.create({
    providers: [{ provide: ClipboardService, useValue: mockClipboard }],
  });
  return {
    component: runInInjectionContext(injector, () => new DetailFieldComponent()),
    mockClipboard,
  };
}

describe('DetailFieldComponent', () => {
  describe('displayValue()', () => {
    it('returns the string value when value is a string', () => {
      const { component } = makeComponent();
      (component.value as any) = () => 'hello';
      expect(component.displayValue()).toBe('hello');
    });

    it('returns the stringified number when value is a number', () => {
      const { component } = makeComponent();
      (component.value as any) = () => 42;
      expect(component.displayValue()).toBe('42');
    });

    it('returns "N/A" when value is null', () => {
      const { component } = makeComponent();
      (component.value as any) = () => null;
      expect(component.displayValue()).toBe('N/A');
    });

    it('returns "N/A" when value is undefined', () => {
      const { component } = makeComponent();
      (component.value as any) = () => undefined;
      expect(component.displayValue()).toBe('N/A');
    });

    it('returns "0" when value is 0', () => {
      const { component } = makeComponent();
      (component.value as any) = () => 0;
      expect(component.displayValue()).toBe('0');
    });

    it('returns "false" when value is the string "false"', () => {
      const { component } = makeComponent();
      (component.value as any) = () => 'false';
      expect(component.displayValue()).toBe('false');
    });

    it('returns empty string when value is empty string', () => {
      const { component } = makeComponent();
      (component.value as any) = () => '';
      expect(component.displayValue()).toBe('');
    });
  });

  describe('copyToClipboard()', () => {
    it('calls clipboard.copyValue with the string value', async () => {
      const { component, mockClipboard } = makeComponent();
      (component.value as any) = () => 'test-value';
      await component.copyToClipboard();
      expect(mockClipboard.copyValue).toHaveBeenCalledWith('test-value');
    });

    it('calls clipboard.copyValue with the number value', async () => {
      const { component, mockClipboard } = makeComponent();
      (component.value as any) = () => 123;
      await component.copyToClipboard();
      expect(mockClipboard.copyValue).toHaveBeenCalledWith(123);
    });

    it('does not call clipboard.copyValue when value is null', async () => {
      const { component, mockClipboard } = makeComponent();
      (component.value as any) = () => null;
      await component.copyToClipboard();
      expect(mockClipboard.copyValue).not.toHaveBeenCalled();
    });

    it('does not call clipboard.copyValue when value is undefined', async () => {
      const { component, mockClipboard } = makeComponent();
      (component.value as any) = () => undefined;
      await component.copyToClipboard();
      expect(mockClipboard.copyValue).not.toHaveBeenCalled();
    });

    it('calls clipboard.copyValue with 0 when value is 0', async () => {
      const { component, mockClipboard } = makeComponent();
      (component.value as any) = () => 0;
      await component.copyToClipboard();
      expect(mockClipboard.copyValue).toHaveBeenCalledWith(0);
    });
  });

  describe('static properties', () => {
    it('exposes Copy icon', () => {
      const { component } = makeComponent();
      expect(component.Copy).toBeDefined();
    });

    it('exposes String constructor', () => {
      const { component } = makeComponent();
      expect(component.String).toBe(String);
    });
  });
});
