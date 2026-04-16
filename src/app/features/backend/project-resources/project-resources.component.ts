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
  Loader2,
  RefreshCw,
  Search,
  Square,
  Play,
  RotateCcw,
  Trash2,
  Server,
  AlertCircle,
  Cloud,
} from 'lucide-angular';
import { BackendService } from '../../../core/services/backend.service';
import { BackendSystem, K8sCluster, K8sPod } from '../../../core/models/backend.model';
import { Container, ContainerStatus } from '../../../core/models/container.model';

interface SystemContainers {
  system: BackendSystem;
  containers: Container[];
}

interface ClusterPods {
  cluster: K8sCluster;
  pods: K8sPod[];
}

interface PodWithCluster extends K8sPod {
  clusterName: string;
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
  readonly Loader2 = Loader2;
  readonly RefreshCw = RefreshCw;
  readonly Search = Search;
  readonly Square = Square;
  readonly Play = Play;
  readonly RotateCcw = RotateCcw;
  readonly Trash2 = Trash2;
  readonly Server = Server;
  readonly AlertCircle = AlertCircle;
  readonly Cloud = Cloud;

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

  // ---- Kubernetes state ----
  clusters = signal<K8sCluster[]>([]);
  clusterPods = signal<ClusterPods[]>([]);
  allPods = computed<PodWithCluster[]>(() =>
    this.clusterPods().flatMap(cp =>
      cp.pods.map(p => ({ ...p, clusterName: cp.cluster.name }))
    )
  );
  filteredPods = computed(() => {
    let pods = this.allPods();
    const query = this.searchQuery().toLowerCase().trim();
    if (query) {
      pods = pods.filter(p =>
        p.name.toLowerCase().includes(query) ||
        p.namespace.toLowerCase().includes(query) ||
        p.clusterName.toLowerCase().includes(query)
      );
    }
    return pods;
  });
  podStats = computed(() => {
    const all = this.allPods();
    return {
      total: all.length,
      running: all.filter(p => p.status === 'Running').length,
      pending: all.filter(p => p.status === 'Pending').length,
      failed: all.filter(p => p.status === 'Failed').length,
    };
  });

  // Container action loading
  loadingActions = signal<Set<string>>(new Set());

  // Loading
  loading = signal(false);
  refreshing = signal(false);
  actionError = signal<string | null>(null);

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
      const systems = await this.backend.listSystemsInEnvironmentFor(
        this.connectionId, this.projectId, this.environmentId,
      );
      if (this.environmentId !== capturedEnv || this.connectionId !== capturedConn || this.projectId !== capturedProj) {
        return;
      }
      this.systems.set(systems);

      // Load containers and K8s pods in parallel
      const [, clusters] = await Promise.all([
        this.loadContainers(systems),
        this.backend.listClustersInEnvironmentFor(
          this.connectionId, this.projectId, this.environmentId,
        ).catch(() => [] as K8sCluster[]),
      ]);
      if (this.environmentId !== capturedEnv || this.connectionId !== capturedConn || this.projectId !== capturedProj) {
        return;
      }
      this.clusters.set(clusters);
      await this.loadPods(clusters);
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

  private async loadPods(clusters: K8sCluster[]): Promise<void> {
    const results: ClusterPods[] = [];
    await Promise.all(clusters.map(async (cluster) => {
      try {
        const namespaces = await this.backend.listNamespacesFor(this.connectionId, cluster.id);
        const allPods: K8sPod[] = [];
        await Promise.all(namespaces.map(async (ns) => {
          try {
            const pods = await this.backend.listPodsFor(this.connectionId, cluster.id, ns.name);
            allPods.push(...pods);
          } catch { /* skip namespace */ }
        }));
        results.push({ cluster, pods: allPods });
      } catch (e) {
        console.error(`Failed to load pods for cluster ${cluster.name}:`, e);
        results.push({ cluster, pods: [] });
      }
    }));
    this.clusterPods.set(results);
  }

  async refresh(): Promise<void> {
    this.refreshing.set(true);
    try {
      await Promise.all([
        this.loadContainers(this.systems()),
        this.loadPods(this.clusters()),
      ]);
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
    this.clusterPods.set([]);
    this.searchQuery.set('');
    this.statusFilter.set(null);
    this.loadingActions.set(new Set());
    this.actionError.set(null);
    this.loading.set(false);
    this.refreshing.set(false);
  }
}
