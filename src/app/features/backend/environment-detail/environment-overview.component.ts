import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  signal,
  SimpleChanges,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, Box, Cloud, Activity, Users } from 'lucide-angular';

import {
  ChipStatus,
  ListStatesComponent,
  StatusChipComponent,
} from '../../../shared/components/a11y';
import { BackendService } from '../../../core/services/backend.service';
import {
  AuditLogEntry,
  K8sCluster,
} from '../../../core/models/backend.model';

interface ContainerCounts {
  readonly total: number;
  readonly running: number;
  readonly stopped: number;
  readonly failing: number;
}

const ZERO_CONTAINERS: ContainerCounts = { total: 0, running: 0, stopped: 0, failing: 0 };

const HEALTH_DEBOUNCE_MS = 750;

@Component({
  selector: 'app-environment-overview',
  standalone: true,
  imports: [RouterLink, LucideAngularModule, StatusChipComponent, ListStatesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './environment-overview.component.html',
})
export class EnvironmentOverviewComponent implements OnInit, OnChanges, OnDestroy {
  private readonly backend = inject(BackendService);

  @Input({ required: true }) connectionId!: string;
  @Input({ required: true }) projectId!: string;
  @Input({ required: true }) environmentId!: string;

  readonly Box = Box;
  readonly Cloud = Cloud;
  readonly Activity = Activity;
  readonly Users = Users;

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly containerCounts = signal<ContainerCounts>(ZERO_CONTAINERS);
  readonly systemCount = signal(0);
  readonly clusters = signal<K8sCluster[]>([]);
  readonly memberCount = signal<number | null>(null);
  readonly recentActivity = signal<AuditLogEntry[]>([]);

  readonly containerStatus = computed<ChipStatus>(() => {
    const c = this.containerCounts();
    if (c.total === 0) return 'unknown';
    if (c.failing > 0) return 'failing';
    if (c.stopped > 0) return 'degraded';
    return 'healthy';
  });

  readonly clusterStatus = computed<ChipStatus>(() => {
    const list = this.clusters();
    if (list.length === 0) return 'unknown';
    const inactive = list.filter((c) => !c.isActive).length;
    if (inactive === list.length) return 'failing';
    if (inactive > 0) return 'degraded';
    return 'healthy';
  });

  readonly clusterInactiveCount = computed(
    () => this.clusters().filter((c) => !c.isActive).length,
  );

  // Total "things looking unhealthy" across the env: stopped+failing containers
  // plus inactive clusters. We announce changes in this number both directions
  // (degradation AND recovery) per CON-125 §3.2.
  readonly unhealthyCount = computed(
    () => this.containerCounts().stopped
      + this.containerCounts().failing
      + this.clusterInactiveCount(),
  );

  // Live region copy. Static label by default; flips on debounced transition.
  readonly liveSummary = signal<string>('');

  private debounceHandle: ReturnType<typeof setTimeout> | null = null;
  private lastAnnouncedUnhealthy: number | null = null;

  constructor() {
    // Debounced aria-live transitions in both directions. We use untracked
    // for the previous value so we only react to *changes*, never to the
    // first read on render.
    effect(() => {
      const current = this.unhealthyCount();
      const total = this.containerCounts().total + this.clusters().length;
      // First render — capture baseline silently.
      const previous = untracked(() => this.lastAnnouncedUnhealthy);
      if (previous === null) {
        this.lastAnnouncedUnhealthy = current;
        return;
      }
      if (previous === current) return;

      if (this.debounceHandle) clearTimeout(this.debounceHandle);
      this.debounceHandle = setTimeout(() => {
        const direction = current > previous ? 'degraded' : 'recovered';
        const phrase = current === 0
          ? 'All resources healthy.'
          : `${current} of ${total} resources unhealthy.`;
        this.liveSummary.set(`${direction === 'degraded' ? 'Health degraded' : 'Health improved'}: ${phrase}`);
        this.lastAnnouncedUnhealthy = current;
      }, HEALTH_DEBOUNCE_MS);
    });
  }

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    const inputChanged = ['connectionId', 'projectId', 'environmentId']
      .some((k) => changes[k] && !changes[k].firstChange);
    if (inputChanged) {
      // Reset baseline so navigating to a different env doesn't fire a
      // misleading "degraded" announcement on the new dataset.
      this.lastAnnouncedUnhealthy = null;
      this.liveSummary.set('');
      await this.refresh();
    }
  }

  ngOnDestroy(): void {
    if (this.debounceHandle) clearTimeout(this.debounceHandle);
  }

  async refresh(): Promise<void> {
    if (!this.connectionId || !this.projectId || !this.environmentId) return;

    this.loading.set(true);
    this.error.set(null);
    try {
      const [systems, clusters, members, audit] = await Promise.all([
        this.backend.listSystemsInEnvironmentFor(this.connectionId, this.projectId, this.environmentId),
        this.backend.listClustersInEnvironmentFor(this.connectionId, this.projectId, this.environmentId)
          .catch(() => [] as K8sCluster[]),
        this.backend.getProjectMembersFor(this.connectionId, this.projectId)
          .catch(() => null),
        this.backend.getAuditLogsFor(this.connectionId, this.projectId, { limit: 50 })
          .catch(() => [] as AuditLogEntry[]),
      ]);

      this.systemCount.set(systems.length);
      this.clusters.set(clusters);
      this.memberCount.set(members?.length ?? null);

      // Filter audit feed to entries scoped to this environment, then take 5.
      const envScoped = audit
        .filter((e) => e.environmentId === this.environmentId)
        .slice(0, 5);
      this.recentActivity.set(envScoped);

      const counts = await this.fetchContainerCounts(systems.map((s) => s.id));
      this.containerCounts.set(counts);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Failed to load environment overview');
    } finally {
      this.loading.set(false);
    }
  }

  private async fetchContainerCounts(systemIds: readonly string[]): Promise<ContainerCounts> {
    if (systemIds.length === 0) return ZERO_CONTAINERS;
    const buckets = await Promise.all(
      systemIds.map((id) =>
        this.backend
          .listContainersFor(this.connectionId, id)
          .catch(() => [] as { status: string }[]),
      ),
    );
    let total = 0;
    let running = 0;
    let stopped = 0;
    let failing = 0;
    for (const list of buckets) {
      for (const c of list) {
        total += 1;
        const s = (c.status ?? '').toLowerCase();
        if (s === 'running') running += 1;
        else if (s === 'restarting' || s === 'dead') failing += 1;
        else stopped += 1;
      }
    }
    return { total, running, stopped, failing };
  }

  formatTime(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString();
  }
}
