import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { setupTestBed } from '@analogjs/vitest-angular/setup-testbed';
import { ConnectionSwitcherComponent } from './connection-switcher.component';
import { BackendService } from '../../core/services/backend.service';
import { UiPreferencesState, LOCAL_CONNECTION_ID } from '../../state/ui-preferences.state';
import type { BackendConnection } from '../../core/models/backend.model';

setupTestBed();

function conn(id: string, overrides: Partial<BackendConnection> = {}): BackendConnection {
  return {
    id,
    label: id,
    serverUrl: `https://${id}`,
    tokens: null,
    status: 'connected',
    errorReason: null,
    user: null,
    projects: [],
    projectPermissions: {},
    ...overrides,
  };
}

function makeFixture(opts: {
  connections?: BackendConnection[];
  activeId?: string;
} = {}) {
  const connections = opts.connections ?? [];
  const activeId = opts.activeId ?? LOCAL_CONNECTION_ID;

  const mockBackend: any = {
    connections: signal<BackendConnection[]>(connections),
    waitForReady: vi.fn().mockResolvedValue(undefined),
  };

  const mockUi: any = {
    activeConnectionId: signal(activeId),
    showConnectionTint: signal(false),
    setActiveConnection: vi.fn((id: string) => mockUi.activeConnectionId.set(id)),
  };

  TestBed.configureTestingModule({
    imports: [ConnectionSwitcherComponent],
    providers: [
      { provide: BackendService, useValue: mockBackend },
      { provide: UiPreferencesState, useValue: mockUi },
    ],
  });

  const fixture = TestBed.createComponent(ConnectionSwitcherComponent);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, mockBackend, mockUi };
}

describe('ConnectionSwitcherComponent — activateOption', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.clearAllMocks();
  });

  it('activates a healthy option by selecting it (changes active connection + closes)', () => {
    const { component, mockUi } = makeFixture({
      connections: [conn('prod-east')],
      activeId: LOCAL_CONNECTION_ID,
    });
    component.openList();
    // index 1 = prod-east (index 0 is the synthetic "local" option)
    component.activateOption(1);

    expect(mockUi.setActiveConnection).toHaveBeenCalledWith('prod-east');
    expect(component.open()).toBe(false);
  });

  it('activates an errored option via its reason CTA, not plain selection', () => {
    const { component, mockBackend, mockUi } = makeFixture({
      connections: [
        conn('prod-east', { status: 'error', errorReason: 'server_unreachable' }),
      ],
      activeId: LOCAL_CONNECTION_ID,
    });
    const ctaSpy = vi.spyOn(component, 'onReasonCta');
    const selectSpy = vi.spyOn(component, 'selectIndex');

    component.openList();
    component.activateOption(1);

    expect(ctaSpy).toHaveBeenCalledWith('prod-east', 'server_unreachable');
    expect(selectSpy).not.toHaveBeenCalled();
    expect(mockBackend.waitForReady).toHaveBeenCalled();
    expect(mockUi.setActiveConnection).toHaveBeenCalledWith('prod-east');
  });

  it('Enter on an errored option dispatches the reason CTA (not selectIndex)', () => {
    const { component } = makeFixture({
      connections: [
        conn('prod-east', { status: 'error', errorReason: 'refresh_token_expired' }),
      ],
      activeId: LOCAL_CONNECTION_ID,
    });
    const ctaSpy = vi.spyOn(component, 'onReasonCta');
    const selectSpy = vi.spyOn(component, 'selectIndex');

    component.openList();
    component.activeIndex.set(1);
    const event = new KeyboardEvent('keydown', { key: 'Enter' });
    component.onTriggerKeydown(event);

    expect(ctaSpy).toHaveBeenCalledWith('prod-east', 'refresh_token_expired');
    expect(selectSpy).not.toHaveBeenCalled();
  });

  it('Enter on a healthy option calls selectIndex', () => {
    const { component, mockUi } = makeFixture({
      connections: [conn('prod-east')],
      activeId: LOCAL_CONNECTION_ID,
    });
    const selectSpy = vi.spyOn(component, 'selectIndex');

    component.openList();
    component.activeIndex.set(1);
    const event = new KeyboardEvent('keydown', { key: 'Enter' });
    component.onTriggerKeydown(event);

    expect(selectSpy).toHaveBeenCalledWith(1);
    expect(mockUi.setActiveConnection).toHaveBeenCalledWith('prod-east');
  });
});
