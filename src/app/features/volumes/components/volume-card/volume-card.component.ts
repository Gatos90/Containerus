import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Volume } from '../../../../core/models/volume.model';
import { Container } from '../../../../core/models/container.model';
import { ContainerChipComponent } from '../../../networks/components/container-chip/container-chip.component';
import { LucideAngularModule, FolderOpen, HardDrive, Trash2, Tag } from 'lucide-angular';

@Component({
  selector: 'app-volume-card',
  imports: [LucideAngularModule, ContainerChipComponent],
  templateUrl: './volume-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VolumeCardComponent {
  readonly volume = input.required<Volume>();
  readonly containers = input.required<Container[]>();
  readonly isOrphaned = input(false);
  readonly isDeleting = input(false);

  readonly deleted = output<void>();

  readonly FolderOpen = FolderOpen;
  readonly HardDrive = HardDrive;
  readonly Trash2 = Trash2;
  readonly Tag = Tag;

  readonly containerCount = computed(() => this.containers().length);

  readonly hasLabels = computed(() => {
    const labels = this.volume().labels;
    return labels && Object.keys(labels).length > 0;
  });

  readonly labelEntries = computed(() => {
    const labels = this.volume().labels;
    return labels ? Object.entries(labels).slice(0, 3) : [];
  });

  readonly truncatedMountpoint = computed(() => {
    const mp = this.volume().mountpoint;
    if (mp.length > 40) {
      return '...' + mp.slice(-37);
    }
    return mp;
  });

  onDelete(event: Event): void {
    event.stopPropagation();
    this.deleted.emit();
  }
}
