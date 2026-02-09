import { Component, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { BackendService } from '../../../core/services/backend.service';
import { BackendConnection, Project } from '../../../core/models/backend.model';
import { AppState } from '../../../state/app.state';
import {
  LucideAngularModule,
  ArrowLeft, Plus, LogOut, Loader2, FolderOpen, ChevronRight, X,
} from 'lucide-angular';

@Component({
  selector: 'app-project-list',
  imports: [FormsModule, DatePipe, LucideAngularModule],
  templateUrl: './project-list.component.html',
})
export class ProjectListComponent implements OnInit {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private backend = inject(BackendService);
  private appState = inject(AppState);

  readonly ArrowLeft = ArrowLeft;
  readonly Plus = Plus;
  readonly LogOut = LogOut;
  readonly Loader2 = Loader2;
  readonly FolderOpen = FolderOpen;
  readonly ChevronRight = ChevronRight;
  readonly X = X;

  connectionId = signal<string>('');
  connection = signal<BackendConnection | undefined>(undefined);
  loading = signal(false);
  error = signal<string | null>(null);
  showCreateForm = signal(false);
  creating = signal(false);
  createError = signal<string | null>(null);
  environmentCounts = signal<Map<string, number>>(new Map());

  newProjectName = '';
  newProjectDescription = '';

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('connectionId') ?? '';
    this.connectionId.set(id);
    this.connection.set(this.backend.getConnection(id));

    if (this.connection()?.status === 'connected') {
      this.loadProjects();
    }
  }

  get projects(): Project[] {
    return this.connection()?.projects ?? [];
  }

  async loadProjects(): Promise<void> {
    const connId = this.connectionId();
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.backend.loadProjectsFor(connId);
      this.connection.set(this.backend.getConnection(connId));
      await this.loadEnvironmentCounts();
    } catch (e: any) {
      this.error.set(e.message ?? 'Failed to load projects');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadEnvironmentCounts(): Promise<void> {
    const connId = this.connectionId();
    const projects = this.projects;
    const counts = new Map<string, number>();

    await Promise.all(
      projects.map(async (project) => {
        try {
          const envs = await this.backend.listEnvironmentsFor(connId, project.id);
          counts.set(project.id, envs.length);
        } catch {
          counts.set(project.id, 0);
        }
      })
    );

    this.environmentCounts.set(counts);
  }

  getEnvCount(projectId: string): number {
    return this.environmentCounts().get(projectId) ?? 0;
  }

  selectProject(projectId: string): void {
    this.router.navigate(['/backends', this.connectionId(), 'projects', projectId]);
  }

  goToLogin(): void {
    this.router.navigate(['/login'], {
      queryParams: { connectionId: this.connectionId() },
    });
  }

  goBack(): void {
    this.router.navigate(['/backends']);
  }

  async logout(): Promise<void> {
    this.backend.logoutFrom(this.connectionId());
    this.connection.set(this.backend.getConnection(this.connectionId()));
    this.environmentCounts.set(new Map());
    await this.appState.onBackendLogout();
  }

  toggleCreateForm(): void {
    this.showCreateForm.update(v => !v);
    if (!this.showCreateForm()) {
      this.newProjectName = '';
      this.newProjectDescription = '';
      this.createError.set(null);
    }
  }

  private generateSlug(name: string): string {
    return name
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  async createProject(): Promise<void> {
    if (!this.newProjectName.trim()) return;

    this.creating.set(true);
    this.createError.set(null);
    try {
      const slug = this.generateSlug(this.newProjectName);
      if (!slug) {
        this.createError.set('Project name must contain at least one alphanumeric character');
        return;
      }
      await this.backend.createProjectFor(this.connectionId(), {
        name: this.newProjectName.trim(),
        slug,
        description: this.newProjectDescription.trim() || undefined,
      });
      await this.backend.loadProjectsFor(this.connectionId());
      this.connection.set(this.backend.getConnection(this.connectionId()));
      this.newProjectName = '';
      this.newProjectDescription = '';
      this.showCreateForm.set(false);
      await this.loadEnvironmentCounts();
    } catch (e: any) {
      this.createError.set(e.message ?? 'Failed to create project');
    } finally {
      this.creating.set(false);
    }
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'connected': return 'bg-green-500';
      case 'connecting': return 'bg-amber-500 animate-pulse';
      case 'error': return 'bg-red-500';
      default: return 'bg-zinc-500';
    }
  }
}
