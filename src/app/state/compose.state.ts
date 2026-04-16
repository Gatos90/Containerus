import { computed, inject, Injectable, signal } from '@angular/core';
import { ContainerRuntime } from '../core/models/container.model';
import {
  ComposeProject,
  ComposeProjectService,
  ComposeProjectStatus,
} from '../core/models/compose.model';
import { ComposeApiService } from '../core/services/compose.service';
import { ContainerState } from './container.state';

@Injectable({ providedIn: 'root' })
export class ComposeState {
  private readonly containerState = inject(ContainerState);
  private readonly composeApi = inject(ComposeApiService);

  private _loading = signal<Record<string, boolean>>({});
  private _error = signal<string | null>(null);
  private _searchQuery = signal<string>('');
  private _systemFilter = signal<string | null>(null);
  private _statusFilter = signal<ComposeProjectStatus | null>(null);
  private _expandedLogs = signal<Record<string, string>>({});

  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly searchQuery = this._searchQuery.asReadonly();
  readonly systemFilter = this._systemFilter.asReadonly();
  readonly statusFilter = this._statusFilter.asReadonly();
  readonly expandedLogs = this._expandedLogs.asReadonly();

  /**
   * Compose projects derived purely from existing container labels.
   * Docker Compose v2 labels: com.docker.compose.project,
   * com.docker.compose.service, com.docker.compose.project.working_dir,
   * com.docker.compose.project.config_files
   */
  readonly projects = computed((): ComposeProject[] => {
    const containers = this.containerState.containers();
    const projectMap = new Map<string, ComposeProject>();

    for (const container of containers) {
      const projectName = container.labels?.['com.docker.compose.project'];
      if (!projectName) continue;

      const serviceName =
        container.labels?.['com.docker.compose.service'] ?? 'default';
      const workingDir =
        container.labels?.['com.docker.compose.project.working_dir'] ?? '';
      const configFiles =
        container.labels?.['com.docker.compose.project.config_files'] ?? '';

      const projectId = `${container.systemId}::${container.runtime}::${projectName}`;

      if (!projectMap.has(projectId)) {
        projectMap.set(projectId, {
          id: projectId,
          name: projectName,
          systemId: container.systemId,
          runtime: container.runtime,
          workingDir,
          configFiles,
          services: [],
          status: 'stopped',
          serviceCount: 0,
          runningCount: 0,
        });
      }

      const project = projectMap.get(projectId)!;

      // Update working dir from the first container that has it
      if (!project.workingDir && workingDir) {
        project.workingDir = workingDir;
      }
      if (!project.configFiles && configFiles) {
        project.configFiles = configFiles;
      }

      // Find or create the service entry
      let service: ComposeProjectService | undefined = project.services.find(
        (s) => s.name === serviceName,
      );
      if (!service) {
        service = { name: serviceName, containers: [], status: 'stopped' };
        project.services.push(service);
      }

      service.containers.push(container);

      // Promote service status: running wins over any stopped state
      if (container.status === 'running') {
        service.status = 'running';
      } else if (service.status !== 'running') {
        service.status = container.status;
      }
    }

    // Compute aggregate project status
    for (const project of projectMap.values()) {
      const total = project.services.length;
      const running = project.services.filter(
        (s) => s.status === 'running',
      ).length;

      if (running === total && total > 0) {
        project.status = 'running';
      } else if (running > 0) {
        project.status = 'partially_running';
      } else {
        project.status = 'stopped';
      }

      project.serviceCount = total;
      project.runningCount = running;
    }

    return Array.from(projectMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  });

  readonly filteredProjects = computed(() => {
    let result = this.projects();

    const systemFilter = this._systemFilter();
    if (systemFilter) {
      result = result.filter((p) => p.systemId === systemFilter);
    }

    const statusFilter = this._statusFilter();
    if (statusFilter) {
      result = result.filter((p) => p.status === statusFilter);
    }

    const query = this._searchQuery().toLowerCase();
    if (query) {
      result = result.filter((p) => p.name.toLowerCase().includes(query));
    }

    return result;
  });

  readonly stats = computed(() => {
    const projects = this.projects();
    return {
      total: projects.length,
      running: projects.filter((p) => p.status === 'running').length,
      partial: projects.filter((p) => p.status === 'partially_running').length,
      stopped: projects.filter((p) => p.status === 'stopped').length,
    };
  });

  readonly projectsBySystem = computed(() => {
    const grouped: Record<string, ComposeProject[]> = {};
    for (const project of this.projects()) {
      if (!grouped[project.systemId]) {
        grouped[project.systemId] = [];
      }
      grouped[project.systemId].push(project);
    }
    return grouped;
  });

  // ── Actions ─────────────────────────────────────────────────────────────────

  async composeUp(project: ComposeProject): Promise<boolean> {
    this._setLoading(project.id, true);
    this._error.set(null);
    try {
      await this.composeApi.composeUp(
        project.systemId,
        project.name,
        project.runtime,
      );
      return true;
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : 'compose up failed');
      return false;
    } finally {
      this._setLoading(project.id, false);
    }
  }

