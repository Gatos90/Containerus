import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BackendService } from '../../../core/services/backend.service';
import { BackendK8sService } from '../../../core/services/backend-k8s.service';
import {
  K8sCluster,
  K8sDeployment,
  K8sNamespace,
  K8sPod,
} from '../../../core/models/backend.model';
import { UiPreferencesState, LOCAL_CONNECTION_ID } from '../../../state/ui-preferences.state';
import { K8sClusterSwitcherComponent } from './components/k8s-cluster-switcher.component';
import { K8sNamespaceFilterComponent } from './components/k8s-namespace-filter.component';
import { K8sTriageCardComponent } from './components/k8s-triage-card.component';
import { K8sPodDrawerComponent } from './components/k8s-pod-drawer.component';
import { StatusChipComponent, ChipStatus } from '../../../shared/components/a11y';
import {
  countPodPhases,
  rollUpPodStatus,
  rollUpWorkloadReadiness,
  podReadyRatio,
} from './k8s-health';

interface NamespaceTriageRow {
  readonly name: string;
  readonly status: ChipStatus;
  readonly readyCounts: string;
  readonly failingCount: number;
}

interface WorkloadTriageRow {
  readonly kind: 'Deployment';
  readonly name: string;
  readonly namespace: string;
  readonly status: ChipStatus;
  readonly ready: string;
}

/**
 * CON-131 — Phase-2 Kubernetes cluster overview page.
 *
 * The page collapses the four drill-levels (cluster → namespace → workload →
 * pod) into one component because each transition is cheap (signals
 * + `computed`) and keeping a single component keeps URL ↔ state sync
 * authoritative in one place. URL schema:
 *
 *   /k8s/overview?cluster={id}&ns={name}&wl={Kind/name}&pod={name}
 *
 * - `ns` unset → aggregated view across all namespaces (cluster level).
 * - `wl` set   → workload scope (namespace implied from workload list).
 * - `pod` set  → pod drawer opens; deselecting closes the drawer and drops
 *                the query param so reload doesn't reopen stale content.
 *
 * State mutations flow URL → component (router observable); selection
 * helpers push to `Router.navigate` with merged query params so back/forward
 * history lands on a valid prior state. The `announcement` signal feeds a
 * polite `role="status"` region so SR users hear "3 pods failing" transitions
 * without the rest of the page being live.
 */
