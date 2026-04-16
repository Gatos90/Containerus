import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  Search,
  RefreshCw,
  Plus,
  Circle,
  SlidersHorizontal,
} from 'lucide-angular';
import { Volume } from '../../../core/models/volume.model';
import { VolumeState } from '../../../state/volume.state';
import { SystemState } from '../../../state/system.state';
import { ContainerState } from '../../../state/container.state';
import { SystemVolumeSectionComponent } from '../components/system-volume-section/system-volume-section.component';
import { AppModalDirective } from '../../../shared/directives/app-modal.directive';
import { AppButtonComponent } from '../../../shared/components/ui-button/ui-button.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-volume-list',
  imports: [CommonModule, FormsModule, LucideAngularModule, SystemVolumeSectionComponent, AppModalDirective, AppButtonComponent, ConfirmDialogComponent],
  templateUrl: './volume-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class VolumeListComponent implements OnInit {
  readonly volumeState = inject(VolumeState);
  readonly systemState = inject(SystemState);
  readonly containerState = inject(ContainerState);

  readonly Search = Search;
  readonly RefreshCw = RefreshCw;
  readonly Plus = Plus;
  readonly Circle = Circle;
  readonly SlidersHorizontal = SlidersHorizontal;

  readonly showMobileFilters = signal(false);
  refreshing = false;
  showCreateDialog = false;
  readonly creating = signal(false);
  readonly pendingDelete = signal<Volume | null>(null);
  readonly deleting = signal(false);

  createForm = {
    name: '',
    systemId: '',
    runtime: 'docker' as const,
    driver: '',
  };

  /** Volumes grouped by system, filtered */
  readonly filteredVolumesBySystem = computed(() => {
    const filtered = this.volumeState.filteredVolumes();
    const grouped: Record<string, Volume[]> = {};

    for (const volume of filtered) {
      if (!grouped[volume.systemId]) {
        grouped[volume.systemId] = [];
      }
      grouped[volume.systemId].push(volume);
    }

    return grouped;
  });

  onEscape(): void {
    if (this.showMobileFilters()) {
      this.showMobileFilters.set(false);
    }
  }

  async ngOnInit(): Promise<void> {
    await this.refresh();
    const connected = this.systemState.connectedSystems();
    if (connected.length > 0) {
      this.createForm.systemId = connected[0].id;
    }
  }

  async refresh(): Promise<void> {
    this.refreshing = true;
    try {
      const systemIds = this.systemState.connectedSystems().map((s) => s.id);
      await Promise.all([
        ...systemIds.map((id) => this.volumeState.loadVolumes(id)),
        ...systemIds.map((id) => this.containerState.loadContainers(id)),
      ]);
    } finally {
      this.refreshing = false;
    }
  }

  async createVolume(): Promise<void> {
    if (!this.createForm.name || !this.createForm.systemId) return;

    this.creating.set(true);
    try {
      await this.volumeState.createVolume(
        this.createForm.systemId,
        this.createForm.name,
        this.createForm.runtime,
        this.createForm.driver || undefined
      );
    } finally {
      this.creating.set(false);
    }

    this.showCreateDialog = false;
    this.createForm = {
      name: '',
      systemId: this.createForm.systemId,
      runtime: 'docker',
      driver: '',
    };
  }

  onVolumeDeleted(volume: Volume): void {
    this.pendingDelete.set(volume);
  }

  cancelDelete(): void {
    if (this.deleting()) return;
    this.pendingDelete.set(null);
  }

  async confirmDelete(): Promise<void> {
    const volume = this.pendingDelete();
    if (!volume || this.deleting()) return;
    this.deleting.set(true);
    try {
      await this.volumeState.removeVolume(volume);
    } finally {
      this.deleting.set(false);
      this.pendingDelete.set(null);
    }
  }
}
