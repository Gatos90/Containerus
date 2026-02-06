import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  LucideAngularModule,
  LucideIconData,
  Play,
  Square,
  RotateCcw,
  Pause,
  PlayCircle,
  Trash2,
  Terminal,
  FileText,
  Search,
  RefreshCw,
  Info,
  Circle,
  ArrowLeftRight,
  ChevronDown,
  Layers,
  LayoutGrid,
  List,
  Maximize2,
  SlidersHorizontal,
  X,
  Link,
  FolderOpen,
} from 'lucide-angular';
import {
  Container,
  ContainerAction,
  getAvailableActions,
  getDisplayName,
  getRelativeTime,
  getStatusColor,
  getStatusText,
  formatPort,
  isRunning,
} from '../../../core/models/container.model';
import { ContainerState, SortOption } from '../../../state/container.state';
import { SystemState } from '../../../state/system.state';
import { PortForwardState } from '../../../state/port-forward.state';
import { PortSectionComponent } from '../components/port-section/port-section.component';
import { PortBadgeComponent } from '../components/port-badge/port-badge.component';
import { ContainerDetailsComponent } from '../components/container-details/container-details.component';
import { ContainerDetailModalComponent } from '../components/container-detail-modal/container-detail-modal.component';
import { LogsViewerModalComponent } from '../components/logs-viewer-modal/logs-viewer-modal.component';

@Component({
  selector: 'app-container-list',
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    LucideAngularModule,
    PortSectionComponent,
    PortBadgeComponent,
    ContainerDetailsComponent,
    ContainerDetailModalComponent,
    LogsViewerModalComponent,
  ],
  templateUrl: './container-list.component.html',
})
export class ContainerListComponent implements OnInit {
  readonly containerState = inject(ContainerState);
  readonly systemState = inject(SystemState);
  readonly portForwardState = inject(PortForwardState);

  // Lucide icons
  readonly Play = Play;
  readonly Square = Square;
  readonly RotateCcw = RotateCcw;
  readonly Pause = Pause;
  readonly PlayCircle = PlayCircle;
  readonly Trash2 = Trash2;
  readonly Terminal = Terminal;
  readonly FileText = FileText;
  readonly FolderOpen = FolderOpen;
  readonly Search = Search;
  readonly RefreshCw = RefreshCw;
  readonly Info = Info;
  readonly Circle = Circle;
  readonly ArrowLeftRight = ArrowLeftRight;
  readonly ChevronDown = ChevronDown;
  readonly Layers = Layers;
  readonly LayoutGrid = LayoutGrid;
  readonly List = List;
  readonly Maximize2 = Maximize2;
  readonly SlidersHorizontal = SlidersHorizontal;
  readonly X = X;
  readonly Link = Link;

  // Helper functions
  readonly getDisplayName = getDisplayName;
  readonly getStatusColor = getStatusColor;
  readonly getStatusText = getStatusText;
  readonly getRelativeTime = getRelativeTime;
  readonly formatPort = formatPort;
  readonly getAvailableActions = getAvailableActions;
  readonly isRunning = isRunning;

  // Containers with active port forwards (for top section)
  readonly containersWithForwards = computed(() => {
    const activeForwards = this.portForwardState.activeForwards();
    if (activeForwards.length === 0) return [];
    const containerIds = new Set(activeForwards.map(f => f.containerId));
    return this.containerState.filteredContainers()
      .filter(c => containerIds.has(c.id));
  });

  // Component state
  private refreshing = false;
  viewMode = signal<'grid' | 'list'>('grid');
  expandedContainerId = signal<string | null>(null);
  modalContainer = signal<Container | null>(null);
  logsContainer = signal<Container | null>(null);
  showMobileFilters = signal(false);

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  isRefreshing(): boolean {
    return this.refreshing;
  }

  async refresh(): Promise<void> {
    this.refreshing = true;
    try {
      const systemIds = this.systemState.connectedSystems().map((s) => s.id);
      await this.containerState.loadContainersForSystems(systemIds);
    } finally {
      this.refreshing = false;
    }
  }

  setStoppedFilter(): void {
    this.containerState.setStatusFilter('exited');
  }

  async performAction(container: Container, action: ContainerAction): Promise<void> {
    await this.containerState.performAction(container, action);
  }

  showLogs(container: Container): void {
    this.logsContainer.set(container);
  }

  closeLogs(): void {
    this.logsContainer.set(null);
  }

  toggleDetails(container: Container): void {
    if (this.expandedContainerId() === container.id) {
      this.expandedContainerId.set(null);
    } else {
      this.expandedContainerId.set(container.id);
    }
  }

  openModal(container: Container): void {
    this.modalContainer.set(container);
  }

  closeModal(): void {
    this.modalContainer.set(null);
  }
}
