import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BackendService } from '../../../core/services/backend.service';
import { BackendConnection, Environment, Project } from '../../../core/models/backend.model';
import {
  LucideAngularModule,
  ArrowLeft, ChevronRight, Monitor, Server, Loader2, Trash2,
} from 'lucide-angular';
import { ProjectResourcesComponent } from '../project-resources/project-resources.component';
import { ProjectServersComponent } from '../project-servers/project-servers.component';

type EnvironmentTab = 'resources' | 'servers';

@Component({
  selector: 'app-environment-detail',
  imports: [
    RouterLink,
    LucideAngularModule,
    ProjectResourcesComponent,
    ProjectServersComponent,
  ],
  template: `
    <div class="flex flex-col h-full">
      <!-- Header -->
      <div class="p-3 sm:p-4 md:px-6 md:py-4 border-b border-zinc-800">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3 min-w-0">
            <button
              (click)="goBack()"
              class="text-zinc-400 hover:text-zinc-200 p-1.5 rounded-lg hover:bg-zinc-800 transition-colors flex-shrink-0"
              title="Back to project"
            >
              <lucide-icon [img]="ArrowLeft" [size]="18" />
            </button>

            <div class="min-w-0">
              <!-- Breadcrumb -->
              <div class="flex items-center gap-1.5 text-xs text-zinc-500">
                <a
                  [routerLink]="['/backends']"
                  class="hover:text-zinc-300 transition-colors"
                >Backends</a>
                <lucide-icon [img]="ChevronRight" [size]="12" />
                <a
                  [routerLink]="['/backends', connectionId()]"
                  class="hover:text-zinc-300 transition-colors truncate"
                >{{ connection()?.label ?? 'Unknown' }}</a>
                <lucide-icon [img]="ChevronRight" [size]="12" />
                <a
                  [routerLink]="['/backends', connectionId(), 'projects', projectId()]"
                  class="hover:text-zinc-300 transition-colors truncate"
                >{{ project()?.name ?? 'Unknown Project' }}</a>
                <lucide-icon [img]="ChevronRight" [size]="12" />
                <span class="text-zinc-300 truncate">{{ environment()?.name ?? 'Unknown Environment' }}</span>
              </div>

              <h1 class="text-lg font-semibold text-zinc-100 truncate mt-0.5">
                {{ environment()?.name ?? 'Unknown Environment' }}
              </h1>
            </div>
          </div>

          <!-- Delete Environment -->
          @if (confirmingDeleteEnv()) {
            <div class="flex items-center gap-1.5 flex-shrink-0">
              <button
                (click)="confirmingDeleteEnv.set(false)"
                class="text-xs text-zinc-400 hover:text-zinc-300 px-2 py-1 rounded hover:bg-zinc-800 transition-colors"
              >Cancel</button>
              <button
                (click)="deleteEnvironment()"
                class="text-xs text-red-400 bg-red-950/40 hover:bg-red-950/60 px-2.5 py-1 rounded transition-colors"
              >Delete</button>
            </div>
          } @else {
            <button
              (click)="confirmingDeleteEnv.set(true)"
              class="text-zinc-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-zinc-800/50 transition-colors flex-shrink-0"
              title="Delete environment"
            >
              <lucide-icon [img]="Trash2" [size]="16" />
            </button>
          }
        </div>
      </div>

      <!-- Loading state -->
      @if (loading()) {
        <div class="flex items-center justify-center gap-2 text-zinc-400 py-12">
          <lucide-icon [img]="Loader2" [size]="16" class="animate-spin" />
          Loading...
        </div>
      }

      <!-- Error state -->
      @if (error()) {
        <div class="p-4">
          <div class="text-red-400 text-sm bg-red-950/30 rounded-lg p-3">
            {{ error() }}
          </div>
        </div>
      }

      @if (!loading() && !error()) {
        <!-- Tab bar -->
        <div class="flex gap-1 px-4 border-b border-zinc-800">
          @for (tab of tabs; track tab.key) {
            <button
              (click)="setTab(tab.key)"
              class="px-4 py-2.5 text-sm transition-colors border-b-2 flex items-center gap-1.5"
              [class]="activeTab() === tab.key ? 'text-blue-400 border-blue-400' : 'text-zinc-400 border-transparent hover:text-zinc-300'"
            >
              <lucide-icon [img]="tab.icon" [size]="14" />
              {{ tab.label }}
            </button>
          }
        </div>

        <!-- Tab content -->
        <div class="flex-1 overflow-auto">
          @switch (activeTab()) {
            @case ('resources') {
              <app-project-resources
                [connectionId]="connectionId()"
                [projectId]="projectId()"
                [environmentId]="envId()"
              />
            }
            @case ('servers') {
              <app-project-servers
                [connectionId]="connectionId()"
                [projectId]="projectId()"
                [environmentId]="envId()"
              />
            }
          }
        </div>
      }
    </div>
  `,
})
export class EnvironmentDetailComponent implements OnInit {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private backend = inject(BackendService);

  readonly ArrowLeft = ArrowLeft;
  readonly ChevronRight = ChevronRight;
  readonly Monitor = Monitor;
  readonly Server = Server;
  readonly Loader2 = Loader2;
  readonly Trash2 = Trash2;

  connectionId = signal<string>('');
  projectId = signal<string>('');
  envId = signal<string>('');
  connection = signal<BackendConnection | undefined>(undefined);
  project = signal<Project | undefined>(undefined);
  environment = signal<Environment | undefined>(undefined);
  loading = signal(false);
  error = signal<string | null>(null);
  activeTab = signal<EnvironmentTab>('resources');
  confirmingDeleteEnv = signal(false);

  readonly tabs: { key: EnvironmentTab; label: string; icon: any }[] = [
    { key: 'resources', label: 'Resources', icon: Monitor },
    { key: 'servers', label: 'Servers', icon: Server },
  ];

  async ngOnInit(): Promise<void> {
    const connId = this.route.snapshot.paramMap.get('connectionId') ?? '';
    const projId = this.route.snapshot.paramMap.get('projectId') ?? '';
    const eId = this.route.snapshot.paramMap.get('envId') ?? '';
    this.connectionId.set(connId);
    this.projectId.set(projId);
    this.envId.set(eId);
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
          this.error.set('Failed to load connection');
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

      // Load environments and find the selected one
      const envs = await this.backend.listEnvironmentsFor(connId, projId);
      const env = envs.find(e => e.id === eId);
      this.environment.set(env);
      if (!env) {
        this.error.set('Environment not found');
        return;
      }
    } catch (e: any) {
      this.error.set(e.message ?? 'Failed to load environment');
    } finally {
      this.loading.set(false);
    }
  }

  setTab(tab: EnvironmentTab): void {
    this.activeTab.set(tab);
  }

  async deleteEnvironment(): Promise<void> {
    const env = this.environment();
    if (!env) return;

    this.confirmingDeleteEnv.set(false);
    this.error.set(null);
    try {
      await this.backend.deleteEnvironmentFor(this.connectionId(), this.projectId(), env.id);
      this.goBack();
    } catch (e: any) {
      this.error.set(e.message ?? 'Failed to delete environment');
    }
  }

  goBack(): void {
    this.router.navigate(['/backends', this.connectionId(), 'projects', this.projectId()]);
  }
}
