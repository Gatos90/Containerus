import { Injectable } from '@angular/core';
import {
  K8sCluster,
  K8sDeployment,
  K8sNamespace,
  K8sPod,
  K8sService,
  K8sTopology,
  K8sApiResource,
  mapPod,
  mapDeployment,
  mapService,
  mapNamespace,
} from '../models/backend.model';
import { BackendService } from './backend.service';

/**
 * Handles all Kubernetes API operations: clusters, namespaces, pods, deployments,
 * services, nodes, CRDs, YAML apply, and real-time watch WebSocket URLs.
 */
@Injectable({ providedIn: 'root' })
export class BackendK8sService {
  constructor(private backend: BackendService) {}

  // ---------- Cluster management ----------

  async listClustersInEnvironmentFor(connectionId: string, projectId: string, environmentId: string): Promise<K8sCluster[]> {
    return this.backend.requestFor<K8sCluster[]>(
      connectionId, 'GET', `/api/projects/${projectId}/environments/${environmentId}/clusters`
    );
  }

  async listAllClustersFor(connectionId: string): Promise<K8sCluster[]> {
    const conn = this.backend.getConnection(connectionId);
    if (!conn) return [];
    const allClusters: K8sCluster[] = [];
    for (const project of conn.projects) {
      try {
        const envs = await this.backend.listEnvironmentsFor(connectionId, project.id);
        for (const env of envs) {
          try {
            const clusters = await this.listClustersInEnvironmentFor(connectionId, project.id, env.id);
            allClusters.push(...clusters);
          } catch { /* skip inaccessible environments */ }
        }
      } catch { /* skip inaccessible projects */ }
    }
    return allClusters;
  }

  async createClusterInEnvironmentFor(connectionId: string, projectId: string, environmentId: string, data: { name: string; kubeconfig: string; contextName?: string }): Promise<K8sCluster> {
    return this.backend.requestFor<K8sCluster>(
      connectionId, 'POST', `/api/projects/${projectId}/environments/${environmentId}/clusters`, data
    );
  }

  async deleteClusterFor(connectionId: string, id: string): Promise<void> {
    await this.backend.requestFor(connectionId, 'DELETE', `/api/clusters/${id}`);
  }

  async testClusterFor(connectionId: string, id: string): Promise<{ status: string; version?: string }> {
    return this.backend.requestFor(connectionId, 'POST', `/api/clusters/${id}/test`);
  }

  async updateClusterFor(connectionId: string, clusterId: string, data: { name?: string; kubeconfig?: string; contextName?: string }): Promise<K8sCluster> {
    return this.backend.requestFor<K8sCluster>(connectionId, 'PUT', `/api/clusters/${clusterId}`, data);
  }

  // ---------- Generic resource API ----------

  async listK8sResourcesFor(connectionId: string, clusterId: string, kind: string, namespace?: string): Promise<any[]> {
    const params = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
    return this.backend.requestFor<any[]>(connectionId, 'GET', `/api/clusters/${clusterId}/resources/${kind}${params}`);
  }

  async getK8sResourceFor(connectionId: string, clusterId: string, kind: string, name: string, namespace?: string): Promise<any> {
    const params = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
    return this.backend.requestFor<any>(connectionId, 'GET', `/api/clusters/${clusterId}/resources/${kind}/${name}${params}`);
  }

  async deleteK8sResourceFor(connectionId: string, clusterId: string, kind: string, name: string, namespace?: string): Promise<void> {
    const params = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
    await this.backend.requestFor(connectionId, 'DELETE', `/api/clusters/${clusterId}/resources/${kind}/${name}${params}`);
  }

  // ---------- Typed resource methods ----------

  async listNamespacesFor(connectionId: string, clusterId: string): Promise<K8sNamespace[]> {
    const raw = await this.listK8sResourcesFor(connectionId, clusterId, 'namespaces');
    return raw.map(mapNamespace);
  }

  async listPodsFor(connectionId: string, clusterId: string, namespace: string): Promise<K8sPod[]> {
    const raw = await this.listK8sResourcesFor(connectionId, clusterId, 'pods', namespace);
    return raw.map(mapPod);
  }

