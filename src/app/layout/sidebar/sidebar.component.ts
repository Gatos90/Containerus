import { CommonModule, DecimalPipe } from '@angular/common';
import { Component, inject, signal, computed } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { LucideAngularModule, LucideIconData, Box, Image, HardDrive, Network, Server, Settings, MoreHorizontal, Command, ChevronDown, ChevronUp, Terminal, Unplug, ExternalLink, Crown, ShieldCheck, Activity, Cpu, MemoryStick } from 'lucide-angular';
import { SystemState } from '../../state/system.state';
import { ContainerState } from '../../state/container.state';
import { ContainerSystem, ExtendedSystemInfo, LiveSystemMetrics, OsType } from '../../core/models/system.model';

export interface LoadLevelInfo {
  level: 'low' | 'medium' | 'high' | 'critical';
  label: string;
  dots: number;
  color: string;
  bgColor: string;
  tooltip: string;
}

interface NavItem {
  label: string;
  route: string;
  icon: LucideIconData;
  badge?: () => number | null;
  showInMobile?: boolean;
}

@Component({
  selector: 'app-sidebar',
  imports: [CommonModule, RouterLink, RouterLinkActive, LucideAngularModule, DecimalPipe],
  templateUrl: './sidebar.component.html',
})
export class SidebarComponent {
  private router = inject(Router);
  readonly systemState = inject(SystemState);
  readonly containerState = inject(ContainerState);

  // State for "More" bottom sheet
  showMoreSheet = signal(false);

  // State for connected systems expansion
  systemsExpanded = signal(false);

  readonly Box = Box;
  readonly Image = Image;
  readonly HardDrive = HardDrive;
  readonly Network = Network;
  readonly Server = Server;
  readonly Command = Command;
  readonly Settings = Settings;
  readonly MoreHorizontal = MoreHorizontal;
  readonly ChevronDown = ChevronDown;
  readonly ChevronUp = ChevronUp;
  readonly Terminal = Terminal;
  readonly Unplug = Unplug;
  readonly ExternalLink = ExternalLink;
  readonly Crown = Crown;
  readonly ShieldCheck = ShieldCheck;
  readonly Activity = Activity;
  readonly Cpu = Cpu;
  readonly MemoryStick = MemoryStick;

  navItems: NavItem[] = [
    {
      label: 'Containers',
      route: '/containers',
      icon: Box,
      badge: () => this.containerState.stats().total,
      showInMobile: true,
    },
    {
      label: 'Images',
      route: '/images',
      icon: Image,
      showInMobile: true,
    },
    {
      label: 'Volumes',
      route: '/volumes',
      icon: HardDrive,
    },
    {
      label: 'Networks',
      route: '/networks',
      icon: Network,
    },
    {
      label: 'Systems',
      route: '/systems',
      icon: Server,
      badge: () => this.systemState.stats().connected,
      showInMobile: true,
    },
    {
      label: 'Commands',
      route: '/commands',
      icon: Command,
    },
    {
      label: 'Settings',
      route: '/settings',
      icon: Settings,
    },
  ];

  // Mobile nav shows only essential items (max 5 for bottom nav)
  get mobileNavItems(): NavItem[] {
    return this.navItems.filter(item => item.showInMobile);
  }

  // Items that appear in the "More" sheet
  get moreNavItems(): NavItem[] {
    return this.navItems.filter(item => !item.showInMobile);
  }

  selectSystem(systemId: string): void {
    const current = this.systemState.selectedSystemId();
    this.systemState.selectSystem(current === systemId ? null : systemId);
  }

  toggleSystemsExpanded(): void {
    this.systemsExpanded.update(v => !v);
  }

  async disconnectSystem(event: Event, system: ContainerSystem): Promise<void> {
    event.stopPropagation();
    await this.systemState.disconnectSystem(system.id);
  }

  openTerminal(event: Event, system: ContainerSystem): void {
    event.stopPropagation();
    this.systemState.selectSystem(system.id);
    this.router.navigate(['/commands']);
  }

