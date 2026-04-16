import { CommonModule } from '@angular/common';
import { Component, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';

export type AuditEventType = 'deploy' | 'config_change' | 'access' | 'scale' | 'secret' | 'rollback';

export interface ProjectAuditEntry {
  id: string;
  timestamp: string;
  user: string;
  eventType: AuditEventType;
  resource: string;
  details: string;
  status: 'success' | 'failure' | 'pending';
}

@Component({
  selector: 'app-project-audit',
  imports: [CommonModule, FormsModule],
  templateUrl: './project-audit.component.html',
})
export class ProjectAuditComponent {
  searchQuery = signal('');
  eventTypeFilter = signal<AuditEventType | ''>('');

  entries = signal<ProjectAuditEntry[]>([
    { id: '1', timestamp: '2024-01-15T15:10:00Z', user: 'alice', eventType: 'deploy', resource: 'api-server v2.4.1', details: 'Deployed to production namespace', status: 'success' },
    { id: '2', timestamp: '2024-01-15T14:55:30Z', user: 'bob', eventType: 'config_change', resource: 'app-config', details: 'Updated DATABASE_URL and MAX_CONNECTIONS', status: 'success' },
    { id: '3', timestamp: '2024-01-15T14:40:00Z', user: 'ci-pipeline', eventType: 'deploy', resource: 'frontend v1.9.2', details: 'Deployment failed: image pull error', status: 'failure' },
    { id: '4', timestamp: '2024-01-15T14:30:15Z', user: 'alice', eventType: 'scale', resource: 'worker-pool', details: 'Scaled replicas from 3 to 6', status: 'success' },
    { id: '5', timestamp: '2024-01-15T14:20:00Z', user: 'admin', eventType: 'secret', resource: 'db-credentials', details: 'Rotated production database password', status: 'success' },
    { id: '6', timestamp: '2024-01-15T14:10:45Z', user: 'charlie', eventType: 'access', resource: 'production namespace', details: 'Granted read access to monitoring service account', status: 'success' },
    { id: '7', timestamp: '2024-01-15T13:55:00Z', user: 'alice', eventType: 'rollback', resource: 'api-server', details: 'Rolled back to v2.3.9 due to 500 error spike', status: 'success' },
    { id: '8', timestamp: '2024-01-15T13:40:22Z', user: 'ci-pipeline', eventType: 'deploy', resource: 'api-server v2.4.0', details: 'Rolling update in progress', status: 'pending' },
  ]);

  filteredEntries = computed(() => {
    const q = this.searchQuery().toLowerCase();
    const t = this.eventTypeFilter();
    return this.entries().filter(e =>
      (!q || e.user.includes(q) || e.resource.toLowerCase().includes(q) || e.details.toLowerCase().includes(q)) &&
      (!t || e.eventType === t)
    );
  });

  eventTypeBadgeClass(type: AuditEventType): string {
    switch (type) {
      case 'deploy': return 'bg-blue-900/50 text-blue-400 border border-blue-700/50';
      case 'rollback': return 'bg-orange-900/50 text-orange-400 border border-orange-700/50';
      case 'config_change': return 'bg-purple-900/50 text-purple-400 border border-purple-700/50';
      case 'scale': return 'bg-cyan-900/50 text-cyan-400 border border-cyan-700/50';
      case 'secret': return 'bg-red-900/50 text-red-400 border border-red-700/50';
      case 'access': return 'bg-zinc-800 text-zinc-400 border border-zinc-700';
    }
  }

  statusBadgeClass(status: ProjectAuditEntry['status']): string {
    switch (status) {
      case 'success': return 'text-green-400';
      case 'failure': return 'text-red-400';
      case 'pending': return 'text-yellow-400';
    }
  }

  eventTypeLabel(type: AuditEventType): string {
    return type.replace('_', ' ');
  }
}
