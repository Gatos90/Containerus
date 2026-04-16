import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { NetworkCardComponent } from './network-card.component';
import type { Network } from '../../../../core/models/network.model';
import type { Container } from '../../../../core/models/container.model';

const makeNetwork = (overrides: Partial<Network> = {}): Network => ({
  id: 'net-1',
  name: 'bridge',
  driver: 'bridge',
  scope: 'local',
  createdAt: null,
  internal: false,
  attachable: false,
  labels: {},
  runtime: 'docker',
  systemId: 'sys-1',
  ...overrides,
});

const makeContainer = (id: string, overrides: Partial<Container> = {}): Container =>
  ({
    id,
    name: `container-${id}`,
    image: 'nginx:latest',
    status: 'running',
    runtime: 'docker',
    systemId: 'sys-1',
    createdAt: new Date().toISOString(),
    ports: [],
    environmentVariables: {},
    volumes: [],
    networkSettings: { networks: {}, portBindings: [] },
    resourceLimits: {},
    labels: {},
    restartPolicy: { name: 'no', maximumRetryCount: 0 },
    healthCheck: null,
    state: { pid: 1, exitCode: 0, error: null, startedAt: null, finishedAt: null, healthStatus: null },
    config: { cmd: null, entrypoint: null, workingDir: null, user: null, hostname: null, domainname: null, tty: false, stopSignal: null },
    hostConfig: { networkMode: null, privileged: false, capAdd: [], capDrop: [], devices: [], shmSize: null, logConfig: null, securityOpt: [], ulimits: [] },
    ...overrides,
  } as Container);

function makeComponent(
  network: Network = makeNetwork(),
  containers: Container[] = [],
  isDefault = false,
  dropListId = 'drop-1',
  connectedDropLists: string[] = []
): NetworkCardComponent {
  const injector = Injector.create({ providers: [] });

  const component = runInInjectionContext(injector, () => new NetworkCardComponent());

  (component as any).network = signal(network);
  (component as any).containers = signal(containers);
  (component as any).isDefault = signal(isDefault);
  (component as any).dropListId = signal(dropListId);
  (component as any).connectedDropLists = signal(connectedDropLists);

  return component;
}

describe('NetworkCardComponent', () => {
  let component: NetworkCardComponent;

  beforeEach(() => {
    component = makeComponent();
  });

  // ─── Construction & icon constants ───────────────────────────────────────

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should expose Info icon reference', () => {
    expect(component.Info).toBeDefined();
  });

  it('should expose Plus icon reference', () => {
    expect(component.Plus).toBeDefined();
  });

  // ─── containerCount computed ──────────────────────────────────────────────

  it('should return 0 when there are no containers', () => {
    expect(component.containerCount()).toBe(0);
  });

  it('should return the correct count of containers', () => {
    component = makeComponent(makeNetwork(), [makeContainer('c1'), makeContainer('c2'), makeContainer('c3')]);
    expect(component.containerCount()).toBe(3);
  });

  it('should update containerCount when containers list changes', () => {
    const containersSig = signal<Container[]>([]);
    (component as any).containers = containersSig;
    expect(component.containerCount()).toBe(0);
    containersSig.set([makeContainer('c1')]);
    expect(component.containerCount()).toBe(1);
  });

  // ─── driverInfo computed ──────────────────────────────────────────────────

  it('should capitalise driver and scope in driverInfo', () => {
    component = makeComponent(makeNetwork({ driver: 'bridge', scope: 'local' }));
    expect(component.driverInfo()).toBe('Bridge, Local');
  });

  it('should handle uppercase driver name correctly', () => {
    component = makeComponent(makeNetwork({ driver: 'overlay', scope: 'swarm' }));
    expect(component.driverInfo()).toBe('Overlay, Swarm');
  });

  it('should handle host driver and global scope', () => {
    component = makeComponent(makeNetwork({ driver: 'host', scope: 'global' }));
    expect(component.driverInfo()).toBe('Host, Global');
  });

  it('should format single-character driver and scope', () => {
    component = makeComponent(makeNetwork({ driver: 'n', scope: 'l' }));
    expect(component.driverInfo()).toBe('N, L');
  });

  // ─── inputs ───────────────────────────────────────────────────────────────

  it('should reflect network input', () => {
    const net = makeNetwork({ name: 'my-custom-net' });
    component = makeComponent(net);
    expect(component.network().name).toBe('my-custom-net');
  });

  it('should reflect isDefault input as false by default', () => {
    expect(component.isDefault()).toBe(false);
  });

  it('should reflect isDefault as true when set', () => {
    component = makeComponent(makeNetwork(), [], true);
    expect(component.isDefault()).toBe(true);
  });

  it('should reflect dropListId input', () => {
    component = makeComponent(makeNetwork(), [], false, 'my-drop-list');
    expect(component.dropListId()).toBe('my-drop-list');
  });

  it('should reflect connectedDropLists input', () => {
    component = makeComponent(makeNetwork(), [], false, 'drop-1', ['drop-2', 'drop-3']);
    expect(component.connectedDropLists()).toEqual(['drop-2', 'drop-3']);
  });

  // ─── onContainerRemoved ───────────────────────────────────────────────────

  it('should emit containerRemoved when onContainerRemoved is called', () => {
    const emitted: Container[] = [];
    component.containerRemoved.subscribe((c) => emitted.push(c));

    const container = makeContainer('c1');
    component.onContainerRemoved(container);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual(container);
  });

  // ─── onDrop ───────────────────────────────────────────────────────────────

  it('should emit containerDropped when onDrop is called', () => {
    const emitted: any[] = [];
    component.containerDropped.subscribe((e) => emitted.push(e));

    const fakeEvent = { item: {}, previousContainer: {}, container: {} } as any;
    component.onDrop(fakeEvent);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toBe(fakeEvent);
  });
});
