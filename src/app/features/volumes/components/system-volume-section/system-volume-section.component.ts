import { ChangeDetectionStrategy, Component, computed, inject, input, model, output } from '@angular/core';
import { Volume } from '../../../../core/models/volume.model';
import { ContainerSystem } from '../../../../core/models/system.model';
import { VolumeCardComponent } from '../volume-card/volume-card.component';
import { LucideAngularModule, ChevronDown, ChevronRight, Globe, HardDrive } from 'lucide-angular';
import { VolumeState } from '../../../../state/volume.state';

@Component({
  selector: 'app-system-volume-section',
  imports: [LucideAngularModule, VolumeCardComponent],
  templateUrl: './system-volume-section.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SystemVolumeSectionComponent {
  private volumeState = inject(VolumeState);

  readonly system = input.required<ContainerSystem>();
  readonly volumes = input.required<Volume[]>();
  readonly expanded = model(false);

  readonly volumeDeleted = output<Volume>();

  readonly ChevronDown = ChevronDown;
  readonly ChevronRight = ChevronRight;
  readonly Globe = Globe;
  readonly HardDrive = HardDrive;

  readonly volumeCount = computed(() => this.volumes().length);

  readonly containerCount = computed(() => {
    let count = 0;
    for (const volume of this.volumes()) {
      count += this.volumeState.getContainersUsingVolume(volume.name).length;
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

  toggleExpanded(): void {
    this.expanded.update((v) => !v);
  }

  getContainersForVolume(volume: Volume) {
    return this.volumeState.getContainersUsingVolume(volume.name);
  }

  isVolumeOrphaned(volume: Volume): boolean {
    return !this.volumeState.isVolumeMounted(volume);
  }

  isVolumeDeleting(volume: Volume): boolean {
    return this.volumeState.isLoading(volume.name);
  }

  onVolumeDeleted(volume: Volume): void {
    this.volumeDeleted.emit(volume);
  }
}
