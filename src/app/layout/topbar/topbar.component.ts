import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BackendService } from '../../core/services/backend.service';
import { UiPreferencesState, LOCAL_CONNECTION_ID } from '../../state/ui-preferences.state';
import { Environment, Project } from '../../core/models/backend.model';
import { ConnectionSwitcherComponent } from './connection-switcher.component';
import { paletteFor } from '../../shared/components/a11y';

/**
 * Chrome topbar for the IA refactor (CON-124). Hosts the connection switcher
 * and scoped project/env pickers. Pickers disable + gray in local mode per
 * §2 of CON-115. The accent tint applied here is read by the main layout via
 * the shared `UiPreferencesState`; the focus ring of every control stays
 * neutral regardless of tint (SC 2.4.11).
 *
 * Unreachable-fallback rule (§8 Q2): when switching connections, if the
 * persisted project/env selection is no longer accessible the picker falls
 * back to the first accessible option and surfaces a `role="status"` banner
 * naming what changed.
 */
@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [CommonModule, ConnectionSwitcherComponent],
  templateUrl: './topbar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TopbarComponent {
  readonly backend = inject(BackendService);
  readonly ui = inject(UiPreferencesState);

  readonly projects = signal<Project[]>([]);
  readonly envs = signal<Environment[]>([]);
  readonly loadingProjects = signal(false);
  readonly loadingEnvs = signal(false);
  readonly fallbackBanner = signal<string | null>(null);

  readonly isLocal = computed(() => this.ui.isLocalMode());
  readonly activeProjectId = computed(() => {
    const conn = this.ui.activeConnectionId();
    return this.ui.projectFor(conn);
  });
  readonly activeEnvId = computed(() => {
    const conn = this.ui.activeConnectionId();
    const proj = this.activeProjectId();
    if (!proj) return null;
    return this.ui.envFor(conn, proj);
  });

  readonly accentRing = computed(() => {
    if (this.ui.disableConnectionTint()) return null;
    const id = this.ui.activeConnectionId();
    if (id === LOCAL_CONNECTION_ID) return null;
    return paletteFor(id).ring;
  });

  constructor() {
    // React to connection switch → reload projects list.
    effect(() => {
      const conn = this.ui.activeConnectionId();
      void this.reloadProjects(conn);
    });
    // React to project change → reload env list.
    effect(() => {
      const conn = this.ui.activeConnectionId();
      const proj = this.activeProjectId();
      void this.reloadEnvs(conn, proj);
    });
  }

  private async reloadProjects(connectionId: string): Promise<void> {
    if (connectionId === LOCAL_CONNECTION_ID) {
      this.projects.set([]);
      return;
    }
    const conn = this.backend.getConnection(connectionId);
    if (!conn || conn.status !== 'connected') {
      this.projects.set([]);
      return;
    }
    this.loadingProjects.set(true);
    try {
      const projects = await this.backend.loadProjectsFor(connectionId);
      this.projects.set(projects);
      this.reconcileProject(connectionId, projects);
    } catch (err) {
      console.warn('[topbar] loadProjectsFor failed', err);
      this.projects.set([]);
    } finally {
      this.loadingProjects.set(false);
    }
  }

  private async reloadEnvs(connectionId: string, projectId: string | null): Promise<void> {
    if (connectionId === LOCAL_CONNECTION_ID || !projectId) {
      this.envs.set([]);
      return;
    }
    this.loadingEnvs.set(true);
    try {
      const envs = await this.backend.listEnvironmentsFor(connectionId, projectId);
      this.envs.set(envs);
      this.reconcileEnv(connectionId, projectId, envs);
    } catch (err) {
      console.warn('[topbar] listEnvironmentsFor failed', err);
      this.envs.set([]);
    } finally {
      this.loadingEnvs.set(false);
    }
  }

  private reconcileProject(connectionId: string, projects: Project[]): void {
    const persisted = this.ui.projectFor(connectionId);
    if (persisted && projects.some((p) => p.id === persisted)) return;
    const first = projects[0] ?? null;
    this.ui.setProject(connectionId, first?.id ?? null);
    if (persisted && !projects.some((p) => p.id === persisted)) {
      this.fallbackBanner.set(
        `Previous project is no longer accessible${first ? `; switched to ${first.name}.` : '.'}`,
      );
    }
  }

  private reconcileEnv(connectionId: string, projectId: string, envs: Environment[]): void {
    const persisted = this.ui.envFor(connectionId, projectId);
    if (persisted && envs.some((e) => e.id === persisted)) return;
    const first = envs.find((e) => e.isDefault) ?? envs[0] ?? null;
    this.ui.setEnv(connectionId, projectId, first?.id ?? null);
    if (persisted && !envs.some((e) => e.id === persisted)) {
      this.fallbackBanner.set(
        `Previous environment is no longer accessible${first ? `; switched to ${first.name}.` : '.'}`,
      );
    }
  }

  onProjectChange(projectId: string): void {
    const conn = this.ui.activeConnectionId();
    this.ui.setProject(conn, projectId || null);
  }

  onEnvChange(envId: string): void {
    const conn = this.ui.activeConnectionId();
    const proj = this.activeProjectId();
    if (!proj) return;
    this.ui.setEnv(conn, proj, envId || null);
  }

  dismissBanner(): void {
    this.fallbackBanner.set(null);
  }
}
