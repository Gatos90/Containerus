import '@angular/compiler';
import { describe, it, expect, vi } from 'vitest';
import {
  Injector,
  runInInjectionContext,
  ɵChangeDetectionScheduler,
  ɵEffectScheduler,
} from '@angular/core';
import { K8sTriageCardComponent } from './k8s-triage-card.component';

function make(): K8sTriageCardComponent {
  const injector = Injector.create({
    providers: [
      { provide: ɵChangeDetectionScheduler, useValue: { notify: vi.fn(), runningTick: false } },
      { provide: ɵEffectScheduler, useValue: { add: vi.fn(), remove: vi.fn(), schedule: vi.fn(), flush: vi.fn() } },
    ],
  });
  return runInInjectionContext(injector, () => new K8sTriageCardComponent());
}

describe('K8sTriageCardComponent', () => {
  it('composes a single aria-label from headline + sub + ready + chip', () => {
    const c = make();
    (c.headline as any) = () => 'prod-api';
    (c.sub as any) = () => 'namespace';
    (c.status as any) = () => 'failing';
    (c.readyCounts as any) = () => '1/3';
    (c.chipLabel as any) = () => null;
    (c.chipCount as any) = () => 2;
    expect(c.ariaLabel()).toBe('prod-api, namespace, ready 1/3, 2 failing');
  });

  it('splits middle-dot separators in sub so SRs do not read "middle dot" verbatim', () => {
    const c = make();
    (c.headline as any) = () => 'payments-7c9';
    (c.sub as any) = () => 'payments · node-3';
    (c.status as any) = () => 'healthy';
    (c.chipLabel as any) = () => 'Running';
    (c.chipCount as any) = () => null;
    (c.readyCounts as any) = () => null;
    expect(c.ariaLabel()).toBe('payments-7c9, payments, node-3, Running');
  });

  it('emits the triggering button element on activation so the caller can restore focus', () => {
    const c = make();
    (c.headline as any) = () => 'x';
    (c.status as any) = () => 'healthy';
    const button = document.createElement('button');
    const received: HTMLElement[] = [];
    c.activate.subscribe((ev) => received.push(ev.element));
    c.onActivate({ currentTarget: button } as unknown as MouseEvent);
    expect(received).toEqual([button]);
  });
});
