import { Component, computed, inject, signal, Input, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BackendService } from '../../../core/services/backend.service';
import { AuditLogEntry, Project } from '../../../core/models/backend.model';
import { LucideAngularModule, ScrollText, ChevronLeft, ChevronRight, Filter, RefreshCw, X } from 'lucide-angular';

@Component({
  selector: 'app-audit-log',
  imports: [FormsModule, LucideAngularModule],
  template: `
    <div class="p-6 max-w-6xl mx-auto space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-semibold text-zinc-100 flex items-center gap-2">
          <lucide-icon [img]="ScrollText" [size]="20" />
          Audit Log
        </h1>
        <button
          (click)="refresh()"
          [disabled]="loading()"
          class="text-zinc-300 hover:text-zinc-100 text-sm rounded-lg px-3 py-1.5 flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 transition-colors disabled:opacity-50"
        >
          <lucide-icon [img]="RefreshCw" [size]="14" />
          Refresh
        </button>
      </div>

      <!-- Filters -->
      <div class="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
        <div class="flex items-center gap-2 text-xs uppercase tracking-wide text-zinc-500">
          <lucide-icon [img]="Filter" [size]="12" />
          Filters
          @if (hasActiveFilters()) {
            <button
              (click)="clearFilters()"
              class="ml-auto text-zinc-400 hover:text-zinc-100 flex items-center gap-1"
            >
              <lucide-icon [img]="X" [size]="12" />
              Clear
            </button>
          }
        </div>

        <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
          <label class="block">
            <span class="block text-[11px] text-zinc-500 mb-1">Project</span>
            <select
              [ngModel]="selectedProjectId()"
              (ngModelChange)="onProjectChange($event)"
              class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-zinc-100 text-sm"
            >
              <option value="" disabled>Select Project</option>
              @for (project of projects(); track project.id) {
                <option [value]="project.id">{{ project.name }}</option>
              }
            </select>
          </label>

          <label class="block">
            <span class="block text-[11px] text-zinc-500 mb-1">Action</span>
            <select
              [(ngModel)]="actionFilter"
              (ngModelChange)="onFilterChange()"
              class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-zinc-100 text-sm"
            >
              <option value="">All actions</option>
              <option value="system.create">system.create</option>
              <option value="system.delete">system.delete</option>
              <option value="system.connect">system.connect</option>
              <option value="container.start">container.start</option>
              <option value="container.stop">container.stop</option>
              <option value="container.restart">container.restart</option>
              <option value="container.remove">container.remove</option>
              <option value="member.invite">member.invite</option>
              <option value="member.remove">member.remove</option>
              <option value="member.role_change">member.role_change</option>
              <option value="cluster.create">cluster.create</option>
              <option value="cluster.delete">cluster.delete</option>
            </select>
          </label>

          <label class="block">
            <span class="block text-[11px] text-zinc-500 mb-1">Resource type</span>
            <select
              [(ngModel)]="resourceTypeFilter"
              (ngModelChange)="onFilterChange()"
              class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-zinc-100 text-sm"
            >
              <option value="">All types</option>
              <option value="system">system</option>
              <option value="container">container</option>
              <option value="cluster">cluster</option>
              <option value="member">member</option>
              <option value="role">role</option>
              <option value="project">project</option>
              <option value="environment">environment</option>
            </select>
          </label>

          <label class="block">
            <span class="block text-[11px] text-zinc-500 mb-1">Actor (user id)</span>
            <input
              type="text"
              [(ngModel)]="userIdFilter"
              (ngModelChange)="onFilterChangeDebounced()"
              placeholder="UUID — leave blank for all"
              class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-zinc-100 text-sm font-mono"
            />
          </label>

          <label class="block">
            <span class="block text-[11px] text-zinc-500 mb-1">From</span>
            <input
              type="datetime-local"
              [(ngModel)]="fromFilter"
              (ngModelChange)="onFilterChange()"
              class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-zinc-100 text-sm"
            />
          </label>

          <label class="block">
            <span class="block text-[11px] text-zinc-500 mb-1">To</span>
            <input
              type="datetime-local"
              [(ngModel)]="toFilter"
              (ngModelChange)="onFilterChange()"
              class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-zinc-100 text-sm"
            />
          </label>
        </div>
      </div>

      @if (loading()) {
        <div class="flex items-center gap-2 text-zinc-400 py-4">
          Loading audit logs...
        </div>
      }

      @if (loadError()) {
        <div class="text-red-400 text-sm bg-red-950/30 rounded-lg p-3">
          {{ loadError() }}
        </div>
      }

      <!-- Log Table -->
      <div class="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-zinc-800 text-zinc-400 text-left">
              <th class="px-4 py-3 font-medium">Time</th>
              <th class="px-4 py-3 font-medium">User</th>
              <th class="px-4 py-3 font-medium">Action</th>
              <th class="px-4 py-3 font-medium">Resource</th>
              @if (showIpColumn()) {
                <th class="px-4 py-3 font-medium">IP</th>
              }
              <th class="px-4 py-3 font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            @for (entry of entries(); track entry.id) {
              <tr class="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                <td class="px-4 py-2.5 text-zinc-400 text-xs whitespace-nowrap">
                  {{ formatTime(entry.createdAt) }}
                </td>
                <td class="px-4 py-2.5 text-zinc-300 text-xs font-mono">
                  {{ entry.userId ?? 'System' }}
                </td>
                <td class="px-4 py-2.5">
                  <span class="text-xs px-1.5 py-0.5 rounded" [class]="getActionClass(entry.action)">
                    {{ entry.action }}
                  </span>
                </td>
                <td class="px-4 py-2.5 text-zinc-300 text-xs">
                  @if (entry.resourceType) {
                    <span class="text-zinc-500">{{ entry.resourceType }}:</span>
                    {{ entry.resourceId ?? '' }}
                  }
                </td>
                @if (showIpColumn()) {
                  <td class="px-4 py-2.5 text-zinc-400 text-xs font-mono whitespace-nowrap">
                    {{ entry.ipAddress ?? '—' }}
                  </td>
                }
                <td class="px-4 py-2.5 text-zinc-500 text-xs max-w-xs truncate" [title]="formatDetails(entry.details)">
                  {{ formatDetails(entry.details) }}
                </td>
              </tr>
            } @empty {
              <tr>
                <td [attr.colspan]="showIpColumn() ? 6 : 5" class="text-center py-12 text-zinc-500">
                  No audit log entries found
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div class="flex items-center justify-between">
        <span class="text-sm text-zinc-400">
          Showing {{ entries().length }} entries
        </span>
        <div class="flex items-center gap-2">
          <button
            (click)="prevPage()"
            [disabled]="offset() === 0"
            aria-label="Previous page"
            class="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-300"
          >
            <lucide-icon [img]="ChevronLeft" [size]="16" />
          </button>
          <span class="text-sm text-zinc-400">Page {{ page() }}</span>
          <button
            (click)="nextPage()"
            [disabled]="entries().length < pageSize"
            aria-label="Next page"
            class="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-300"
          >
            <lucide-icon [img]="ChevronRight" [size]="16" />
          </button>
        </div>
      </div>
    </div>
  `,
})
export class AuditLogComponent implements OnInit, OnChanges {
  private backend = inject(BackendService);

