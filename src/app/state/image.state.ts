import { computed, inject, Injectable, signal } from '@angular/core';
import { ContainerRuntime } from '../core/models/container.model';
import { ContainerImage } from '../core/models/image.model';
import { ImageService } from '../core/services/image.service';
import { ContainerState } from './container.state';

export type ImageUsageFilter = 'all' | 'in-use' | 'unused' | 'dangling';

@Injectable({ providedIn: 'root' })
export class ImageState {
  private containerState = inject(ContainerState);

  private _images = signal<ContainerImage[]>([]);
  private _loading = signal<Record<string, boolean>>({});
  private _error = signal<string | null>(null);
  private _pullProgress = signal<Record<string, string>>({});

  private _runtimeFilter = signal<ContainerRuntime | null>(null);
  private _searchQuery = signal<string>('');
  private _systemFilter = signal<string | null>(null);
  private _sortOption = signal<'name' | 'size' | 'created'>('name');
  private _usageFilter = signal<ImageUsageFilter>('all');

  readonly images = this._images.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly pullProgress = this._pullProgress.asReadonly();

  readonly runtimeFilter = this._runtimeFilter.asReadonly();
  readonly searchQuery = this._searchQuery.asReadonly();
  readonly systemFilter = this._systemFilter.asReadonly();
  readonly sortOption = this._sortOption.asReadonly();
  readonly usageFilter = this._usageFilter.asReadonly();

  /** Helper to get full image name for matching */
  private getImageFullName(img: ContainerImage): string {
    return img.tag && img.tag !== '<none>' ? `${img.name}:${img.tag}` : img.name;
  }

  /** Get set of image names currently used by containers */
  private getUsedImageNames(): Set<string> {
    return new Set(this.containerState.containers().map((c) => c.image));
  }

