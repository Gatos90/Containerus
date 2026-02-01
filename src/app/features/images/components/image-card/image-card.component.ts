import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ContainerImage, getImageFullName, getImageSizeHuman } from '../../../../core/models/image.model';
import { Container } from '../../../../core/models/container.model';
import { ContainerChipComponent } from '../../../networks/components/container-chip/container-chip.component';
import { LucideAngularModule, Package, Clock, Trash2, Copy, Cpu } from 'lucide-angular';

@Component({
  selector: 'app-image-card',
  imports: [LucideAngularModule, ContainerChipComponent],
  templateUrl: './image-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImageCardComponent {
  readonly image = input.required<ContainerImage>();
  readonly containers = input.required<Container[]>();
  readonly isUnused = input(false);
  readonly isDangling = input(false);
  readonly isDeleting = input(false);

  readonly deleted = output<void>();

  readonly Package = Package;
  readonly Clock = Clock;
  readonly Trash2 = Trash2;
  readonly Copy = Copy;
  readonly Cpu = Cpu;

  readonly containerCount = computed(() => this.containers().length);

  readonly fullName = computed(() => getImageFullName(this.image()));

  readonly sizeHuman = computed(() => getImageSizeHuman(this.image()));

  readonly shortId = computed(() => {
    const id = this.image().id;
    // Remove 'sha256:' prefix if present
    const cleanId = id.startsWith('sha256:') ? id.slice(7) : id;
    return cleanId.slice(0, 12);
  });

  readonly relativeTime = computed(() => {
    const created = this.image().created;
    if (!created) return null;

    const date = new Date(created);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
  });

  readonly archDisplay = computed(() => {
    const img = this.image();
    if (img.architecture && img.os) {
      return `${img.os}/${img.architecture}`;
    }
    if (img.architecture) {
      return img.architecture;
    }
    return null;
  });

  readonly truncatedDigest = computed(() => {
    const digest = this.image().digest;
    if (!digest) return null;
    // Format: sha256:abcd1234... -> sha256:abcd12...
    if (digest.length > 19) {
      return digest.slice(0, 15) + '...';
    }
    return digest;
  });

  onDelete(event: Event): void {
    event.stopPropagation();
    this.deleted.emit();
  }

  async copyId(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.image().id);
    } catch {
      // Clipboard not available
    }
  }

  async copyDigest(): Promise<void> {
    const digest = this.image().digest;
    if (digest) {
      try {
        await navigator.clipboard.writeText(digest);
      } catch {
        // Clipboard not available
      }
    }
  }
}
