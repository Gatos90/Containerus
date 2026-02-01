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

@Component({
  selector: 'app-volume-list',
  imports: [CommonModule, FormsModule, LucideAngularModule, SystemVolumeSectionComponent],
  templateUrl: './volume-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
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

    await this.volumeState.createVolume(
      this.createForm.systemId,
      this.createForm.name,
      this.createForm.runtime,
      this.createForm.driver || undefined
    );

    this.showCreateDialog = false;
    this.createForm = {
      name: '',
      systemId: this.createForm.systemId,
      runtime: 'docker',
      driver: '',
    };
  }

  async onVolumeDeleted(volume: Volume): Promise<void> {
    if (confirm(`Remove volume "${volume.name}"? This action cannot be undone.`)) {
      await this.volumeState.removeVolume(volume);
    }
  }
}
