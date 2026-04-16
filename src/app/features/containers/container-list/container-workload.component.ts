import {
  Component, computed, inject, signal, Output, EventEmitter,
  ChangeDetectionStrategy,
} from '@angular/core';
import { BackendService } from '../../../core/services/backend.service';
import { K8sPod } from '../../../core/models/backend.model';
import { ToastState } from '../../../state/toast.state';

export interface PodEntry {
  pod: K8sPod;
  clusterName: string;
  clusterId: string;
  connectionId: string;
}

/**
 * Manages Kubernetes pod state (fetching, loading, pod-level actions).
 * Consumed by ContainerListComponent, which owns the template and signals
 * that depend on both containers and pods.
 *
 * Use-site: ContainerListComponent delegates loadBackendPods() here and
 * reads the backendPods/podsLoading/podActionLoading signals.
 */
@Component({
  selector: 'app-container-workload',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContainerWorkloadComponent {
  private readonly backend = inject(BackendService);
  private readonly toast = inject(ToastState);

  readonly backendPods = signal<PodEntry[]>([]);
  readonly podsLoading = signal(false);
  readonly podActionLoading = signal<Set<string>>(new Set());

  readonly podStats = computed(() => {
    const all = this.backendPods();
    return {
      total: all.length,
      running: all.filter(pe => pe.pod.status === 'Running').length,
      pending: all.filter(pe => pe.pod.status === 'Pending').length,
      failed: all.filter(pe => pe.pod.status === 'Failed' || pe.pod.status === 'Succeeded').length,
    };
  });

  @Output() reloadRequested = new EventEmitter<void>();

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

  podActionKey(entry: { connectionId: string; clusterId: string; namespace: string; name: string }): string {
    return `pod:${entry.connectionId}/${entry.clusterId}/${entry.namespace}/${entry.name}`;
  }

  async deletePod(connectionId: string, clusterId: string, namespace: string, name: string): Promise<void> {
    const key = this.podActionKey({ connectionId, clusterId, namespace, name });
    this.podActionLoading.update(s => { const n = new Set(s); n.add(key); return n; });
    try {
      await this.backend.deleteK8sResourceFor(connectionId, clusterId, 'pods', name, namespace);
      this.toast.success(`Deleted pod ${name}`);
      await this.loadBackendPods();
    } catch (e: any) {
      this.toast.error(`Failed to delete pod: ${e?.message ?? e}`);
    } finally {
      this.podActionLoading.update(s => { const n = new Set(s); n.delete(key); return n; });
    }
  }

  isPodActionLoading(connectionId: string, clusterId: string, namespace: string, name: string): boolean {
    return this.podActionLoading().has(this.podActionKey({ connectionId, clusterId, namespace, name }));
  }
}
