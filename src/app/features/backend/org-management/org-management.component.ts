import { Component, inject, signal, Input, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BackendService } from '../../../core/services/backend.service';
import { Environment, Project, ProjectMember, Role } from '../../../core/models/backend.model';
import { LucideAngularModule, Users, UserPlus, Crown, Shield, Eye, Loader2, Trash2, ChevronDown, Layers, Plus, Pencil, X } from 'lucide-angular';

@Component({
  selector: 'app-org-management',
  imports: [FormsModule, LucideAngularModule],
  template: `
    <div class="p-6 max-w-4xl mx-auto space-y-6">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-zinc-100 flex items-center gap-2">
            <lucide-icon [img]="Users" [size]="20" />
            Projects & Environments
          </h1>
          <p class="text-zinc-400 text-sm mt-1">
            {{ activeProject()?.name ?? 'No project selected' }}
          </p>
        </div>
      </div>

      <!-- Project Switcher -->
      @if (projects().length > 1) {
        <div class="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <label class="block text-sm font-medium text-zinc-300 mb-2">Active Project</label>
          <select
            class="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 w-full max-w-xs"
            [ngModel]="activeProject()?.id"
            (ngModelChange)="selectProject($event)"
          >
            @for (proj of projects(); track proj.id) {
              <option [value]="proj.id">{{ proj.name }}</option>
            }
          </select>
        </div>
      }

      <!-- Environments -->
      <div class="bg-zinc-900 rounded-xl border border-zinc-800 p-4 space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-medium text-zinc-200 flex items-center gap-2">
            <lucide-icon [img]="Layers" [size]="18" />
            Environments
          </h2>
          <button
            (click)="showAddEnvironment.set(true)"
            class="bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg px-3 py-1.5 flex items-center gap-1.5 transition-colors"
          >
            <lucide-icon [img]="Plus" [size]="14" />
            Add Environment
          </button>
        </div>

        @if (environmentsLoading()) {
          <div class="flex items-center gap-2 text-zinc-400 py-4">
            <lucide-icon [img]="Loader2" [size]="16" class="animate-spin" />
            Loading environments...
          </div>
        }

        @if (envError()) {
          <div class="text-red-400 text-sm bg-red-950/30 rounded-lg p-3">
            {{ envError() }}
          </div>
        }

        <div class="space-y-2">
          @for (env of environments(); track env.id) {
            <div class="flex items-center justify-between bg-zinc-800/50 rounded-lg p-3">
              @if (editingEnvironment()?.id === env.id) {
                <!-- Edit mode -->
                <div class="flex-1 flex items-center gap-2">
                  <input
                    type="text"
                    [(ngModel)]="editEnvName"
                    class="bg-zinc-700 border border-zinc-600 rounded-lg px-2 py-1 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 w-40"
                    (keydown.enter)="updateEnvironment()"
                    (keydown.escape)="editingEnvironment.set(null)"
                  />
                  <input
                    type="text"
                    [(ngModel)]="editEnvDescription"
                    placeholder="Description (optional)"
                    class="bg-zinc-700 border border-zinc-600 rounded-lg px-2 py-1 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 flex-1"
                    (keydown.enter)="updateEnvironment()"
                    (keydown.escape)="editingEnvironment.set(null)"
                  />
                </div>
                <div class="flex items-center gap-1 ml-2">
                  <button
                    (click)="updateEnvironment()"
                    class="text-green-400 hover:text-green-300 p-1 text-xs bg-green-500/10 rounded"
                  >
                    Save
                  </button>
                  <button
                    (click)="editingEnvironment.set(null)"
                    class="text-zinc-400 hover:text-zinc-300 p-1"
                  >
                    <lucide-icon [img]="X" [size]="14" />
                  </button>
                </div>
              } @else {
                <!-- View mode -->
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium text-zinc-200">{{ env.name }}</span>
                  @if (env.isDefault) {
                    <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400">default</span>
                  }
                  @if (env.description) {
                    <span class="text-xs text-zinc-500">{{ env.description }}</span>
                  }
                </div>
                <div class="flex items-center gap-1">
                  <button
                    (click)="startEditEnvironment(env)"
                    class="text-zinc-500 hover:text-zinc-300 p-1 transition-colors"
                    title="Edit environment"
                  >
                    <lucide-icon [img]="Pencil" [size]="13" />
                  </button>
                  @if (!env.isDefault) {
                    @if (confirmingDeleteEnvId() === env.id) {
                      <button
                        (click)="confirmingDeleteEnvId.set(null)"
                        class="text-[11px] text-zinc-400 hover:text-zinc-300 px-1.5 py-0.5 rounded hover:bg-zinc-800 transition-colors"
                      >Cancel</button>
                      <button
                        (click)="deleteEnvironment(env.id)"
                        class="text-[11px] text-red-400 bg-red-950/40 hover:bg-red-950/60 px-1.5 py-0.5 rounded transition-colors"
                      >Delete</button>
                    } @else {
                      <button
                        (click)="promptDeleteEnvironment(env.id)"
                        class="text-zinc-500 hover:text-red-400 p-1 transition-colors"
                        title="Delete environment"
                      >
                        <lucide-icon [img]="Trash2" [size]="13" />
                      </button>
                    }
                  }
                </div>
              }
            </div>
          } @empty {
            @if (!environmentsLoading()) {
              <p class="text-zinc-500 text-sm py-2">No environments found.</p>
            }
          }
        </div>

        <!-- Add Environment Inline Form -->
        @if (showAddEnvironment()) {
          <div class="border border-zinc-700 rounded-lg p-3 space-y-3">
            <div class="flex gap-2">
              <input
                type="text"
                [(ngModel)]="newEnvName"
                placeholder="Environment name (e.g. staging)"
                class="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                (keydown.enter)="createEnvironment()"
                (keydown.escape)="showAddEnvironment.set(false)"
              />
            </div>
            <div class="flex gap-2">
              <input
                type="text"
                [(ngModel)]="newEnvDescription"
                placeholder="Description (optional)"
                class="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                (keydown.enter)="createEnvironment()"
              />
            </div>
            <div class="flex gap-2 justify-end">
              <button
                (click)="showAddEnvironment.set(false)"
                class="text-sm text-zinc-400 hover:text-zinc-300 px-3 py-1.5"
              >
                Cancel
              </button>
              <button
                (click)="createEnvironment()"
                [disabled]="!newEnvName.trim() || envSaving()"
                class="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg px-3 py-1.5 transition-colors"
              >
                {{ envSaving() ? 'Creating...' : 'Create' }}
              </button>
            </div>
          </div>
        }
      </div>

      <!-- Members -->
      <div class="bg-zinc-900 rounded-xl border border-zinc-800 p-4 space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-medium text-zinc-200">Members</h2>
          <button
            (click)="showInvite.set(true)"
            class="bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg px-3 py-1.5 flex items-center gap-1.5 transition-colors"
          >
            <lucide-icon [img]="UserPlus" [size]="14" />
            Invite
          </button>
        </div>

        @if (loading()) {
          <div class="flex items-center gap-2 text-zinc-400 py-4">
            <lucide-icon [img]="Loader2" [size]="16" class="animate-spin" />
            Loading members...
          </div>
        }

        @if (loadError()) {
          <div class="text-red-400 text-sm bg-red-950/30 rounded-lg p-3">
            {{ loadError() }}
          </div>
        }

        <div class="space-y-2">
          @for (member of members(); track member.userId) {
            <div class="flex items-center justify-between bg-zinc-800/50 rounded-lg p-3">
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-sm font-medium text-zinc-300">
                  {{ (member.displayName || member.email || '?').charAt(0).toUpperCase() }}
                </div>
                <div>
                  <div class="text-sm font-medium text-zinc-200">{{ member.displayName }}</div>
                  <div class="text-xs text-zinc-400">{{ member.email }}</div>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-xs px-2 py-0.5 rounded-full"
                  [class]="getRoleBadgeClass(member.roleSlug)">
                  {{ member.roleName }}
                </span>
              </div>
            </div>
          }
        </div>
      </div>

      <!-- Invite Modal -->
      @if (showInvite()) {
        <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" (click)="showInvite.set(false)">
          <div class="bg-zinc-900 rounded-xl border border-zinc-800 p-6 w-full max-w-md space-y-4" (click)="$event.stopPropagation()">
            <h3 class="text-lg font-medium text-zinc-100">Invite Member</h3>

            <div>
              <label class="block text-sm text-zinc-300 mb-1">Email</label>
              <input
                type="email"
                [(ngModel)]="inviteEmail"
                placeholder="colleague@company.com"
                class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label class="block text-sm text-zinc-300 mb-1">Role</label>
              <select [(ngModel)]="inviteRoleId" class="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 w-full">
                @for (role of roles(); track role.id) {
                  <option [value]="role.id">{{ role.name }}</option>
                }
              </select>
            </div>

            @if (inviteError()) {
              <div class="text-red-400 text-sm">{{ inviteError() }}</div>
            }

            <div class="flex gap-2 justify-end">
              <button (click)="showInvite.set(false)" class="px-4 py-2 text-zinc-400 hover:text-zinc-300 text-sm">
                Cancel
              </button>
              <button
                (click)="invite()"
                [disabled]="inviteLoading() || !inviteEmail.trim() || !inviteRoleId"
                class="bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg px-4 py-2 flex items-center gap-1.5"
              >
                @if (inviteLoading()) {
                  <lucide-icon [img]="Loader2" [size]="14" class="animate-spin" />
                }
                Send Invite
              </button>
            </div>
          </div>
        </div>
      }

      <!-- Create Project -->
      <div class="bg-zinc-900 rounded-xl border border-zinc-800 p-4 space-y-3">
        <h2 class="text-lg font-medium text-zinc-200">Create Project</h2>
        <div class="flex gap-2">
          <input
            type="text"
            [(ngModel)]="newProjectName"
            placeholder="Project name"
            class="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            (keydown.enter)="createProject()"
          />
          <button
            (click)="createProject()"
            [disabled]="!newProjectName.trim() || createProjectLoading()"
            class="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm"
          >
            {{ createProjectLoading() ? 'Creating...' : 'Create' }}
          </button>
        </div>
        @if (createProjectError()) {
          <div class="text-red-400 text-sm">{{ createProjectError() }}</div>
        }
      </div>
    </div>
  `,
})
export class OrgManagementComponent implements OnInit, OnChanges {
  private backend = inject(BackendService);

