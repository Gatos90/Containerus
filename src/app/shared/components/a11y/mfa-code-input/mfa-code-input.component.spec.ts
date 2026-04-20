import { describe, it, expect, vi } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { MfaCodeInputComponent } from './mfa-code-input.component';

function makeComponent(): MfaCodeInputComponent {
  const injector = Injector.create({ providers: [] });
  return runInInjectionContext(injector, () => new MfaCodeInputComponent());
}

function fakeInputEvent(value: string): Event {
  return { target: { value } } as unknown as Event;
}

describe('MfaCodeInputComponent', () => {
  describe('sanitization', () => {
    it('strips non-digit characters', () => {
      const c = makeComponent();
      (c.length as any) = () => 6;
      c.onInput(fakeInputEvent('12a3 b4'));
      expect(c.value()).toBe('1234');
    });

    it('truncates to the configured length', () => {
      const c = makeComponent();
      (c.length as any) = () => 6;
      c.onInput(fakeInputEvent('1234567890'));
      expect(c.value()).toBe('123456');
    });

    it('accepts paste of a full code', () => {
      const c = makeComponent();
      (c.length as any) = () => 6;
      c.onInput(fakeInputEvent('123456'));
      expect(c.value()).toBe('123456');
      expect(c.isComplete()).toBe(true);
    });
  });

  describe('emissions', () => {
    it('emits valueChanged on every input', () => {
      const c = makeComponent();
      (c.length as any) = () => 6;
      const spy = vi.fn();
      c.valueChanged.subscribe(spy);
      c.onInput(fakeInputEvent('1'));
      c.onInput(fakeInputEvent('12'));
      expect(spy).toHaveBeenNthCalledWith(1, '1');
      expect(spy).toHaveBeenNthCalledWith(2, '12');
    });

    it('emits codeEntered only when length matches', () => {
      const c = makeComponent();
      (c.length as any) = () => 6;
      const spy = vi.fn();
      c.codeEntered.subscribe(spy);
      c.onInput(fakeInputEvent('12345'));
      expect(spy).not.toHaveBeenCalled();
      c.onInput(fakeInputEvent('123456'));
      expect(spy).toHaveBeenCalledWith('123456');
    });

    it('respects a custom length', () => {
      const c = makeComponent();
      (c.length as any) = () => 4;
      const spy = vi.fn();
      c.codeEntered.subscribe(spy);
      c.onInput(fakeInputEvent('1234'));
      expect(spy).toHaveBeenCalledWith('1234');
    });
  });

  describe('pattern computed', () => {
    it('builds a pattern matching the length', () => {
      const c = makeComponent();
      (c.length as any) = () => 8;
      expect(c.pattern()).toBe('[0-9]{8}');
    });
  });

  describe('clear()', () => {
    it('resets the value', () => {
      const c = makeComponent();
      (c.length as any) = () => 6;
      c.onInput(fakeInputEvent('1234'));
      c.clear();
      expect(c.value()).toBe('');
    });
  });

  describe('accessible name', () => {
    it('falls back to the label when no inputId is provided', () => {
      const c = makeComponent();
      (c.label as any) = () => 'One-time code';
      (c.inputId as any) = () => null;
      expect(c.ariaLabelAttr()).toBe('One-time code');
    });

    it('suppresses aria-label when inputId is set so a paired <label for> wins', () => {
      const c = makeComponent();
      (c.label as any) = () => 'One-time code';
      (c.inputId as any) = () => 'mfa-verify-code';
      expect(c.ariaLabelAttr()).toBeNull();
    });
  });
});
