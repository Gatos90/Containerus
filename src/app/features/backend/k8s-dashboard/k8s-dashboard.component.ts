import { Component, inject, signal, computed, Input, OnInit, OnChanges, SimpleChanges, HostListener } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BackendService } from '../../../core/services/backend.service';
import { K8sCluster, K8sNamespace, K8sPod, K8sDeployment, K8sService as K8sSvc, Project, Environment } from '../../../core/models/backend.model';
import { LucideAngularModule, Cloud, Plus, Trash2, Loader2, RefreshCw, ChevronDown, Box, Layers, Globe, Scale, Play, CheckCircle, XCircle } from 'lucide-angular';

export interface ClusterGroup {
  project: Project;
  environment: Environment;
  clusters: K8sCluster[];
}

@Component({
  selector: 'app-k8s-dashboard',
  imports: [FormsModule, LucideAngularModule],
  template: `
    <div class="p-6 max-w-6xl mx-auto space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-semibold text-zinc-100 flex items-center gap-2">
          <lucide-icon [img]="Cloud" [size]="20" />
          Kubernetes
        </h1>
        <button
          (click)="openAddClusterModal()"
          class="bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg px-3 py-1.5 flex items-center gap-1.5"
        >
          <lucide-icon [img]="Plus" [size]="14" />
          Add Cluster
        </button>
      </div>

      <!-- Cluster List -->
      <div class="grid gap-3">
        @if (clusterGroups().length === 0) {
          <div class="text-center py-12 text-zinc-400">
            No clusters registered. Click "Add Cluster" to get started.
          </div>
        } @else {
          @for (group of clusterGroups(); track group.project.id + '/' + group.environment.id) {
            @if (clusterGroups().length > 1) {
              <div class="text-xs font-medium text-zinc-500 uppercase tracking-wide mt-2 first:mt-0">
                {{ group.project.name }} / {{ group.environment.name }}
              </div>
            }
            @for (cluster of group.clusters; track cluster.id) {
              <div
                class="bg-zinc-900 rounded-xl border border-zinc-800 p-4 cursor-pointer hover:border-zinc-700 transition-colors"
                [class.border-blue-600]="selectedCluster()?.id === cluster.id"
                (click)="selectCluster(cluster)"
              >
                <div class="flex items-center justify-between">
                  <div>
                    <div class="font-medium text-zinc-200">{{ cluster.name }}</div>
                    <div class="text-xs text-zinc-400 mt-0.5">{{ cluster.apiServerUrl }}</div>
                  </div>
                  <div class="flex items-center gap-2">
                    @if (clusterTestResults().get(cluster.id) === 'testing') {
                      <lucide-icon [img]="Loader2" [size]="14" class="animate-spin text-zinc-400" />
                    } @else if (clusterTestResults().get(cluster.id) === 'success') {
                      <lucide-icon [img]="CheckCircle" [size]="14" class="text-green-400" title="Connection successful" />
                    } @else if (clusterTestResults().get(cluster.id) === 'error') {
                      <lucide-icon [img]="XCircle" [size]="14" class="text-red-400" title="Connection failed" />
                    }
                    <button
                      (click)="testCluster(cluster); $event.stopPropagation()"
                      class="text-zinc-400 hover:text-zinc-200 p-1"
                      title="Test connection"
                      aria-label="Test connection"
                    >
                      <lucide-icon [img]="Play" [size]="14" />
                    </button>
                    @if (confirmingRemoveCluster()?.id === cluster.id) {
                      <button
                        (click)="confirmingRemoveCluster.set(null); $event.stopPropagation()"
                        class="text-[11px] text-zinc-400 hover:text-zinc-300 px-1.5 py-0.5 rounded hover:bg-zinc-800 transition-colors"
                      >Cancel</button>
                      <button
                        (click)="removeCluster(cluster); $event.stopPropagation()"
                        class="text-[11px] text-red-400 bg-red-950/40 hover:bg-red-950/60 px-1.5 py-0.5 rounded transition-colors"
                      >Remove</button>
                    } @else {
                      <button
                        (click)="promptRemoveCluster(cluster); $event.stopPropagation()"
                        class="text-zinc-400 hover:text-red-400 p-1"
                        title="Remove cluster"
                        aria-label="Remove cluster"
                      >
                        <lucide-icon [img]="Trash2" [size]="14" />
                      </button>
                    }
                  </div>
                </div>
              </div>
            }
          }
        }
      </div>

      <!-- Cluster Detail -->
      @if (selectedCluster()) {
        <div class="space-y-4">
          <!-- Namespace selector -->
          <div class="flex items-center gap-3">
            <label class="text-sm text-zinc-300">Namespace:</label>
            <select
              class="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-zinc-100 text-sm"
              [ngModel]="selectedNs()"
              (ngModelChange)="selectNamespace($event)"
            >
              @for (ns of namespaces(); track ns.name) {
                <option [value]="ns.name">{{ ns.name }}</option>
              }
            </select>
            <button (click)="refreshData()" class="text-zinc-400 hover:text-zinc-200">
              <lucide-icon [img]="RefreshCw" [size]="14" [class.animate-spin]="refreshing()" />
            </button>
          </div>

          <!-- Tabs -->
          <div class="flex gap-1 border-b border-zinc-800">
            @for (tab of k8sTabs; track tab.key) {
              <button
                (click)="activeTab.set(tab.key)"
                class="px-4 py-2 text-sm transition-colors border-b-2"
                [class]="activeTab() === tab.key ? 'text-blue-400 border-blue-400' : 'text-zinc-400 border-transparent hover:text-zinc-300'"
              >
                {{ tab.label }}
              </button>
            }
          </div>

          <!-- Pods -->
          @if (activeTab() === 'pods') {
            <div class="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-zinc-800 text-zinc-400 text-left">
                    <th class="px-4 py-2 font-medium">Name</th>
                    <th class="px-4 py-2 font-medium">Ready</th>
                    <th class="px-4 py-2 font-medium">Status</th>
                    <th class="px-4 py-2 font-medium">Restarts</th>
                    <th class="px-4 py-2 font-medium">Age</th>
                    <th class="px-4 py-2 font-medium">Node</th>
                  </tr>
                </thead>
                <tbody>
                  @for (pod of pods(); track pod.name) {
                    <tr class="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                      <td class="px-4 py-2 text-zinc-200 font-mono text-xs">{{ pod.name }}</td>
                      <td class="px-4 py-2 text-zinc-300">{{ pod.ready }}</td>
                      <td class="px-4 py-2">
                        <span class="text-xs px-1.5 py-0.5 rounded" [class]="getPodStatusClass(pod.status)">
                          {{ pod.status }}
                        </span>
                      </td>
                      <td class="px-4 py-2 text-zinc-300">{{ pod.restarts }}</td>
                      <td class="px-4 py-2 text-zinc-400">{{ pod.age }}</td>
                      <td class="px-4 py-2 text-zinc-400 text-xs">{{ pod.node ?? '-' }}</td>
                    </tr>
                  } @empty {
                    <tr><td colspan="6" class="text-center py-8 text-zinc-500">No pods found</td></tr>
                  }
                </tbody>
              </table>
            </div>
          }

          <!-- Deployments -->
          @if (activeTab() === 'deployments') {
            <div class="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-zinc-800 text-zinc-400 text-left">
                    <th class="px-4 py-2 font-medium">Name</th>
                    <th class="px-4 py-2 font-medium">Ready</th>
                    <th class="px-4 py-2 font-medium">Up-to-date</th>
                    <th class="px-4 py-2 font-medium">Available</th>
                    <th class="px-4 py-2 font-medium">Age</th>
                    <th class="px-4 py-2 font-medium">Scale</th>
                  </tr>
                </thead>
                <tbody>
                  @for (dep of deployments(); track dep.name) {
                    <tr class="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                      <td class="px-4 py-2 text-zinc-200 font-mono text-xs">{{ dep.name }}</td>
                      <td class="px-4 py-2 text-zinc-300">{{ dep.ready }}</td>
                      <td class="px-4 py-2 text-zinc-300">{{ dep.upToDate }}</td>
                      <td class="px-4 py-2 text-zinc-300">{{ dep.available }}</td>
                      <td class="px-4 py-2 text-zinc-400">{{ dep.age }}</td>
                      <td class="px-4 py-2">
                        <div class="flex items-center gap-1">
                          <button (click)="scaleDown(dep)" class="text-zinc-400 hover:text-zinc-200 text-xs px-1" [attr.aria-label]="'Scale down ' + dep.name + ' (current: ' + dep.ready + ')'">-</button>
                          <button (click)="scaleUp(dep)" class="text-zinc-400 hover:text-zinc-200 text-xs px-1" [attr.aria-label]="'Scale up ' + dep.name + ' (current: ' + dep.ready + ')'">+</button>
                        </div>
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="6" class="text-center py-8 text-zinc-500">No deployments found</td></tr>
                  }
                </tbody>
              </table>
            </div>
          }

          <!-- Services -->
          @if (activeTab() === 'services') {
            <div class="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-zinc-800 text-zinc-400 text-left">
                    <th class="px-4 py-2 font-medium">Name</th>
                    <th class="px-4 py-2 font-medium">Type</th>
                    <th class="px-4 py-2 font-medium">Cluster IP</th>
                    <th class="px-4 py-2 font-medium">External IP</th>
                    <th class="px-4 py-2 font-medium">Ports</th>
                    <th class="px-4 py-2 font-medium">Age</th>
                  </tr>
                </thead>
                <tbody>
                  @for (svc of services(); track svc.name) {
                    <tr class="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                      <td class="px-4 py-2 text-zinc-200 font-mono text-xs">{{ svc.name }}</td>
                      <td class="px-4 py-2 text-zinc-300">{{ svc.serviceType }}</td>
                      <td class="px-4 py-2 text-zinc-400 text-xs">{{ svc.clusterIp ?? '-' }}</td>
                      <td class="px-4 py-2 text-zinc-400 text-xs">{{ svc.externalIp ?? '-' }}</td>
                      <td class="px-4 py-2 text-zinc-400 text-xs">{{ svc.ports?.join(', ') || '-' }}</td>
                      <td class="px-4 py-2 text-zinc-400">{{ svc.age }}</td>
                    </tr>
                  } @empty {
                    <tr><td colspan="6" class="text-center py-8 text-zinc-500">No services found</td></tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </div>
      }

      <!-- Add Cluster Modal -->
      @if (showAddCluster()) {
        <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="add-cluster-title" (click)="showAddCluster.set(false)" (keydown.escape)="showAddCluster.set(false)">
          <div class="bg-zinc-900 rounded-xl border border-zinc-800 p-6 w-full max-w-lg space-y-4" (click)="$event.stopPropagation()">
            <h3 id="add-cluster-title" class="text-lg font-medium text-zinc-100">Add Kubernetes Cluster</h3>

            <div>
              <label class="block text-sm text-zinc-300 mb-1">Project</label>
              <select
                class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:border-blue-500 focus:outline-none"
                [ngModel]="selectedProjectId()"
                (ngModelChange)="onProjectSelected($event)"
              >
                @for (project of availableProjects(); track project.id) {
                  <option [value]="project.id">{{ project.name }}</option>
                }
              </select>
            </div>

            <div>
              <label class="block text-sm text-zinc-300 mb-1">Environment</label>
              <select
                class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:border-blue-500 focus:outline-none"
                [ngModel]="selectedEnvironmentId()"
                (ngModelChange)="selectedEnvironmentId.set($event)"
              >
                @for (env of availableEnvironments(); track env.id) {
                  <option [value]="env.id">{{ env.name }}</option>
                }
              </select>
            </div>

            <div>
              <label class="block text-sm text-zinc-300 mb-1">Cluster Name</label>
              <input
                type="text"
                [(ngModel)]="newClusterName"
                placeholder="production-cluster"
                class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label class="block text-sm text-zinc-300 mb-1">Kubeconfig (YAML)</label>
              <p class="text-xs text-yellow-500/80 mb-1">Contains sensitive credentials. Transmitted encrypted to the server.</p>
              <textarea
                [(ngModel)]="newKubeconfig"
                placeholder="Paste your kubeconfig YAML here..."
                rows="10"
                autocomplete="off"
                class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-xs"
              ></textarea>
            </div>

            <div>
              <label class="block text-sm text-zinc-300 mb-1">Context (optional)</label>
              <input
                type="text"
                [(ngModel)]="newContextName"
                placeholder="Leave empty for default context"
                class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            @if (addClusterError()) {
              <div class="text-red-400 text-sm">{{ addClusterError() }}</div>
            }

            <div class="flex gap-2 justify-end">
              <button (click)="showAddCluster.set(false)" class="px-4 py-2 text-zinc-400 hover:text-zinc-300 text-sm">
                Cancel
              </button>
              <button
                (click)="addCluster()"
                [disabled]="addingCluster() || !newClusterName.trim() || !newKubeconfig.trim() || !selectedProjectId() || !selectedEnvironmentId()"
                class="bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white text-sm rounded-lg px-4 py-2"
              >
                @if (addingCluster()) {
                  <lucide-icon [img]="Loader2" [size]="14" class="animate-spin" />
                }
                Add Cluster
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class K8sDashboardComponent implements OnInit, OnChanges {
  private backend = inject(BackendService);

  @Input() connectionId!: string;

  readonly Cloud = Cloud;
  readonly Plus = Plus;
  readonly Trash2 = Trash2;
  readonly Loader2 = Loader2;
  readonly RefreshCw = RefreshCw;
  readonly ChevronDown = ChevronDown;
  readonly Box = Box;
  readonly Layers = Layers;
  readonly Globe = Globe;
  readonly Scale = Scale;
  readonly Play = Play;
  readonly CheckCircle = CheckCircle;
  readonly XCircle = XCircle;

  confirmingRemoveCluster = signal<K8sCluster | null>(null);
  clusterTestResults = signal<Map<string, string>>(new Map());
  clusterGroups = signal<ClusterGroup[]>([]);
  allClusters = computed(() => this.clusterGroups().flatMap(g => g.clusters));
  selectedCluster = signal<K8sCluster | null>(null);
  namespaces = signal<K8sNamespace[]>([]);
  selectedNs = signal<string>('default');
  pods = signal<K8sPod[]>([]);
  deployments = signal<K8sDeployment[]>([]);
  services = signal<K8sSvc[]>([]);
  refreshing = signal(false);

  activeTab = signal<'pods' | 'deployments' | 'services'>('pods');
  k8sTabs = [
    { key: 'pods' as const, label: 'Pods' },
    { key: 'deployments' as const, label: 'Deployments' },
    { key: 'services' as const, label: 'Services' },
  ];

  showAddCluster = signal(false);
  newClusterName = '';
  newKubeconfig = '';
  newContextName = '';
  addingCluster = signal(false);
  addClusterError = signal<string | null>(null);

  // Project/environment selector state for Add Cluster modal
  selectedProjectId = signal<string>('');
  selectedEnvironmentId = signal<string>('');
  availableEnvironments = signal<Environment[]>([]);
  availableProjects = computed(() => this.backend.getConnection(this.connectionId)?.projects ?? []);

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    this.showAddCluster.set(false);
  }

  ngOnInit(): void {
    this.loadClusters();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['connectionId'] && !changes['connectionId'].firstChange) {
      this.selectedCluster.set(null);
      this.pods.set([]);
      this.deployments.set([]);
      this.services.set([]);
      this.namespaces.set([]);
      this.selectedNs.set('default');
      this.loadClusters();
    }
  }

  async loadClusters(): Promise<void> {
    try {
      const conn = this.backend.getConnection(this.connectionId);
      const projects = conn?.projects ?? [];
      const groups: ClusterGroup[] = [];

      for (const project of projects) {
        let envs: Environment[] = [];
        try {
          envs = await this.backend.listEnvironmentsFor(this.connectionId, project.id);
        } catch (e) {
          console.warn(`Failed to load environments for project ${project.id}:`, e);
        }

        for (const env of envs) {
          let clusters: K8sCluster[] = [];
          try {
            clusters = await this.backend.listClustersInEnvironmentFor(this.connectionId, project.id, env.id);
          } catch (e) {
            console.warn(`Failed to load clusters for ${project.id}/${env.id}:`, e);
          }

          if (clusters.length > 0) {
            groups.push({ project, environment: env, clusters });
          }
        }
      }

      this.clusterGroups.set(groups);
    } catch (e) {
      console.error('Failed to load clusters:', e);
    }
  }

  async openAddClusterModal(): Promise<void> {
    this.showAddCluster.set(true);
    this.addClusterError.set(null);
    this.newClusterName = '';
    this.newKubeconfig = '';
    this.newContextName = '';

    // Initialize project selector
    const projects = this.availableProjects();
    if (projects.length > 0) {
      await this.onProjectSelected(projects[0].id);
    } else {
      this.selectedProjectId.set('');
      this.selectedEnvironmentId.set('');
      this.availableEnvironments.set([]);
    }
  }

  async onProjectSelected(projectId: string): Promise<void> {
    this.selectedProjectId.set(projectId);
    this.availableEnvironments.set([]);
    this.selectedEnvironmentId.set('');

    if (!projectId) return;

    try {
      const envs = await this.backend.listEnvironmentsFor(this.connectionId, projectId);
      this.availableEnvironments.set(envs);

      // Default to the default environment, or the first one
      const defaultEnv = envs.find(e => e.isDefault) ?? envs[0];
      if (defaultEnv) {
        this.selectedEnvironmentId.set(defaultEnv.id);
      }
    } catch (e) {
      console.error('Failed to load environments:', e);
    }
  }

  async selectCluster(cluster: K8sCluster): Promise<void> {
    this.selectedCluster.set(cluster);
    try {
      this.namespaces.set(await this.backend.listNamespacesFor(this.connectionId, cluster.id));
      if (this.namespaces().length > 0) {
        await this.selectNamespace(this.namespaces()[0].name);
      }
    } catch (e) {
      console.error('Failed to select cluster:', e);
    }
  }

  async selectNamespace(ns: string): Promise<void> {
    this.selectedNs.set(ns);
    await this.refreshData();
  }

  async refreshData(): Promise<void> {
    const cluster = this.selectedCluster();
    const ns = this.selectedNs();
    if (!cluster || !ns) return;

    this.refreshing.set(true);
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
      console.error('Failed to refresh data:', e);
    }
    this.refreshing.set(false);
  }

  async addCluster(): Promise<void> {
    this.addingCluster.set(true);
    this.addClusterError.set(null);
    try {
      const projectId = this.selectedProjectId();
      const environmentId = this.selectedEnvironmentId();
      if (!projectId) throw new Error('No project selected. Create a project first.');
      if (!environmentId) throw new Error('No environment selected.');

      await this.backend.createClusterInEnvironmentFor(this.connectionId, projectId, environmentId, {
        name: this.newClusterName.trim(),
        kubeconfig: this.newKubeconfig.trim(),
        contextName: this.newContextName.trim() || undefined,
      });
      this.showAddCluster.set(false);
      this.newClusterName = '';
      this.newKubeconfig = '';
      this.newContextName = '';
      await this.loadClusters();
    } catch (e: any) {
      this.addClusterError.set(e.message);
    } finally {
      this.addingCluster.set(false);
    }
  }

  promptRemoveCluster(cluster: K8sCluster): void {
    this.confirmingRemoveCluster.set(cluster);
  }

  async removeCluster(cluster: K8sCluster): Promise<void> {
    this.confirmingRemoveCluster.set(null);
    try {
      await this.backend.deleteClusterFor(this.connectionId, cluster.id);
      if (this.selectedCluster()?.id === cluster.id) {
        this.selectedCluster.set(null);
      }
      await this.loadClusters();
    } catch (e) {
      console.error('Failed to remove cluster:', e);
      this.addClusterError.set(e instanceof Error ? e.message : 'Failed to remove cluster');
    }
  }

  async testCluster(cluster: K8sCluster): Promise<void> {
    this.clusterTestResults.update(m => { const n = new Map(m); n.set(cluster.id, 'testing'); return n; });
    try {
      await this.backend.testClusterFor(this.connectionId, cluster.id);
      this.clusterTestResults.update(m => { const n = new Map(m); n.set(cluster.id, 'success'); return n; });
    } catch (e: any) {
      console.error('Failed to test cluster:', e);
      this.clusterTestResults.update(m => { const n = new Map(m); n.set(cluster.id, 'error'); return n; });
    }
  }

  private readonly MAX_REPLICAS = 50;
  scalingDeployment = signal<string | null>(null);

  private parseReplicaCount(ready: string): number | null {
    const parts = ready.split('/');
    if (parts.length !== 2) return null;
    const count = parseInt(parts[1], 10);
    return isNaN(count) ? null : count;
  }

  async scaleUp(dep: K8sDeployment): Promise<void> {
    const cluster = this.selectedCluster();
    if (!cluster || this.scalingDeployment()) return;
    const current = this.parseReplicaCount(dep.ready);
    if (current === null) return;
    if (current >= this.MAX_REPLICAS) {
      console.warn(`Cannot scale beyond ${this.MAX_REPLICAS} replicas`);
      return;
    }
    this.scalingDeployment.set(dep.name);
    try {
      await this.backend.scaleDeploymentFor(this.connectionId, cluster.id, dep.namespace, dep.name, current + 1);
      await this.refreshData();
    } catch (e) {
      console.error('Failed to scale up deployment:', e);
    } finally {
      this.scalingDeployment.set(null);
    }
  }

  async scaleDown(dep: K8sDeployment): Promise<void> {
    const cluster = this.selectedCluster();
    if (!cluster || this.scalingDeployment()) return;
    const current = this.parseReplicaCount(dep.ready);
    if (current === null || current <= 0) return;
    this.scalingDeployment.set(dep.name);
    try {
      await this.backend.scaleDeploymentFor(this.connectionId, cluster.id, dep.namespace, dep.name, current - 1);
      await this.refreshData();
    } catch (e) {
      console.error('Failed to scale down deployment:', e);
    } finally {
      this.scalingDeployment.set(null);
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
}
