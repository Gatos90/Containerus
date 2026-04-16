import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { PortBadgeComponent } from './port-badge.component';
import { PortForwardState } from '../../../../state/port-forward.state';
import type { PortMapping } from '../../../../core/models/container.model';
import type { PortForward } from '../../../../core/models/port-forward.model';

const makePortMapping = (overrides: Partial<PortMapping> = {}): PortMapping => ({
  hostIp: '0.0.0.0',
  hostPort: 8080,
  containerPort: 80,
  protocol: 'tcp',
  ...overrides,
});

const makePortForward = (overrides: Partial<PortForward> = {}): PortForward => ({
  id: 'fwd-1',
  systemId: 'sys-1',
  containerId: 'ctr-1',
  containerPort: 80,
  localPort: 8080,
  remoteHost: 'localhost',
  remotePort: 8080,
  protocol: 'tcp',
  status: 'active',
  createdAt: new Date().toISOString(),
  ...overrides,
});

function makeComponent(portForwardStateOverrides: any = {}): {
  component: PortBadgeComponent;
  mockState: any;
} {
  const mockState: any = {
    isPortForwarded: vi.fn().mockReturnValue(false),
    getForward: vi.fn().mockReturnValue(null),
    isLoading: vi.fn().mockReturnValue(false),
    createForward: vi.fn().mockResolvedValue(makePortForward()),
    stopForward: vi.fn().mockResolvedValue(true),
    openInBrowser: vi.fn().mockResolvedValue(undefined),
    ...portForwardStateOverrides,
  };

  const injector = Injector.create({
    providers: [{ provide: PortForwardState, useValue: mockState }],
  });

  const component = runInInjectionContext(injector, () => new PortBadgeComponent());

  // Set required inputs via the signal-based input API
  (component as any).port = signal(makePortMapping());
  (component as any).containerId = signal('ctr-1');
  (component as any).systemId = signal('sys-1');

  return { component, mockState };
}

