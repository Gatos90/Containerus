import { Component, computed, inject, signal, Input, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BackendService } from '../../../core/services/backend.service';
import { AuditLogEntry, Project } from '../../../core/models/backend.model';
import { LucideAngularModule, ScrollText, ChevronLeft, ChevronRight, Filter, RefreshCw, X } from 'lucide-angular';
import { VirtualGridComponent, VirtualGridRow } from '../../../shared/components/a11y';
import { CommonModule } from '@angular/common';

interface SavedFilter {
  readonly key: string;
  readonly label: string;
  readonly action: string;
  /** Restrict to a specific `resource_type`. Empty = no restriction. */
  readonly resourceType?: string;
  /** Hours back from "now" to apply as `from`. 0 = no time bound. */
  readonly hoursBack: number;
}

const SAVED_FILTERS: readonly SavedFilter[] = [
  { key: 'failed-logins-24h', label: 'Failed logins · 24h', action: 'auth.login.failed', hoursBack: 24 },
  { key: 'container-removals', label: 'Container removals', action: 'container.remove', hoursBack: 0 },
  { key: 'role-changes', label: 'Role changes', action: 'member.role_change', hoursBack: 0 },
  // CON-130: one-click filter for ACL denies that fired at the container
  // layer (CON-117 stamps resource_type="container" on those rows).
  { key: 'container-scope-denies', label: 'Container-scope denies · 24h', action: '', resourceType: 'container', hoursBack: 24 },
];

interface AuditRow extends VirtualGridRow {
  readonly id: string;
  readonly entry: AuditLogEntry;
}

@Component({
  selector: 'app-audit-log',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, VirtualGridComponent],
  templateUrl: './audit-log.component.html',
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

  readonly savedFilters = SAVED_FILTERS;

  entries = signal<AuditLogEntry[]>([]);
  loadError = signal<string | null>(null);
  loading = signal(false);
  projects = signal<Project[]>([]);
  selectedProjectId = signal<string>('');
  activeSavedFilter = signal<string | null>(null);

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
  // permission-aware toggle (CON-115 §3.3 + ticket Acceptance).
  readonly showIpColumn = computed(() =>
    this.entries().some((e) => e.ipAddress != null && e.ipAddress !== ''),
  );

  // Wrap entries in a VirtualGridRow shape with stable ids.
  readonly rows = computed<readonly AuditRow[]>(() =>
    this.entries().map((entry) => ({ id: entry.id, entry })),
  );

  readonly hasActiveFilters = computed(
    () =>
      !!this.actionFilter ||
      !!this.resourceTypeFilter ||
      !!this.userIdFilter ||
      !!this.fromFilter ||
      !!this.toFilter ||
      this.activeSavedFilter() !== null,
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
    this.activeSavedFilter.set(null);
    this.offset.set(0);
    this.page.set(1);
    this.loadLogs();
  }

  applySavedFilter(filter: SavedFilter): void {
    // Toggle off if the same chip is clicked again.
    if (this.activeSavedFilter() === filter.key) {
      this.clearFilters();
      return;
    }
    this.actionFilter = filter.action;
    this.resourceTypeFilter = filter.resourceType ?? '';
    this.userIdFilter = '';
    if (filter.hoursBack > 0) {
      const since = new Date(Date.now() - filter.hoursBack * 60 * 60 * 1000);
      this.fromFilter = this.isoToLocal(since.toISOString());
    } else {
      this.fromFilter = '';
    }
    this.toFilter = '';
    this.activeSavedFilter.set(filter.key);
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
    this.activeSavedFilter.set(null);
    this.offset.set(0);
    this.page.set(1);
    this.loadLogs();
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

  // Round-trip an ISO timestamp into the `YYYY-MM-DDTHH:mm` format that the
  // datetime-local input expects, so saved-filter chips repopulate the field.
  private isoToLocal(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
