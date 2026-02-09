import { Component, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { BackendService } from '../../../core/services/backend.service';
import { BackendConnection, Environment, Project } from '../../../core/models/backend.model';
import {
  LucideAngularModule,
  ArrowLeft, ChevronRight, Users, ScrollText, Loader2, Layers,
  Plus, Pencil, X, Trash2, Server, Cloud, ChevronRight as ChevronRightIcon,
} from 'lucide-angular';
import { ProjectMembersComponent } from '../project-members/project-members.component';
import { ProjectAuditComponent } from '../project-audit/project-audit.component';

type ProjectTab = 'environments' | 'members' | 'audit';

interface EnvironmentCounts {
  systems: number;
  clusters: number;
}

@Component({
  selector: 'app-project-detail',
  imports: [
    RouterLink,
    FormsModule,
    LucideAngularModule,
    ProjectMembersComponent,
    ProjectAuditComponent,
  ],
  templateUrl: './project-detail.component.html',
})
export class ProjectDetailComponent implements OnInit {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private backend = inject(BackendService);

  readonly ArrowLeft = ArrowLeft;
  readonly ChevronRight = ChevronRight;
  readonly Users = Users;
  readonly ScrollText = ScrollText;
  readonly Loader2 = Loader2;
  readonly Layers = Layers;
  readonly Plus = Plus;
  readonly Pencil = Pencil;
  readonly X = X;
  readonly Trash2 = Trash2;
  readonly Server = Server;
  readonly Cloud = Cloud;
  readonly ChevronRightIcon = ChevronRightIcon;

  connectionId = signal<string>('');
  projectId = signal<string>('');
  connection = signal<BackendConnection | undefined>(undefined);
  project = signal<Project | undefined>(undefined);
  environments = signal<Environment[]>([]);
  loading = signal(false);
  error = signal<string | null>(null);
  activeTab = signal<ProjectTab>('environments');

  // Environment CRUD state (absorbed from ProjectSettingsComponent)
  showAddEnvironment = signal(false);
  editingEnvironment = signal<Environment | null>(null);
  saving = signal(false);
  envError = signal<string | null>(null);
  newEnvName = '';
  newEnvDescription = '';
  editEnvName = '';
  editEnvDescription = '';

  // Resource counts per environment
  environmentCounts = signal<Map<string, EnvironmentCounts>>(new Map());

  // Inline confirm state
  confirmingDeleteProject = signal(false);
  confirmingDeleteEnvId = signal<string | null>(null);

  readonly tabs: { key: ProjectTab; label: string; icon: any }[] = [
    { key: 'environments', label: 'Environments', icon: Layers },
    { key: 'members', label: 'Members', icon: Users },
    { key: 'audit', label: 'Audit', icon: ScrollText },
  ];

  async ngOnInit(): Promise<void> {
    const connId = this.route.snapshot.paramMap.get('connectionId') ?? '';
    const projId = this.route.snapshot.paramMap.get('projectId') ?? '';
    this.connectionId.set(connId);
    this.projectId.set(projId);
    this.loading.set(true);

    try {
      await this.backend.waitForReady();

      let conn = this.backend.getConnection(connId);
      this.connection.set(conn);

      if (!conn || conn.status !== 'connected') {
        this.error.set('Backend not connected');
        return;
      }

      // Ensure projects are loaded
      if (conn.projects.length === 0) {
        await this.backend.loadProjectsFor(connId);
        conn = this.backend.getConnection(connId);
        if (!conn) {
          this.error.set('Connection lost while loading projects');
          return;
        }
        this.connection.set(conn);
      }

      const project = conn.projects.find(p => p.id === projId);
      this.project.set(project);
      if (!project) {
        this.error.set('Project not found');
        return;
      }

      // Load environments
      const envs = await this.backend.listEnvironmentsFor(connId, projId);
      this.environments.set(envs);

      // Load resource counts
      await this.loadEnvironmentCounts(envs);
    } catch (e: any) {
      this.error.set(e.message ?? 'Failed to load project');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadEnvironmentCounts(envs: Environment[]): Promise<void> {
    const connId = this.connectionId();
    const projId = this.projectId();
    const counts = new Map<string, EnvironmentCounts>();

    await Promise.all(
      envs.map(async (env) => {
        try {
          const [systems, clusters] = await Promise.all([
            this.backend.listSystemsInEnvironmentFor(connId, projId, env.id),
            this.backend.listClustersInEnvironmentFor(connId, projId, env.id),
          ]);
          counts.set(env.id, { systems: systems.length, clusters: clusters.length });
        } catch {
          counts.set(env.id, { systems: 0, clusters: 0 });
        }
      })
    );

    this.environmentCounts.set(counts);
  }

  getEnvCounts(envId: string): EnvironmentCounts {
    return this.environmentCounts().get(envId) ?? { systems: 0, clusters: 0 };
  }

  setTab(tab: ProjectTab): void {
    this.activeTab.set(tab);
  }

  openEnvironment(envId: string): void {
    this.router.navigate([
      '/backends', this.connectionId(), 'projects', this.projectId(), 'environments', envId,
    ]);
  }

  goBack(): void {
    this.router.navigate(['/backends', this.connectionId()]);
  }

  // ========================================================================
  // Environment CRUD (absorbed from ProjectSettingsComponent)
  // ========================================================================

  async createEnvironment(): Promise<void> {
    if (!this.newEnvName.trim()) return;

    this.saving.set(true);
    this.envError.set(null);
    try {
      await this.backend.createEnvironmentFor(this.connectionId(), this.projectId(), {
        name: this.newEnvName.trim(),
        slug: this.newEnvName.trim().toLowerCase().replace(/\s+/g, '-'),
        description: this.newEnvDescription.trim() || undefined,
      });
      this.newEnvName = '';
      this.newEnvDescription = '';
      this.showAddEnvironment.set(false);
      await this.reloadEnvironments();
    } catch (e: any) {
      this.envError.set(e.message ?? 'Failed to create environment');
    } finally {
      this.saving.set(false);
    }
  }

  startEditEnvironment(env: Environment): void {
    this.editingEnvironment.set(env);
    this.editEnvName = env.name;
    this.editEnvDescription = env.description ?? '';
  }

  cancelEditEnvironment(): void {
    this.editingEnvironment.set(null);
  }

  async updateEnvironment(): Promise<void> {
    const env = this.editingEnvironment();
    if (!env || !this.editEnvName.trim()) return;

    this.saving.set(true);
    this.envError.set(null);
    try {
      await this.backend.updateEnvironmentFor(this.connectionId(), this.projectId(), env.id, {
        name: this.editEnvName.trim(),
        slug: this.editEnvName.trim().toLowerCase().replace(/\s+/g, '-'),
        description: this.editEnvDescription.trim() || undefined,
      });
      this.editingEnvironment.set(null);
      await this.reloadEnvironments();
    } catch (e: any) {
      this.envError.set(e.message ?? 'Failed to update environment');
    } finally {
      this.saving.set(false);
    }
  }

  promptDeleteEnvironment(envId: string, envName: string): void {
    const counts = this.getEnvCounts(envId);
    if (counts.systems > 0 || counts.clusters > 0) {
      this.envError.set(
        `Cannot delete "${envName}" — it still has ${counts.systems} system${counts.systems !== 1 ? 's' : ''} and ${counts.clusters} cluster${counts.clusters !== 1 ? 's' : ''}. Remove all resources first.`
      );
      return;
    }
    this.confirmingDeleteEnvId.set(envId);
  }

  async deleteEnvironment(envId: string): Promise<void> {
    this.confirmingDeleteEnvId.set(null);
    this.envError.set(null);
    try {
      await this.backend.deleteEnvironmentFor(this.connectionId(), this.projectId(), envId);
      await this.reloadEnvironments();
    } catch (e: any) {
      this.envError.set(e.message ?? 'Failed to delete environment');
    }
  }

  promptDeleteProject(): void {
    const envCount = this.environments().length;
    if (envCount > 0) {
      this.error.set(`Cannot delete project with ${envCount} environment${envCount !== 1 ? 's' : ''}. Remove all environments first.`);
      return;
    }
    this.confirmingDeleteProject.set(true);
  }

  async deleteProject(): Promise<void> {
    const project = this.project();
    if (!project) return;

    this.confirmingDeleteProject.set(false);
    try {
      await this.backend.deleteProjectFor(this.connectionId(), project.id);
      this.router.navigate(['/backends', this.connectionId()]);
    } catch (e: any) {
      this.error.set(e.message ?? 'Failed to delete project');
    }
  }

  private async reloadEnvironments(): Promise<void> {
    const connId = this.connectionId();
    const projId = this.projectId();
    if (!connId || !projId) return;

    try {
      const envs = await this.backend.listEnvironmentsFor(connId, projId);
      this.environments.set(envs);
      await this.loadEnvironmentCounts(envs);
    } catch (e: any) {
      console.error('Failed to reload environments:', e);
    }
  }
}
