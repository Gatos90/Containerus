import {
  Component,
  inject,
  signal,
  computed,
  Input,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  Box,
  Cloud,
  Loader2,
  RefreshCw,
  Search,
  Square,
  Play,
  RotateCcw,
  Trash2,
  Server,
  AlertCircle,
} from 'lucide-angular';
import { BackendService } from '../../../core/services/backend.service';
import {
  BackendSystem,
  K8sCluster,
  K8sNamespace,
  K8sPod,
  K8sDeployment,
  K8sService as K8sSvc,
} from '../../../core/models/backend.model';
import { Container, ContainerStatus } from '../../../core/models/container.model';

interface SystemContainers {
  system: BackendSystem;
  containers: Container[];
}

@Component({
  selector: 'app-project-resources',
  standalone: true,
  imports: [FormsModule, LucideAngularModule],
  templateUrl: './project-resources.component.html',
})
export class ProjectResourcesComponent implements OnChanges {
  private readonly backend = inject(BackendService);

  @Input() connectionId!: string;
  @Input() projectId!: string;
  @Input() environmentId!: string;

  // Icons
  readonly Box = Box;
  readonly Cloud = Cloud;
  readonly Loader2 = Loader2;
  readonly RefreshCw = RefreshCw;
  readonly Search = Search;
  readonly Square = Square;
  readonly Play = Play;
  readonly RotateCcw = RotateCcw;
  readonly Trash2 = Trash2;
  readonly Server = Server;
  readonly AlertCircle = AlertCircle;

  // ---- Container state (local, not global) ----
  systems = signal<BackendSystem[]>([]);
  systemContainers = signal<SystemContainers[]>([]);
  allContainers = computed(() => this.systemContainers().flatMap(sc => sc.containers));

  // Search + filter
  searchQuery = signal('');
  statusFilter = signal<ContainerStatus | null>(null);

  filteredContainers = computed(() => {
    let containers = this.allContainers();
    const query = this.searchQuery().toLowerCase().trim();
    const status = this.statusFilter();

    if (query) {
      containers = containers.filter(c =>
        c.name.toLowerCase().includes(query) ||
        c.image.toLowerCase().includes(query)
      );
    }
    if (status) {
      containers = containers.filter(c => c.status === status);
    }
    return containers;
  });

  // Stats
  stats = computed(() => {
    const all = this.allContainers();
    return {
      total: all.length,
      running: all.filter(c => c.status === 'running').length,
      stopped: all.filter(c => c.status === 'exited' || c.status === 'dead').length,
      paused: all.filter(c => c.status === 'paused').length,
    };
  });

  connectedSystemCount = computed(() => this.systems().filter(s => s.connected).length);

  // Container action loading
  loadingActions = signal<Set<string>>(new Set());

  // ---- K8s state ----
  clusters = signal<K8sCluster[]>([]);
  selectedCluster = signal<K8sCluster | null>(null);
  namespaces = signal<K8sNamespace[]>([]);
  selectedNs = signal<string>('default');
  pods = signal<K8sPod[]>([]);
  deployments = signal<K8sDeployment[]>([]);
  services = signal<K8sSvc[]>([]);
  refreshingK8s = signal(false);
  activeK8sTab = signal<'pods' | 'deployments' | 'services'>('pods');

  readonly k8sTabs = [
    { key: 'pods' as const, label: 'Pods' },
    { key: 'deployments' as const, label: 'Deployments' },
    { key: 'services' as const, label: 'Services' },
  ];

  // Loading
  loading = signal(false);
  refreshing = signal(false);
  actionError = signal<string | null>(null);

  private readonly MAX_REPLICAS = 50;

