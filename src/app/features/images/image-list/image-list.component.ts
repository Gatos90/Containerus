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
  Hammer,
  X,
  Plus,
  Trash2,
  CheckCircle,
  AlertCircle,
  Loader,
} from 'lucide-angular';
import { ContainerImage, getImageFullName, getImageSizeHuman } from '../../../core/models/image.model';
import { ImageState } from '../../../state/image.state';
import { SystemState } from '../../../state/system.state';
import { ContainerState } from '../../../state/container.state';
import { SystemImageSectionComponent } from '../components/system-image-section/system-image-section.component';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { HelpTooltipComponent } from '../../../shared/components/help-tooltip/help-tooltip.component';
import { AppModalDirective } from '../../../shared/directives/app-modal.directive';
import { Router } from '@angular/router';
import { Layers } from 'lucide-angular';

@Component({
  selector: 'app-image-list',
  imports: [CommonModule, FormsModule, LucideAngularModule, SystemImageSectionComponent, EmptyStateComponent, HelpTooltipComponent, AppModalDirective],
  templateUrl: './image-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class ImageListComponent implements OnInit {
  readonly imageState = inject(ImageState);
  readonly systemState = inject(SystemState);
  readonly containerState = inject(ContainerState);
  private readonly router = inject(Router);

  readonly Search = Search;
  readonly RefreshCw = RefreshCw;
  readonly Download = Download;
  readonly Circle = Circle;
  readonly SlidersHorizontal = SlidersHorizontal;
  readonly Layers = Layers;
  readonly Hammer = Hammer;
  readonly X = X;
  readonly Plus = Plus;
  readonly Trash2 = Trash2;
  readonly CheckCircle = CheckCircle;
  readonly AlertCircle = AlertCircle;
  readonly Loader = Loader;

  goToSystems(): void {
    this.router.navigate(['/systems']);
  }

  readonly getImageFullName = getImageFullName;
  readonly getImageSizeHuman = getImageSizeHuman;

  readonly showMobileFilters = signal(false);
  refreshing = false;
  showPullDialog = false;
  showBuildDialog = false;

  pullForm = {
    name: '',
    tag: 'latest',
    systemId: '',
    runtime: 'docker' as const,
  };

  buildForm = {
    contextPath: '.',
    dockerfile: '',
    imageName: '',
    tag: 'latest',
    systemId: '',
    runtime: 'docker' as const,
    noCache: false,
    buildArgs: [] as { key: string; value: string }[],
  };

  pullNameError = signal<string | null>(null);
  buildNameError = signal<string | null>(null);

  private readonly IMAGE_NAME_PATTERN = /^[a-z0-9][a-z0-9._\-\/]*$/;

  private validateImageName(value: string): string | null {
    if (!value) return 'Image name is required.';
    if (value !== value.toLowerCase()) return 'Image name must be lowercase.';
    if (!this.IMAGE_NAME_PATTERN.test(value))
      return 'Only lowercase letters, digits, dashes, dots, underscores, and slashes allowed.';
    return null;
  }

  onPullNameChange(value: string): void {
    this.pullForm.name = value;
    this.pullNameError.set(this.validateImageName(value));
  }

  onBuildNameChange(value: string): void {
    this.buildForm.imageName = value;
    this.buildNameError.set(this.validateImageName(value));
  }

  building = false;
  buildLog = '';
  buildError = '';
  showBuildOutput = false;

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

  onEscape(): void {
    if (this.showMobileFilters()) {
      this.showMobileFilters.set(false);
    }
  }

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
    const nameErr = this.validateImageName(this.pullForm.name);
    if (nameErr) { this.pullNameError.set(nameErr); return; }
    if (!this.pullForm.systemId) return;

    await this.imageState.pullImage(
      this.pullForm.systemId,
      this.pullForm.name,
      this.pullForm.tag,
      this.pullForm.runtime
    );

    this.showPullDialog = false;
    this.pullNameError.set(null);
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

  openBuildDialog(): void {
    const connected = this.systemState.connectedSystems();
    if (connected.length > 0 && !this.buildForm.systemId) {
      this.buildForm.systemId = connected[0].id;
    }
    this.buildLog = '';
    this.buildError = '';
    this.showBuildOutput = false;
    this.showBuildDialog = true;
  }

  addBuildArg(): void {
    this.buildForm.buildArgs = [...this.buildForm.buildArgs, { key: '', value: '' }];
  }

  removeBuildArg(index: number): void {
    this.buildForm.buildArgs = this.buildForm.buildArgs.filter((_, i) => i !== index);
  }

  async buildImage(): Promise<void> {
    const nameErr = this.validateImageName(this.buildForm.imageName);
    if (nameErr) { this.buildNameError.set(nameErr); return; }
    if (!this.buildForm.systemId || !this.buildForm.contextPath) return;

    this.building = true;
    this.buildLog = '';
    this.buildError = '';
    this.showBuildOutput = true;

    const buildArgs: [string, string][] = this.buildForm.buildArgs
      .filter((a) => a.key.trim())
      .map((a) => [a.key.trim(), a.value]);

    const job = await this.imageState.buildImage(
      this.buildForm.systemId,
      this.buildForm.contextPath,
      this.buildForm.dockerfile.trim() || null,
      this.buildForm.imageName,
      this.buildForm.tag || 'latest',
      this.buildForm.runtime,
      buildArgs,
      this.buildForm.noCache,
    );

    this.building = false;
    this.buildLog = job.log;
    this.buildError = job.error ?? '';
  }

  closeBuildDialog(): void {
    if (this.building) return;
    this.showBuildDialog = false;
    this.buildLog = '';
    this.buildError = '';
    this.buildNameError.set(null);
    this.showBuildOutput = false;
    this.buildForm = {
      contextPath: '.',
      dockerfile: '',
      imageName: '',
      tag: 'latest',
      systemId: this.buildForm.systemId,
      runtime: this.buildForm.runtime,
      noCache: false,
      buildArgs: [],
    };
  }

  formatSize(bytes: number): string {
    const GB = 1024 * 1024 * 1024;
    const MB = 1024 * 1024;
    if (bytes >= GB) return `${(bytes / GB).toFixed(2)} GB`;
    if (bytes >= MB) return `${(bytes / MB).toFixed(2)} MB`;
    return `${(bytes / 1024).toFixed(2)} KB`;
  }
}
