import { Injectable } from '@angular/core';
import { K8sPod, K8sDeployment, K8sService as K8sSvc } from '../../../core/models/backend.model';

/**
 * Pure display helpers and raw-resource mappers for K8s resources.
 * Extracted from K8sDashboardComponent to reduce component size.
 */
@Injectable({ providedIn: 'root' })
export class K8sResourceHelperService {

  getGenericStatus(res: any): string {
    return (res.status?.phase
      ?? res.status?.conditions?.find((c: any) => c.type === 'Ready')?.status
      ?? res.status?.conditions?.find((c: any) => c.type === 'Available')?.status
      ?? (res.status?.active != null ? `Active: ${res.status.active}` : ''))
      || 'N/A';
  }

  getGenericStatusClass(res: any): string {
    const status = this.getGenericStatus(res);
    if (['Running', 'Active', 'True', 'Bound', 'Ready'].some(s => status.includes(s))) return 'bg-green-500/20 text-green-400';
    if (['Pending', 'Waiting'].some(s => status.includes(s))) return 'bg-yellow-500/20 text-yellow-400';
    if (['Failed', 'Error', 'False'].some(s => status.includes(s))) return 'bg-red-500/20 text-red-400';
    return 'bg-zinc-700 text-zinc-400';
  }

  getResourceAge(res: any): string {
    const ts = res.metadata?.creationTimestamp;
    if (!ts) return 'unknown';
    const dur = Date.now() - new Date(ts).getTime();
    if (dur < 0) return '0m';
    const days = Math.floor(dur / 86400000);
    if (days > 0) return `${days}d`;
    const hours = Math.floor(dur / 3600000);
    if (hours > 0) return `${hours}h`;
    return `${Math.floor(dur / 60000)}m`;
  }

  getNodeStatus(node: any): string {
    const conditions = node.status?.conditions ?? [];
    const ready = conditions.find((c: any) => c.type === 'Ready');
    if (node.spec?.unschedulable) return 'Cordoned';
    if (ready?.status === 'True') return 'Ready';
    if (ready?.status === 'False') return 'NotReady';
    return 'Unknown';
  }

  getNodeStatusClass(node: any): string {
    const status = this.getNodeStatus(node);
    if (status === 'Ready') return 'bg-green-500/20 text-green-400';
    if (status === 'Cordoned') return 'bg-yellow-500/20 text-yellow-400';
    if (status === 'NotReady') return 'bg-red-500/20 text-red-400';
    return 'bg-zinc-700 text-zinc-400';
  }

  getNodeRoles(node: any): string {
    const labels = node.metadata?.labels ?? {};
    const roles: string[] = [];
    for (const [key] of Object.entries(labels)) {
      if (key.startsWith('node-role.kubernetes.io/')) {
        roles.push(key.replace('node-role.kubernetes.io/', ''));
      }
    }
    return roles.length > 0 ? roles.join(', ') : '<none>';
  }

  getNodeCapacity(node: any): string {
    const alloc = node.status?.allocatable;
    if (!alloc) return '-';
    const cpu = alloc.cpu ?? '?';
    const mem = alloc.memory ?? '?';
    return `${cpu} / ${mem}`;
  }

  getNodeTaints(node: any): string {
    const taints = node.spec?.taints ?? [];
    if (taints.length === 0) return '<none>';
    return taints.map((t: any) => `${t.key}=${t.value || ''}:${t.effect}`).join(', ');
  }

  mapPodFromRaw(raw: any): K8sPod {
    const containers = raw.spec?.containers ?? [];
    const statuses = raw.status?.containerStatuses ?? [];
    const readyCount = statuses.filter((s: any) => s.ready).length;
    const totalRestarts = statuses.reduce((sum: number, s: any) => sum + (s.restartCount ?? 0), 0);
    return {
      name: raw.metadata?.name ?? '',
      namespace: raw.metadata?.namespace ?? '',
      status: raw.status?.phase ?? 'Unknown',
      ready: `${readyCount}/${containers.length}`,
      restarts: totalRestarts,
      age: this.getResourceAge(raw),
      node: raw.spec?.nodeName,
    };
  }

  mapDeploymentFromRaw(raw: any): K8sDeployment {
    const desired = raw.spec?.replicas ?? 0;
    const ready = raw.status?.readyReplicas ?? 0;
    const upToDate = raw.status?.updatedReplicas ?? 0;
    const available = raw.status?.availableReplicas ?? 0;
    return {
      name: raw.metadata?.name ?? '',
      namespace: raw.metadata?.namespace ?? '',
      ready: `${ready}/${desired}`,
      upToDate,
      available,
      age: this.getResourceAge(raw),
    };
  }

  mapServiceFromRaw(raw: any): K8sSvc {
    const ports = (raw.spec?.ports ?? []).map((p: any) => `${p.port}/${p.protocol ?? 'TCP'}`);
    return {
      name: raw.metadata?.name ?? '',
      namespace: raw.metadata?.namespace ?? '',
      serviceType: raw.spec?.type ?? '',
      clusterIp: raw.spec?.clusterIP,
      externalIp: raw.status?.loadBalancer?.ingress?.[0]?.ip,
      ports,
      age: this.getResourceAge(raw),
    };
  }
}
