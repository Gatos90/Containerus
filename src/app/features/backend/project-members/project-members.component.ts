import { Component, inject, signal, Input, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BackendService } from '../../../core/services/backend.service';
import { ProjectMember, Role } from '../../../core/models/backend.model';
import { LucideAngularModule, Users, UserPlus, Loader2 } from 'lucide-angular';

@Component({
  selector: 'app-project-members',
  imports: [FormsModule, LucideAngularModule],
  template: `
    <div class="space-y-4">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-medium text-zinc-200 flex items-center gap-2">
          <lucide-icon [img]="Users" [size]="18" />
          Members
        </h2>
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

      <!-- Member List -->
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
        } @empty {
          @if (!loading()) {
            <p class="text-zinc-500 text-sm py-2">No members found.</p>
          }
        }
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
                placeholder="colleague&#64;company.com"
                class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label class="block text-sm text-zinc-300 mb-1">Role</label>
              <select
                [(ngModel)]="inviteRoleId"
                class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
              >
                @for (role of roles(); track role.id) {
                  <option [value]="role.id">{{ role.name }}</option>
                }
              </select>
            </div>

            @if (inviteError()) {
              <div class="text-red-400 text-sm">{{ inviteError() }}</div>
            }

            <div class="flex gap-2 justify-end">
              <button
                (click)="showInvite.set(false)"
                class="px-4 py-2 text-zinc-400 hover:text-zinc-300 text-sm"
              >
                Cancel
              </button>
              <button
                (click)="invite()"
                [disabled]="inviteLoading()"
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
    </div>
  `,
})
export class ProjectMembersComponent implements OnInit, OnChanges {
  private backend = inject(BackendService);

  @Input() connectionId!: string;
  @Input() projectId!: string;

  readonly Users = Users;
  readonly UserPlus = UserPlus;
  readonly Loader2 = Loader2;

  members = signal<ProjectMember[]>([]);
  roles = signal<Role[]>([]);
  loading = signal(false);
  loadError = signal<string | null>(null);

  showInvite = signal(false);
  inviteEmail = '';
  inviteRoleId = '';
  inviteLoading = signal(false);
  inviteError = signal<string | null>(null);

  ngOnInit(): void {
    this.loadRoles();
    this.loadMembers();
  }

  ngOnChanges(changes: SimpleChanges): void {
    const connectionChanged = changes['connectionId'] && !changes['connectionId'].firstChange;
    const projectChanged = changes['projectId'] && !changes['projectId'].firstChange;

    if (connectionChanged) {
      this.loadRoles();
    }

    if (connectionChanged || projectChanged) {
      this.loadMembers();
    }
  }

  async loadMembers(): Promise<void> {
    if (!this.connectionId || !this.projectId) return;

    this.loading.set(true);
    this.loadError.set(null);
    try {
      const members = await this.backend.getProjectMembersFor(this.connectionId, this.projectId);
      this.members.set(members);
    } catch (e: any) {
      this.loadError.set(e.message ?? 'Failed to load members');
      console.error('Failed to load members:', e);
    } finally {
      this.loading.set(false);
    }
  }

  async loadRoles(): Promise<void> {
    if (!this.connectionId) return;
    try {
      const roles = await this.backend.listRolesFor(this.connectionId);
      this.roles.set(roles);
      if (roles.length > 0 && !this.inviteRoleId) {
        this.inviteRoleId = roles[0].id;
      }
    } catch (e: any) {
      this.roles.set([]);
      this.loadError.set(e?.message ?? 'Failed to load roles');
      console.error('Failed to load roles:', e);
    }
  }

  async invite(): Promise<void> {
    if (!this.inviteEmail.trim() || !this.inviteRoleId) return;

    this.inviteLoading.set(true);
    this.inviteError.set(null);
    try {
      await this.backend.inviteMemberFor(this.connectionId, this.projectId, {
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

  getRoleBadgeClass(role: string): string {
    switch (role) {
      case 'owner': return 'bg-amber-500/20 text-amber-400';
      case 'admin': return 'bg-blue-500/20 text-blue-400';
      case 'manager': return 'bg-green-500/20 text-green-400';
      default: return 'bg-zinc-700 text-zinc-400';
    }
  }
}
