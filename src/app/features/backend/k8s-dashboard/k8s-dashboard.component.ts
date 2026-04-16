import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';

export interface K8sPod {
  name: string;
  namespace: string;
  status: 'Running' | 'Pending' | 'Failed' | 'Succeeded' | 'CrashLoopBackOff';
  restarts: number;
  age: string;
}

export interface K8sNode {
  name: string;
  status: 'Ready' | 'NotReady';
  roles: string;
  age: string;
  version: string;
}

export interface K8sService {
  name: string;
  namespace: string;
  type: 'ClusterIP' | 'NodePort' | 'LoadBalancer';
  clusterIp: string;
  port: string;
}

export interface K8sDeployment {
  name: string;
  namespace: string;
  ready: string;
  upToDate: number;
  available: number;
}

export interface K8sNamespace {
  name: string;
  status: 'Active' | 'Terminating';
  age: string;
}

export type K8sTab = 'pods' | 'nodes' | 'services' | 'deployments' | 'namespaces';

@Component({
  selector: 'app-k8s-dashboard',
  imports: [CommonModule],
  templateUrl: './k8s-dashboard.component.html',
})
export class K8sDashboardComponent {
  readonly tabs: K8sTab[] = ['pods', 'nodes', 'services', 'deployments', 'namespaces'];
  activeTab = signal<K8sTab>('pods');

  pods = signal<K8sPod[]>([
    { name: 'nginx-6b94b4c4c9-xk2rp', namespace: 'default', status: 'Running', restarts: 0, age: '2d' },
    { name: 'api-server-7d9f8b5c6-mnp4q', namespace: 'default', status: 'Running', restarts: 1, age: '5d' },
    { name: 'worker-5c8d9b7f4-tz9wv', namespace: 'kube-system', status: 'Pending', restarts: 0, age: '1h' },
    { name: 'redis-4b6c8d9f2-rq7st', namespace: 'default', status: 'CrashLoopBackOff', restarts: 5, age: '3h' },
  ]);

  nodes = signal<K8sNode[]>([
    { name: 'node-01', status: 'Ready', roles: 'control-plane,master', age: '30d', version: 'v1.28.4' },
    { name: 'node-02', status: 'Ready', roles: 'worker', age: '30d', version: 'v1.28.4' },
    { name: 'node-03', status: 'NotReady', roles: 'worker', age: '12d', version: 'v1.28.3' },
  ]);

  services = signal<K8sService[]>([
    { name: 'kubernetes', namespace: 'default', type: 'ClusterIP', clusterIp: '10.96.0.1', port: '443/TCP' },
    { name: 'nginx-svc', namespace: 'default', type: 'NodePort', clusterIp: '10.100.32.8', port: '80:30080/TCP' },
    { name: 'api-lb', namespace: 'default', type: 'LoadBalancer', clusterIp: '10.100.56.9', port: '8080:31080/TCP' },
  ]);

  deployments = signal<K8sDeployment[]>([
    { name: 'nginx', namespace: 'default', ready: '3/3', upToDate: 3, available: 3 },
    { name: 'api-server', namespace: 'default', ready: '2/2', upToDate: 2, available: 2 },
    { name: 'worker', namespace: 'default', ready: '0/1', upToDate: 1, available: 0 },
  ]);

  namespaces = signal<K8sNamespace[]>([
    { name: 'default', status: 'Active', age: '30d' },
    { name: 'kube-system', status: 'Active', age: '30d' },
    { name: 'kube-public', status: 'Active', age: '30d' },
    { name: 'monitoring', status: 'Active', age: '14d' },
    { name: 'staging', status: 'Terminating', age: '2d' },
  ]);

  setTab(tab: K8sTab): void {
    this.activeTab.set(tab);
  }

  podStatusClass(status: K8sPod['status']): string {
    switch (status) {
      case 'Running': return 'text-green-400';
      case 'Pending': return 'text-yellow-400';
      case 'Failed':
      case 'CrashLoopBackOff': return 'text-red-400';
      case 'Succeeded': return 'text-blue-400';
    }
  }

  nodeStatusClass(status: K8sNode['status']): string {
    return status === 'Ready' ? 'text-green-400' : 'text-red-400';
  }

  nsStatusClass(status: K8sNamespace['status']): string {
    return status === 'Active' ? 'text-green-400' : 'text-yellow-400';
  }
}
