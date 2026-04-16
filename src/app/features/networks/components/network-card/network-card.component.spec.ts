import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { setupTestBed } from '@analogjs/vitest-angular/setup-testbed';
import { NetworkCardComponent } from './network-card.component';

setupTestBed();
import { Network } from '../../../../core/models/network.model';
import { Container } from '../../../../core/models/container.model';

function makeNetwork(overrides: Partial<Network> = {}): Network {
  return {
    id: 'net-1',
    name: 'bridge',
    driver: 'bridge',
    scope: 'local',
    internal: false,
    attachable: false,
    labels: {},
    runtime: 'docker',
    systemId: 'sys-1',
    ...overrides,
  };
}

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'c-1',
    name: 'test-container',
    image: 'nginx:latest',
    status: 'running',
    runtime: 'docker',
    systemId: 'sys-1',
    createdAt: '2024-01-01T00:00:00Z',
    ports: [],
    volumes: [],
    networks: [],
    labels: {},
    networkSettings: { networks: {} },
    ...overrides,
  } as Container;
}

describe('NetworkCardComponent', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<NetworkCardComponent>>;
  let component: NetworkCardComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [NetworkCardComponent],
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(NetworkCardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('network', makeNetwork());
    fixture.componentRef.setInput('containers', []);
    fixture.componentRef.setInput('dropListId', 'list-1');
  });

  describe('containerCount', () => {
    it('returns the number of containers', () => {
      fixture.componentRef.setInput('containers', [makeContainer(), makeContainer({ id: 'c-2' })]);
      expect(component.containerCount()).toBe(2);
    });

    it('returns 0 for empty container list', () => {
      expect(component.containerCount()).toBe(0);
    });
  });

  describe('driverInfo', () => {
    it('capitalizes driver and scope, separated by comma', () => {
      fixture.componentRef.setInput('network', makeNetwork({ driver: 'bridge', scope: 'local' }));
      expect(component.driverInfo()).toBe('Bridge, Local');
    });

    it('handles overlay driver with swarm scope', () => {
      fixture.componentRef.setInput('network', makeNetwork({ driver: 'overlay', scope: 'swarm' }));
      expect(component.driverInfo()).toBe('Overlay, Swarm');
    });

    it('handles macvlan driver', () => {
      fixture.componentRef.setInput('network', makeNetwork({ driver: 'macvlan', scope: 'local' }));
      expect(component.driverInfo()).toBe('Macvlan, Local');
    });

    it('capitalizes single-character strings', () => {
      fixture.componentRef.setInput('network', makeNetwork({ driver: 'n', scope: 'g' }));
      expect(component.driverInfo()).toBe('N, G');
    });
  });

  describe('onContainerRemoved', () => {
    it('emits containerRemoved with the correct container', () => {
      const container = makeContainer();
      const emitSpy = vi.spyOn(component.containerRemoved, 'emit');
      component.onContainerRemoved(container);
      expect(emitSpy).toHaveBeenCalledWith(container);
    });
  });
});
