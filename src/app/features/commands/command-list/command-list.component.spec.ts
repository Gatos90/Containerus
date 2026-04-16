import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { CommandListComponent } from './command-list.component';
import { CommandTemplateState } from '../../../state/command-template.state';
import { SystemState } from '../../../state/system.state';
import type { CommandTemplate, CommandCategory } from '../../../core/models/command-template.model';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeTemplate = (overrides: Partial<CommandTemplate> = {}): CommandTemplate => ({
  id: 'tpl-1',
  name: 'Test Command',
  description: 'A test command',
  command: 'docker ps',
  category: 'container-management',
  tags: [],
  variables: [],
  compatibility: { runtimes: [] },
  isFavorite: false,
  isBuiltIn: false,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  ...overrides,
});

const emptyCategoryCounts = {
  'container-management': 0,
  debugging: 0,
  networking: 0,
  images: 0,
  volumes: 0,
  system: 0,
  pods: 0,
  custom: 0,
};

function makeComponent(): CommandListComponent {
  const mockCommandState: any = {
    categoryCounts: vi.fn(() => emptyCategoryCounts),
    loadTemplates: vi.fn().mockResolvedValue(undefined),
    toggleFavorite: vi.fn().mockResolvedValue(undefined),
    duplicateTemplate: vi.fn().mockResolvedValue(undefined),
    deleteTemplate: vi.fn().mockResolvedValue(undefined),
    selectTemplate: vi.fn(),
    setCategoryFilter: vi.fn(),
    setShowFavoritesOnly: vi.fn(),
    filteredTemplates: vi.fn(() => []),
    selectedTemplateId: vi.fn(() => null),
    selectedTemplate: vi.fn(() => null),
    searchQuery: vi.fn(() => ''),
    showFavoritesOnly: vi.fn(() => false),
    categoryFilter: vi.fn(() => null),
  };

  const mockSystemState: any = {
    connectedSystems: vi.fn(() => []),
    systems: vi.fn(() => []),
  };

  const injector = Injector.create({
    providers: [
      { provide: CommandTemplateState, useValue: mockCommandState },
      { provide: SystemState, useValue: mockSystemState },
    ],
  });

  return runInInjectionContext(injector, () => new CommandListComponent());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommandListComponent', () => {
  let component: CommandListComponent;

  beforeEach(() => {
    component = makeComponent();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe('initial state', () => {
    it('should initialise showMobileFilters to false', () => {
      expect(component.showMobileFilters()).toBe(false);
    });

    it('should initialise showCreateModal to false', () => {
      expect(component.showCreateModal()).toBe(false);
    });

    it('should initialise editingTemplate to null', () => {
      expect(component.editingTemplate()).toBeNull();
    });

    it('should initialise collapsedCategories to empty Set', () => {
      expect(component.collapsedCategories().size).toBe(0);
    });

    it('should initialise refreshing to false', () => {
      expect(component.refreshing).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // categories computed
  // -------------------------------------------------------------------------

  describe('categories computed', () => {
    it('should return 8 category entries', () => {
      expect(component.categories().length).toBe(8);
    });

    it('should include all expected category keys', () => {
      const keys = component.categories().map((c) => c.key);
      expect(keys).toContain('container-management');
      expect(keys).toContain('debugging');
      expect(keys).toContain('networking');
      expect(keys).toContain('images');
      expect(keys).toContain('volumes');
      expect(keys).toContain('system');
      expect(keys).toContain('pods');
      expect(keys).toContain('custom');
    });

    it('should reflect categoryCounts from the state', () => {
      component.commandState.categoryCounts = vi.fn(() => ({
        ...emptyCategoryCounts,
        debugging: 5,
      }));
      const debugCat = component.categories().find((c) => c.key === 'debugging');
      expect(debugCat?.count).toBe(5);
    });

    it('should mark a category as collapsed when present in collapsedCategories', () => {
      component.collapsedCategories.set(new Set(['debugging' as CommandCategory]));
      const debugCat = component.categories().find((c) => c.key === 'debugging');
      expect(debugCat?.collapsed).toBe(true);
    });

    it('should mark a category as not collapsed when absent from collapsedCategories', () => {
      const debugCat = component.categories().find((c) => c.key === 'debugging');
      expect(debugCat?.collapsed).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // refresh
  // -------------------------------------------------------------------------

  describe('refresh', () => {
    it('should call loadTemplates', async () => {
      await component.refresh();
      expect(component.commandState.loadTemplates).toHaveBeenCalled();
    });

    it('should set refreshing to false after successful load', async () => {
      await component.refresh();
      expect(component.refreshing).toBe(false);
    });

    it('should set refreshing to false when loadTemplates throws', async () => {
      component.commandState.loadTemplates = vi.fn().mockRejectedValue(new Error('fail'));
      await component.refresh().catch(() => {});
      expect(component.refreshing).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // ngOnInit
  // -------------------------------------------------------------------------

  describe('ngOnInit', () => {
    it('should call refresh on init', async () => {
      const refreshSpy = vi.spyOn(component, 'refresh').mockResolvedValue(undefined);
      await component.ngOnInit();
      expect(refreshSpy).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // toggleCategory
  // -------------------------------------------------------------------------

  describe('toggleCategory', () => {
    it('should add a category to collapsedCategories when not present', () => {
      component.toggleCategory('debugging');
      expect(component.collapsedCategories().has('debugging')).toBe(true);
    });

    it('should remove a category from collapsedCategories when already present', () => {
      component.collapsedCategories.set(new Set(['debugging' as CommandCategory]));
      component.toggleCategory('debugging');
      expect(component.collapsedCategories().has('debugging')).toBe(false);
    });

    it('should not affect other categories when toggling one', () => {
      component.collapsedCategories.set(new Set(['images' as CommandCategory]));
      component.toggleCategory('debugging');
      expect(component.collapsedCategories().has('images')).toBe(true);
      expect(component.collapsedCategories().has('debugging')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // openCreateModal / closeModal
  // -------------------------------------------------------------------------

  describe('openCreateModal', () => {
    it('should set showCreateModal to true', () => {
      component.openCreateModal();
      expect(component.showCreateModal()).toBe(true);
    });

    it('should clear editingTemplate', () => {
      component.editingTemplate.set(makeTemplate());
      component.openCreateModal();
      expect(component.editingTemplate()).toBeNull();
    });
  });

  describe('openEditModal', () => {
    it('should set showCreateModal to true', () => {
      component.openEditModal(makeTemplate());
      expect(component.showCreateModal()).toBe(true);
    });

    it('should set editingTemplate to the provided template', () => {
      const tpl = makeTemplate({ id: 'tpl-42', name: 'My Cmd' });
      component.openEditModal(tpl);
      expect(component.editingTemplate()).toEqual(tpl);
    });
  });

  describe('closeModal', () => {
    it('should set showCreateModal to false', () => {
      component.showCreateModal.set(true);
      component.closeModal();
      expect(component.showCreateModal()).toBe(false);
    });

    it('should clear editingTemplate', () => {
      component.editingTemplate.set(makeTemplate());
      component.closeModal();
      expect(component.editingTemplate()).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // selectTemplate / clearSelection
  // -------------------------------------------------------------------------

  describe('selectTemplate', () => {
    it('should call commandState.selectTemplate with the template id', () => {
      const tpl = makeTemplate({ id: 'tpl-7' });
      component.selectTemplate(tpl);
      expect(component.commandState.selectTemplate).toHaveBeenCalledWith('tpl-7');
    });
  });

  describe('clearSelection', () => {
    it('should call commandState.selectTemplate with null', () => {
      component.clearSelection();
      expect(component.commandState.selectTemplate).toHaveBeenCalledWith(null);
    });
  });

  // -------------------------------------------------------------------------
  // onToggleFavorite
  // -------------------------------------------------------------------------

  describe('onToggleFavorite', () => {
    it('should call commandState.toggleFavorite with the template id', async () => {
      const tpl = makeTemplate({ id: 'tpl-fav' });
      await component.onToggleFavorite(tpl);
      expect(component.commandState.toggleFavorite).toHaveBeenCalledWith('tpl-fav');
    });
  });

  // -------------------------------------------------------------------------
  // onDuplicate
  // -------------------------------------------------------------------------

  describe('onDuplicate', () => {
    it('should call commandState.duplicateTemplate with the template id', async () => {
      const tpl = makeTemplate({ id: 'tpl-dup' });
      await component.onDuplicate(tpl);
      expect(component.commandState.duplicateTemplate).toHaveBeenCalledWith('tpl-dup');
    });
  });

  // -------------------------------------------------------------------------
  // onDelete
  // -------------------------------------------------------------------------

  describe('onDelete', () => {
    it('should do nothing when template is built-in', async () => {
      const tpl = makeTemplate({ isBuiltIn: true });
      await component.onDelete(tpl);
      expect(component.commandState.deleteTemplate).not.toHaveBeenCalled();
    });

    it('should call deleteTemplate when user confirms deletion of custom template', async () => {
      vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
      const tpl = makeTemplate({ id: 'tpl-del', isBuiltIn: false });
      await component.onDelete(tpl);
      expect(component.commandState.deleteTemplate).toHaveBeenCalledWith('tpl-del');
    });

    it('should not call deleteTemplate when user cancels deletion', async () => {
      vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
      const tpl = makeTemplate({ id: 'tpl-del', isBuiltIn: false });
      await component.onDelete(tpl);
      expect(component.commandState.deleteTemplate).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // onCategoryFilterChange
  // -------------------------------------------------------------------------

  describe('onCategoryFilterChange', () => {
    it('should clear category filter and favorites when value is all', () => {
      component.onCategoryFilterChange('all');
      expect(component.commandState.setCategoryFilter).toHaveBeenCalledWith(null);
      expect(component.commandState.setShowFavoritesOnly).toHaveBeenCalledWith(false);
    });

    it('should set showFavoritesOnly and clear category filter when value is favorites', () => {
      component.onCategoryFilterChange('favorites');
      expect(component.commandState.setCategoryFilter).toHaveBeenCalledWith(null);
      expect(component.commandState.setShowFavoritesOnly).toHaveBeenCalledWith(true);
    });

    it('should set category filter and clear favorites when value is a category key', () => {
      component.onCategoryFilterChange('debugging');
      expect(component.commandState.setCategoryFilter).toHaveBeenCalledWith('debugging');
      expect(component.commandState.setShowFavoritesOnly).toHaveBeenCalledWith(false);
    });
  });
});
