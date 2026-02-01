import { computed, Injectable, signal } from '@angular/core';
import {
  CommandCategory,
  CommandTemplate,
  CreateCommandTemplateRequest,
  UpdateCommandTemplateRequest,
  groupByCategory,
  isCompatibleWithRuntime,
  isCompatibleWithSystem,
} from '../core/models/command-template.model';
import { ContainerRuntime } from '../core/models/container.model';
import { CommandTemplateService } from '../core/services/command-template.service';

export type SortOption = 'name' | 'category' | 'recent';

@Injectable({ providedIn: 'root' })
export class CommandTemplateState {
  private _templates = signal<CommandTemplate[]>([]);
  private _loading = signal(false);
  private _error = signal<string | null>(null);
  private _selectedTemplateId = signal<string | null>(null);

  // Filters
  private _categoryFilter = signal<CommandCategory | null>(null);
  private _runtimeFilter = signal<ContainerRuntime | null>(null);
  private _systemFilter = signal<string | null>(null);
  private _searchQuery = signal('');
  private _showFavoritesOnly = signal(false);
  private _sortOption = signal<SortOption>('name');

  // Public readonly signals
  readonly templates = this._templates.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly selectedTemplateId = this._selectedTemplateId.asReadonly();

  readonly categoryFilter = this._categoryFilter.asReadonly();
  readonly runtimeFilter = this._runtimeFilter.asReadonly();
  readonly systemFilter = this._systemFilter.asReadonly();
  readonly searchQuery = this._searchQuery.asReadonly();
  readonly showFavoritesOnly = this._showFavoritesOnly.asReadonly();
  readonly sortOption = this._sortOption.asReadonly();

  // Computed values
  readonly selectedTemplate = computed(() => {
    const id = this._selectedTemplateId();
    return id ? this._templates().find((t) => t.id === id) ?? null : null;
  });

  readonly filteredTemplates = computed(() => {
    let result = this._templates();

    // Category filter
    const categoryFilter = this._categoryFilter();
    if (categoryFilter) {
      result = result.filter((t) => t.category === categoryFilter);
    }

    // Runtime filter
    const runtimeFilter = this._runtimeFilter();
    if (runtimeFilter) {
      result = result.filter((t) => isCompatibleWithRuntime(t, runtimeFilter));
    }

    // System filter
    const systemFilter = this._systemFilter();
    if (systemFilter) {
      result = result.filter((t) => isCompatibleWithSystem(t, systemFilter));
    }

    // Favorites filter
    if (this._showFavoritesOnly()) {
      result = result.filter((t) => t.isFavorite);
    }

    // Search filter
    const query = this._searchQuery().toLowerCase();
    if (query) {
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(query) ||
          t.description.toLowerCase().includes(query) ||
          t.command.toLowerCase().includes(query) ||
          t.tags.some((tag) => tag.toLowerCase().includes(query))
      );
    }

    // Sorting
    const sortOption = this._sortOption();
    result = [...result].sort((a, b) => {
      // Always put favorites first
      if (a.isFavorite && !b.isFavorite) return -1;
      if (!a.isFavorite && b.isFavorite) return 1;

      switch (sortOption) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'category':
          const catCompare = a.category.localeCompare(b.category);
          return catCompare !== 0 ? catCompare : a.name.localeCompare(b.name);
        case 'recent':
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        default:
          return 0;
      }
    });