  viewSystem(event: Event, system: ContainerSystem): void {
    event.stopPropagation();
    this.router.navigate(['/systems'], { queryParams: { id: system.id } });
  }

  /**
   * Get extended info for a system
   */
  getExtendedInfo(systemId: string): ExtendedSystemInfo | null {
    return this.systemState.getExtendedInfo(systemId);
  }

  /**
   * Get OS icon (emoji) for a system
   */
  getOsIcon(osType: OsType | undefined): string {
    switch (osType) {
      case 'linux':
        return '🐧';
      case 'macos':
        return '🍎';
      case 'windows':
        return '🪟';
      default:
        return '💻';
    }
  }

  /**
   * Format quick stats line for a system
   */
  formatQuickStats(info: ExtendedSystemInfo | null): string {
    if (!info) return '';

    const parts: string[] = [];

    // Username
    if (info.username) {
      parts.push(info.username);
    }

    // CPU count
    if (info.cpuCount) {
      parts.push(`${info.cpuCount} cores`);
    }

    // Memory
    if (info.totalMemory) {
      parts.push(info.totalMemory);
    }

    return parts.join(' · ');
  }

  /**
   * Format disk usage display
   */
  formatDiskUsage(info: ExtendedSystemInfo | null): string {
    if (!info?.diskUsagePercent) return '';
    return `${info.diskUsagePercent}% disk`;
  }

  /**
   * Get live metrics for a system
   */
  getLiveMetrics(systemId: string): LiveSystemMetrics | null {
    return this.systemState.getLiveMetrics(systemId);
  }

  /**
   * Get CSS class for metric bar based on percentage value
   */
  getMetricBarClass(value: number, thresholds: [number, number] = [70, 85]): string {
    if (value >= thresholds[1]) return 'bg-red-500';
    if (value >= thresholds[0]) return 'bg-amber-500';
    return 'bg-blue-500';
  }

  /**
   * Get CSS class for metric text based on percentage value
   */
  getMetricTextClass(value: number, thresholds: [number, number] = [70, 85]): string {
    if (value >= thresholds[1]) return 'text-red-500';
    if (value >= thresholds[0]) return 'text-amber-500';
    return 'text-zinc-300';
  }

  /**
   * Load level info for display
   */
  getLoadLevel(loadAvg: [number, number, number] | null | undefined, cpuCount: number | null | undefined): LoadLevelInfo {
    if (!loadAvg || !cpuCount || cpuCount === 0) {
      return { level: 'low', label: 'Low', dots: 1, color: 'text-green-500', bgColor: 'bg-green-500', tooltip: 'Low: System is mostly idle (~0% CPU capacity)' };
    }

    const loadPerCore = loadAvg[0] / cpuCount;
    const capacityPercent = Math.round(loadPerCore * 100);

    if (loadPerCore < 0.5) {
      return { level: 'low', label: 'Low', dots: 1, color: 'text-green-500', bgColor: 'bg-green-500', tooltip: `Low: System is mostly idle (~${capacityPercent}% CPU capacity)` };
    }
    if (loadPerCore < 1.0) {
      return { level: 'medium', label: 'Medium', dots: 3, color: 'text-amber-500', bgColor: 'bg-amber-500', tooltip: `Medium: Healthy utilization (~${capacityPercent}% CPU capacity)` };
    }
    if (loadPerCore < 2.0) {
      return { level: 'high', label: 'High', dots: 4, color: 'text-red-500', bgColor: 'bg-red-500', tooltip: `High: System is busy (~${capacityPercent}% CPU capacity - tasks queuing)` };
    }
    return { level: 'critical', label: 'Critical', dots: 5, color: 'text-red-600', bgColor: 'bg-red-600', tooltip: `Critical: System is overloaded! (~${capacityPercent}% CPU capacity)` };
  }

  /** Array for load dots rendering */
  readonly loadDots = [1, 2, 3, 4, 5];
}
