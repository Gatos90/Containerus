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
  Monitor,
  Cloud,
  Plus,
  X,
  Plug,
  Unplug,
  Trash2,
  Loader2,
  AlertCircle,
  Key,
  Lock,
  CheckCircle,
  XCircle,
  Play,
  RefreshCw,
  Scale,
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
import { AppState } from '../../../state/app.state';

@Component({
  selector: 'app-project-servers',
  standalone: true,
  imports: [FormsModule, LucideAngularModule],
  templateUrl: './project-servers.component.html',
})
export class ProjectServersComponent implements OnChanges {
  private readonly backend = inject(BackendService);
  private readonly appState = inject(AppState);

  @Input() connectionId!: string;
  @Input() projectId!: string;
  @Input() environmentId!: string;

  // Icons
  readonly Monitor = Monitor;
  readonly Cloud = Cloud;
  readonly Plus = Plus;
  readonly X = X;
  readonly Plug = Plug;
  readonly Unplug = Unplug;
  readonly Trash2 = Trash2;
  readonly Loader2 = Loader2;
  readonly AlertCircle = AlertCircle;
  readonly Key = Key;
  readonly Lock = Lock;
  readonly CheckCircle = CheckCircle;
  readonly XCircle = XCircle;
  readonly Play = Play;
  readonly RefreshCw = RefreshCw;
  readonly Scale = Scale;

  // ---- Systems state ----
  systems = signal<BackendSystem[]>([]);
  systemErrors = signal<Map<string, string>>(new Map());
  showAddSystem = signal(false);
  savingSystem = signal(false);

  // Add system form
  newSystem = {
    name: '',
    hostname: '',
    port: 22,
    username: 'root',
    primaryRuntime: 'docker' as 'docker' | 'podman',
    authMethod: 'password' as 'password' | 'publicKey',
    password: '',
    privateKey: '',
    passphrase: '',
  };

  // Inline confirm state
  confirmingDeleteSystemId = signal<string | null>(null);
  confirmingDeleteCluster = signal<K8sCluster | null>(null);

  // Host key mismatch modal
  showHostKeyModal = signal(false);
  hostKeyInfo = signal<{
    systemId: string;
    hostname: string;
    expected: string;
    received: string;
  } | null>(null);
  trustingHostKey = signal(false);

  // ---- Kubernetes state ----
  clusters = signal<K8sCluster[]>([]);
  showAddCluster = signal(false);
  savingCluster = signal(false);
  addClusterError = signal<string | null>(null);
  clusterTestResults = signal<Map<string, string>>(new Map());

  // Add cluster form
  newCluster = {
    name: '',
    kubeconfig: '',
    contextName: '',
  };

  // Cluster detail
  selectedCluster = signal<K8sCluster | null>(null);
  namespaces = signal<K8sNamespace[]>([]);
  selectedNs = signal<string>('default');
  pods = signal<K8sPod[]>([]);
  deployments = signal<K8sDeployment[]>([]);
  services = signal<K8sSvc[]>([]);
  refreshing = signal(false);
  activeK8sTab = signal<'pods' | 'deployments' | 'services'>('pods');

  readonly k8sTabs = [
    { key: 'pods' as const, label: 'Pods' },
    { key: 'deployments' as const, label: 'Deployments' },
    { key: 'services' as const, label: 'Services' },
  ];

  // Loading
  loading = signal(false);

