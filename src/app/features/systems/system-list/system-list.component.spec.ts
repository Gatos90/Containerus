import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { setupTestBed } from '@analogjs/vitest-angular/setup-testbed';
import { SystemListComponent, LoadLevelInfo } from './system-list.component';

setupTestBed();
import { SystemState } from '../../../state/system.state';
import { AppState } from '../../../state/app.state';
import { SystemService } from '../../../core/services/system.service';
import { KeychainService } from '../../../core/services/keychain.service';
import { TerminalState } from '../../../state/terminal.state';
import { TerminalService } from '../../../core/services/terminal.service';
import { ToastState } from '../../../state/toast.state';
import { LiveSystemMetrics } from '../../../core/models/system.model';

function makeMetrics(overrides: Partial<LiveSystemMetrics> = {}): LiveSystemMetrics {
  return {
    cpuUsagePercent: 0,
    memoryUsagePercent: 0,
    memoryTotalBytes: 8 * 1024 * 1024 * 1024,
    memoryUsedBytes: 0,
    ...overrides,
  } as LiveSystemMetrics;
}

describe('SystemListComponent', () => {
  let component: SystemListComponent;

  const mockSystemState = {
    systems: signal([]),
    connectedSystems: signal([]),
    error: signal(null),
    getConnectionState: vi.fn().mockReturnValue('disconnected'),
    getExtendedInfo: vi.fn().mockReturnValue(null),
    getLiveMetrics: vi.fn().mockReturnValue(null),
    loadSystems: vi.fn().mockResolvedValue(undefined),
    connectSystem: vi.fn().mockResolvedValue(false),
    disconnectSystem: vi.fn().mockResolvedValue(undefined),
    addSystem: vi.fn().mockResolvedValue(null),
    updateSystem: vi.fn().mockResolvedValue(null),
    removeSystem: vi.fn().mockResolvedValue(undefined),
    clearError: vi.fn(),
    setError: vi.fn(),
    fetchExtendedInfo: vi.fn(),
    ensureMonitoring: vi.fn(),
    detectRuntimes: vi.fn().mockResolvedValue(undefined),
  };

  const mockAppState = {
    loadAllDataForSystem: vi.fn().mockResolvedValue(undefined),
    clearDataForSystem: vi.fn(),
  };

  const mockSystemService = {
    getAppSettings: vi.fn().mockResolvedValue({ sshConfigPaths: [] }),
    listSshConfigHosts: vi.fn().mockResolvedValue([]),
    getSshHostConfig: vi.fn().mockResolvedValue({}),
    storeSshCredentials: vi.fn().mockResolvedValue(undefined),
    browseSshKey: vi.fn().mockResolvedValue(null),
    browseAndImportSshKey: vi.fn().mockResolvedValue(null),
  };

  const mockKeychainService = {
    checkPlatform: vi.fn().mockResolvedValue(false),
  };

  const mockTerminalState = {
    addTerminal: vi.fn(),
    generateTerminalId: vi.fn().mockReturnValue('term-1'),
    addFileBrowser: vi.fn(),
    generateFileBrowserId: vi.fn().mockReturnValue('fb-1'),
  };

  const mockTerminalService = {
    startSession: vi.fn().mockResolvedValue({ id: 'session-1', systemId: 'sys-1' }),
  };

  const mockToastState = {
    success: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      imports: [SystemListComponent],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        { provide: SystemState, useValue: mockSystemState },
        { provide: AppState, useValue: mockAppState },
        { provide: SystemService, useValue: mockSystemService },
        { provide: KeychainService, useValue: mockKeychainService },
        { provide: TerminalState, useValue: mockTerminalState },
        { provide: TerminalService, useValue: mockTerminalService },
        { provide: ToastState, useValue: mockToastState },
      ],
    });
    const fixture = TestBed.createComponent(SystemListComponent);
    component = fixture.componentInstance;
  });

  describe('getLoadLevel', () => {
    it('returns unknown level when metrics is null', () => {
      const result = component.getLoadLevel(null);
      expect(result.level).toBe('unknown');
      expect(result.dots).toBe(0);
      expect(result.score).toBe(0);
    });

    it('returns low level for under 30% composite load', () => {
      const metrics = makeMetrics({ cpuUsagePercent: 20, memoryUsagePercent: 10 });
      const result = component.getLoadLevel(metrics);
      expect(result.level).toBe('low');
      expect(result.dots).toBe(1);
      expect(result.color).toContain('green');
    });

    it('returns medium level for 30-60% composite load', () => {
      const metrics = makeMetrics({ cpuUsagePercent: 60, memoryUsagePercent: 30 });
      const result = component.getLoadLevel(metrics);
      expect(result.level).toBe('medium');
      expect(result.dots).toBe(3);
      expect(result.color).toContain('amber');
    });

    it('returns high level for 60-85% composite load', () => {
      const metrics = makeMetrics({ cpuUsagePercent: 90, memoryUsagePercent: 70 });
      const result = component.getLoadLevel(metrics);
      expect(result.level).toBe('high');
      expect(result.dots).toBe(4);
      expect(result.color).toContain('red');
    });

    it('returns critical level for 85%+ composite load', () => {
      const metrics = makeMetrics({ cpuUsagePercent: 100, memoryUsagePercent: 100 });
      const result = component.getLoadLevel(metrics);
      expect(result.level).toBe('critical');
      expect(result.dots).toBe(5);
    });

    it('includes swap in composite score (10% weight)', () => {
      // CPU: 60*0.6 = 36, Mem: 0*0.3 = 0, Swap: 100*0.1 = 10 → total 46 → medium
      const metrics = makeMetrics({ cpuUsagePercent: 60, memoryUsagePercent: 0, swapUsagePercent: 100 });
      const result = component.getLoadLevel(metrics);
      expect(result.level).toBe('medium');
    });

    it('includes score in the tooltip text', () => {
      const metrics = makeMetrics({ cpuUsagePercent: 20, memoryUsagePercent: 0 });
      const result = component.getLoadLevel(metrics);
      expect(result.tooltip).toContain('%');
    });
  });

  describe('getOsIcon', () => {
    it('returns Linux penguin for linux', () => {
      expect(component.getOsIcon('linux')).toBe('🐧');
    });

    it('returns Apple for macos', () => {
      expect(component.getOsIcon('macos')).toBe('🍎');
    });

    it('returns Windows for windows', () => {
      expect(component.getOsIcon('windows')).toBe('🪟');
    });

    it('returns generic computer for unknown', () => {
      expect(component.getOsIcon(undefined)).toBe('💻');
    });
  });

  describe('getOsName', () => {
    it('returns "Linux" for linux', () => {
      expect(component.getOsName('linux')).toBe('Linux');
    });

    it('returns "macOS" for macos', () => {
      expect(component.getOsName('macos')).toBe('macOS');
    });

    it('returns "Windows" for windows', () => {
      expect(component.getOsName('windows')).toBe('Windows');
    });

    it('returns "Unknown" for undefined', () => {
      expect(component.getOsName(undefined)).toBe('Unknown');
    });
  });

  describe('getConnectionState', () => {
    it('delegates to systemState', () => {
      mockSystemState.getConnectionState.mockReturnValue('connected');
      expect(component.getConnectionState('sys-1')).toBe('connected');
      expect(mockSystemState.getConnectionState).toHaveBeenCalledWith('sys-1');
    });
  });

  describe('getExtendedInfo', () => {
    it('delegates to systemState', () => {
      const info = { hostname: 'server-1' } as any;
      mockSystemState.getExtendedInfo.mockReturnValue(info);
      expect(component.getExtendedInfo('sys-1')).toBe(info);
    });
  });

  describe('getLiveMetrics', () => {
    it('delegates to systemState', () => {
      const metrics = makeMetrics({ cpuUsagePercent: 50 });
      mockSystemState.getLiveMetrics.mockReturnValue(metrics);
      expect(component.getLiveMetrics('sys-1')).toBe(metrics);
    });
  });

  describe('loadDots', () => {
    it('is a static array [1, 2, 3, 4, 5]', () => {
      expect(component.loadDots).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe('addForm initial state', () => {
    it('has default values', () => {
      expect(component.addForm.connectionType).toBe('remote');
      expect(component.addForm.sshPort).toBe(22);
      expect(component.addForm.sshUsername).toBe('root');
      expect(component.addForm.primaryRuntime).toBe('docker');
      expect(component.addForm.autoConnect).toBe(true);
    });
  });
});
