import { describe, it, expect, vi } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { VolumeCardComponent } from './volume-card.component';
import { Volume } from '../../../../core/models/volume.model';
import { Container } from '../../../../core/models/container.model';

function makeVolume(overrides: Partial<Volume> = {}): Volume {
  return {
    name: 'my-volume',
    driver: 'local',
    mountpoint: '/var/lib/docker/volumes/my-volume/_data',
    labels: {},
    options: {},
    runtime: 'docker',
    systemId: 'sys-1',
    ...overrides,
  };
}

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'container-1',
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
  return runInInjectionContext(injector, () => new VolumeCardComponent());
}

describe('VolumeCardComponent', () => {
  describe('containerCount', () => {
    it('returns 0 when no containers', () => {
      const c = makeComponent();
      (c.containers as any) = () => [];
      expect(c.containerCount()).toBe(0);
    });

    it('returns the number of containers', () => {
      const c = makeComponent();
      (c.containers as any) = () => [makeContainer(), makeContainer({ id: 'c2' })];
      expect(c.containerCount()).toBe(2);
    });
  });

  describe('hasLabels', () => {
    it('returns false when labels is empty object', () => {
      const c = makeComponent();
      (c.volume as any) = () => makeVolume({ labels: {} });
      expect(c.hasLabels()).toBe(false);
    });

    it('returns true when labels has entries', () => {
      const c = makeComponent();
      (c.volume as any) = () => makeVolume({ labels: { 'app': 'myapp' } });
      expect(c.hasLabels()).toBe(true);
    });

    it('returns false when labels is null', () => {
      const c = makeComponent();
      (c.volume as any) = () => makeVolume({ labels: null as any });
      expect(c.hasLabels()).toBeFalsy();
    });
  });

  describe('labelEntries', () => {
    it('returns empty array when no labels', () => {
      const c = makeComponent();
      (c.volume as any) = () => makeVolume({ labels: {} });
      expect(c.labelEntries()).toEqual([]);
    });

    it('returns all entries when 3 or fewer labels', () => {
      const c = makeComponent();
      (c.volume as any) = () => makeVolume({ labels: { a: '1', b: '2', c: '3' } });
      expect(c.labelEntries()).toHaveLength(3);
    });

    it('returns at most 3 entries when more than 3 labels', () => {
      const c = makeComponent();
      (c.volume as any) = () => makeVolume({ labels: { a: '1', b: '2', c: '3', d: '4', e: '5' } });
      expect(c.labelEntries()).toHaveLength(3);
    });
  });

  describe('truncatedMountpoint', () => {
    it('returns full path when 40 chars or fewer', () => {
      const mp = '/short/path';
      const c = makeComponent();
      (c.volume as any) = () => makeVolume({ mountpoint: mp });
      expect(c.truncatedMountpoint()).toBe(mp);
    });

    it('truncates long paths to at most 40 chars with ellipsis prefix', () => {
      const mp = '/var/lib/docker/volumes/very-long-volume-name-here/_data/extra';
      const c = makeComponent();
      (c.volume as any) = () => makeVolume({ mountpoint: mp });
      const result = c.truncatedMountpoint();
      expect(result.startsWith('...')).toBe(true);
      expect(result.length).toBe(40); // '...' (3) + 37 chars
    });

    it('returns exact 40-char path without truncation', () => {
      const mp = '/var/lib/docker/volumes/my-vol-1/_data/x'; // exactly 40 chars
      const c = makeComponent();
      (c.volume as any) = () => makeVolume({ mountpoint: mp });
      expect(c.truncatedMountpoint()).toBe(mp);
    });
  });

  describe('onDelete()', () => {
    it('stops event propagation', () => {
      const c = makeComponent();
      const event = { stopPropagation: vi.fn() } as any;
      c.onDelete(event);
      expect(event.stopPropagation).toHaveBeenCalledOnce();
    });

    it('emits deleted event', () => {
      const c = makeComponent();
      let emitCount = 0;
      c.deleted.subscribe(() => emitCount++);
      c.onDelete({ stopPropagation: vi.fn() } as any);
      expect(emitCount).toBe(1);
    });
  });

  describe('default inputs', () => {
    it('isOrphaned defaults to false', () => {
      const c = makeComponent();
      expect(c.isOrphaned()).toBe(false);
    });

    it('isDeleting defaults to false', () => {
      const c = makeComponent();
      expect(c.isDeleting()).toBe(false);
    });
  });

  describe('static properties', () => {
    it('exposes icon references', () => {
      const c = makeComponent();
      expect(c.FolderOpen).toBeDefined();
      expect(c.HardDrive).toBeDefined();
      expect(c.Trash2).toBeDefined();
      expect(c.Tag).toBeDefined();
    });
  });
});