  async composeDown(project: ComposeProject): Promise<boolean> {
    this._setLoading(project.id, true);
    this._error.set(null);
    try {
      await this.composeApi.composeDown(
        project.systemId,
        project.name,
        project.runtime,
      );
      return true;
    } catch (err) {
      this._error.set(
        err instanceof Error ? err.message : 'compose down failed',
      );
      return false;
    } finally {
      this._setLoading(project.id, false);
    }
  }

  async composeRestart(
    project: ComposeProject,
    serviceName?: string,
  ): Promise<boolean> {
    const key = serviceName ? `${project.id}::${serviceName}` : project.id;
    this._setLoading(key, true);
    this._error.set(null);
    try {
      await this.composeApi.composeRestart(
        project.systemId,
        project.name,
        project.runtime,
        serviceName,
      );
      return true;
    } catch (err) {
      this._error.set(
        err instanceof Error ? err.message : 'compose restart failed',
      );
      return false;
    } finally {
      this._setLoading(key, false);
    }
  }

  async loadLogs(
    project: ComposeProject,
    serviceName?: string,
    tail: number = 100,
  ): Promise<void> {
    const key = serviceName ? `${project.id}::${serviceName}` : project.id;
    this._setLoading(`logs::${key}`, true);
    this._error.set(null);
    try {
      const logs = await this.composeApi.composeLogs(
        project.systemId,
        project.name,
        project.runtime,
        serviceName,
        tail,
      );
      this._expandedLogs.update((m) => ({ ...m, [key]: logs }));
    } catch (err) {
      this._error.set(
        err instanceof Error ? err.message : 'Failed to fetch logs',
      );
    } finally {
      this._setLoading(`logs::${key}`, false);
    }
  }

  clearLogs(key: string): void {
    this._expandedLogs.update((m) => {
      const copy = { ...m };
      delete copy[key];
      return copy;
    });
  }

  // ── Filters ──────────────────────────────────────────────────────────────────

  setSearchQuery(query: string): void {
    this._searchQuery.set(query);
  }

  setSystemFilter(systemId: string | null): void {
    this._systemFilter.set(systemId);
  }

  setStatusFilter(status: ComposeProjectStatus | null): void {
    this._statusFilter.set(status);
  }

  clearFilters(): void {
    this._searchQuery.set('');
    this._systemFilter.set(null);
    this._statusFilter.set(null);
  }

  isLoading(key: string): boolean {
    return this._loading()[key] ?? false;
  }

  clearError(): void {
    this._error.set(null);
  }

  private _setLoading(key: string, loading: boolean): void {
    this._loading.update((l) => ({ ...l, [key]: loading }));
  }
}