  @Input() connectionId!: string;

  readonly Users = Users;
  readonly UserPlus = UserPlus;
  readonly Crown = Crown;
  readonly Shield = Shield;
  readonly Eye = Eye;
  readonly Loader2 = Loader2;
  readonly Trash2 = Trash2;
  readonly ChevronDown = ChevronDown;
  readonly Layers = Layers;
  readonly Plus = Plus;
  readonly Pencil = Pencil;
  readonly X = X;

  members = signal<ProjectMember[]>([]);
  loading = signal(false);
  activeProject = signal<Project | null>(null);
  projects = signal<Project[]>([]);
  roles = signal<Role[]>([]);

  // Environments
  environments = signal<Environment[]>([]);
  environmentsLoading = signal(false);
  showAddEnvironment = signal(false);
  editingEnvironment = signal<Environment | null>(null);
  newEnvName = '';
  newEnvDescription = '';
  editEnvName = '';
  editEnvDescription = '';
  envError = signal<string | null>(null);
  envSaving = signal(false);
  confirmingDeleteEnvId = signal<string | null>(null);

  showInvite = signal(false);
  inviteEmail = '';
  inviteRoleId = '';
  inviteLoading = signal(false);
  inviteError = signal<string | null>(null);
  rolesError = signal<string | null>(null);

