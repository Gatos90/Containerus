import { describe, it, expect } from 'vitest';
import {
  Container,
  ContainerStatus,
  ContainerRuntime,
  ContainerAction,
  PortMapping,
  getDisplayName,
  getStatusColor,
  getRuntimeColor,
  getAvailableActions,
  isRunning,
  getStatusText,
  formatPort,
  getRelativeTime,
} from './container.model';

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'abc123def456',
    name: 'my-container',
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
    state: { pid: 1234, exitCode: 0, error: null, startedAt: null, finishedAt: null, healthStatus: null },
    config: { cmd: null, entrypoint: null, workingDir: null, user: null, hostname: null, domainname: null, tty: false, stopSignal: null },
    hostConfig: { networkMode: null, privileged: false, capAdd: [], capDrop: [], devices: [], shmSize: null, logConfig: null, securityOpt: [], ulimits: [] },
    ...overrides,
  };
}

describe('Container Model Utilities', () => {
  describe('getDisplayName', () => {
    it('should return the container name when it exists', () => {
      const container = makeContainer({ name: 'web-server' });
      expect(getDisplayName(container)).toBe('web-server');
    });

    it('should return truncated ID when name is empty', () => {
      const container = makeContainer({ id: 'abc123def456789012', name: '' });
      expect(getDisplayName(container)).toBe('abc123def456');
    });

    it('should return truncated ID when name is not set', () => {
      const container = makeContainer({ id: 'abc123def456789012' });
      container.name = '';
      expect(getDisplayName(container)).toBe('abc123def456');
    });
  });

  describe('getStatusColor', () => {
    it('should return green for running', () => {
      expect(getStatusColor('running')).toBe('text-green-500');
    });

    it('should return yellow for paused', () => {
      expect(getStatusColor('paused')).toBe('text-yellow-500');
    });

    it('should return orange for restarting', () => {
      expect(getStatusColor('restarting')).toBe('text-orange-500');
    });

    it('should return red for exited', () => {
      expect(getStatusColor('exited')).toBe('text-red-500');
    });

    it('should return red for dead', () => {
      expect(getStatusColor('dead')).toBe('text-red-500');
    });

    it('should return blue for created', () => {
      expect(getStatusColor('created')).toBe('text-blue-500');
    });

    it('should return gray for removing', () => {
      expect(getStatusColor('removing')).toBe('text-gray-500');
    });
  });

  describe('getRuntimeColor', () => {
    it('should return blue for docker', () => {
      expect(getRuntimeColor('docker')).toBe('text-blue-500');
    });

    it('should return orange for podman', () => {
      expect(getRuntimeColor('podman')).toBe('text-orange-500');
    });

    it('should return purple for apple', () => {
      expect(getRuntimeColor('apple')).toBe('text-purple-500');
    });
  });

  describe('getAvailableActions', () => {
    it('should return stop, restart, pause for running containers', () => {
      const container = makeContainer({ status: 'running' });
      expect(getAvailableActions(container)).toEqual(['stop', 'restart', 'pause']);
    });

    it('should return unpause, stop for paused containers', () => {
      const container = makeContainer({ status: 'paused' });
      expect(getAvailableActions(container)).toEqual(['unpause', 'stop']);
    });

    it('should return start, remove for exited containers', () => {
      const container = makeContainer({ status: 'exited' });
      expect(getAvailableActions(container)).toEqual(['start', 'remove']);
    });

    it('should return start, remove for created containers', () => {
      const container = makeContainer({ status: 'created' });
      expect(getAvailableActions(container)).toEqual(['start', 'remove']);
    });

    it('should return start, remove for dead containers', () => {
      const container = makeContainer({ status: 'dead' });
      expect(getAvailableActions(container)).toEqual(['start', 'remove']);
    });

    it('should return stop for restarting containers', () => {
      const container = makeContainer({ status: 'restarting' });
      expect(getAvailableActions(container)).toEqual(['stop']);
    });

    it('should return empty array for removing containers', () => {
      const container = makeContainer({ status: 'removing' });
      expect(getAvailableActions(container)).toEqual([]);
    });
  });

  describe('isRunning', () => {
    it('should return true for running containers', () => {
      expect(isRunning(makeContainer({ status: 'running' }))).toBe(true);
    });

    it('should return false for non-running containers', () => {
      expect(isRunning(makeContainer({ status: 'exited' }))).toBe(false);
      expect(isRunning(makeContainer({ status: 'paused' }))).toBe(false);
      expect(isRunning(makeContainer({ status: 'created' }))).toBe(false);
      expect(isRunning(makeContainer({ status: 'dead' }))).toBe(false);
    });
  });

  describe('getStatusText', () => {
    it('should return capitalized status text', () => {
      expect(getStatusText('running')).toBe('Running');
      expect(getStatusText('exited')).toBe('Exited');
      expect(getStatusText('created')).toBe('Created');
      expect(getStatusText('paused')).toBe('Paused');
      expect(getStatusText('restarting')).toBe('Restarting');
      expect(getStatusText('removing')).toBe('Removing');
      expect(getStatusText('dead')).toBe('Dead');
    });
  });

  describe('formatPort', () => {
    it('should format port mapping correctly', () => {
      const port: PortMapping = { hostIp: '0.0.0.0', hostPort: 8080, containerPort: 80, protocol: 'tcp' };
      expect(formatPort(port)).toBe('8080:80/TCP');
    });

    it('should handle UDP protocol', () => {
      const port: PortMapping = { hostIp: '0.0.0.0', hostPort: 53, containerPort: 53, protocol: 'udp' };
      expect(formatPort(port)).toBe('53:53/UDP');
    });
  });

  describe('getRelativeTime', () => {
    it('should return "Just now" for very recent dates', () => {
      const now = new Date();
      expect(getRelativeTime(now.toISOString())).toBe('Just now');
    });

    it('should return minutes ago', () => {
      const date = new Date(Date.now() - 5 * 60 * 1000);
      expect(getRelativeTime(date.toISOString())).toBe('5 minutes ago');
    });

    it('should return hours ago', () => {
      const date = new Date(Date.now() - 3 * 60 * 60 * 1000);
      expect(getRelativeTime(date.toISOString())).toBe('3 hours ago');
    });

    it('should return days ago', () => {
      const date = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      expect(getRelativeTime(date.toISOString())).toBe('2 days ago');
    });

    it('should return weeks ago', () => {
      const date = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      expect(getRelativeTime(date.toISOString())).toBe('2 weeks ago');
    });

    it('should return months ago', () => {
      const date = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      expect(getRelativeTime(date.toISOString())).toBe('2 months ago');
    });

    it('should return years ago', () => {
      const date = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
      expect(getRelativeTime(date.toISOString())).toBe('1 year ago');
    });

    it('should pluralize correctly for singular', () => {
      const date = new Date(Date.now() - 1 * 60 * 1000);
      expect(getRelativeTime(date.toISOString())).toBe('1 minute ago');
    });
  });
});
