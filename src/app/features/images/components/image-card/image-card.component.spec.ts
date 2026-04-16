import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { ImageCardComponent } from './image-card.component';
import { ContainerImage } from '../../../../core/models/image.model';
import { Container } from '../../../../core/models/container.model';

function makeImage(overrides: Partial<ContainerImage> = {}): ContainerImage {
  return {
    id: 'sha256:abc123def4567890',
    name: 'nginx',
    tag: 'latest',
    size: 1024 * 1024 * 50, // 50 MB
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
  return runInInjectionContext(injector, () => new ImageCardComponent());
}

describe('ImageCardComponent', () => {
  describe('containerCount', () => {
    it('returns 0 with no containers', () => {
      const c = makeComponent();
      (c.containers as any) = () => [];
      expect(c.containerCount()).toBe(0);
    });

    it('returns correct count', () => {
      const c = makeComponent();
      (c.containers as any) = () => [makeContainer(), makeContainer({ id: 'c2' })];
      expect(c.containerCount()).toBe(2);
    });
  });

  describe('fullName', () => {
    it('returns name:tag for tagged image', () => {
      const c = makeComponent();
      (c.image as any) = () => makeImage({ name: 'nginx', tag: 'latest' });
      expect(c.fullName()).toBe('nginx:latest');
    });

    it('returns just name for image with <none> tag', () => {
      const c = makeComponent();
      (c.image as any) = () => makeImage({ name: 'nginx', tag: '<none>' });
      expect(c.fullName()).toBe('nginx');
    });

    it('returns just name for image with no tag', () => {
      const c = makeComponent();
      (c.image as any) = () => makeImage({ name: 'myimage', tag: '' });
      expect(c.fullName()).toBe('myimage');
    });
  });

  describe('sizeHuman', () => {
    it('returns GB for large images', () => {
      const c = makeComponent();
      (c.image as any) = () => makeImage({ size: 1024 * 1024 * 1024 * 2 });
      expect(c.sizeHuman()).toContain('GB');
    });

    it('returns MB for medium images', () => {
      const c = makeComponent();
      (c.image as any) = () => makeImage({ size: 1024 * 1024 * 50 });
      expect(c.sizeHuman()).toContain('MB');
    });

    it('returns KB for small images', () => {
      const c = makeComponent();
      (c.image as any) = () => makeImage({ size: 1024 * 5 });
      expect(c.sizeHuman()).toContain('KB');
    });

    it('returns B for tiny images', () => {
      const c = makeComponent();
      (c.image as any) = () => makeImage({ size: 500 });
      expect(c.sizeHuman()).toContain('B');
    });
  });

  describe('shortId', () => {
    it('strips sha256: prefix and returns first 12 chars', () => {
      const c = makeComponent();
      (c.image as any) = () => makeImage({ id: 'sha256:abcdef123456789012345' });
      expect(c.shortId()).toBe('abcdef123456');
    });

    it('returns first 12 chars of id without prefix', () => {
      const c = makeComponent();
      (c.image as any) = () => makeImage({ id: 'abcdef1234567890' });
      expect(c.shortId()).toBe('abcdef123456');
    });
  });

  describe('relativeTime', () => {
    it('returns null when created is not set', () => {
      const c = makeComponent();
      (c.image as any) = () => makeImage({ created: null });
      expect(c.relativeTime()).toBeNull();
    });

    it('returns "Today" for same-day image', () => {
      const c = makeComponent();
      const today = new Date().toISOString();
      (c.image as any) = () => makeImage({ created: today });
      expect(c.relativeTime()).toBe('Today');
    });

    it('returns "Yesterday" for 1-day-old image', () => {
      const c = makeComponent();
      const yesterday = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
      (c.image as any) = () => makeImage({ created: yesterday });
      expect(c.relativeTime()).toBe('Yesterday');
    });

    it('returns days ago for recent images', () => {
      const c = makeComponent();
      const threeDaysAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString();
      (c.image as any) = () => makeImage({ created: threeDaysAgo });
      expect(c.relativeTime()).toBe('3 days ago');
    });

    it('returns weeks ago for older images', () => {
      const c = makeComponent();
      const twoWeeksAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 14).toISOString();
      (c.image as any) = () => makeImage({ created: twoWeeksAgo });
      expect(c.relativeTime()).toBe('2 weeks ago');
    });

    it('returns months ago for month-old images', () => {
      const c = makeComponent();
      const twoMonthsAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 60).toISOString();
      (c.image as any) = () => makeImage({ created: twoMonthsAgo });
      expect(c.relativeTime()).toBe('2 months ago');
    });

    it('returns years ago for old images', () => {
      const c = makeComponent();
      const twoYearsAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 730).toISOString();
      (c.image as any) = () => makeImage({ created: twoYearsAgo });
      expect(c.relativeTime()).toBe('2 years ago');
    });
  });

  describe('archDisplay', () => {
    it('returns "os/arch" when both are set', () => {
      const c = makeComponent();
      (c.image as any) = () => makeImage({ os: 'linux', architecture: 'amd64' });
      expect(c.archDisplay()).toBe('linux/amd64');
    });

    it('returns just arch when os is not set', () => {
      const c = makeComponent();
      (c.image as any) = () => makeImage({ os: undefined, architecture: 'arm64' });
      expect(c.archDisplay()).toBe('arm64');
    });

    it('returns null when neither os nor arch is set', () => {
      const c = makeComponent();
      (c.image as any) = () => makeImage({ os: undefined, architecture: undefined });
      expect(c.archDisplay()).toBeNull();
    });
  });

  describe('truncatedDigest', () => {
    it('returns null when digest is not set', () => {
      const c = makeComponent();
      (c.image as any) = () => makeImage({ digest: null });
      expect(c.truncatedDigest()).toBeNull();
    });

    it('truncates long digest with ellipsis', () => {
      const c = makeComponent();
      (c.image as any) = () => makeImage({ digest: 'sha256:abcdef1234567890' });
      const result = c.truncatedDigest();
      expect(result).toContain('...');
      expect(result!.length).toBeLessThan('sha256:abcdef1234567890'.length);
    });

    it('returns short digest as-is', () => {
      const c = makeComponent();
      const shortDigest = 'sha256:abc';
      (c.image as any) = () => makeImage({ digest: shortDigest });
      expect(c.truncatedDigest()).toBe(shortDigest);
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
    it('isUnused defaults to false', () => {
      const c = makeComponent();
      expect(c.isUnused()).toBe(false);
    });

    it('isDangling defaults to false', () => {
      const c = makeComponent();
      expect(c.isDangling()).toBe(false);
    });

    it('isDeleting defaults to false', () => {
      const c = makeComponent();
      expect(c.isDeleting()).toBe(false);
    });
  });

  describe('static properties', () => {
    it('exposes all icon references', () => {
      const c = makeComponent();
      expect(c.Package).toBeDefined();
      expect(c.Clock).toBeDefined();
      expect(c.Trash2).toBeDefined();
      expect(c.Copy).toBeDefined();
      expect(c.Cpu).toBeDefined();
    });
  });
});