  async listDeploymentsFor(connectionId: string, clusterId: string, namespace: string): Promise<K8sDeployment[]> {
    const raw = await this.listK8sResourcesFor(connectionId, clusterId, 'deployments', namespace);
    return raw.map(mapDeployment);
  }

  async listServicesFor(connectionId: string, clusterId: string, namespace: string): Promise<K8sService[]> {
    const raw = await this.listK8sResourcesFor(connectionId, clusterId, 'services', namespace);
    return raw.map(mapService);
  }

  async scaleDeploymentFor(connectionId: string, clusterId: string, namespace: string, name: string, replicas: number): Promise<void> {
    await this.backend.requestFor(connectionId, 'POST', `/api/clusters/${clusterId}/namespaces/${namespace}/deployments/${name}/scale`, { replicas });
  }

  async restartDeploymentFor(connectionId: string, clusterId: string, namespace: string, name: string): Promise<void> {
    await this.backend.requestFor(connectionId, 'POST', `/api/clusters/${clusterId}/namespaces/${namespace}/deployments/${name}/restart`);
  }

  async scaleStatefulSetFor(connectionId: string, clusterId: string, namespace: string, name: string, replicas: number): Promise<void> {
    await this.backend.requestFor(connectionId, 'POST', `/api/clusters/${clusterId}/namespaces/${namespace}/statefulsets/${name}/scale`, { replicas });
  }

  async restartStatefulSetFor(connectionId: string, clusterId: string, namespace: string, name: string): Promise<void> {
    await this.backend.requestFor(connectionId, 'POST', `/api/clusters/${clusterId}/namespaces/${namespace}/statefulsets/${name}/restart`);
  }

  async restartDaemonSetFor(connectionId: string, clusterId: string, namespace: string, name: string): Promise<void> {
    await this.backend.requestFor(connectionId, 'POST', `/api/clusters/${clusterId}/namespaces/${namespace}/daemonsets/${name}/restart`);
  }

  // ---------- Pod logs ----------

  async getPodLogsFor(
    connectionId: string, clusterId: string, namespace: string, pod: string,
    opts?: { container?: string; tailLines?: number; sinceSeconds?: number; previous?: boolean; timestamps?: boolean }
  ): Promise<{ logs: string; container?: string }> {
    const params = new URLSearchParams();
    if (opts?.container) params.set('container', opts.container);
    if (opts?.tailLines != null) params.set('tailLines', String(opts.tailLines));
    if (opts?.sinceSeconds != null) params.set('sinceSeconds', String(opts.sinceSeconds));
    if (opts?.previous) params.set('previous', 'true');
    if (opts?.timestamps) params.set('timestamps', 'true');
    const qs = params.toString();
    return this.backend.requestFor(connectionId, 'GET',
      `/api/clusters/${clusterId}/namespaces/${namespace}/pods/${pod}/logs${qs ? `?${qs}` : ''}`
    );
  }

  getLogStreamInfo(
    connectionId: string, clusterId: string, namespace: string, pod: string,
    opts?: { container?: string; tailLines?: number; previous?: boolean; timestamps?: boolean }
  ): { url: string; token: string } | null {
    const conn = this.backend.getConnection(connectionId);
    if (!conn?.tokens?.accessToken) return null;
    const params = new URLSearchParams();
    if (opts?.container) params.set('container', opts.container);
    if (opts?.tailLines != null) params.set('tailLines', String(opts.tailLines));
    if (opts?.previous) params.set('previous', 'true');
    if (opts?.timestamps) params.set('timestamps', 'true');
    const qs = params.toString();
    return {
      url: `${conn.serverUrl}/api/clusters/${clusterId}/namespaces/${namespace}/pods/${pod}/logs/stream${qs ? `?${qs}` : ''}`,
      token: conn.tokens.accessToken,
    };
  }

  // ---------- Resource events ----------

  async getResourceEventsFor(connectionId: string, clusterId: string, namespace: string, kind: string, name: string): Promise<any[]> {
    const fieldSelector = `involvedObject.name=${name},involvedObject.kind=${kind}`;
    const params = `?namespace=${encodeURIComponent(namespace)}&fieldSelector=${encodeURIComponent(fieldSelector)}`;
    return this.backend.requestFor<any[]>(connectionId, 'GET', `/api/clusters/${clusterId}/resources/events${params}`);
  }

