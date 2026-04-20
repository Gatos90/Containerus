import '@angular/compiler';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ElementRef,
  Injector,
  runInInjectionContext,
  ɵChangeDetectionScheduler,
  ɵEffectScheduler,
} from '@angular/core';
import { K8sClusterSwitcherComponent } from './k8s-cluster-switcher.component';
import { K8sCluster } from '../../../../core/models/backend.model';

function cluster(id: string, name: string, isActive = true): K8sCluster {
  return {
    id,
    environmentId: 'env-1',
    name,
    apiServerUrl: 'https://example',
    isActive,
    createdAt: new Date().toISOString(),
  };
}

function makeSwitcher(clusters: K8sCluster[], active: string | null): K8sClusterSwitcherComponent {
  const hostEl = new ElementRef(document.createElement('div'));
  const injector = Injector.create({
    providers: [
      { provide: ElementRef, useValue: hostEl },
      { provide: ɵChangeDetectionScheduler, useValue: { notify: vi.fn(), runningTick: false } },
      { provide: ɵEffectScheduler, useValue: { add: vi.fn(), remove: vi.fn(), schedule: vi.fn(), flush: vi.fn() } },
    ],
  });
  const c = runInInjectionContext(injector, () => new K8sClusterSwitcherComponent());
  (c.clusters as any) = () => clusters;
  (c.activeClusterId as any) = () => active;
  c.triggerEl = new ElementRef(document.createElement('button'));
  return c;
}

describe('K8sClusterSwitcherComponent', () => {
  let switcher: K8sClusterSwitcherComponent;
  let selectSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    switcher = makeSwitcher(
      [cluster('c1', 'alpha'), cluster('c2', 'beta', false), cluster('c3', 'gamma')],
      'c1',
    );
    selectSpy = vi.fn();
    switcher.select.subscribe(selectSpy);
  });

  it('opens the listbox with activeIndex landing on the current cluster', () => {
    switcher.openList();
    expect(switcher.open()).toBe(true);
    expect(switcher.activeIndex()).toBe(0);
  });

  it('arrow keys move the active descendant without leaving focus', () => {
    switcher.openList();
    const ev = (key: string) => ({ key, preventDefault: vi.fn() }) as unknown as KeyboardEvent;
    switcher.onTriggerKeydown(ev('ArrowDown'));
    expect(switcher.activeIndex()).toBe(1);
    switcher.onTriggerKeydown(ev('End'));
    expect(switcher.activeIndex()).toBe(2);
    switcher.onTriggerKeydown(ev('Home'));
    expect(switcher.activeIndex()).toBe(0);
    switcher.onTriggerKeydown(ev('ArrowUp'));
    expect(switcher.activeIndex()).toBe(0);
  });

  it('Escape closes the listbox and focus returns to the trigger', () => {
    switcher.openList();
    const focusSpy = vi.spyOn(switcher.triggerEl.nativeElement, 'focus');
    switcher.onTriggerKeydown({ key: 'Escape', preventDefault: vi.fn() } as unknown as KeyboardEvent);
    expect(switcher.open()).toBe(false);
    return Promise.resolve().then(() => expect(focusSpy).toHaveBeenCalled());
  });

  it('Enter selects the active option and emits', () => {
    switcher.openList();
    switcher.activeIndex.set(2); // gamma (active)
    switcher.onTriggerKeydown({ key: 'Enter', preventDefault: vi.fn() } as unknown as KeyboardEvent);
    expect(selectSpy).toHaveBeenCalledWith('c3');
    expect(switcher.open()).toBe(false);
  });

  it('does not emit when the active option is an offline cluster', () => {
    switcher.openList();
    switcher.activeIndex.set(1); // beta (isActive=false)
    switcher.onTriggerKeydown({ key: 'Enter', preventDefault: vi.fn() } as unknown as KeyboardEvent);
    expect(selectSpy).not.toHaveBeenCalled();
  });

  it('Tab leaves the listbox open-state behind without restoring focus', () => {
    switcher.openList();
    const focusSpy = vi.spyOn(switcher.triggerEl.nativeElement, 'focus');
    switcher.onTriggerKeydown({ key: 'Tab', preventDefault: vi.fn() } as unknown as KeyboardEvent);
    expect(switcher.open()).toBe(false);
    expect(focusSpy).not.toHaveBeenCalled();
  });

  it('activeCluster falls back to the first option when the provided id is unknown', () => {
    const s = makeSwitcher([cluster('c1', 'alpha'), cluster('c2', 'beta')], 'missing');
    expect(s.activeCluster()?.id).toBe('c1');
  });
});
