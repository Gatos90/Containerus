import { Injectable } from '@angular/core';
import { AuditLogEntry } from '../models/backend.model';
import { BackendService } from './backend.service';

/**
 * Handles audit log retrieval for backend projects.
 */
@Injectable({ providedIn: 'root' })
export class BackendAuditService {
  constructor(private backend: BackendService) {}

  async getAuditLogsFor(connectionId: string, projectId: string, params?: { limit?: number; offset?: number; action?: string }): Promise<AuditLogEntry[]> {
    const query = new URLSearchParams();
    if (params?.limit != null) query.set('limit', String(params.limit));
    if (params?.offset != null) query.set('offset', String(params.offset));
    if (params?.action) query.set('action', params.action);
    const qs = query.toString();
    return this.backend.requestFor<AuditLogEntry[]>(connectionId, 'GET', `/api/projects/${projectId}/audit${qs ? `?${qs}` : ''}`);
  }

  async getAuditLogs(projectId: string, params?: { limit?: number; offset?: number; action?: string }): Promise<AuditLogEntry[]> {
    const conn = this.backend.connectedBackends()[0];
    if (!conn) return [];
    return this.getAuditLogsFor(conn.id, projectId, params);
  }
}
