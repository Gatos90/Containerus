import '@angular/compiler';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ElementRef,
  Injector,
  runInInjectionContext,
  ɵChangeDetectionScheduler,
  ɵEffectScheduler,
} from '@angular/core';
import { K8sNamespaceFilterComponent } from './k8s-namespace-filter.component';

function make(active: string | null, namespaces: string[]): K8sNamespaceFilterComponent {
  const hostEl = new ElementRef(document.createElement('div'));
  const injector = Injector.create({
    providers: [
      { provide: ElementRef, useValue: hostEl },
      { provide: ɵChangeDetectionScheduler, useValue: { notify: vi.fn(), runningTick: false } },
      { provide: ɵEffectScheduler, useValue: { add: vi.fn(), remove: vi.fn(), schedule: vi.fn(), flush: vi.fn() } },
    ],
  });
  const c = runInInjectionContext(injector, () => new K8sNamespaceFilterComponent());
  (c.namespaces as any) = () => namespaces;
  (c.activeNamespace as any) = () => active;
  c.triggerEl = new ElementRef(document.createElement('input'));
  return c;
}

describe('K8sNamespaceFilterComponent', () => {
  let filter: K8sNamespaceFilterComponent;
  let selectSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    filter = make(null, ['default', 'kube-system', 'prod-api', 'prod-web']);
    selectSpy = vi.fn();
    filter.select.subscribe(selectSpy);
  });

  it('prepends an "All namespaces" option before the namespace list', () => {
    const opts = filter.options();
    expect(opts[0]).toEqual({ value: '', label: 'All namespaces' });
    expect(opts.slice(1).map((o) => o.value)).toEqual(['default', 'kube-system', 'prod-api', 'prod-web']);
  });

  it('filters the listbox by the trigger query', () => {
    filter.openList();
    filter.onInput({ target: { value: 'prod' } } as unknown as Event);
    expect(filter.filteredOptions().map((o) => o.value)).toEqual(['prod-api', 'prod-web']);
  });

  it('selecting the All option emits null so the URL drops the ns param', () => {
    filter.openList();
    filter.activateIndex(0);
    expect(selectSpy).toHaveBeenCalledWith(null);
  });

  it('selecting a concrete namespace emits the name', () => {
    filter.openList();
    filter.onInput({ target: { value: 'kube' } } as unknown as Event);
    filter.activeIndex.set(0); // "kube-system" is now at index 0 of the filtered list
    filter.onKeydown({ key: 'Enter', preventDefault: vi.fn() } as unknown as KeyboardEvent);
    expect(selectSpy).toHaveBeenCalledWith('kube-system');
  });

  it('Escape closes without emitting', () => {
    filter.openList();
    filter.onKeydown({ key: 'Escape', preventDefault: vi.fn() } as unknown as KeyboardEvent);
    expect(filter.open()).toBe(false);
    expect(selectSpy).not.toHaveBeenCalled();
  });

  it('displayValue shows the active namespace when closed and the query when open', () => {
    const f = make('prod-api', ['prod-api', 'prod-web']);
    expect(f.displayValue()).toBe('prod-api');
    f.openList();
    f.onInput({ target: { value: 'web' } } as unknown as Event);
    expect(f.displayValue()).toBe('web');
  });
});
