import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  Search,
  RefreshCw,
  Download,
  Circle,
  SlidersHorizontal,
} from 'lucide-angular';
import { ContainerImage, getImageFullName, getImageSizeHuman } from '../../../core/models/image.model';
import { ImageState } from '../../../state/image.state';
import { SystemState } from '../../../state/system.state';
import { ContainerState } from '../../../state/container.state';
import { SystemImageSectionComponent } from '../components/system-image-section/system-image-section.component';

@Component({
  selector: 'app-image-list',
  imports: [CommonModule, FormsModule, LucideAngularModule, SystemImageSectionComponent],
  templateUrl: './image-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImageListComponent implements OnInit {
  readonly imageState = inject(ImageState);
  readonly systemState = inject(SystemState);
  readonly containerState = inject(ContainerState);

  readonly Search = Search;
  readonly RefreshCw = RefreshCw;
  readonly Download = Download;
  readonly Circle = Circle;
  readonly SlidersHorizontal = SlidersHorizontal;

  readonly getImageFullName = getImageFullName;
  readonly getImageSizeHuman = getImageSizeHuman;

  readonly showMobileFilters = signal(false);
  refreshing = false;
  showPullDialog = false;

  pullForm = {
    name: '',
    tag: 'latest',
    systemId: '',
    runtime: 'docker' as const,
  };

  /** Images grouped by system, filtered */
  readonly filteredImagesBySystem = computed(() => {
    const filtered = this.imageState.filteredImages();
    const grouped: Record<string, ContainerImage[]> = {};

    for (const image of filtered) {
      if (!grouped[image.systemId]) {
        grouped[image.systemId] = [];
      }
      grouped[image.systemId].push(image);
    }

    return grouped;
  });

  async ngOnInit(): Promise<void> {
    await this.refresh();
    const connected = this.systemState.connectedSystems();
    if (connected.length > 0) {
      this.pullForm.systemId = connected[0].id;
    }
  }

  async refresh(): Promise<void> {
    this.refreshing = true;
    try {
      const systemIds = this.systemState.connectedSystems().map((s) => s.id);
      await Promise.all([
        ...systemIds.map((id) => this.imageState.loadImages(id)),
        ...systemIds.map((id) => this.containerState.loadContainers(id)),
      ]);
    } finally {
      this.refreshing = false;
    }
  }

  async pullImage(): Promise<void> {
    if (!this.pullForm.name || !this.pullForm.systemId) return;

    await this.imageState.pullImage(
      this.pullForm.systemId,
      this.pullForm.name,
      this.pullForm.tag,
      this.pullForm.runtime
    );

    this.showPullDialog = false;
    this.pullForm = {
      name: '',
      tag: 'latest',
      systemId: this.pullForm.systemId,
      runtime: 'docker',
    };
  }

  async onImageDeleted(image: ContainerImage): Promise<void> {
    if (confirm(`Remove image "${getImageFullName(image)}"? This action cannot be undone.`)) {
      await this.imageState.removeImage(image);
    }
  }

  formatSize(bytes: number): string {
    const GB = 1024 * 1024 * 1024;
    const MB = 1024 * 1024;
    if (bytes >= GB) return `${(bytes / GB).toFixed(2)} GB`;
    if (bytes >= MB) return `${(bytes / MB).toFixed(2)} MB`;
    return `${(bytes / 1024).toFixed(2)} KB`;
  }
}
