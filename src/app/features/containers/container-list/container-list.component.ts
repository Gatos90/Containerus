import { CommonModule } from '@angular/common';
import { Component, computed, HostListener, inject, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
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
  Cloud,
  Loader2,
  Ship,
  Box,
  Apple,
  Server,
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
import { PodLogsViewerModalComponent } from '../components/pod-logs-viewer-modal/pod-logs-viewer-modal.component';
import { ToastState } from '../../../state/toast.state';
import { TerminalState, DockedFileBrowser, DEFAULT_TERMINAL_OPTIONS } from '../../../state/terminal.state';
import { TerminalService } from '../../../core/services/terminal.service';
import { BackendService } from '../../../core/services/backend.service';
import { K8sCluster, K8sPod } from '../../../core/models/backend.model';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { HelpTooltipComponent } from '../../../shared/components/help-tooltip/help-tooltip.component';
import { Router } from '@angular/router';

interface PodEntry {
  pod: K8sPod;
  clusterName: string;
  clusterId: string;
  connectionId: string;
}

export type Workload =
  | { kind: 'container'; container: Container }
  | { kind: 'pod'; pod: K8sPod; clusterName: string; clusterId: string; connectionId: string };

@Component({
  selector: 'app-container-list',
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    PortSectionComponent,
    PortBadgeComponent,
    ContainerDetailsComponent,
    ContainerDetailModalComponent,
    LogsViewerModalComponent,
    PodLogsViewerModalComponent,
    EmptyStateComponent,
    HelpTooltipComponent,
  ],
  templateUrl: './container-list.component.html',
  host: {
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class ContainerListComponent implements OnInit {
  readonly containerState = inject(ContainerState);
  readonly systemState = inject(SystemState);
  readonly portForwardState = inject(PortForwardState);
  private readonly toast = inject(ToastState);
  private readonly terminalState = inject(TerminalState);
  private readonly terminalService = inject(TerminalService);
  readonly backend = inject(BackendService);
  private readonly router = inject(Router);

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
  readonly Cloud = Cloud;
  readonly Loader2 = Loader2;
  readonly Ship = Ship;
  readonly Box = Box;
  readonly Apple = Apple;
  readonly Server = Server;

  // Helper functions
  readonly getDisplayName = getDisplayName;
  readonly getStatusColor = getStatusColor;
  readonly getStatusText = getStatusText;
  readonly getRelativeTime = getRelativeTime;
  readonly formatPort = formatPort;
  readonly getAvailableActions = getAvailableActions;
  readonly isRunning = isRunning;

  getRuntimeIcon(runtime: string): LucideIconData {
    switch (runtime) {
      case 'docker': return Ship;
      case 'podman': return Box;
      case 'apple': return Apple;
      case 'kubernetes': return Cloud;
      default: return Box;
    }
  }

  getRuntimeColor(runtime: string): string {
    switch (runtime) {
      case 'docker': return 'text-blue-400';
      case 'podman': return 'text-indigo-400';
      case 'apple': return 'text-zinc-400';
      case 'kubernetes': return 'text-purple-400';
      default: return 'text-zinc-500';
    }
  }

  // Runtime filter dropdown
  showRuntimeDropdown = signal(false);
  readonly runtimeOptions = [
    { value: 'docker', label: 'Docker' },
    { value: 'podman', label: 'Podman' },
    { value: 'apple', label: 'Apple' },
    { value: 'kubernetes', label: 'Kubernetes' },
  ];

  toggleRuntimeDropdown(): void {
    this.showRuntimeDropdown.update(v => !v);
  }

  selectRuntimeFilter(value: string | null): void {
    this.containerState.setRuntimeFilter(value as any);
    this.showRuntimeDropdown.set(false);
  }

  runtimeLabel(value: string): string {
    return this.runtimeOptions.find(o => o.value === value)?.label ?? value;
  }

  // System filter dropdown
  showSystemDropdown = signal(false);

  availableClusters = computed(() => {
    const pods = this.backendPods();
    const seen = new Map<string, { clusterId: string; clusterName: string; connectionId: string }>();
    for (const pe of pods) {
      if (!seen.has(pe.clusterId)) {
        seen.set(pe.clusterId, { clusterId: pe.clusterId, clusterName: pe.clusterName, connectionId: pe.connectionId });
      }
    }
    return [...seen.values()];
  });

  selectedSystemDisplay = computed(() => {
    const id = this.containerState.systemFilter();
    if (!id) return null;
    if (id.startsWith('cluster:')) {
      const clusterId = id.slice('cluster:'.length);
      const c = this.availableClusters().find(c => c.clusterId === clusterId);
      if (c) return { name: c.clusterName, primaryRuntime: 'kubernetes', hostname: 'Kubernetes' } as any;
      return null;
    }
    return this.systemState.connectedSystems().find(s => s.id === id) ?? null;
  });

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.system-dropdown-wrapper')) {
      this.showSystemDropdown.set(false);
    }
    if (!target.closest('.runtime-dropdown-wrapper')) {
      this.showRuntimeDropdown.set(false);
    }
  }

  toggleSystemDropdown(): void {
    this.showSystemDropdown.update(v => !v);
  }

  selectSystemFilter(id: string | null): void {
    this.containerState.setSystemFilter(id);
    this.showSystemDropdown.set(false);
  }

  // Containers with active port forwards (for top section)
  readonly containersWithForwards = computed(() => {
    const activeForwards = this.portForwardState.activeForwards();
    if (activeForwards.length === 0) return [];
    const containerIds = new Set(activeForwards.map(f => f.containerId));
    return this.containerState.filteredContainers()
      .filter(c => containerIds.has(c.id));
  });

  // K8s pod state (local, not global)
  backendPods = signal<PodEntry[]>([]);
  podsLoading = signal(false);
  podActionLoading = signal<Set<string>>(new Set());

  workloads = computed<Workload[]>(() => {
    const containerWorkloads: Workload[] = this.containerState.filteredContainers()
      .map(c => ({ kind: 'container' as const, container: c }));

    let pods = this.backendPods();

    // Apply search filter
    const query = this.containerState.searchQuery()?.toLowerCase().trim();
    if (query) {
      pods = pods.filter(pe =>
        pe.pod.name.toLowerCase().includes(query) ||
        pe.pod.namespace.toLowerCase().includes(query) ||
        pe.clusterName.toLowerCase().includes(query)
      );
    }

    // Apply status filter (map pod statuses to container filter values)
    const statusFilter = this.containerState.statusFilter();
    if (statusFilter) {
      const podStatusMap: Record<string, string[]> = {
        'running': ['Running'],
        'exited': ['Failed', 'Succeeded'],
        'created': ['Pending'],
        'paused': [],
      };
      const allowedPodStatuses = podStatusMap[statusFilter] ?? [];
      pods = pods.filter(pe => allowedPodStatuses.includes(pe.pod.status));
    }

    // Apply system filter
    const systemFilter = this.containerState.systemFilter();
    if (systemFilter) {
      if (systemFilter.startsWith('cluster:')) {
        // Filter pods to a specific K8s cluster
        const clusterId = systemFilter.slice('cluster:'.length);
        pods = pods.filter(pe => pe.clusterId === clusterId);
      } else {
        // SSH system selected — only show containers, not K8s pods
        pods = [];
      }
    }

    // Apply runtime filter — show pods only when 'kubernetes' or no filter is active
    const runtimeFilter = this.containerState.runtimeFilter();
    if (runtimeFilter && runtimeFilter !== 'kubernetes') {
      pods = [];
    }

    const podWorkloads: Workload[] = pods.map(pe => ({
      kind: 'pod' as const,
      pod: pe.pod,
      clusterName: pe.clusterName,
      clusterId: pe.clusterId,
      connectionId: pe.connectionId,
    }));

    // Combine and sort together
    const all = [...containerWorkloads, ...podWorkloads];
    const sortOption = this.containerState.sortOption();
    return all.sort((a, b) => {
      const nameA = a.kind === 'container' ? a.container.name : a.pod.name;
      const nameB = b.kind === 'container' ? b.container.name : b.pod.name;
      switch (sortOption) {
        case 'name': return nameA.localeCompare(nameB);
        case 'status': {
          const statusA = a.kind === 'container' ? a.container.status : a.pod.status.toLowerCase();
          const statusB = b.kind === 'container' ? b.container.status : b.pod.status.toLowerCase();
          return statusA.localeCompare(statusB);
        }
        case 'created': {
          const dateA = a.kind === 'container' ? new Date(a.container.createdAt).getTime()
            : (a.pod.creationTimestamp ? new Date(a.pod.creationTimestamp).getTime() : 0);
          const dateB = b.kind === 'container' ? new Date(b.container.createdAt).getTime()
            : (b.pod.creationTimestamp ? new Date(b.pod.creationTimestamp).getTime() : 0);
          return dateB - dateA;
        }
        default: return 0;
      }
    });
  });

  podStats = computed(() => {
    const all = this.backendPods();
    return {
      total: all.length,
      running: all.filter(pe => pe.pod.status === 'Running').length,
      pending: all.filter(pe => pe.pod.status === 'Pending').length,
      failed: all.filter(pe => pe.pod.status === 'Failed' || pe.pod.status === 'Succeeded').length,
    };
  });

  combinedStats = computed(() => {
    const cs = this.containerState.stats();
    const ps = this.podStats();
    return {
      total: cs.total + ps.total,
      running: cs.running + ps.running,
      stopped: cs.stopped + ps.failed,
      paused: cs.paused,
    };
  });

  // Component state
  private refreshing = false;
  viewMode = signal<'grid' | 'list'>('grid');
  expandedContainerId = signal<string | null>(null);
  modalContainer = signal<Container | null>(null);
  logsContainer = signal<Container | null>(null);
  logsPod = signal<(Workload & { kind: 'pod' }) | null>(null);
  expandedPodKey = signal<string | null>(null);
  modalPod = signal<(Workload & { kind: 'pod' }) | null>(null);
  podDetail = signal<any>(null);
  podDetailLoading = signal(false);
  showMobileFilters = signal(false);

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  isRefreshing(): boolean {
    return this.refreshing;
  }

  goToSystems(): void {
    this.router.navigate(['/systems']);
  }

  goToImages(): void {
    this.router.navigate(['/images']);
  }

  async refresh(): Promise<void> {
    this.refreshing = true;
    try {
      const systemIds = this.systemState.connectedSystems().map((s) => s.id);
      await Promise.all([
        this.containerState.loadContainersForSystems(systemIds),
        this.loadBackendPods(),
      ]);
    } finally {
      this.refreshing = false;
    }
  }

  async loadBackendPods(): Promise<void> {
    await this.backend.waitForReady();
    const connections = this.backend.connectedBackends();
    if (connections.length === 0) {
      this.backendPods.set([]);
      return;
    }
    this.podsLoading.set(true);
    try {
      const allPods: PodEntry[] = [];
      await Promise.all(connections.map(async (conn) => {
        try {
          const clusters = await this.backend.listAllClustersFor(conn.id);
          await Promise.all(clusters.map(async (cluster) => {
            try {
              const namespaces = await this.backend.listNamespacesFor(conn.id, cluster.id);
              await Promise.all(namespaces.map(async (ns) => {
                try {
                  const pods = await this.backend.listPodsFor(conn.id, cluster.id, ns.name);
                  allPods.push(...pods.map(pod => ({
                    pod,
                    clusterName: cluster.name,
                    clusterId: cluster.id,
                    connectionId: conn.id,
                  })));
                } catch { /* skip namespace */ }
              }));
            } catch { /* skip cluster */ }
          }));
        } catch { /* skip connection */ }
      }));
      this.backendPods.set(allPods);
    } finally {
      this.podsLoading.set(false);
    }
  }

  setStoppedFilter(): void {
    this.containerState.setStatusFilter('exited');
  }

  confirmAction = signal<{ container: Container; action: ContainerAction } | null>(null);

  async performAction(container: Container, action: ContainerAction): Promise<void> {
    const destructive: ContainerAction[] = ['stop', 'remove'];
    if (destructive.includes(action)) {
      this.confirmAction.set({ container, action });
      return;
    }
    await this.executeAction(container, action);
  }

  async confirmAndExecute(): Promise<void> {
    const pending = this.confirmAction();
    if (!pending) return;
    this.confirmAction.set(null);
    await this.executeAction(pending.container, pending.action);
  }

  cancelAction(): void {
    this.confirmAction.set(null);
  }

  onEscape(): void {
    if (this.showMobileFilters()) {
      this.showMobileFilters.set(false);
    } else if (this.confirmAction()) {
      this.confirmAction.set(null);
    }
  }

  private async executeAction(container: Container, action: ContainerAction): Promise<void> {
    const name = getDisplayName(container);
    const success = await this.containerState.performAction(container, action);
    if (success) {
      this.toast.success(`${action.charAt(0).toUpperCase() + action.slice(1)}${action.endsWith('e') ? 'd' : 'ed'} ${name}`);
    } else {
      this.toast.error(`Failed to ${action} ${name}`);
    }
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

  async dockTerminal(container: Container): Promise<void> {
    const system = this.systemState.systems().find(s => s.id === container.systemId);
    if (!system) return;
    try {
      const session = await this.terminalService.startSession(container.systemId, container.id, '/bin/sh', 80, 24, container.runtime);
      this.terminalState.addTerminal({
        id: this.terminalState.generateTerminalId(),
        session,
        systemId: container.systemId,
        systemName: system.name,
        containerName: getDisplayName(container),
        serializedState: '',
        terminalOptions: DEFAULT_TERMINAL_OPTIONS,
      });
    } catch (err: any) {
      this.toast.error(`Failed to open terminal: ${err?.message ?? err}`);
    }
  }

  dockFileBrowser(container: Container): void {
    const system = this.systemState.systems().find(s => s.id === container.systemId);
    if (!system) return;
    const fb: DockedFileBrowser = {
      id: this.terminalState.generateFileBrowserId(),
      systemId: container.systemId,
      systemName: system.name,
      containerId: container.id,
      containerName: getDisplayName(container),
      runtime: container.runtime,
      currentPath: '/',
    };
    this.terminalState.addFileBrowser(fb);
  }

  dockPodFileBrowser(workload: Workload & { kind: 'pod' }): void {
    const fb: DockedFileBrowser = {
      id: this.terminalState.generateFileBrowserId(),
      systemId: '',
      systemName: workload.clusterName,
      containerName: workload.pod.name,
      currentPath: '/',
      podContext: {
        connectionId: workload.connectionId,
        clusterId: workload.clusterId,
        namespace: workload.pod.namespace,
        podName: workload.pod.name,
        containerName: workload.pod.containerNames?.[0],
        clusterName: workload.clusterName,
      },
    };
    this.terminalState.addFileBrowser(fb);
  }

  // K8s pod actions

  showPodLogs(workload: Workload & { kind: 'pod' }): void {
    this.logsPod.set(workload);
  }

  closePodLogs(): void {
    this.logsPod.set(null);
  }

  togglePodDetails(workload: Workload & { kind: 'pod' }): void {
    const key = this.getPodKey(workload);
    this.expandedPodKey.set(this.expandedPodKey() === key ? null : key);
  }

  getPodKey(workload: Workload & { kind: 'pod' }): string {
    return `${workload.connectionId}/${workload.clusterId}/${workload.pod.namespace}/${workload.pod.name}`;
  }

  async openPodModal(workload: Workload & { kind: 'pod' }): Promise<void> {
    this.modalPod.set(workload);
    this.podDetail.set(null);
    this.podDetailLoading.set(true);
    try {
      const raw = await this.backend.getK8sResourceFor(
        workload.connectionId, workload.clusterId,
        'pods', workload.pod.name, workload.pod.namespace
      );
      this.podDetail.set(raw);
    } catch { /* show what we have */ }
    finally { this.podDetailLoading.set(false); }
  }

  closePodModal(): void {
    this.modalPod.set(null);
    this.podDetail.set(null);
  }

  async dockPodTerminal(workload: Workload & { kind: 'pod' }): Promise<void> {
    try {
      const session = await this.terminalService.startK8sExecSession(
        workload.connectionId,
        workload.clusterId,
        workload.pod.namespace,
        workload.pod.name,
        undefined,
        '/bin/sh',
        80,
        24,
      );
      this.terminalState.addTerminal({
        id: this.terminalState.generateTerminalId(),
        session,
        systemId: session.systemId,
        systemName: workload.clusterName,
        containerName: workload.pod.name,
        serializedState: '',
        terminalOptions: DEFAULT_TERMINAL_OPTIONS,
      });
    } catch (err: any) {
      this.toast.error(`Failed to open pod terminal: ${err?.message ?? err}`);
    }
  }

  // K8s pod helpers

  trackWorkload(index: number, workload: Workload): string {
    if (workload.kind === 'container') return workload.container.id;
    return `pod:${workload.connectionId}/${workload.clusterId}/${workload.pod.namespace}/${workload.pod.name}`;
  }

  async deletePod(workload: Workload & { kind: 'pod' }): Promise<void> {
    const key = `pod:${workload.connectionId}/${workload.clusterId}/${workload.pod.namespace}/${workload.pod.name}`;
    if (!confirm(`Delete pod "${workload.pod.name}" in namespace "${workload.pod.namespace}"? This action cannot be undone.`)) {
      return;
    }
    this.podActionLoading.update(s => { const n = new Set(s); n.add(key); return n; });
    try {
      await this.backend.deleteK8sResourceFor(
        workload.connectionId,
        workload.clusterId,
        'pods',
        workload.pod.name,
        workload.pod.namespace,
      );
      this.toast.success(`Deleted pod ${workload.pod.name}`);
      await this.loadBackendPods();
    } catch (e: any) {
      this.toast.error(`Failed to delete pod: ${e?.message ?? e}`);
    } finally {
      this.podActionLoading.update(s => { const n = new Set(s); n.delete(key); return n; });
    }
  }

  isPodActionLoading(workload: Workload & { kind: 'pod' }): boolean {
    const key = `pod:${workload.connectionId}/${workload.clusterId}/${workload.pod.namespace}/${workload.pod.name}`;
    return this.podActionLoading().has(key);
  }

  getPodStatusClass(status: string): string {
    switch (status) {
      case 'Running': return 'bg-green-500/20 text-green-400';
      case 'Pending': return 'bg-yellow-500/20 text-yellow-400';
      case 'Failed': return 'bg-red-500/20 text-red-400';
      case 'Succeeded': return 'bg-blue-500/20 text-blue-400';
      default: return 'bg-zinc-700 text-zinc-400';
    }
  }

  getPodStatusDot(status: string): string {
    switch (status) {
      case 'Running': return 'bg-green-400';
      case 'Pending': return 'bg-yellow-400';
      case 'Failed': return 'bg-red-400';
      case 'Succeeded': return 'bg-blue-400';
      default: return 'bg-zinc-500';
    }
  }

  getPodStatusTextClass(status: string): string {
    switch (status) {
      case 'Running': return 'text-green-400';
      case 'Pending': return 'text-yellow-400';
      case 'Failed': return 'text-red-400';
      case 'Succeeded': return 'text-blue-400';
      default: return 'text-zinc-400';
    }
  }
}
