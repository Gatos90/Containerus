import { ChangeDetectionStrategy, Component, computed, inject, input, model, output } from '@angular/core';
import { ContainerImage, getImageSizeHuman } from '../../../../core/models/image.model';
import { ContainerSystem } from '../../../../core/models/system.model';
import { ImageCardComponent } from '../image-card/image-card.component';
import { LucideAngularModule, ChevronDown, ChevronRight, Globe, Package } from 'lucide-angular';
import { ImageState } from '../../../../state/image.state';

@Component({
  selector: 'app-system-image-section',
  imports: [LucideAngularModule, ImageCardComponent],
  templateUrl: './system-image-section.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SystemImageSectionComponent {
  private imageState = inject(ImageState);

  readonly system = input.required<ContainerSystem>();
  readonly images = input.required<ContainerImage[]>();
  readonly expanded = model(false);

  readonly imageDeleted = output<ContainerImage>();

  readonly ChevronDown = ChevronDown;
  readonly ChevronRight = ChevronRight;
  readonly Globe = Globe;
  readonly Package = Package;

  readonly imageCount = computed(() => this.images().length);

  readonly totalSize = computed(() => {
    const total = this.images().reduce((sum, img) => sum + img.size, 0);
    return this.formatSize(total);
  });

  readonly containerCount = computed(() => {
    let count = 0;
    for (const image of this.images()) {
      count += this.imageState.getContainersUsingImage(image).length;
    }
    return count;
  });

  readonly runtimeIcon = computed(() => {
    switch (this.system().primaryRuntime) {
      case 'docker':
        return 'Docker';
      case 'podman':
        return 'Podman';
      case 'apple':
        return 'Apple';
      default:
        return 'Container';
    }
  });

  private formatSize(bytes: number): string {
    const KB = 1024;
    const MB = KB * 1024;
    const GB = MB * 1024;

    if (bytes >= GB) {
      return `${(bytes / GB).toFixed(1)} GB`;
    }
    if (bytes >= MB) {
      return `${(bytes / MB).toFixed(0)} MB`;
    }
    if (bytes >= KB) {
      return `${(bytes / KB).toFixed(0)} KB`;
    }
    return `${bytes} B`;
  }

  toggleExpanded(): void {
    this.expanded.update((v) => !v);
  }

  getContainersForImage(image: ContainerImage) {
    return this.imageState.getContainersUsingImage(image);
  }

  isImageUnused(image: ContainerImage): boolean {
    return !this.imageState.isImageInUse(image);
  }

  isImageDangling(image: ContainerImage): boolean {
    return this.imageState.isDangling(image);
  }

  isImageDeleting(image: ContainerImage): boolean {
    return this.imageState.isLoading(image.id);
  }

  onImageDeleted(image: ContainerImage): void {
    this.imageDeleted.emit(image);
  }
}
