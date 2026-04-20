import '@angular/compiler';
import { describe, it, expect, vi } from 'vitest';
import {
  DestroyRef,
  Injector,
  runInInjectionContext,
  ɵChangeDetectionScheduler,
  ɵEffectScheduler,
} from '@angular/core';
import { K8sPodDrawerComponent } from './k8s-pod-drawer.component';
import { BackendK8sService } from '../../../../core/services/backend-k8s.service';

interface Harness {
  readonly drawer: K8sPodDrawerComponent;
  readonly k8s: { getPodLogsFor: ReturnType<typeof vi.fn>; getResourceEventsFor: ReturnType<typeof vi.fn> };
}

function make(): Harness {
  const k8s = {
    getPodLogsFor: vi.fn().mockResolvedValue({ logs: '' }),
    getResourceEventsFor: vi.fn().mockResolvedValue([]),
  };
  const destroyRef: Partial<DestroyRef> = { onDestroy: vi.fn(() => () => {}) };
  const injector = Injector.create({
    providers: [
      { provide: BackendK8sService, useValue: k8s as unknown as BackendK8sService },
      { provide: DestroyRef, useValue: destroyRef },
      { provide: ɵChangeDetectionScheduler, useValue: { notify: vi.fn(), runningTick: false } },
      { provide: ɵEffectScheduler, useValue: { add: vi.fn(), remove: vi.fn(), schedule: vi.fn(), flush: vi.fn() } },
    ],
  });
  const drawer = runInInjectionContext(injector, () => new K8sPodDrawerComponent());
  (drawer.connectionId as any) = () => 'conn-1';
  (drawer.clusterId as any) = () => 'cluster-1';
  (drawer.pod as any) = () => ({ name: 'p1', namespace: 'default', status: 'Running' });
  return { drawer, k8s };
}

describe('K8sPodDrawerComponent manual-activation tablist', () => {
  it('Arrow keys move only the focused tab — activeTab and the lazy fetches do not fire', () => {
    const { drawer, k8s } = make();
    expect(drawer.activeTab()).toBe('describe');
    expect(drawer.focusedTab()).toBe('describe');

    drawer.onTabKeydown({ key: 'ArrowRight', preventDefault: vi.fn(), currentTarget: null } as unknown as KeyboardEvent, 'describe');
    expect(drawer.focusedTab()).toBe('logs');
    expect(drawer.activeTab()).toBe('describe');
    expect(k8s.getPodLogsFor).not.toHaveBeenCalled();

    drawer.onTabKeydown({ key: 'ArrowRight', preventDefault: vi.fn(), currentTarget: null } as unknown as KeyboardEvent, 'logs');
    expect(drawer.focusedTab()).toBe('events');
    expect(drawer.activeTab()).toBe('describe');
    expect(k8s.getResourceEventsFor).not.toHaveBeenCalled();
  });

  it('Enter commits the currently-focused tab and triggers the lazy fetch', () => {
    const { drawer, k8s } = make();
    drawer.onTabKeydown({ key: 'ArrowRight', preventDefault: vi.fn(), currentTarget: null } as unknown as KeyboardEvent, 'describe');
    expect(drawer.focusedTab()).toBe('logs');
    drawer.onTabKeydown({ key: 'Enter', preventDefault: vi.fn(), currentTarget: null } as unknown as KeyboardEvent, 'logs');
    expect(drawer.activeTab()).toBe('logs');
    expect(k8s.getPodLogsFor).toHaveBeenCalledTimes(1);
  });

  it('Home and End reposition focus without committing activation', () => {
    const { drawer } = make();
    drawer.onTabKeydown({ key: 'End', preventDefault: vi.fn(), currentTarget: null } as unknown as KeyboardEvent, 'describe');
    expect(drawer.focusedTab()).toBe('metrics');
    expect(drawer.activeTab()).toBe('describe');
    drawer.onTabKeydown({ key: 'Home', preventDefault: vi.fn(), currentTarget: null } as unknown as KeyboardEvent, 'metrics');
    expect(drawer.focusedTab()).toBe('describe');
    expect(drawer.activeTab()).toBe('describe');
  });

  it('tablist exposes the CON-136 Metrics tab as a roving target reachable by arrow keys', () => {
    const { drawer, k8s } = make();
    drawer.onTabKeydown({ key: 'ArrowLeft', preventDefault: vi.fn(), currentTarget: null } as unknown as KeyboardEvent, 'describe');
    // ArrowLeft wraps to the last tab, which is now Metrics.
    expect(drawer.focusedTab()).toBe('metrics');
    expect(drawer.activeTab()).toBe('describe');
    // Metrics tab activation is panel-owned polling — drawer should not
    // invoke logs or events fetches when it is selected.
    drawer.onTabKeydown({ key: 'Enter', preventDefault: vi.fn(), currentTarget: null } as unknown as KeyboardEvent, 'metrics');
    expect(drawer.activeTab()).toBe('metrics');
    expect(k8s.getPodLogsFor).not.toHaveBeenCalled();
    expect(k8s.getResourceEventsFor).not.toHaveBeenCalled();
  });
});