  newProjectName = '';
  loadError = signal<string | null>(null);
  createProjectError = signal<string | null>(null);
  createProjectLoading = signal(false);

  ngOnInit(): void {
    if (!this.connectionId) {
      console.error('OrgManagementComponent: connectionId is required');
      return;
    }
    this.refreshConnectionState();
    this.loadRoles().catch(e => console.error('Failed to load roles on init:', e));
    this.loadMembers().catch(e => console.error('Failed to load members on init:', e));
    this.loadEnvironments().catch(e => console.error('Failed to load environments on init:', e));
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['connectionId'] && !changes['connectionId'].firstChange) {
      this.refreshConnectionState();
      this.loadRoles().catch(e => console.error('Failed to load roles on change:', e));
      this.loadMembers().catch(e => console.error('Failed to load members on change:', e));
      this.loadEnvironments().catch(e => console.error('Failed to load environments on change:', e));
    }
  }

  private refreshConnectionState(): void {
    const conn = this.backend.getConnection(this.connectionId);
    const projects = conn?.projects ?? [];
    this.projects.set(projects);
    const currentActive = this.activeProject();
    const isCurrentValid = currentActive && projects.some(p => p.id === currentActive.id);
    if (!isCurrentValid && projects.length > 0) {
      this.activeProject.set(projects[0]);
    } else if (!isCurrentValid) {
      this.activeProject.set(null);
    }
  }

  selectProject(projectId: string): void {
    const project = this.projects().find((p) => p.id === projectId);
    if (project) {
      this.activeProject.set(project);
      this.loadMembers().catch(e => console.error('Failed to load members:', e));
      this.loadEnvironments().catch(e => console.error('Failed to load environments:', e));
    }
  }

  // ========================================================================
  // Environments
  // ========================================================================

  async loadEnvironments(): Promise<void> {
    const project = this.activeProject();
    if (!project) return;

    const currentConnectionId = this.connectionId;
    this.environmentsLoading.set(true);
    this.envError.set(null);
    try {
      const envs = await this.backend.listEnvironmentsFor(this.connectionId, project.id);
      if (this.connectionId !== currentConnectionId) return;
      this.environments.set(envs);
    } catch (e: any) {
      if (this.connectionId !== currentConnectionId) return;
      this.envError.set(e.message ?? 'Failed to load environments');
      console.error('Failed to load environments:', e);
    } finally {
      if (this.connectionId === currentConnectionId) {
        this.environmentsLoading.set(false);
      }
    }
  }

  async createEnvironment(): Promise<void> {
    if (!this.newEnvName.trim()) return;
    const project = this.activeProject();
    if (!project) return;

    const slug = this.generateSlug(this.newEnvName);
    if (!slug) {
      this.envError.set('Environment name must contain at least one alphanumeric character');
      return;
    }

    this.envSaving.set(true);
    this.envError.set(null);
    try {
      await this.backend.createEnvironmentFor(this.connectionId, project.id, {
        name: this.newEnvName.trim(),
        slug,
        description: this.newEnvDescription.trim() || undefined,
      });
      this.newEnvName = '';
      this.newEnvDescription = '';
      this.showAddEnvironment.set(false);
      await this.loadEnvironments();
    } catch (e: any) {
      this.envError.set(e.message ?? 'Failed to create environment');
    } finally {
      this.envSaving.set(false);
    }
  }

  startEditEnvironment(env: Environment): void {
    this.editingEnvironment.set(env);
    this.editEnvName = env.name;
    this.editEnvDescription = env.description ?? '';
  }

  async updateEnvironment(): Promise<void> {
    const env = this.editingEnvironment();
    if (!env || !this.editEnvName.trim()) return;
    const project = this.activeProject();
    if (!project) return;

    const slug = this.generateSlug(this.editEnvName);
    if (!slug) {
      this.envError.set('Environment name must contain at least one alphanumeric character');
      return;
    }

    this.envSaving.set(true);
    this.envError.set(null);
    try {
      await this.backend.updateEnvironmentFor(this.connectionId, project.id, env.id, {
        name: this.editEnvName.trim(),
        slug,
        description: this.editEnvDescription.trim() || undefined,
      });
      this.editingEnvironment.set(null);
      await this.loadEnvironments();
    } catch (e: any) {
      this.envError.set(e.message ?? 'Failed to update environment');
    } finally {
      this.envSaving.set(false);
    }
  }

  promptDeleteEnvironment(envId: string): void {
    this.confirmingDeleteEnvId.set(envId);
  }

  async deleteEnvironment(envId: string): Promise<void> {
    this.confirmingDeleteEnvId.set(null);
    const project = this.activeProject();
    if (!project) return;

    this.envError.set(null);
    try {
      await this.backend.deleteEnvironmentFor(this.connectionId, project.id, envId);
      await this.loadEnvironments();
    } catch (e: any) {
      this.envError.set(e.message ?? 'Failed to delete environment');
    }
  }

  // ========================================================================
  // Members
  // ========================================================================

  async loadMembers(): Promise<void> {
    const project = this.activeProject();
    if (!project) return;

    const currentConnectionId = this.connectionId;
    this.loadError.set(null);
    this.loading.set(true);
    try {
      const members = await this.backend.getProjectMembersFor(this.connectionId, project.id);
      if (this.connectionId !== currentConnectionId) return;
      this.members.set(members);
    } catch (e: any) {
      if (this.connectionId !== currentConnectionId) return;
      this.loadError.set(e.message ?? 'Failed to load members');
      console.error('Failed to load members:', e);
    } finally {
      if (this.connectionId === currentConnectionId) {
        this.loading.set(false);
      }
    }
  }

  async invite(): Promise<void> {
    if (!this.inviteEmail.trim() || !this.inviteRoleId) return;
    const project = this.activeProject();
    if (!project) return;

    this.inviteLoading.set(true);
    this.inviteError.set(null);
    try {
      await this.backend.inviteMemberFor(this.connectionId, project.id, {
        email: this.inviteEmail.trim(),
        roleId: this.inviteRoleId,
      });
      this.showInvite.set(false);
      this.inviteEmail = '';
      await this.loadMembers();
    } catch (e: any) {
      this.inviteError.set(e.message ?? 'Failed to send invite');
    } finally {
      this.inviteLoading.set(false);
    }
  }

  async loadRoles(): Promise<void> {
    const currentConnectionId = this.connectionId;
    try {
      const roles = await this.backend.listRolesFor(this.connectionId);
      if (this.connectionId !== currentConnectionId) return;
      this.roles.set(roles);
      if (roles.length > 0 && !this.inviteRoleId) {
        this.inviteRoleId = roles[0].id;
      }
    } catch (e: any) {
      if (this.connectionId !== currentConnectionId) return;
      this.rolesError.set('Failed to load roles. Please try again.');
      console.error('Failed to load roles:', e);
    }
  }

  async createProject(): Promise<void> {
    if (!this.newProjectName.trim()) return;

    const slug = this.generateSlug(this.newProjectName);
    if (!slug) {
      this.createProjectError.set('Project name must contain at least one alphanumeric character');
      return;
    }

    this.createProjectLoading.set(true);
    this.createProjectError.set(null);
    try {
      const newProject = await this.backend.createProjectFor(this.connectionId, {
        name: this.newProjectName.trim(),
        slug,
      });
      this.newProjectName = '';
      this.refreshConnectionState();
      // Select the newly created project
      this.activeProject.set(newProject);
      await this.loadMembers();
      await this.loadEnvironments();
    } catch (e: any) {
      this.createProjectError.set(e.message ?? 'Failed to create project');
    } finally {
      this.createProjectLoading.set(false);
    }
  }

  private generateSlug(name: string): string {
    return name.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  }

  getRoleBadgeClass(role: string): string {
    switch (role) {
      case 'owner': return 'bg-amber-500/20 text-amber-400';
      case 'admin': return 'bg-blue-500/20 text-blue-400';
      case 'manager': return 'bg-green-500/20 text-green-400';
      default: return 'bg-zinc-700 text-zinc-400';
    }
  }
}