  @Input() connectionId!: string;

  readonly ScrollText = ScrollText;
  readonly ChevronLeft = ChevronLeft;
  readonly ChevronRight = ChevronRight;
  readonly Filter = Filter;
  readonly RefreshCw = RefreshCw;
  readonly X = X;

  entries = signal<AuditLogEntry[]>([]);
  loadError = signal<string | null>(null);
  loading = signal(false);
  projects = signal<Project[]>([]);
  selectedProjectId = signal<string>('');

  actionFilter = '';
  resourceTypeFilter = '';
  userIdFilter = '';
  fromFilter = '';
  toFilter = '';

  readonly pageSize = 50;
  offset = signal(0);
  page = signal(1);

  // Show the IP column if any current row carries one — the server strips
  // ipAddress when the caller lacks `audit.view_ip`, so this doubles as a
  // permission-aware toggle.
  readonly showIpColumn = computed(() =>
    this.entries().some((e) => e.ipAddress != null && e.ipAddress !== ''),
  );

  readonly hasActiveFilters = computed(
    () =>
      !!this.actionFilter ||
      !!this.resourceTypeFilter ||
      !!this.userIdFilter ||
      !!this.fromFilter ||
      !!this.toFilter,
  );

  ngOnInit(): void {
    if (!this.connectionId) {
      this.loadError.set('Connection ID is required');
      return;
    }
    this.populateProjects();
    this.loadLogs();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['connectionId'] && !changes['connectionId'].firstChange) {
      this.offset.set(0);
      this.page.set(1);
      this.clearFilters();
      this.populateProjects();
      this.loadLogs();
    }
  }

  private populateProjects(): void {
    const conn = this.backend.getConnection(this.connectionId);
    const projectList = conn?.projects ?? [];
    this.projects.set(projectList);
    this.selectedProjectId.set(projectList[0]?.id ?? '');
  }

  onProjectChange(projectId: string): void {
    this.selectedProjectId.set(projectId);
    this.offset.set(0);
    this.page.set(1);
    this.loadLogs();
  }

  onFilterChange(): void {
    this.offset.set(0);
    this.page.set(1);
    this.loadLogs();
  }

  private userIdDebounce: ReturnType<typeof setTimeout> | null = null;
  onFilterChangeDebounced(): void {
    if (this.userIdDebounce) clearTimeout(this.userIdDebounce);
    this.userIdDebounce = setTimeout(() => this.onFilterChange(), 300);
  }

  clearFilters(): void {
    this.actionFilter = '';
    this.resourceTypeFilter = '';
    this.userIdFilter = '';
    this.fromFilter = '';
    this.toFilter = '';
    this.onFilterChange();
  }

  refresh(): void {
    this.loadLogs();
  }

  private loadRequestId = 0;

  async loadLogs(): Promise<void> {
    const currentRequestId = ++this.loadRequestId;
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const projectId = this.selectedProjectId();
      if (!projectId) {
        this.entries.set([]);
        this.loading.set(false);
        return;
      }
      const entries = await this.backend.getAuditLogsFor(this.connectionId, projectId, {
        limit: this.pageSize,
        offset: this.offset(),
        action: this.actionFilter || undefined,
        resourceType: this.resourceTypeFilter || undefined,
        userId: this.userIdFilter.trim() || undefined,
        from: this.localToIso(this.fromFilter),
        to: this.localToIso(this.toFilter),
      });
      if (currentRequestId !== this.loadRequestId) return;
      this.entries.set(entries);
    } catch (e: any) {
      if (currentRequestId !== this.loadRequestId) return;
      this.loadError.set('Failed to load audit logs');
      console.error('Failed to load audit logs:', e);
    } finally {
      if (currentRequestId === this.loadRequestId) {
        this.loading.set(false);
      }
    }
  }

  // datetime-local inputs produce "YYYY-MM-DDTHH:mm" without a timezone;
  // send a full ISO-8601 string so the server can parse it reliably.
  private localToIso(local: string): string | undefined {
    if (!local) return undefined;
    const d = new Date(local);
    if (isNaN(d.getTime())) return undefined;
    return d.toISOString();
  }

  async nextPage(): Promise<void> {
    this.offset.update(o => o + this.pageSize);
    this.page.update(p => p + 1);
    await this.loadLogs();
  }

  async prevPage(): Promise<void> {
    this.offset.update(o => Math.max(0, o - this.pageSize));
    this.page.update(p => Math.max(1, p - 1));
    await this.loadLogs();
  }

  formatTime(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  }

  formatDetails(details: Record<string, unknown> | null | undefined): string {
    if (!details) return '';
    return JSON.stringify(details);
  }

  getActionClass(action: string): string {
    if (action.includes('delete') || action.includes('remove')) return 'bg-red-500/20 text-red-400';
    if (action.includes('create') || action.includes('invite')) return 'bg-green-500/20 text-green-400';
    if (action.includes('connect') || action.includes('start')) return 'bg-blue-500/20 text-blue-400';
    return 'bg-zinc-700 text-zinc-400';
  }
}
