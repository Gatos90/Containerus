import { describe, it, expect, vi } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { ContainerChipComponent } from './container-chip.component';
import { Container } from '../../../../core/models/container.model';

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'abc123def456xyz',
    name: 'my-container',
    image: 'nginx:latest',
    status: 'running',
    runtime: 'docker',
    systemId: 'sys-1',
    createdAt: '2024-01-01T00:00:00Z',
    ports: [],
    environmentVariables: {},
    volumes: [],
    networkSettings: { networks: {}, portBindings: [] },
    resourceLimits: {},
    labels: {},
    restartPolicy: { name: 'no', maximumRetryCount: 0 },
    healthCheck: null,
    state: { pid: 0, exitCode: 0, error: null, startedAt: null, finishedAt: null, healthStatus: null },
    config: { cmd: null, entrypoint: null, workingDir: null, user: null, hostname: null, domainname: null, tty: false, stopSignal: null },
    hostConfig: { networkMode: null, privileged: false, capAdd: [], capDrop: [], devices: [], shmSize: null, logConfig: null, securityOpt: [], ulimits: [] },
    ...overrides,
  };
}

function makeComponent() {
  const injector = Injector.create({ providers: [] });
  return runInInjectionContext(injector, () => new ContainerChipComponent());
}

describe('ContainerChipComponent', () => {
  describe('statusDotClass', () => {
    it.each([
      ['running', 'bg-green-500'],
      ['paused', 'bg-yellow-500'],
      ['restarting', 'bg-orange-500'],
      ['exited', 'bg-red-500'],
      ['dead', 'bg-red-500'],
      ['created', 'bg-blue-500'],
    ] as const)('returns %s class for %s status', (status, expected) => {
      const c = makeComponent();
      (c.container as any) = () => makeContainer({ status });
      expect(c.statusDotClass()).toBe(expected);
    });

    it('returns bg-zinc-500 for unknown status', () => {
      const c = makeComponent();
      (c.container as any) = () => makeContainer({ status: 'removing' });
      expect(c.statusDotClass()).toBe('bg-zinc-500');
    });
  });

  describe('displayName', () => {
    it('returns container name when name is present', () => {
      const c = makeComponent();
      (c.container as any) = () => makeContainer({ name: 'my-container' });
      expect(c.displayName()).toBe('my-container');
    });

    it('returns truncated id when name is empty', () => {
      const c = makeComponent();
      (c.container as any) = () => makeContainer({ name: '', id: 'abcdef1234567890' });
      expect(c.displayName()).toBe('abcdef123456');
    });

    it('returns 12 chars of id when name is falsy', () => {
      const c = makeComponent();
      (c.container as any) = () => makeContainer({ name: '', id: '123456789012abcdef' });
      expect(c.displayName()).toHaveLength(12);
    });
  });

  describe('onRemove()', () => {
    it('stops event propagation', () => {
      const c = makeComponent();
      (c.container as any) = () => makeContainer();
      const event = { stopPropagation: vi.fn() } as any;
      c.onRemove(event);
      expect(event.stopPropagation).toHaveBeenCalledOnce();
    });

    it('emits removed event', () => {
      const c = makeComponent();
      (c.container as any) = () => makeContainer();
      let emitCount = 0;
      c.removed.subscribe(() => emitCount++);
      const event = { stopPropagation: vi.fn() } as any;
      c.onRemove(event);
      expect(emitCount).toBe(1);
    });
  });

  describe('default inputs', () => {
    it('removable defaults to true', () => {
      const c = makeComponent();
      expect(c.removable()).toBe(true);
    });

    it('compact defaults to false', () => {
      const c = makeComponent();
      expect(c.compact()).toBe(false);
    });
  });

  describe('static properties', () => {
    it('exposes X icon', () => {
      const c = makeComponent();
      expect(c.X).toBeDefined();
    });
  });
});