  // Computed
  systemCount = computed(() => this.systems().length);
  clusterCount = computed(() => this.clusters().length);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['connectionId'] || changes['projectId'] || changes['environmentId']) {
      this.resetState();
      this.loadResources();
    }
  }

  // ========================================================================
  // Data loading
  // ========================================================================

  async loadResources(): Promise<void> {
    if (!this.connectionId || !this.projectId || !this.environmentId) return;
    this.loading.set(true);
    try {
      const [systems, clusters] = await Promise.all([
        this.backend.listSystemsInEnvironmentFor(this.connectionId, this.projectId, this.environmentId),
        this.backend.listClustersInEnvironmentFor(this.connectionId, this.projectId, this.environmentId),
      ]);
      this.systems.set(systems);
      this.clusters.set(clusters);
    } catch (e) {
      console.error('Failed to load resources:', e);
    } finally {
      this.loading.set(false);
    }
  }

  // ========================================================================
  // Systems
  // ========================================================================

  toggleAddSystem(): void {
    this.showAddSystem.update(v => !v);
    if (this.showAddSystem()) {
      this.resetSystemForm();
    }
  }

  resetSystemForm(): void {
    this.newSystem = {
      name: '',
      hostname: '',
      port: 22,
      username: 'root',
      primaryRuntime: 'docker',
      authMethod: 'password',
      password: '',
      privateKey: '',
      passphrase: '',
    };
  }

  async saveSystem(): Promise<void> {
    if (!this.newSystem.name.trim() || !this.newSystem.hostname.trim()) return;
    this.savingSystem.set(true);
    try {
      const data: Record<string, unknown> = {
        name: this.newSystem.name.trim(),
        hostname: this.newSystem.hostname.trim(),
        port: this.newSystem.port,
        username: this.newSystem.username.trim(),
        authMethod: this.newSystem.authMethod,
        primaryRuntime: this.newSystem.primaryRuntime,
        availableRuntimes: [this.newSystem.primaryRuntime],
      };

      if (this.newSystem.authMethod === 'password') {
        data['password'] = this.newSystem.password;
      } else {
        data['privateKey'] = this.newSystem.privateKey;
        if (this.newSystem.passphrase) {
          data['passphrase'] = this.newSystem.passphrase;
        }
      }

      const system = await this.backend.createSystemInEnvironmentFor(
        this.connectionId,
        this.projectId,
        this.environmentId,
        data,
      );

      // Auto-connect
      try {
        await this.backend.connectSystemFor(this.connectionId, system.id);
      } catch (e: any) {
        const msg = e?.message ?? '';
        if (this.isHostKeyError(msg)) {
          this.openHostKeyModal(system.id, msg);
        } else {
          this.setSystemError(system.id, msg);
        }
      }

      // Refresh global state
      await this.appState.system.loadSystems();
      try {
        await this.appState.loadAllDataForSystem(system.id);
      } catch {
        // system may not have connected
      }
      await this.loadResources();

      this.showAddSystem.set(false);
      this.resetSystemForm();
    } catch (e: any) {
      console.error('Failed to save system:', e);
    } finally {
      this.savingSystem.set(false);
    }
  }

  async connectSystem(systemId: string): Promise<void> {
    this.clearSystemError(systemId);
    try {
      await this.backend.connectSystemFor(this.connectionId, systemId);
      await this.appState.system.loadSystems();
      await this.appState.loadAllDataForSystem(systemId);
      await this.loadResources();
    } catch (e: any) {
      const msg = e?.message ?? '';
      if (this.isHostKeyError(msg)) {
        this.openHostKeyModal(systemId, msg);
      } else {
        this.setSystemError(systemId, msg);
      }
    }
  }

  async disconnectSystem(systemId: string): Promise<void> {
    this.clearSystemError(systemId);
    try {
      await this.backend.disconnectSystemFor(this.connectionId, systemId);
      this.appState.clearDataForSystem(systemId);
      await this.appState.system.loadSystems();
      await this.loadResources();
    } catch (e: any) {
      this.setSystemError(systemId, e?.message ?? 'Failed to disconnect');
    }
  }

  promptDeleteSystem(systemId: string): void {
    this.confirmingDeleteSystemId.set(systemId);
  }

  async deleteSystem(systemId: string): Promise<void> {
    this.confirmingDeleteSystemId.set(null);
    try {
      await this.backend.deleteSystemFor(this.connectionId, systemId);
      this.appState.clearDataForSystem(systemId);
      await this.appState.system.loadSystems();
      await this.loadResources();
    } catch (e: any) {
      this.setSystemError(systemId, e?.message ?? 'Failed to delete');
    }
  }

  getSystemError(systemId: string): string | undefined {
    return this.systemErrors().get(systemId);
  }

  // ========================================================================
  // Host Key Mismatch
  // ========================================================================

  private isHostKeyError(msg: string): boolean {
    const lower = msg.toLowerCase();
    return lower.includes('host key verification failed') || lower.includes('host key has changed');
  }

  private openHostKeyModal(systemId: string, errorMsg: string): void {
    const hostnameMatch = errorMsg.match(/host[:\s]+([^\s,]+)/i);
    const expectedMatch = errorMsg.match(/expected[:\s]+([^\s,]+)/i);
    const receivedMatch = errorMsg.match(/received[:\s]+([^\s,]+)/i) ?? errorMsg.match(/got[:\s]+([^\s,]+)/i);

    this.hostKeyInfo.set({
      systemId,
      hostname: hostnameMatch?.[1] ?? 'unknown',
      expected: expectedMatch?.[1] ?? 'unknown',
      received: receivedMatch?.[1] ?? 'unknown',
    });
    this.showHostKeyModal.set(true);
  }

  async trustHostKey(): Promise<void> {
    const info = this.hostKeyInfo();
    if (!info) return;
    this.trustingHostKey.set(true);
    try {
      await this.backend.trustHostKeyFor(this.connectionId, info.systemId);
      this.showHostKeyModal.set(false);
      this.hostKeyInfo.set(null);
      await this.connectSystem(info.systemId);
    } catch (e: any) {
      this.setSystemError(info.systemId, e?.message ?? 'Failed to trust host key');
      this.showHostKeyModal.set(false);
      this.hostKeyInfo.set(null);
    } finally {
      this.trustingHostKey.set(false);
    }
  }

  dismissHostKeyModal(): void {
    this.showHostKeyModal.set(false);
    this.hostKeyInfo.set(null);
  }

  // ========================================================================
  // Kubernetes Clusters
  // ========================================================================

  openAddCluster(): void {
    this.showAddCluster.set(true);
    this.addClusterError.set(null);
    this.newCluster = { name: '', kubeconfig: '', contextName: '' };
  }

  async saveCluster(): Promise<void> {
    if (!this.newCluster.name.trim() || !this.newCluster.kubeconfig.trim()) return;
    this.savingCluster.set(true);
    this.addClusterError.set(null);
    try {
      await this.backend.createClusterInEnvironmentFor(
        this.connectionId,
        this.projectId,
        this.environmentId,
        {
          name: this.newCluster.name.trim(),
          kubeconfig: this.newCluster.kubeconfig,
          contextName: this.newCluster.contextName.trim() || undefined,
        },
      );
      this.showAddCluster.set(false);
      await this.loadResources();
    } catch (e: any) {
      this.addClusterError.set(e?.message ?? 'Failed to add cluster');
    } finally {
      this.savingCluster.set(false);
    }
  }

  async testCluster(cluster: K8sCluster): Promise<void> {
    this.clusterTestResults.update(m => {
      const n = new Map(m);
      n.set(cluster.id, 'testing');
      return n;
    });
    try {
      await this.backend.testClusterFor(this.connectionId, cluster.id);
      this.clusterTestResults.update(m => {
        const n = new Map(m);
        n.set(cluster.id, 'success');
        return n;
      });
    } catch {
      this.clusterTestResults.update(m => {
        const n = new Map(m);
        n.set(cluster.id, 'error');
        return n;
      });
    }
  }

  promptDeleteCluster(cluster: K8sCluster): void {
    this.confirmingDeleteCluster.set(cluster);
  }

  async deleteCluster(cluster: K8sCluster): Promise<void> {
    this.confirmingDeleteCluster.set(null);
    try {
      await this.backend.deleteClusterFor(this.connectionId, cluster.id);
      if (this.selectedCluster()?.id === cluster.id) {
        this.selectedCluster.set(null);
        this.pods.set([]);
        this.deployments.set([]);
        this.services.set([]);
        this.namespaces.set([]);
      }
      await this.loadResources();
    } catch (e) {
      console.error('Failed to delete cluster:', e);
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
      console.error('Failed to refresh cluster data:', e);
    } finally {
      this.refreshing.set(false);
    }
  }

  async scaleUp(dep: K8sDeployment): Promise<void> {
    const cluster = this.selectedCluster();
    if (!cluster) return;
    const parts = dep.ready.split('/');
    if (parts.length !== 2) return;
    const current = parseInt(parts[1], 10);
    if (isNaN(current) || current >= 50) return;
    try {
      await this.backend.scaleDeploymentFor(this.connectionId, cluster.id, dep.namespace, dep.name, current + 1);
      await this.refreshClusterData();
    } catch (e) {
      console.error('Failed to scale up:', e);
    }
  }

  async scaleDown(dep: K8sDeployment): Promise<void> {
    const cluster = this.selectedCluster();
    if (!cluster) return;
    const parts = dep.ready.split('/');
    if (parts.length !== 2) return;
    const current = parseInt(parts[1], 10);
    if (isNaN(current) || current <= 0) return;
    try {
      await this.backend.scaleDeploymentFor(this.connectionId, cluster.id, dep.namespace, dep.name, current - 1);
      await this.refreshClusterData();
    } catch (e) {
      console.error('Failed to scale down:', e);
    }
  }

  getPodStatusClass(status: string): string {
    switch (status) {
      case 'Running':
        return 'bg-green-500/20 text-green-400';
      case 'Pending':
        return 'bg-yellow-500/20 text-yellow-400';
      case 'Failed':
        return 'bg-red-500/20 text-red-400';
      case 'Succeeded':
        return 'bg-blue-500/20 text-blue-400';
      default:
        return 'bg-zinc-700 text-zinc-400';
    }
  }

  // ========================================================================
  // Helpers
  // ========================================================================

  private resetState(): void {
    this.systems.set([]);
    this.clusters.set([]);
    this.systemErrors.set(new Map());
    this.showAddSystem.set(false);
    this.showAddCluster.set(false);
    this.selectedCluster.set(null);
    this.namespaces.set([]);
    this.selectedNs.set('default');
    this.pods.set([]);
    this.deployments.set([]);
    this.services.set([]);
  }

  private setSystemError(systemId: string, msg: string): void {
    this.systemErrors.update(m => {
      const n = new Map(m);
      n.set(systemId, msg);
      return n;
    });
  }

  private clearSystemError(systemId: string): void {
    this.systemErrors.update(m => {
      const n = new Map(m);
      n.delete(systemId);
      return n;
    });
  }
}