    return result;
  });

  readonly templatesByCategory = computed(() => {
    return groupByCategory(this.filteredTemplates());
  });

  readonly favorites = computed(() => {
    return this._templates().filter((t) => t.isFavorite);
  });

  readonly stats = computed(() => {
    const templates = this._templates();
    return {
      total: templates.length,
      favorites: templates.filter((t) => t.isFavorite).length,
      builtIn: templates.filter((t) => t.isBuiltIn).length,
      custom: templates.filter((t) => !t.isBuiltIn).length,
    };
  });

  readonly categoryCounts = computed(() => {
    const templates = this._templates();
    return {
      'container-management': templates.filter((t) => t.category === 'container-management').length,
      debugging: templates.filter((t) => t.category === 'debugging').length,
      networking: templates.filter((t) => t.category === 'networking').length,
      images: templates.filter((t) => t.category === 'images').length,
      volumes: templates.filter((t) => t.category === 'volumes').length,
      system: templates.filter((t) => t.category === 'system').length,
      pods: templates.filter((t) => t.category === 'pods').length,
      custom: templates.filter((t) => t.category === 'custom').length,
    };
  });

  constructor(private templateService: CommandTemplateService) {}

  /**
   * Load all command templates
   */
  async loadTemplates(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);

    try {
      const templates = await this.templateService.listTemplates();
      this._templates.set(templates);
    } catch (err) {
      this._error.set(
        err instanceof Error ? err.message : 'Failed to load command templates'
      );
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Create a new command template
   */
  async createTemplate(request: CreateCommandTemplateRequest): Promise<CommandTemplate | null> {
    this._loading.set(true);
    this._error.set(null);

    try {
      const template = await this.templateService.createTemplate(request);
      this._templates.update((templates) => [...templates, template]);
      return template;
    } catch (err) {
      this._error.set(
        err instanceof Error ? err.message : 'Failed to create command template'
      );
      return null;
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Update an existing command template
   */
  async updateTemplate(request: UpdateCommandTemplateRequest): Promise<CommandTemplate | null> {
    this._loading.set(true);
    this._error.set(null);

    try {
      const updated = await this.templateService.updateTemplate(request);
      this._templates.update((templates) =>
        templates.map((t) => (t.id === updated.id ? updated : t))
      );
      return updated;
    } catch (err) {
      this._error.set(
        err instanceof Error ? err.message : 'Failed to update command template'
      );
      return null;
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Delete a command template
   */
  async deleteTemplate(id: string): Promise<boolean> {
    this._loading.set(true);
    this._error.set(null);

    try {
      const success = await this.templateService.deleteTemplate(id);
      if (success) {
        this._templates.update((templates) => templates.filter((t) => t.id !== id));
        if (this._selectedTemplateId() === id) {
          this._selectedTemplateId.set(null);
        }
      }
      return success;
    } catch (err) {
      this._error.set(
        err instanceof Error ? err.message : 'Failed to delete command template'
      );
      return false;
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Toggle favorite status for a template
   */
  async toggleFavorite(id: string): Promise<boolean> {
    this._error.set(null);

    try {
      const updated = await this.templateService.toggleFavorite(id);
      this._templates.update((templates) =>
        templates.map((t) => (t.id === updated.id ? updated : t))
      );
      return true;
    } catch (err) {
      this._error.set(
        err instanceof Error ? err.message : 'Failed to toggle favorite'
      );
      return false;
    }
  }

  /**
   * Duplicate a command template
   */
  async duplicateTemplate(id: string): Promise<CommandTemplate | null> {
    this._loading.set(true);
    this._error.set(null);

    try {
      const duplicate = await this.templateService.duplicateTemplate(id);
      this._templates.update((templates) => [...templates, duplicate]);
      return duplicate;
    } catch (err) {
      this._error.set(
        err instanceof Error ? err.message : 'Failed to duplicate command template'
      );
      return null;
    } finally {
      this._loading.set(false);
    }
  }

  // Selection
  selectTemplate(id: string | null): void {
    this._selectedTemplateId.set(id);
  }

  // Filter setters
  setCategoryFilter(category: CommandCategory | null): void {
    this._categoryFilter.set(category);
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

  setShowFavoritesOnly(show: boolean): void {
    this._showFavoritesOnly.set(show);
  }

  setSortOption(option: SortOption): void {
    this._sortOption.set(option);
  }

  clearFilters(): void {
    this._categoryFilter.set(null);
    this._runtimeFilter.set(null);
    this._systemFilter.set(null);
    this._searchQuery.set('');
    this._showFavoritesOnly.set(false);
    this._sortOption.set('name');
  }

  clearError(): void {
    this._error.set(null);
  }

  /**
   * Get templates compatible with a specific runtime and optionally a system
   */
  getCompatibleTemplates(
    runtime: ContainerRuntime,
    systemId?: string
  ): CommandTemplate[] {
    return this._templates().filter((t) => {
      if (!isCompatibleWithRuntime(t, runtime)) return false;
      if (systemId && !isCompatibleWithSystem(t, systemId)) return false;
      return true;
    });
  }
}
