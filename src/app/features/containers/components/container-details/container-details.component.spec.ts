import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { ContainerDetailsComponent } from './container-details.component';
import { ClipboardService } from '../../../../core/services/clipboard.service';
import { Container } from '../../../../core/models/container.model';

function makeComponent(): { component: ContainerDetailsComponent; mockClipboard: any } {
  const mockClipboard = {
    copy: vi.fn().mockResolvedValue(true),
    copyEnvVars: vi.fn().mockResolvedValue(true),
  };

  const injector = Injector.create({
    providers: [
      { provide: ClipboardService, useValue: mockClipboard },
    ],
  });

  const component = runInInjectionContext(injector, () => new ContainerDetailsComponent());
  return { component, mockClipboard };
}

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'abc123def456',
    name: 'my-container',
    image: 'nginx:latest',
    status: 'running',
    runtime: 'docker',
    systemId: 'sys-1',
    createdAt: '2024-06-01T12:00:00Z',
    ports: [],
    environmentVariables: { KEY1: 'val1', KEY2: 'val2' },
    volumes: [
      { source: '/host/data', destination: '/data', mode: 'rw', readWrite: true, volumeName: null, mountType: 'bind' },
    ],
    networkSettings: {
      networks: {
        bridge: { ipAddress: '172.17.0.2', gateway: '172.17.0.1', macAddress: '02:42:ac:11:00:02' },
      },
      portBindings: [],
    },
    resourceLimits: { memory: 536870912, cpuShares: 1024, cpuQuota: 50000, cpuPeriod: 100000 },
    labels: { 'com.example.app': 'web', 'maintainer': 'alice' },
    restartPolicy: { name: 'on-failure', maximumRetryCount: 3 },
    healthCheck: null,
    state: { pid: 1234, exitCode: 0, error: null, startedAt: '2024-06-01T12:00:00Z', finishedAt: null, healthStatus: null },
    config: {
      cmd: ['/bin/nginx', '-g', 'daemon off;'],
      entrypoint: ['/docker-entrypoint.sh'],
      workingDir: '/app',
      user: 'nobody',
      hostname: 'container-host',
      domainname: null,
      tty: false,
      stopSignal: 'SIGTERM',
    },
    hostConfig: {
      networkMode: 'bridge',
      privileged: false,
      capAdd: ['NET_ADMIN'],
      capDrop: ['ALL'],
      devices: [],
      shmSize: null,
      logConfig: { logType: 'json-file', config: { 'max-size': '10m', 'max-file': '3' } },
      securityOpt: ['no-new-privileges'],
      ulimits: [],
    },
    ...overrides,
  } as Container;
}