describe('PortBadgeComponent', () => {
  let component: PortBadgeComponent;
  let mockState: any;

  beforeEach(() => {
    ({ component, mockState } = makeComponent());
  });

  // ─── Construction & icon constants ───────────────────────────────────────

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should expose Lucide icon references', () => {
    expect(component.Link).toBeDefined();
    expect(component.ArrowLeftRight).toBeDefined();
    expect(component.X).toBeDefined();
    expect(component.Radio).toBeDefined();
    expect(component.Loader2).toBeDefined();
  });

  // ─── isForwarded computed ─────────────────────────────────────────────────

  it('should return false when port is not forwarded', () => {
    mockState.isPortForwarded.mockReturnValue(false);
    expect(component.isForwarded()).toBe(false);
  });

  it('should return true when port is forwarded', () => {
    mockState.isPortForwarded.mockReturnValue(true);
    expect(component.isForwarded()).toBe(true);
  });

  it('should query isPortForwarded with correct containerId and containerPort', () => {
    component.isForwarded();
    expect(mockState.isPortForwarded).toHaveBeenCalledWith('ctr-1', 80);
  });

  // ─── activeForward computed ───────────────────────────────────────────────

  it('should return null when there is no active forward', () => {
    mockState.getForward.mockReturnValue(null);
    expect(component.activeForward()).toBeNull();
  });

  it('should return the forward when one is active', () => {
    const fwd = makePortForward();
    mockState.getForward.mockReturnValue(fwd);
    expect(component.activeForward()).toEqual(fwd);
  });

  it('should query getForward with correct containerId and containerPort', () => {
    component.activeForward();
    expect(mockState.getForward).toHaveBeenCalledWith('ctr-1', 80);
  });

  // ─── loading computed ─────────────────────────────────────────────────────

  it('should reflect false loading when state not loading and no local loading', () => {
    mockState.isLoading.mockReturnValue(false);
    expect(component.loading()).toBe(false);
  });

  it('should reflect true loading when state is loading', () => {
    mockState.isLoading.mockReturnValue(true);
    expect(component.loading()).toBe(true);
  });

  // ─── toggleForward – stop path ────────────────────────────────────────────

  it('should call stopForward when port is currently forwarded', async () => {
    const fwd = makePortForward();
    mockState.isPortForwarded.mockReturnValue(true);
    mockState.getForward.mockReturnValue(fwd);

    await component.toggleForward();

    expect(mockState.stopForward).toHaveBeenCalledWith('fwd-1');
    expect(mockState.createForward).not.toHaveBeenCalled();
  });

  it('should not call stopForward when getForward returns null even if forwarded flag is true', async () => {
    mockState.isPortForwarded.mockReturnValue(true);
    mockState.getForward.mockReturnValue(null);

    await component.toggleForward();

    expect(mockState.stopForward).not.toHaveBeenCalled();
  });

  // ─── toggleForward – create path ──────────────────────────────────────────

  it('should call createForward with correct params when port is not forwarded', async () => {
    mockState.isPortForwarded.mockReturnValue(false);

    await component.toggleForward();

    expect(mockState.createForward).toHaveBeenCalledWith(
      expect.objectContaining({
        systemId: 'sys-1',
        containerId: 'ctr-1',
        containerPort: 80,
        hostPort: 8080,
        localPort: 8080,
        protocol: 'tcp',
      })
    );
  });

  it('should use hostIp as remoteHost when creating a forward', async () => {
    (component as any).port = signal(makePortMapping({ hostIp: '127.0.1.1' }));
    mockState.isPortForwarded.mockReturnValue(false);

    await component.toggleForward();

    expect(mockState.createForward).toHaveBeenCalledWith(
      expect.objectContaining({ remoteHost: '127.0.1.1' })
    );
  });

  it('should fall back to "localhost" as remoteHost when hostIp is empty', async () => {
    (component as any).port = signal(makePortMapping({ hostIp: '' }));
    mockState.isPortForwarded.mockReturnValue(false);

    await component.toggleForward();

    expect(mockState.createForward).toHaveBeenCalledWith(
      expect.objectContaining({ remoteHost: 'localhost' })
    );
  });

  it('should reset _localLoading to false after successful createForward', async () => {
    mockState.isPortForwarded.mockReturnValue(false);
    mockState.createForward.mockResolvedValue(makePortForward());

    await component.toggleForward();

    // After the call, loading should be back to false (delegated to state)
    mockState.isLoading.mockReturnValue(false);
    expect(component.loading()).toBe(false);
  });

  it('should reset _localLoading to false even when createForward throws', async () => {
    mockState.isPortForwarded.mockReturnValue(false);
    mockState.createForward.mockRejectedValue(new Error('network error'));

    await expect(component.toggleForward()).rejects.toThrow('network error');

    mockState.isLoading.mockReturnValue(false);
    expect(component.loading()).toBe(false);
  });

  // ─── openInBrowser ────────────────────────────────────────────────────────

  it('should not call openInBrowser when port is not forwarded', async () => {
    mockState.isPortForwarded.mockReturnValue(false);

    await component.openInBrowser();

    expect(mockState.openInBrowser).not.toHaveBeenCalled();
  });

  it('should call openInBrowser with the forward id when port is forwarded', async () => {
    const fwd = makePortForward({ id: 'fwd-42' });
    mockState.isPortForwarded.mockReturnValue(true);
    mockState.getForward.mockReturnValue(fwd);

    await component.openInBrowser();

    expect(mockState.openInBrowser).toHaveBeenCalledWith('fwd-42');
  });

  it('should not call openInBrowser when forwarded but getForward returns null', async () => {
    mockState.isPortForwarded.mockReturnValue(true);
    mockState.getForward.mockReturnValue(null);

    await component.openInBrowser();

    expect(mockState.openInBrowser).not.toHaveBeenCalled();
  });
});
