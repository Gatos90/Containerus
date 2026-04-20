import { describe, it, expect, vi } from 'vitest';
import { Injector, runInInjectionContext, ɵChangeDetectionScheduler, ɵEffectScheduler } from '@angular/core';
import { ListStatesComponent } from './list-states.component';

function makeComponent(): ListStatesComponent {
  const injector = Injector.create({
    providers: [
      { provide: ɵChangeDetectionScheduler, useValue: { notify: vi.fn(), runningTick: false } },
      { provide: ɵEffectScheduler, useValue: { add: vi.fn(), remove: vi.fn(), schedule: vi.fn(), flush: vi.fn() } },
    ],
  });
  return runInInjectionContext(injector, () => new ListStatesComponent());
}

describe('ListStatesComponent', () => {
  describe('mode precedence', () => {
    it('renders error when both error and loading are truthy', () => {
      const c = makeComponent();
      (c.error as any) = () => 'boom';
      (c.loading as any) = () => true;
      (c.empty as any) = () => true;
      expect(c.mode()).toBe('error');
    });

    it('renders loading when error is null and loading is true', () => {
      const c = makeComponent();
      (c.error as any) = () => null;
      (c.loading as any) = () => true;
      expect(c.mode()).toBe('loading');
    });

    it('renders empty when no error and not loading', () => {
      const c = makeComponent();
      (c.error as any) = () => null;
      (c.loading as any) = () => false;
      (c.empty as any) = () => true;
      expect(c.mode()).toBe('empty');
    });

    it('renders idle (projects children) otherwise', () => {
      const c = makeComponent();
      (c.error as any) = () => null;
      (c.loading as any) = () => false;
      (c.empty as any) = () => false;
      expect(c.mode()).toBe('idle');
    });
  });

  describe('retry emission', () => {
    it('emits retry once on onRetry()', () => {
      const c = makeComponent();
      const spy = vi.fn();
      c.retry.subscribe(spy);
      c.onRetry();
      expect(spy).toHaveBeenCalledOnce();
    });
  });
});