  private parseReplicaCount(ready: string): number | null {
    const parts = ready.split('/');
    if (parts.length !== 2) return null;
    const count = parseInt(parts[1], 10);
    return isNaN(count) ? null : count;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['environmentId'] || changes['connectionId'] || changes['projectId']) {
      this.resetState();
      this.loadAll();
    }
  }

  // ========================================================================
  // Data loading
  // ========================================================================

  async loadAll(): Promise<void> {
    if (!this.connectionId || !this.projectId || !this.environmentId) return;
    if (this.loading()) return; // Prevent concurrent loadAll() calls
    this.loading.set(true);
    const capturedEnv = this.environmentId;
    const capturedConn = this.connectionId;
    const capturedProj = this.projectId;
    try {
      const [systems, clusters] = await Promise.all([
        this.backend.listSystemsInEnvironmentFor(this.connectionId, this.projectId, this.environmentId),
        this.backend.listClustersInEnvironmentFor(this.connectionId, this.projectId, this.environmentId),
      ]);
      if (this.environmentId !== capturedEnv || this.connectionId !== capturedConn || this.projectId !== capturedProj) {
        return;
      }
      this.systems.set(systems);
      this.clusters.set(clusters);

      // Load containers for connected systems
      await this.loadContainers(systems);
    } catch (e) {
      console.error('Failed to load resources:', e);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadContainers(systems: BackendSystem[]): Promise<void> {
    const connected = systems.filter(s => s.connected);
    const results: SystemContainers[] = [];

    await Promise.all(connected.map(async (system) => {
      try {
        const containers = await this.backend.listContainersFor(this.connectionId, system.id);
        results.push({ system, containers });
      } catch (e) {
        console.error(`Failed to load containers for ${system.name}:`, e);
        results.push({ system, containers: [] });
      }
    }));

    this.systemContainers.set(results);
  }

  async refresh(): Promise<void> {
    this.refreshing.set(true);
    try {
      const systems = this.systems();
      await this.loadContainers(systems);
    } finally {
      this.refreshing.set(false);
    }
  }

  // ========================================================================
  // Container actions
  // ========================================================================

  confirmRemove(container: Container): void {
    if (confirm(`Remove container "${container.name || container.id}"? This action cannot be undone.`)) {
      this.containerAction(container, 'remove');
    }
  }

  async containerAction(container: Container, action: string): Promise<void> {
    this.loadingActions.update(s => {
      const n = new Set(s);
      n.add(container.id);
      return n;
    });
    this.actionError.set(null);
    try {
      await this.backend.containerActionFor(
        this.connectionId,
        container.systemId,
        container.id,
        action,
        container.runtime,
      );
      // Reload containers for this system
      const system = this.systems().find(s => s.id === container.systemId);
      if (system) {
        try {
          const containers = await this.backend.listContainersFor(this.connectionId, system.id);
          this.systemContainers.update(scs =>
            scs.map(sc => sc.system.id === system.id ? { ...sc, containers } : sc)
          );
        } catch (reloadErr) {
          console.error(`Failed to reload containers for ${system.name}:`, reloadErr);
        }
      }
    } catch (e: any) {
      const msg = e?.message || `Container action '${action}' failed`;
      this.actionError.set(msg);
      console.error(`Container action '${action}' failed:`, e);
    } finally {
      this.loadingActions.update(s => {
        const n = new Set(s);
        n.delete(container.id);
        return n;
      });
    }
  }

  isActionLoading(containerId: string): boolean {
    return this.loadingActions().has(containerId);
  }

  // ========================================================================
  // K8s
  // ========================================================================

  async selectCluster(cluster: K8sCluster): Promise<void> {
    this.selectedCluster.set(cluster);
    try {
      this.namespaces.set(await this.backend.listNamespacesFor(this.connectionId, cluster.id));
      if (this.namespaces().length > 0) {
        await this.selectNamespace(this.namespaces()[0].name);
      }
    } catch (e) {
      console.error('Failed to load cluster namespaces:', e);
    }
  }

  async selectNamespace(ns: string): Promise<void> {
    this.selectedNs.set(ns);
    await this.refreshClusterData();
  }

  async refreshClusterData(): Promise<void> {
    const cluster = this.selectedCluster();
    const ns = this.selectedNs();
    if (!cluster || !ns) return;

    this.refreshingK8s.set(true);
    try {
      const [pods, deps, svcs] = await Promise.all([
        this.backend.listPodsFor(this.connectionId, cluster.id, ns),
        this.backend.listDeploymentsFor(this.connectionId, cluster.id, ns),
        this.backend.listServicesFor(this.connectionId, cluster.id, ns),
      ]);
      this.pods.set(pods);
      this.deployments.set(deps);
      this.services.set(svcs);
    } catch (e) {
      console.error('Failed to refresh cluster data:', e);
    } finally {
      this.refreshingK8s.set(false);
    }
  }

  async scaleUp(dep: K8sDeployment): Promise<void> {
    const cluster = this.selectedCluster();
    if (!cluster) return;
    const current = this.parseReplicaCount(dep.ready);
    if (current === null || current >= this.MAX_REPLICAS) return;
    try {
      await this.backend.scaleDeploymentFor(this.connectionId, cluster.id, dep.namespace, dep.name, current + 1);
      await this.refreshClusterData();
    } catch (e: any) {
      const msg = e?.message || 'Failed to scale up deployment';
      this.actionError.set(msg);
      console.error('Failed to scale up:', e);
    }
  }

  async scaleDown(dep: K8sDeployment): Promise<void> {
    const cluster = this.selectedCluster();
    if (!cluster) return;
    const current = this.parseReplicaCount(dep.ready);
    if (current === null || current <= 0) return;
    try {
      await this.backend.scaleDeploymentFor(this.connectionId, cluster.id, dep.namespace, dep.name, current - 1);
      await this.refreshClusterData();
    } catch (e: any) {
      const msg = e?.message || 'Failed to scale down deployment';
      this.actionError.set(msg);
      console.error('Failed to scale down:', e);
    }
  }

  // ========================================================================
  // Helpers
  // ========================================================================

  getSystemName(systemId: string): string {
    return this.systems().find(s => s.id === systemId)?.name ?? 'Unknown';
  }

  getDisplayName(container: Container): string {
    const name = container.name;
    return name.startsWith('/') ? name.slice(1) : name;
  }

  getStatusText(status: ContainerStatus): string {
    switch (status) {
      case 'running': return 'Running';
      case 'exited': return 'Stopped';
      case 'paused': return 'Paused';
      case 'restarting': return 'Restarting';
      case 'created': return 'Created';
      case 'dead': return 'Dead';
      case 'removing': return 'Removing';
      default: return status;
    }
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

  private resetState(): void {
    this.systems.set([]);
    this.systemContainers.set([]);
    this.clusters.set([]);
    this.searchQuery.set('');
    this.statusFilter.set(null);
    this.selectedCluster.set(null);
    this.namespaces.set([]);
    this.selectedNs.set('default');
    this.pods.set([]);
    this.deployments.set([]);
    this.services.set([]);
    this.loadingActions.set(new Set());
    this.actionError.set(null);
  }
}
