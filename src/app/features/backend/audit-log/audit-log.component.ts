import { CommonModule } from '@angular/common';
import { Component, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';

export type AuditVerb = 'create' | 'update' | 'delete' | 'get' | 'list' | 'watch';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  user: string;
  verb: AuditVerb;
  resource: string;
  namespace: string;
  name: string;
  statusCode: number;
}

@Component({
  selector: 'app-audit-log',
  imports: [CommonModule, FormsModule],
  templateUrl: './audit-log.component.html',
})
export class AuditLogComponent {
  searchQuery = signal('');
  verbFilter = signal<AuditVerb | ''>('');

  entries = signal<AuditLogEntry[]>([
    { id: '1', timestamp: '2024-01-15T14:32:11Z', user: 'admin', verb: 'create', resource: 'pods', namespace: 'default', name: 'nginx-deploy', statusCode: 201 },
    { id: '2', timestamp: '2024-01-15T14:31:05Z', user: 'ci-bot', verb: 'update', resource: 'deployments', namespace: 'default', name: 'api-server', statusCode: 200 },
    { id: '3', timestamp: '2024-01-15T14:29:44Z', user: 'admin', verb: 'delete', resource: 'pods', namespace: 'kube-system', name: 'old-pod-xyz', statusCode: 200 },
    { id: '4', timestamp: '2024-01-15T14:28:30Z', user: 'monitor', verb: 'list', resource: 'nodes', namespace: '', name: '', statusCode: 200 },
    { id: '5', timestamp: '2024-01-15T14:27:10Z', user: 'developer', verb: 'get', resource: 'secrets', namespace: 'default', name: 'db-credentials', statusCode: 403 },
    { id: '6', timestamp: '2024-01-15T14:25:00Z', user: 'admin', verb: 'create', resource: 'services', namespace: 'staging', name: 'frontend-svc', statusCode: 201 },
    { id: '7', timestamp: '2024-01-15T14:22:48Z', user: 'ci-bot', verb: 'update', resource: 'configmaps', namespace: 'default', name: 'app-config', statusCode: 200 },
    { id: '8', timestamp: '2024-01-15T14:20:15Z', user: 'admin', verb: 'delete', resource: 'namespaces', namespace: '', name: 'old-staging', statusCode: 200 },
  ]);

  filteredEntries = computed(() => {
    const q = this.searchQuery().toLowerCase();
    const v = this.verbFilter();
    return this.entries().filter(e =>
      (!q || e.user.includes(q) || e.resource.includes(q) || e.name.includes(q) || e.namespace.includes(q)) &&
      (!v || e.verb === v)
    );
  });

  verbBadgeClass(verb: AuditVerb): string {
    switch (verb) {
      case 'create': return 'bg-green-900/50 text-green-400 border border-green-700/50';
      case 'update': return 'bg-blue-900/50 text-blue-400 border border-blue-700/50';
      case 'delete': return 'bg-red-900/50 text-red-400 border border-red-700/50';
      case 'get':
      case 'list':
      case 'watch': return 'bg-zinc-800 text-zinc-400 border border-zinc-700';
    }
  }

  statusBadgeClass(code: number): string {
    if (code >= 200 && code < 300) return 'text-green-400';
    if (code >= 400 && code < 500) return 'text-yellow-400';
    return 'text-red-400';
  }
}