@Component({
  selector: 'app-k8s-overview-page',
  standalone: true,
  imports: [
    CommonModule,
    K8sClusterSwitcherComponent,
    K8sNamespaceFilterComponent,
    K8sTriageCardComponent,
    K8sPodDrawerComponent,
    StatusChipComponent,
  ],
  templateUrl: './k8s-overview-page.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class K8sOverviewPageComponent implements OnInit {
  private readonly backend = inject(BackendService);
  private readonly k8s = inject(BackendK8sService);
  private readonly ui = inject(UiPreferencesState);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly clusters = signal<K8sCluster[]>([]);
  readonly clustersLoading = signal(false);
  readonly clustersError = signal<string | null>(null);

  readonly namespaces = signal<K8sNamespace[]>([]);
  readonly pods = signal<K8sPod[]>([]);
  readonly deployments = signal<K8sDeployment[]>([]);
  readonly loading = signal(false);

  readonly activeClusterId = signal<string | null>(null);
  readonly activeNamespace = signal<string | null>(null);
  readonly activeWorkload = signal<string | null>(null);
  readonly activePodName = signal<string | null>(null);

  readonly announcement = signal<string>('');
  /** Captured when the pod drill-down is opened so drawer close restores focus. */
  readonly podDrawerTrigger = signal<HTMLElement | null>(null);

  readonly connectionId = computed(() => this.ui.activeConnectionId());
  readonly isLocal = computed(() => this.connectionId() === LOCAL_CONNECTION_ID);

  readonly activeCluster = computed(() =>
    this.clusters().find((c) => c.id === this.activeClusterId()) ?? null,
  );

  readonly namespaceNames = computed(() => this.namespaces().map((n) => n.name));

  readonly filteredPods = computed(() => {
    const ns = this.activeNamespace();
    const all = this.pods();
    return ns ? all.filter((p) => p.namespace === ns) : all;
  });

  readonly namespaceRows = computed<NamespaceTriageRow[]>(() => {
    const rows: NamespaceTriageRow[] = [];
    const byNs = new Map<string, K8sPod[]>();
    for (const pod of this.pods()) {
      const list = byNs.get(pod.namespace) ?? [];
      list.push(pod);
      byNs.set(pod.namespace, list);
    }
    for (const ns of this.namespaces()) {
      const pods = byNs.get(ns.name) ?? [];
      const counts = countPodPhases(pods);
      const status = rollUpPodStatus(counts);
      rows.push({
        name: ns.name,
        status,
        readyCounts: podReadyRatio(counts),
        failingCount: counts.failed,
      });
    }
    return rows;
  });

  readonly workloadRows = computed<WorkloadTriageRow[]>(() =>
    this.deployments().map((d) => ({
      kind: 'Deployment' as const,
      name: d.name,
      namespace: d.namespace,
      status: rollUpWorkloadReadiness(d.ready),
      ready: d.ready,
    })),
  );

  readonly clusterPhaseSummary = computed(() => {
    const counts = countPodPhases(this.filteredPods());
    return {
      counts,
      status: rollUpPodStatus(counts),
    };
  });

  readonly activePod = computed(() => {
    const name = this.activePodName();
    if (!name) return null;
    return this.pods().find((p) => p.name === name) ?? null;
  });

  private lastFailingCount = -1;

  constructor() {
    // Keep the activeConnectionId honest: when the topbar switcher changes,
    // we drop cluster/namespace selection and reload from scratch rather
    // than silently fetching from the previous tenant.
    effect(() => {
      const _ = this.connectionId();
      this.clusters.set([]);
      this.activeClusterId.set(null);
      this.activeNamespace.set(null);
      this.namespaces.set([]);
      this.pods.set([]);
      this.deployments.set([]);
      if (!this.isLocal()) {
        void this.loadClusters();
      }
    });

    // Announce failing-pod transitions when the count changes. Writing
    // announcements outside the template keeps the live region from
    // spamming on every re-render.
    effect(() => {
      const failing = this.clusterPhaseSummary().counts.failed;
      if (failing !== this.lastFailingCount && this.lastFailingCount !== -1) {
        this.announcement.set(
          failing === 0
            ? 'All pods are healthy'
            : `${failing} pod${failing === 1 ? '' : 's'} failing`,
        );
      }
      this.lastFailingCount = failing;
    });
  }

  ngOnInit(): void {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const cluster = params.get('cluster');
      const ns = params.get('ns');
      const wl = params.get('wl');
      const pod = params.get('pod');

      const clusterChanged = cluster !== this.activeClusterId();
      this.activeClusterId.set(cluster ?? null);
      this.activeNamespace.set(ns);
      this.activeWorkload.set(wl);
      this.activePodName.set(pod);

      if (cluster && clusterChanged && this.clusters().some((c) => c.id === cluster)) {
        void this.loadClusterResources(cluster);
      }
    });
  }

  async loadClusters(): Promise<void> {
    const conn = this.connectionId();
    if (this.isLocal()) return;
    this.clustersLoading.set(true);
    this.clustersError.set(null);
    try {
      const list = await this.k8s.listAllClustersFor(conn);
      this.clusters.set(list);
      const active = this.activeClusterId();
      if (!active && list.length > 0) {
        void this.onSelectCluster(list[0].id);
      } else if (active) {
        void this.loadClusterResources(active);
      }
    } catch (err: any) {
      this.clustersError.set(err?.message ?? 'Failed to load clusters');
    } finally {
      this.clustersLoading.set(false);
    }
  }

  async loadClusterResources(clusterId: string): Promise<void> {
    const conn = this.connectionId();
    this.loading.set(true);
    try {
      const [ns, pods, deps] = await Promise.all([
        this.k8s.listNamespacesFor(conn, clusterId),
        this.k8s.listPodsFor(conn, clusterId, ''),
        this.k8s.listDeploymentsFor(conn, clusterId, ''),
      ]);
      this.namespaces.set(ns);
      this.pods.set(pods);
      this.deployments.set(deps);
    } catch (err) {
      // Surface via empty state; detailed error routing lands with QA review.
      this.namespaces.set([]);
      this.pods.set([]);
      this.deployments.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  onSelectCluster(clusterId: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { cluster: clusterId, ns: null, wl: null, pod: null },
      queryParamsHandling: 'merge',
    });
  }

  onSelectNamespace(ns: string | null): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { ns, wl: null, pod: null },
      queryParamsHandling: 'merge',
    });
  }

  onSelectWorkload(row: WorkloadTriageRow | null): void {
    if (!row) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { wl: null, pod: null },
        queryParamsHandling: 'merge',
      });
      return;
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { ns: row.namespace, wl: `${row.kind}/${row.name}`, pod: null },
      queryParamsHandling: 'merge',
    });
  }

  openPod(pod: K8sPod, trigger: HTMLElement): void {
    this.podDrawerTrigger.set(trigger);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { ns: pod.namespace, pod: pod.name },
      queryParamsHandling: 'merge',
    });
  }

  closePodDrawer(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { pod: null },
      queryParamsHandling: 'merge',
    });
  }

  trackPod = (_: number, pod: K8sPod): string => `${pod.namespace}/${pod.name}`;

  podStatus(pod: K8sPod): ChipStatus {
    if (pod.status === 'Running' || pod.status === 'Succeeded') return 'healthy';
    if (pod.status === 'Pending') return 'degraded';
    if (pod.status === 'Failed' || pod.status === 'CrashLoopBackOff' || pod.status === 'Error') return 'failing';
    return 'unknown';
  }
}
