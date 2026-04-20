import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { PermissionBannerComponent } from './permission-banner.component';
import { PermissionBannerState } from '../../../state/permission-banner.state';
import { ToastState } from '../../../state/toast.state';
import { BackendService } from '../../../core/services/backend.service';

function makeComponent() {
  const banner = new PermissionBannerState();
  const toast: any = {
    success: vi.fn(),
    error: vi.fn(),
  };
  const backend: any = {
    refreshPermissionsFor: vi.fn().mockResolvedValue(undefined),
    getConnection: vi.fn().mockReturnValue({ label: 'prod-east' }),
  };

  const injector = Injector.create({
    providers: [
      { provide: PermissionBannerState, useValue: banner },
      { provide: ToastState, useValue: toast },
      { provide: BackendService, useValue: backend },
    ],
  });
  const component = runInInjectionContext(injector, () => new PermissionBannerComponent());
  return { component, banner, toast, backend };
}

describe('PermissionBannerComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('visible() reflects the underlying state toggle', () => {
    const { component, banner } = makeComponent();
    expect(component.visible()).toBe(false);

    banner.show('conn-1');
    expect(component.visible()).toBe(true);

    banner.dismiss();
    expect(component.visible()).toBe(false);
  });

  it('refresh() calls backend.refreshPermissionsFor + toast.success on success', async () => {
    const { component, banner, toast, backend } = makeComponent();
    banner.show('conn-1');

    await component.refresh();

    expect(backend.refreshPermissionsFor).toHaveBeenCalledWith('conn-1');
    expect(toast.success).toHaveBeenCalledWith('Permissions refreshed.');
    expect(toast.error).not.toHaveBeenCalled();
    expect(component.visible()).toBe(false);
  });

  it('refresh() calls toast.error (not success) when the refresh throws', async () => {
    const { component, banner, toast, backend } = makeComponent();
    backend.refreshPermissionsFor.mockRejectedValueOnce(new Error('403'));
    banner.show('conn-1');

    await component.refresh();

    expect(toast.error).toHaveBeenCalledWith('Failed to refresh permissions.');
    expect(toast.success).not.toHaveBeenCalled();
    // Banner still dismisses — we don't re-show on failure.
    expect(component.visible()).toBe(false);
  });

  it('dismiss() clears visibility and connectionId', () => {
    const { component, banner } = makeComponent();
    banner.show('conn-1');
    expect(banner.connectionId()).toBe('conn-1');

    component.dismiss();

    expect(banner.visible()).toBe(false);
    expect(banner.connectionId()).toBeNull();
  });
});

describe('PermissionBannerState — focus restoration', () => {
  it('restores focus to the element active at show() after dismiss()', async () => {
    const banner = new PermissionBannerState();
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    banner.show('conn-1');
    // Simulate focus moving into the banner (as happens when user clicks Refresh).
    const bannerBtn = document.createElement('button');
    document.body.appendChild(bannerBtn);
    bannerBtn.focus();
    expect(document.activeElement).toBe(bannerBtn);

    banner.dismiss();
    bannerBtn.remove();

    // Focus is restored via queueMicrotask — await one microtask tick.
    await Promise.resolve();

    expect(document.activeElement).toBe(trigger);

    trigger.remove();
  });

  it('does not throw when the previously-focused element is gone', async () => {
    const banner = new PermissionBannerState();
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    banner.show('conn-1');
    trigger.remove();

    expect(() => banner.dismiss()).not.toThrow();
    await Promise.resolve();
  });
});
