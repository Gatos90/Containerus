import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { SidebarComponent } from './sidebar.component';
import { Router } from '@angular/router';
import { SystemState } from '../../state/system.state';
import { ContainerState } from '../../state/container.state';
import { TerminalState } from '../../state/terminal.state';
import { TerminalService } from '../../core/services/terminal.service';

// ─── Factory ──────────────────────────────────────────────────────────────────

function makeComponent() {
  const mockRouter: any = { navigate: vi.fn() };

  const mockSystemState: any = {
    systems: vi.fn(() => []),
    stats: vi.fn(() => ({ total: 0, connected: 0, disconnected: 0 })),
    selectedSystemId: vi.fn(() => null),
    loading: vi.fn(() => false),
    extendedInfo: vi.fn(() => ({})),
    connectedSystems: vi.fn(() => []),
    selectSystem: vi.fn(),
    disconnectSystem: vi.fn().mockResolvedValue(undefined),
    connectSystem: vi.fn().mockResolvedValue(undefined),
    getExtendedInfo: vi.fn().mockReturnValue(null),
    getLiveMetrics: vi.fn().mockReturnValue(null),
  };

  const mockContainerState: any = {
    stats: vi.fn(() => ({ total: 0, running: 0, stopped: 0, paused: 0 })),
    containers: vi.fn(() => []),
  };

  const mockTerminalState: any = {
    generateTerminalId: vi.fn().mockReturnValue('terminal-123'),
    addTerminal: vi.fn(),
  };

  const mockTerminalService: any = {
    startSession: vi.fn().mockResolvedValue({ id: 'session-1' }),
  };

  const injector = Injector.create({
    providers: [
      { provide: Router, useValue: mockRouter },
      { provide: SystemState, useValue: mockSystemState },
      { provide: ContainerState, useValue: mockContainerState },
      { provide: TerminalState, useValue: mockTerminalState },
      { provide: TerminalService, useValue: mockTerminalService },
    ],
  });

  const component = runInInjectionContext(injector, () => new SidebarComponent());
  return { component, mockRouter, mockSystemState, mockContainerState, mockTerminalState, mockTerminalService };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SidebarComponent', () => {
  describe('navItems', () => {
    it('should define all 8 nav items', () => {
      const { component } = makeComponent();
      expect(component.navItems).toHaveLength(8);
    });

    it('should include Containers route', () => {
      const { component } = makeComponent();
      expect(component.navItems.some(i => i.route === '/containers')).toBe(true);
    });

    it('should include Images route', () => {
      const { component } = makeComponent();
      expect(component.navItems.some(i => i.route === '/images')).toBe(true);
    });

    it('should include Volumes route', () => {
      const { component } = makeComponent();
      expect(component.navItems.some(i => i.route === '/volumes')).toBe(true);
    });

    it('should include Networks route', () => {
      const { component } = makeComponent();
      expect(component.navItems.some(i => i.route === '/networks')).toBe(true);
    });

    it('should include Files route', () => {
      const { component } = makeComponent();
      expect(component.navItems.some(i => i.route === '/files')).toBe(true);
    });

    it('should include Systems route', () => {
      const { component } = makeComponent();
      expect(component.navItems.some(i => i.route === '/systems')).toBe(true);
    });

    it('should include Settings route', () => {
      const { component } = makeComponent();
      expect(component.navItems.some(i => i.route === '/settings')).toBe(true);
    });
  });

  describe('mobileNavItems', () => {
    it('should return only showInMobile items', () => {
      const { component } = makeComponent();
      const mobileItems = component.mobileNavItems;
      expect(mobileItems.every(i => i.showInMobile === true)).toBe(true);
    });

    it('should include Containers, Images, and Systems in mobile nav', () => {
      const { component } = makeComponent();
      const routes = component.mobileNavItems.map(i => i.route);
      expect(routes).toContain('/containers');
      expect(routes).toContain('/images');
      expect(routes).toContain('/systems');
    });
  });

  describe('moreNavItems', () => {
    it('should return items not shown in mobile', () => {
      const { component } = makeComponent();
      const moreItems = component.moreNavItems;
      expect(moreItems.every(i => !i.showInMobile)).toBe(true);
    });

    it('should include Volumes, Networks, Files, Commands, Settings in more', () => {
      const { component } = makeComponent();
      const routes = component.moreNavItems.map(i => i.route);
      expect(routes).toContain('/volumes');
      expect(routes).toContain('/networks');
      expect(routes).toContain('/files');
      expect(routes).toContain('/settings');
    });

    it('should be complement of mobileNavItems', () => {
      const { component } = makeComponent();
      expect(component.mobileNavItems.length + component.moreNavItems.length).toBe(component.navItems.length);
    });
  });

  describe('showMoreSheet signal', () => {
    it('should default to false', () => {
      const { component } = makeComponent();
      expect(component.showMoreSheet()).toBe(false);
    });

    it('should be settable to true', () => {
      const { component } = makeComponent();
      component.showMoreSheet.set(true);
      expect(component.showMoreSheet()).toBe(true);
    });
  });

  describe('systemsExpanded signal', () => {
    it('should default to false', () => {
      const { component } = makeComponent();
      expect(component.systemsExpanded()).toBe(false);
    });

    it('should toggle via toggleSystemsExpanded', () => {
      const { component } = makeComponent();
      component.toggleSystemsExpanded();
      expect(component.systemsExpanded()).toBe(true);
      component.toggleSystemsExpanded();
      expect(component.systemsExpanded()).toBe(false);
    });
  });

  describe('reconnecting signal', () => {
    it('should default to null', () => {
      const { component } = makeComponent();
      expect(component.reconnecting()).toBeNull();
    });
  });

  describe('selectSystem', () => {
    it('should call systemState.selectSystem with the given id when not currently selected', () => {
      const { component, mockSystemState } = makeComponent();
      mockSystemState.selectedSystemId.mockReturnValue(null);
      component.selectSystem('sys-1');
      expect(mockSystemState.selectSystem).toHaveBeenCalledWith('sys-1');
    });

    it('should deselect (pass null) when the same system is already selected', () => {
      const { component, mockSystemState } = makeComponent();
      mockSystemState.selectedSystemId.mockReturnValue('sys-1');
      component.selectSystem('sys-1');
      expect(mockSystemState.selectSystem).toHaveBeenCalledWith(null);
    });
  });

  describe('disconnectSystem', () => {
    it('should call systemState.disconnectSystem', async () => {
      const { component, mockSystemState } = makeComponent();
      const event = { stopPropagation: vi.fn() } as any;
      const system: any = { id: 'sys-1', name: 'Test' };
      await component.disconnectSystem(event, system);
      expect(mockSystemState.disconnectSystem).toHaveBeenCalledWith('sys-1');
    });

    it('should stop event propagation', async () => {
      const { component } = makeComponent();
      const event = { stopPropagation: vi.fn() } as any;
      await component.disconnectSystem(event, { id: 'sys-1' } as any);
      expect(event.stopPropagation).toHaveBeenCalled();
    });
  });

  describe('openTerminal', () => {
    it('should start a terminal session and add terminal to state', async () => {
      const { component, mockTerminalService, mockTerminalState } = makeComponent();
      const event = { stopPropagation: vi.fn() } as any;
      const system: any = { id: 'sys-1', name: 'My Server' };
      await component.openTerminal(event, system);
      expect(mockTerminalService.startSession).toHaveBeenCalledWith('sys-1');
      expect(mockTerminalState.addTerminal).toHaveBeenCalledWith(
        expect.objectContaining({ systemId: 'sys-1', systemName: 'My Server' })
      );
    });

    it('should stop event propagation', async () => {
      const { component } = makeComponent();
      const event = { stopPropagation: vi.fn() } as any;
      await component.openTerminal(event, { id: 'sys-1', name: 'Server' } as any);
      expect(event.stopPropagation).toHaveBeenCalled();
    });
  });

  describe('viewSystem', () => {
    it('should navigate to /systems with system id as query param', () => {
      const { component, mockRouter } = makeComponent();
      const event = { stopPropagation: vi.fn() } as any;
      component.viewSystem(event, { id: 'sys-42', name: 'Production' } as any);
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/systems'], { queryParams: { id: 'sys-42' } });
    });

    it('should stop event propagation', () => {
      const { component } = makeComponent();
      const event = { stopPropagation: vi.fn() } as any;
      component.viewSystem(event, { id: 'sys-1' } as any);
      expect(event.stopPropagation).toHaveBeenCalled();
    });
  });

  describe('getExtendedInfo', () => {
    it('should delegate to systemState', () => {
      const { component, mockSystemState } = makeComponent();
      const info = { username: 'root', cpuCount: 4 };
      mockSystemState.getExtendedInfo.mockReturnValue(info as any);
      expect(component.getExtendedInfo('sys-1')).toBe(info);
      expect(mockSystemState.getExtendedInfo).toHaveBeenCalledWith('sys-1');
    });

    it('should return null when no info available', () => {
      const { component, mockSystemState } = makeComponent();
      mockSystemState.getExtendedInfo.mockReturnValue(null);
      expect(component.getExtendedInfo('sys-unknown')).toBeNull();
    });
  });

  describe('getOsIcon', () => {
    it('should return penguin for linux', () => {
      const { component } = makeComponent();
      expect(component.getOsIcon('linux')).toBe('🐧');
    });

    it('should return apple for macos', () => {
      const { component } = makeComponent();
      expect(component.getOsIcon('macos')).toBe('🍎');
    });

    it('should return window for windows', () => {
      const { component } = makeComponent();
      expect(component.getOsIcon('windows')).toBe('🪟');
    });

    it('should return laptop for unknown OS', () => {
      const { component } = makeComponent();
      expect(component.getOsIcon(undefined)).toBe('💻');
    });
  });

  describe('formatQuickStats', () => {
    it('should return empty string for null', () => {
      const { component } = makeComponent();
      expect(component.formatQuickStats(null)).toBe('');
    });

    it('should format username, cpu, and memory with dots', () => {
      const { component } = makeComponent();
      const info: any = { username: 'admin', cpuCount: 8, totalMemory: '16 GB' };
      const result = component.formatQuickStats(info);
      expect(result).toBe('admin · 8 cores · 16 GB');
    });

    it('should omit missing fields', () => {
      const { component } = makeComponent();
      const info: any = { username: 'deploy' };
      expect(component.formatQuickStats(info)).toBe('deploy');
    });
  });

  describe('formatDiskUsage', () => {
    it('should return empty string for null info', () => {
      const { component } = makeComponent();
      expect(component.formatDiskUsage(null)).toBe('');
    });

    it('should return empty string when diskUsagePercent is falsy', () => {
      const { component } = makeComponent();
      expect(component.formatDiskUsage({} as any)).toBe('');
    });

    it('should format disk percent correctly', () => {
      const { component } = makeComponent();
      expect(component.formatDiskUsage({ diskUsagePercent: 72 } as any)).toBe('72% disk');
    });
  });

  describe('getMetricBarClass', () => {
    it('should return blue for low values', () => {
      const { component } = makeComponent();
      expect(component.getMetricBarClass(50)).toBe('bg-blue-500');
    });

    it('should return amber for medium values', () => {
      const { component } = makeComponent();
      expect(component.getMetricBarClass(75)).toBe('bg-amber-500');
    });

    it('should return red for high values', () => {
      const { component } = makeComponent();
      expect(component.getMetricBarClass(90)).toBe('bg-red-500');
    });
  });

  describe('getMetricTextClass', () => {
    it('should return zinc for low values', () => {
      const { component } = makeComponent();
      expect(component.getMetricTextClass(40)).toBe('text-zinc-300');
    });

    it('should return amber text for medium values', () => {
      const { component } = makeComponent();
      expect(component.getMetricTextClass(80)).toBe('text-amber-500');
    });

    it('should return red text for high values', () => {
      const { component } = makeComponent();
      expect(component.getMetricTextClass(95)).toBe('text-red-500');
    });
  });

  describe('getLoadLevel', () => {
    it('should return low level for null loadAvg', () => {
      const { component } = makeComponent();
      const result = component.getLoadLevel(null, 4);
      expect(result.level).toBe('low');
    });

    it('should return low level for null cpuCount', () => {
      const { component } = makeComponent();
      const result = component.getLoadLevel([0.5, 0.5, 0.5], null);
      expect(result.level).toBe('low');
    });

    it('should return low level for load < 0.5 per core', () => {
      const { component } = makeComponent();
      const result = component.getLoadLevel([1.0, 0.8, 0.6], 4);
      expect(result.level).toBe('low');
      expect(result.dots).toBe(1);
    });

    it('should return medium level for load between 0.5 and 1.0 per core', () => {
      const { component } = makeComponent();
      const result = component.getLoadLevel([3.0, 2.5, 2.0], 4); // 0.75 per core
      expect(result.level).toBe('medium');
      expect(result.dots).toBe(3);
    });

    it('should return high level for load between 1.0 and 2.0 per core', () => {
      const { component } = makeComponent();
      const result = component.getLoadLevel([5.0, 4.0, 3.0], 4); // 1.25 per core
      expect(result.level).toBe('high');
      expect(result.dots).toBe(4);
    });

    it('should return critical level for load >= 2.0 per core', () => {
      const { component } = makeComponent();
      const result = component.getLoadLevel([16.0, 12.0, 8.0], 4); // 4 per core
      expect(result.level).toBe('critical');
      expect(result.dots).toBe(5);
    });
  });

  describe('reconnectSystem', () => {
    it('should set reconnecting to system id during reconnect', async () => {
      const { component, mockSystemState } = makeComponent();
      const event = { stopPropagation: vi.fn() } as any;
      const system: any = { id: 'sys-2', name: 'Staging' };

      let capturedId: string | null = null;
      mockSystemState.connectSystem.mockImplementation(async (id: string) => {
        capturedId = component.reconnecting();
        return undefined;
      });

      await component.reconnectSystem(event, system);
      expect(capturedId).toBe('sys-2');
    });

    it('should clear reconnecting to null after reconnect succeeds', async () => {
      const { component } = makeComponent();
      const event = { stopPropagation: vi.fn() } as any;
      await component.reconnectSystem(event, { id: 'sys-2' } as any);
      expect(component.reconnecting()).toBeNull();
    });

    it('should clear reconnecting even if connectSystem throws', async () => {
      const { component, mockSystemState } = makeComponent();
      mockSystemState.connectSystem.mockRejectedValue(new Error('timeout'));
      const event = { stopPropagation: vi.fn() } as any;
      await expect(component.reconnectSystem(event, { id: 'sys-2' } as any)).rejects.toThrow('timeout');
      expect(component.reconnecting()).toBeNull();
    });

    it('should stop event propagation', async () => {
      const { component } = makeComponent();
      const event = { stopPropagation: vi.fn() } as any;
      await component.reconnectSystem(event, { id: 'sys-1' } as any);
      expect(event.stopPropagation).toHaveBeenCalled();
    });
  });

  describe('getLiveMetrics', () => {
    it('should delegate to systemState', () => {
      const { component, mockSystemState } = makeComponent();
      const metrics: any = { cpuPercent: 42.5, memoryPercent: 60.0 };
      mockSystemState.getLiveMetrics.mockReturnValue(metrics);
      expect(component.getLiveMetrics('sys-1')).toBe(metrics);
      expect(mockSystemState.getLiveMetrics).toHaveBeenCalledWith('sys-1');
    });

    it('should return null when no metrics', () => {
      const { component, mockSystemState } = makeComponent();
      mockSystemState.getLiveMetrics.mockReturnValue(null);
      expect(component.getLiveMetrics('sys-none')).toBeNull();
    });
  });

  describe('loadDots', () => {
    it('should be [1, 2, 3, 4, 5]', () => {
      const { component } = makeComponent();
      expect(component.loadDots).toEqual([1, 2, 3, 4, 5]);
    });
  });
});