  readonly filteredImages = computed(() => {
    let result = this._images();
    const usedImageNames = this.getUsedImageNames();

    // Apply usage filter
    const usageFilter = this._usageFilter();
    if (usageFilter === 'in-use') {
      result = result.filter((i) => usedImageNames.has(this.getImageFullName(i)));
    } else if (usageFilter === 'unused') {
      result = result.filter((i) => !usedImageNames.has(this.getImageFullName(i)));
    } else if (usageFilter === 'dangling') {
      result = result.filter((i) => !i.tag || i.tag === '<none>');
    }

    const runtimeFilter = this._runtimeFilter();
    if (runtimeFilter) {
      result = result.filter((i) => i.runtime === runtimeFilter);
    }

    const systemFilter = this._systemFilter();
    if (systemFilter) {
      result = result.filter((i) => i.systemId === systemFilter);
    }

    const query = this._searchQuery().toLowerCase();
    if (query) {
      result = result.filter(
        (i) =>
          i.name.toLowerCase().includes(query) ||
          i.tag.toLowerCase().includes(query) ||
          i.id.toLowerCase().includes(query)
      );
    }

    // Sort results - in-use images first, then by selected option
    const sortOption = this._sortOption();
    result = [...result].sort((a, b) => {
      // First: sort by in-use status (in-use first)
      const aInUse = usedImageNames.has(this.getImageFullName(a));
      const bInUse = usedImageNames.has(this.getImageFullName(b));
      if (aInUse !== bInUse) {
        return aInUse ? -1 : 1;
      }

      // Then: sort by selected option
      switch (sortOption) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'size':
          return b.size - a.size;
        case 'created':
          return new Date(b.created || 0).getTime() - new Date(a.created || 0).getTime();
        default:
          return 0;
      }
    });

    return result;
  });

  readonly stats = computed(() => {
    const images = this._images();
    const usedImageNames = this.getUsedImageNames();

    const usedImages = images.filter((i) =>
      usedImageNames.has(this.getImageFullName(i))
    );
    const unusedImages = images.filter(
      (i) => !usedImageNames.has(this.getImageFullName(i))
    );
    const danglingImages = images.filter((i) => !i.tag || i.tag === '<none>');

    return {
      total: images.length,
      totalSize: images.reduce((sum, i) => sum + i.size, 0),
      inUse: usedImages.length,
      inUseSize: usedImages.reduce((sum, i) => sum + i.size, 0),
      unused: unusedImages.length,
      unusedSize: unusedImages.reduce((sum, i) => sum + i.size, 0),
      dangling: danglingImages.length,
    };
  });

  readonly imagesBySystem = computed(() => {
    const grouped: Record<string, ContainerImage[]> = {};
    for (const image of this._images()) {
      if (!grouped[image.systemId]) {
        grouped[image.systemId] = [];
      }
      grouped[image.systemId].push(image);
    }
    return grouped;
  });

  constructor(private imageService: ImageService) {}

  async loadImages(systemId: string): Promise<void> {
    this._loading.update((l) => ({ ...l, [systemId]: true }));
    this._error.set(null);

    try {
      const images = await this.imageService.listImages(systemId);
      this._images.update((current) => {
        const filtered = current.filter((i) => i.systemId !== systemId);
        return [...filtered, ...images];
      });
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : 'Failed to load images');
    } finally {
      this._loading.update((l) => ({ ...l, [systemId]: false }));
    }
  }

  async pullImage(
    systemId: string,
    name: string,
    tag: string,
    runtime: ContainerRuntime
  ): Promise<boolean> {
    const key = `${systemId}:${name}:${tag}`;
    this._loading.update((l) => ({ ...l, [key]: true }));
    this._pullProgress.update((p) => ({ ...p, [key]: 'Starting pull...' }));
    this._error.set(null);

    try {
      await this.imageService.pullImage(systemId, name, tag, runtime);
      await this.loadImages(systemId);
      return true;
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : 'Failed to pull image');
      return false;
    } finally {
      this._loading.update((l) => ({ ...l, [key]: false }));
      this._pullProgress.update((p) => {
        const updated = { ...p };
        delete updated[key];
        return updated;
      });
    }
  }

  async removeImage(image: ContainerImage): Promise<boolean> {
    this._loading.update((l) => ({ ...l, [image.id]: true }));
    this._error.set(null);

    try {
      await this.imageService.removeImage(
        image.systemId,
        image.id,
        image.runtime
      );
      this._images.update((images) => images.filter((i) => i.id !== image.id));
      return true;
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : 'Failed to remove image');
      return false;
    } finally {
      this._loading.update((l) => ({ ...l, [image.id]: false }));
    }
  }

  setRuntimeFilter(runtime: ContainerRuntime | null): void {
    this._runtimeFilter.set(runtime);
  }

  setSystemFilter(systemId: string | null): void {
    this._systemFilter.set(systemId);
  }

  setSearchQuery(query: string): void {
    this._searchQuery.set(query);
  }

  setSortOption(option: 'name' | 'size' | 'created'): void {
    this._sortOption.set(option);
  }

  setUsageFilter(filter: ImageUsageFilter): void {
    this._usageFilter.set(filter);
  }

  clearFilters(): void {
    this._runtimeFilter.set(null);
    this._systemFilter.set(null);
    this._searchQuery.set('');
    this._sortOption.set('name');
    this._usageFilter.set('all');
  }

  /** Check if an image is currently in use by any container */
  isImageInUse(image: ContainerImage): boolean {
    const usedImageNames = this.getUsedImageNames();
    return usedImageNames.has(this.getImageFullName(image));
  }

  /** Check if an image is dangling (no tag) */
  isDangling(image: ContainerImage): boolean {
    return !image.tag || image.tag === '<none>';
  }

  /** Get containers that are using a specific image */
  getContainersUsingImage(image: ContainerImage) {
    const fullName = this.getImageFullName(image);
    return this.containerState.containers().filter((c) => c.image === fullName);
  }

  clearImagesForSystem(systemId: string): void {
    this._images.update((images) =>
      images.filter((i) => i.systemId !== systemId)
    );
  }

  isLoading(id: string): boolean {
    return this._loading()[id] ?? false;
  }

  clearError(): void {
    this._error.set(null);
  }
}