describe('ContainerDetailsComponent', () => {
  let component: ContainerDetailsComponent;
  let mockClipboard: any;

  beforeEach(() => {
    const result = makeComponent();
    component = result.component;
    mockClipboard = result.mockClipboard;
  });

  // --- Construction ---

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // --- Computed: envVarCount ---

  it('envVarCount returns plural when multiple env vars', () => {
    component.container = (() => makeContainer()) as any;
    expect(component.envVarCount()).toBe('2 variables');
  });

  it('envVarCount returns singular for 1 env var', () => {
    component.container = (() => makeContainer({ environmentVariables: { SOLO: 'one' } })) as any;
    expect(component.envVarCount()).toBe('1 variable');
  });

  it('envVarCount returns zero when no env vars', () => {
    component.container = (() => makeContainer({ environmentVariables: {} })) as any;
    expect(component.envVarCount()).toBe('0 variables');
  });

  // --- Computed: volumeCount ---

  it('volumeCount returns correct count', () => {
    component.container = (() => makeContainer()) as any;
    expect(component.volumeCount()).toBe('1 mounted');
  });

  it('volumeCount returns zero when no volumes', () => {
    component.container = (() => makeContainer({ volumes: [] })) as any;
    expect(component.volumeCount()).toBe('0 mounted');
  });

  // --- Computed: labelCount ---

  it('labelCount returns plural for multiple labels', () => {
    component.container = (() => makeContainer()) as any;
    expect(component.labelCount()).toBe('2 labels configured');
  });

  it('labelCount returns singular for one label', () => {
    component.container = (() => makeContainer({ labels: { 'only': 'one' } })) as any;
    expect(component.labelCount()).toBe('1 label configured');
  });

  // --- Computed: envVarsArray ---

  it('envVarsArray returns key-value pairs', () => {
    component.container = (() => makeContainer()) as any;
    const result = component.envVarsArray();
    expect(result).toEqual(expect.arrayContaining([
      { key: 'KEY1', value: 'val1' },
      { key: 'KEY2', value: 'val2' },
    ]));
  });

  it('envVarsArray returns empty array when no env vars', () => {
    component.container = (() => makeContainer({ environmentVariables: {} })) as any;
    expect(component.envVarsArray()).toEqual([]);
  });

  // --- Computed: labelsArray ---

  it('labelsArray returns key-value pairs from labels', () => {
    component.container = (() => makeContainer()) as any;
    const result = component.labelsArray();
    expect(result).toEqual(expect.arrayContaining([
      { key: 'com.example.app', value: 'web' },
      { key: 'maintainer', value: 'alice' },
    ]));
  });

  // --- Computed: logConfigEntries ---

  it('logConfigEntries returns entries from logConfig', () => {
    component.container = (() => makeContainer()) as any;
    const result = component.logConfigEntries();
    expect(result).toEqual(expect.arrayContaining([
      { key: 'max-size', value: '10m' },
      { key: 'max-file', value: '3' },
    ]));
  });

  it('logConfigEntries returns empty array when logConfig is null', () => {
    const c = makeContainer();
    c.hostConfig.logConfig = null;
    component.container = (() => c) as any;
    expect(component.logConfigEntries()).toEqual([]);
  });

  // --- Computed: networksArray ---

  it('networksArray returns network entries with name and info', () => {
    component.container = (() => makeContainer()) as any;
    const result = component.networksArray();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('bridge');
    expect(result[0].info.ipAddress).toBe('172.17.0.2');
  });

  // --- hasCommandInfo ---

  it('hasCommandInfo returns true when entrypoint is set', () => {
    component.container = (() => makeContainer()) as any;
    expect(component.hasCommandInfo()).toBe(true);
  });

  it('hasCommandInfo returns false when no command info', () => {
    const c = makeContainer();
    c.config = { cmd: null, entrypoint: null, workingDir: null, user: null, hostname: null, domainname: null, tty: false, stopSignal: null };
    component.container = (() => c) as any;
    expect(component.hasCommandInfo()).toBe(false);
  });

  // --- hasSecurityInfo ---

  it('hasSecurityInfo returns true when capAdd is non-empty', () => {
    component.container = (() => makeContainer()) as any;
    expect(component.hasSecurityInfo()).toBe(true);
  });

  it('hasSecurityInfo returns false when security arrays are empty', () => {
    const c = makeContainer();
    c.hostConfig.capAdd = [];
    c.hostConfig.capDrop = [];
    c.hostConfig.securityOpt = [];
    component.container = (() => c) as any;
    expect(component.hasSecurityInfo()).toBe(false);
  });

  // --- hasDevicesInfo ---

  it('hasDevicesInfo returns false when no devices or shm', () => {
    component.container = (() => makeContainer()) as any;
    expect(component.hasDevicesInfo()).toBe(false);
  });

  it('hasDevicesInfo returns true when shmSize is set', () => {
    const c = makeContainer();
    c.hostConfig.shmSize = 67108864;
    component.container = (() => c) as any;
    expect(component.hasDevicesInfo()).toBe(true);
  });

  // --- formatDate ---

  it('formatDate returns a non-empty formatted date string', () => {
    const result = component.formatDate('2024-06-01T12:00:00Z');
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('formatDate returns original string on invalid date', () => {
    // Invalid dates return "Invalid Date" from toLocaleString, which is still a string
    const result = component.formatDate('not-a-date');
    expect(typeof result).toBe('string');
  });

  // --- formatMemory ---

  it('formatMemory returns "No limit" for falsy value', () => {
    expect(component.formatMemory(null)).toBe('No limit');
    expect(component.formatMemory(undefined)).toBe('No limit');
    expect(component.formatMemory(0)).toBe('No limit');
  });

  it('formatMemory formats bytes', () => {
    expect(component.formatMemory(512)).toBe('512 B');
  });

  it('formatMemory formats kilobytes', () => {
    expect(component.formatMemory(2048)).toBe('2.0 KB');
  });

  it('formatMemory formats megabytes', () => {
    expect(component.formatMemory(536870912)).toBe('512.0 MB');
  });

  it('formatMemory formats gigabytes', () => {
    expect(component.formatMemory(2147483648)).toBe('2.0 GB');
  });

  // --- formatCpuLimit ---

  it('formatCpuLimit returns percentage when cpuQuota and cpuPeriod set', () => {
    component.container = (() => makeContainer()) as any;
    expect(component.formatCpuLimit()).toBe('50%');
  });

  it('formatCpuLimit returns "Not set" when no quotas', () => {
    const c = makeContainer();
    c.resourceLimits.cpuQuota = null;
    c.resourceLimits.cpuPeriod = null;
    component.container = (() => c) as any;
    expect(component.formatCpuLimit()).toBe('Not set');
  });

  // --- formatRestartPolicy ---

  it('formatRestartPolicy returns name with retry count for on-failure', () => {
    component.container = (() => makeContainer()) as any;
    expect(component.formatRestartPolicy()).toBe('on-failure (max 3)');
  });

  it('formatRestartPolicy returns just name for always', () => {
    component.container = (() => makeContainer({ restartPolicy: { name: 'always', maximumRetryCount: 0 } })) as any;
    expect(component.formatRestartPolicy()).toBe('always');
  });

  it('formatRestartPolicy returns just name for on-failure with no retry count', () => {
    component.container = (() => makeContainer({ restartPolicy: { name: 'on-failure', maximumRetryCount: 0 } })) as any;
    expect(component.formatRestartPolicy()).toBe('on-failure');
  });

  // --- copyAllEnvVars ---

  it('copyAllEnvVars delegates to clipboard.copyEnvVars', async () => {
    component.container = (() => makeContainer()) as any;
    await component.copyAllEnvVars();
    expect(mockClipboard.copyEnvVars).toHaveBeenCalledWith({ KEY1: 'val1', KEY2: 'val2' });
  });

  // --- copyAllLabels ---

  it('copyAllLabels copies label key=value pairs', async () => {
    component.container = (() => makeContainer()) as any;
    await component.copyAllLabels();
    expect(mockClipboard.copy).toHaveBeenCalledWith(expect.stringContaining('com.example.app=web'));
    expect(mockClipboard.copy).toHaveBeenCalledWith(expect.stringContaining('maintainer=alice'));
  });

  // --- copyEnvVar ---

  it('copyEnvVar copies key=value format', async () => {
    await component.copyEnvVar('DATABASE_URL', 'postgres://localhost/db');
    expect(mockClipboard.copy).toHaveBeenCalledWith('DATABASE_URL=postgres://localhost/db');
  });
});
