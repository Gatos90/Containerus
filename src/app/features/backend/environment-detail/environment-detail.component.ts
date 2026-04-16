import { Component, inject, signal, viewChild, OnInit, OnDestroy, HostListener } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { BackendService } from '../../../core/services/backend.service';
import { BackendConnection, Environment, Project } from '../../../core/models/backend.model';
import {
  LucideAngularModule,
  ArrowLeft, ChevronRight, ChevronDown, Monitor, Server, Loader2, Trash2, Cloud, Search, RefreshCw, Plus, Settings,
} from 'lucide-angular';
import { ProjectResourcesComponent } from '../project-resources/project-resources.component';
import { ProjectServersComponent } from '../project-servers/project-servers.component';
import { K8sDashboardComponent } from '../k8s-dashboard/k8s-dashboard.component';

type EnvironmentTab = 'resources' | 'servers' | 'kubernetes';

@Component({
  selector: 'app-environment-detail',
  imports: [
    RouterLink,
    FormsModule,
    LucideAngularModule,
    ProjectResourcesComponent,
    ProjectServersComponent,
    K8sDashboardComponent,
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
        <div class="flex items-center justify-between px-4 border-b border-zinc-800">
          <div class="flex gap-1">
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
          <!-- Tab-specific controls (right side) -->
          @if (activeTab() === 'resources' && resourcesComp()) {
            <div class="flex items-center gap-2 py-1.5">
              <div class="relative">
                <lucide-icon [img]="Search" [size]="13" class="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Search..."
                  [ngModel]="resourcesComp()!.searchQuery()"
                  (ngModelChange)="resourcesComp()!.searchQuery.set($event)"
                  class="h-8 w-44 pl-8 pr-3 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <select
                [ngModel]="resourcesComp()!.statusFilter()"
                (ngModelChange)="resourcesComp()!.statusFilter.set($event)"
                class="h-8 px-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-100 focus:border-blue-500 focus:outline-none"
              >
                <option [ngValue]="null">All Status</option>
                <option value="running">Running</option>
                <option value="exited">Stopped</option>
                <option value="paused">Paused</option>
                <option value="created">Created</option>
              </select>
              <button
                (click)="resourcesComp()!.refresh()"
                [disabled]="resourcesComp()!.refreshing()"
                class="flex items-center gap-1 text-zinc-400 hover:text-zinc-200 text-xs border border-zinc-700 rounded-lg px-2.5 h-8 hover:bg-zinc-800 transition-colors"
              >
                <lucide-icon [img]="RefreshCw" [size]="13" [class.animate-spin]="resourcesComp()!.refreshing()" />
              </button>
            </div>
          }
          @if (activeTab() === 'servers' && serversComp()) {
            <div class="flex items-center gap-2 py-1.5">
              <div class="relative">
                <lucide-icon [img]="Search" [size]="13" class="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Search..."
                  [ngModel]="serversComp()!.searchQuery()"
                  (ngModelChange)="serversComp()!.searchQuery.set($event)"
                  class="h-8 w-44 pl-8 pr-3 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <button
                (click)="serversComp()!.refresh()"
                [disabled]="serversComp()!.refreshing()"
                class="flex items-center gap-1 text-zinc-400 hover:text-zinc-200 text-xs border border-zinc-700 rounded-lg px-2.5 h-8 hover:bg-zinc-800 transition-colors"
              >
                <lucide-icon [img]="RefreshCw" [size]="13" [class.animate-spin]="serversComp()!.refreshing()" />
              </button>
            </div>
          }
          @if (activeTab() === 'kubernetes' && k8sComp()) {
            <div class="flex items-center gap-2 py-1.5">
              <!-- Cluster dropdown -->
              <div class="relative cluster-dropdown-wrapper">
                <button
                  (click)="toggleClusterDropdown()"
                  class="h-8 px-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-100 hover:border-zinc-600 transition-colors flex items-center gap-2 max-w-[200px]"
                >
                  @if (k8sComp()!.selectedCluster(); as cluster) {
                    <div
                      class="w-2 h-2 rounded-full shrink-0"
                      [class]="k8sComp()!.getClusterStatusDotClass(cluster.id)"
                    ></div>
                    <span class="truncate">{{ cluster.name }}</span>
                  } @else {
                    <span class="text-zinc-500">Select Cluster</span>
                  }
                  <lucide-icon [img]="ChevronDown" [size]="12" class="shrink-0 text-zinc-500" />
                </button>
                @if (showClusterDropdown()) {
                  <div class="absolute top-full left-0 mt-1 w-72 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 overflow-hidden">
                    <div class="max-h-64 overflow-y-auto">
                      @for (cluster of k8sComp()!.allClusters(); track cluster.id) {
                        <button
                          (click)="selectClusterFromDropdown(cluster)"
                          class="w-full px-3 py-2 flex items-center gap-2.5 hover:bg-zinc-700/50 transition-colors text-left"
                          [class.bg-zinc-700/30]="k8sComp()!.selectedCluster()?.id === cluster.id"
                        >
                          <div
                            class="w-2 h-2 rounded-full shrink-0"
                            [class]="k8sComp()!.getClusterStatusDotClass(cluster.id)"
                          ></div>
                          <div class="min-w-0 flex-1">
                            <div class="text-xs text-zinc-200 truncate">{{ cluster.name }}</div>
                            <div class="text-[10px] text-zinc-500 truncate">{{ cluster.apiServerUrl }}</div>
                          </div>
                        </button>
                      }
                      @if (k8sComp()!.allClusters().length === 0) {
                        <div class="px-3 py-3 text-xs text-zinc-500 text-center">No clusters</div>
                      }
                    </div>
                    <div class="border-t border-zinc-700 px-1 py-1 flex gap-1">
                      <button
                        (click)="k8sComp()!.openAddClusterModal(); showClusterDropdown.set(false)"
                        class="flex-1 flex items-center gap-1.5 px-2 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50 rounded transition-colors"
                      >
                        <lucide-icon [img]="Plus" [size]="12" />
                        Add Cluster
                      </button>
                      <button
                        (click)="k8sComp()!.showManageView(); showClusterDropdown.set(false)"
                        class="flex-1 flex items-center gap-1.5 px-2 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50 rounded transition-colors"
                      >
                        <lucide-icon [img]="Settings" [size]="12" />
                        Manage
                      </button>
                    </div>
                  </div>
                }
              </div>
              <!-- Namespace dropdown (only when cluster selected) -->
              @if (k8sComp()!.selectedCluster()) {
                <select
                  [ngModel]="k8sComp()!.selectedNs()"
                  (ngModelChange)="k8sComp()!.selectNamespace($event)"
                  class="h-8 px-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-100 focus:border-blue-500 focus:outline-none max-w-[160px]"
                >
                  @for (ns of k8sComp()!.namespaces(); track ns.name) {
                    <option [value]="ns.name">{{ ns.name }}</option>
                  }
                </select>
                <!-- Search -->
                <div class="relative">
                  <lucide-icon [img]="Search" [size]="13" class="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="text"
                    placeholder="Filter..."
                    [ngModel]="k8sComp()!.searchFilter()"
                    (ngModelChange)="k8sComp()!.searchFilter.set($event)"
                    class="h-8 w-36 pl-8 pr-3 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <!-- Refresh -->
                <button
                  (click)="k8sComp()!.refreshData()"
                  [disabled]="k8sComp()!.refreshing()"
                  class="flex items-center gap-1 text-zinc-400 hover:text-zinc-200 text-xs border border-zinc-700 rounded-lg px-2.5 h-8 hover:bg-zinc-800 transition-colors"
                >
                  <lucide-icon [img]="RefreshCw" [size]="13" [class.animate-spin]="k8sComp()!.refreshing()" />
                </button>
              }
            </div>
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
            @case ('kubernetes') {
              <app-k8s-dashboard
                [connectionId]="connectionId()"
              />
            }
          }
        </div>
      }
    </div>
  `,
})
export class EnvironmentDetailComponent implements OnInit {
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.cluster-dropdown-wrapper')) {
      this.showClusterDropdown.set(false);
    }
  }

  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private backend = inject(BackendService);

  readonly ArrowLeft = ArrowLeft;
  readonly ChevronRight = ChevronRight;
  readonly Monitor = Monitor;
  readonly Server = Server;
  readonly Loader2 = Loader2;
  readonly Trash2 = Trash2;
  readonly Cloud = Cloud;
  readonly Search = Search;
  readonly RefreshCw = RefreshCw;
  readonly ChevronDown = ChevronDown;
  readonly Plus = Plus;
  readonly Settings = Settings;

  showClusterDropdown = signal(false);

  resourcesComp = viewChild(ProjectResourcesComponent);
  serversComp = viewChild(ProjectServersComponent);
  k8sComp = viewChild(K8sDashboardComponent);

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
    { key: 'kubernetes', label: 'Kubernetes', icon: Cloud },
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

  toggleClusterDropdown(): void {
    this.showClusterDropdown.update(v => !v);
  }

  selectClusterFromDropdown(cluster: any): void {
    this.k8sComp()?.selectCluster(cluster);
    this.showClusterDropdown.set(false);
  }

}
