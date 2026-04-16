import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { setupTestBed } from '@analogjs/vitest-angular/setup-testbed';
import { PortBadgeComponent } from './port-badge.component';

setupTestBed();
import { PortForwardState } from '../../../../state/port-forward.state';
import { PortMapping } from '../../../../core/models/container.model';
import { PortForward } from '../../../../core/models/port-forward.model';

function makePort(overrides: Partial<PortMapping> = {}): PortMapping {
  return {
    containerPort: 8080,
    hostPort: 8080,
    protocol: 'tcp',
    hostIp: '0.0.0.0',
    ...overrides,
  };
}

function makeForward(overrides: Partial<PortForward> = {}): PortForward {
  return {
    id: 'fwd-1',
    systemId: 'sys-1',
    containerId: 'c-1',
    containerPort: 8080,
    hostPort: 8080,
    localPort: 8080,
    protocol: 'tcp',
    ...overrides,
  } as PortForward;
}

describe('PortBadgeComponent', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<PortBadgeComponent>>;
  let component: PortBadgeComponent;

  const mockPortForwardState = {
    isPortForwarded: vi.fn().mockReturnValue(false),
    getForward: vi.fn().mockReturnValue(null),
    isLoading: vi.fn().mockReturnValue(false),
    stopForward: vi.fn().mockResolvedValue(undefined),
    createForward: vi.fn().mockResolvedValue(undefined),
    openInBrowser: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      imports: [PortBadgeComponent],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        { provide: PortForwardState, useValue: mockPortForwardState },
      ],
    });
    fixture = TestBed.createComponent(PortBadgeComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('port', makePort());
    fixture.componentRef.setInput('containerId', 'c-1');
    fixture.componentRef.setInput('systemId', 'sys-1');
  });

  describe('isForwarded', () => {
    it('returns false when port is not forwarded', () => {
      mockPortForwardState.isPortForwarded.mockReturnValue(false);
      expect(component.isForwarded()).toBe(false);
      expect(mockPortForwardState.isPortForwarded).toHaveBeenCalledWith('c-1', 8080);
    });

    it('returns true when port is forwarded', () => {
      mockPortForwardState.isPortForwarded.mockReturnValue(true);
      expect(component.isForwarded()).toBe(true);
    });
  });

  describe('activeForward', () => {
    it('returns null when no forward is active', () => {
      mockPortForwardState.getForward.mockReturnValue(null);
      expect(component.activeForward()).toBeNull();
    });

    it('returns the active forward when one exists', () => {
      const forward = makeForward();
      mockPortForwardState.getForward.mockReturnValue(forward);
      expect(component.activeForward()).toBe(forward);
    });
  });

  describe('loading', () => {
    it('returns false when not loading', () => {
      mockPortForwardState.isLoading.mockReturnValue(false);
      expect(component.loading()).toBe(false);
    });

    it('returns true when port forward state is loading', () => {
      mockPortForwardState.isLoading.mockReturnValue(true);
      expect(component.loading()).toBe(true);
    });
  });

  describe('toggleForward', () => {
    it('calls stopForward when already forwarded', async () => {
      const forward = makeForward({ id: 'fwd-42' });
      mockPortForwardState.isPortForwarded.mockReturnValue(true);
      mockPortForwardState.getForward.mockReturnValue(forward);

      await component.toggleForward();

      expect(mockPortForwardState.stopForward).toHaveBeenCalledWith('fwd-42');
      expect(mockPortForwardState.createForward).not.toHaveBeenCalled();
    });

    it('calls createForward when not yet forwarded', async () => {
      mockPortForwardState.isPortForwarded.mockReturnValue(false);
      mockPortForwardState.getForward.mockReturnValue(null);

      await component.toggleForward();

      expect(mockPortForwardState.createForward).toHaveBeenCalledWith(
        expect.objectContaining({
          systemId: 'sys-1',
          containerId: 'c-1',
          containerPort: 8080,
        })
      );
    });

    it('uses hostIp as remoteHost when creating forward', async () => {
      fixture.componentRef.setInput('port', makePort({ hostIp: '127.0.1.1', containerPort: 3000, hostPort: 3000 }));
      mockPortForwardState.isPortForwarded.mockReturnValue(false);

      await component.toggleForward();

      expect(mockPortForwardState.createForward).toHaveBeenCalledWith(
        expect.objectContaining({ remoteHost: '127.0.1.1' })
      );
    });

    it('uses localhost as remoteHost when hostIp is empty', async () => {
      fixture.componentRef.setInput('port', makePort({ hostIp: '', containerPort: 3000 }));
      mockPortForwardState.isPortForwarded.mockReturnValue(false);

      await component.toggleForward();

      expect(mockPortForwardState.createForward).toHaveBeenCalledWith(
        expect.objectContaining({ remoteHost: 'localhost' })
      );
    });
  });

  describe('openInBrowser', () => {
    it('does nothing when port is not forwarded', async () => {
      mockPortForwardState.isPortForwarded.mockReturnValue(false);
      await component.openInBrowser();
      expect(mockPortForwardState.openInBrowser).not.toHaveBeenCalled();
    });

    it('opens in browser when port is forwarded', async () => {
      const forward = makeForward({ id: 'fwd-99' });
      mockPortForwardState.isPortForwarded.mockReturnValue(true);
      mockPortForwardState.getForward.mockReturnValue(forward);

      await component.openInBrowser();

      expect(mockPortForwardState.openInBrowser).toHaveBeenCalledWith('fwd-99');
    });
  });
});