  // ---------- Topology ----------

  async getNamespaceTopologyFor(connectionId: string, clusterId: string, namespace: string): Promise<K8sTopology> {
    return this.backend.requestFor(connectionId, 'GET', `/api/clusters/${clusterId}/namespaces/${namespace}/topology`);
  }

  // ---------- Node management ----------

  async cordonNodeFor(connectionId: string, clusterId: string, node: string): Promise<void> {
    await this.backend.requestFor(connectionId, 'POST', `/api/clusters/${clusterId}/nodes/${node}/cordon`);
  }

  async uncordonNodeFor(connectionId: string, clusterId: string, node: string): Promise<void> {
    await this.backend.requestFor(connectionId, 'POST', `/api/clusters/${clusterId}/nodes/${node}/uncordon`);
  }

  async drainNodeFor(connectionId: string, clusterId: string, node: string, force?: boolean): Promise<{ status: string; evicted: number; errors?: string[] }> {
    return this.backend.requestFor(connectionId, 'POST', `/api/clusters/${clusterId}/nodes/${node}/drain`, force ? { force: true } : undefined);
  }

  // ---------- YAML apply ----------

  async applyYamlFor(connectionId: string, clusterId: string, yaml: string, namespace?: string): Promise<any> {
    return this.backend.requestFor(connectionId, 'POST', `/api/clusters/${clusterId}/apply`, { namespace, yaml });
  }

  // ---------- CRD discovery & custom resources ----------

  async discoverApiResourcesFor(connectionId: string, clusterId: string): Promise<K8sApiResource[]> {
    return this.backend.requestFor(connectionId, 'GET', `/api/clusters/${clusterId}/discovery`);
  }

  async listCustomResourcesFor(connectionId: string, clusterId: string, group: string, version: string, plural: string, namespace?: string): Promise<any[]> {
    const params = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
    return this.backend.requestFor(connectionId, 'GET', `/api/clusters/${clusterId}/custom/${group}/${version}/${plural}${params}`);
  }

  async getCustomResourceFor(connectionId: string, clusterId: string, group: string, version: string, plural: string, name: string, namespace?: string): Promise<any> {
    const params = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
    return this.backend.requestFor(connectionId, 'GET', `/api/clusters/${clusterId}/custom/${group}/${version}/${plural}/${name}${params}`);
  }

  async deleteCustomResourceFor(connectionId: string, clusterId: string, group: string, version: string, plural: string, name: string, namespace?: string): Promise<void> {
    const params = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
    await this.backend.requestFor(connectionId, 'DELETE', `/api/clusters/${clusterId}/custom/${group}/${version}/${plural}/${name}${params}`);
  }

  async applyCustomResourceFor(connectionId: string, clusterId: string, group: string, version: string, plural: string, yaml: string, namespace?: string): Promise<any> {
    return this.backend.requestFor(connectionId, 'POST', `/api/clusters/${clusterId}/custom/${group}/${version}/${plural}/apply`, { namespace, yaml });
  }

  // ---------- WebSocket URLs ----------

  getK8sExecWsUrl(connectionId: string, clusterId: string): { url: string; token: string } | null {
    const conn = this.backend.getConnection(connectionId);
    if (!conn?.tokens?.accessToken) return null;
    const serverUrl = conn.serverUrl;
    const wsProtocol = serverUrl.startsWith('https') ? 'wss' : 'ws';
    const host = serverUrl.replace(/^https?:\/\//, '');
    return {
      url: `${wsProtocol}://${host}/api/ws/k8s-exec/${clusterId}`,
      token: conn.tokens.accessToken,
    };
  }

  getK8sWatchWsUrl(connectionId: string, clusterId: string): { url: string; token: string } | null {
    const conn = this.backend.getConnection(connectionId);
    if (!conn?.tokens?.accessToken) return null;
    const serverUrl = conn.serverUrl;
    const wsProtocol = serverUrl.startsWith('https') ? 'wss' : 'ws';
    const host = serverUrl.replace(/^https?:\/\//, '');
    return {
      url: `${wsProtocol}://${host}/api/ws/k8s-watch/${clusterId}`,
      token: conn.tokens.accessToken,
    };
  }
}
