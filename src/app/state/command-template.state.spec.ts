import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandTemplateState } from './command-template.state';
import type { CommandTemplate } from '../core/models/command-template.model';

describe('CommandTemplateState', () => {
  let state: CommandTemplateState;
  let mockService: any;

  const makeTemplate = (overrides: Partial<CommandTemplate> = {}): CommandTemplate => ({
    id: 'tpl-1',
    name: 'List Containers',
    description: 'List all containers',
    command: 'docker ps -a',
    category: 'container-management',
    tags: ['docker', 'list'],
    variables: [],
    compatibility: { runtimes: ['docker', 'podman'] },
    isFavorite: false,
    isBuiltIn: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  } as any);

  beforeEach(() => {
    mockService = {
      listTemplates: vi.fn(),
      getTemplate: vi.fn(),
      createTemplate: vi.fn(),
      updateTemplate: vi.fn(),
      deleteTemplate: vi.fn(),
      toggleFavorite: vi.fn(),
      duplicateTemplate: vi.fn(),
    };
    state = new CommandTemplateState(mockService);
  });

  it('should start with empty state', () => {
    expect(state.templates()).toEqual([]);
    expect(state.loading()).toBe(false);
    expect(state.error()).toBeNull();
    expect(state.selectedTemplateId()).toBeNull();
  });

  it('should load templates', async () => {
    const templates = [makeTemplate(), makeTemplate({ id: 'tpl-2', name: 'Stop' })];
    mockService.listTemplates.mockResolvedValue(templates);

    await state.loadTemplates();
    expect(state.templates()).toHaveLength(2);
    expect(state.loading()).toBe(false);
  });

  it('should handle load error', async () => {
    mockService.listTemplates.mockRejectedValue(new Error('DB error'));

    await state.loadTemplates();
    expect(state.error()).toBe('DB error');
  });

  it('should create a template', async () => {
    const newTpl = makeTemplate({ id: 'tpl-new', isBuiltIn: false });
    mockService.createTemplate.mockResolvedValue(newTpl);

    const result = await state.createTemplate({} as any);
    expect(result).toEqual(newTpl);
    expect(state.templates()).toContainEqual(newTpl);
  });

  it('should update a template', async () => {
    mockService.listTemplates.mockResolvedValue([makeTemplate()]);
    await state.loadTemplates();

    const updated = makeTemplate({ name: 'Updated Name' });
    mockService.updateTemplate.mockResolvedValue(updated);

    await state.updateTemplate({ id: 'tpl-1', name: 'Updated Name' } as any);
    expect(state.templates()[0].name).toBe('Updated Name');
  });

  it('should delete a template', async () => {
    mockService.listTemplates.mockResolvedValue([makeTemplate()]);
    await state.loadTemplates();

    mockService.deleteTemplate.mockResolvedValue(true);
    const result = await state.deleteTemplate('tpl-1');

    expect(result).toBe(true);
    expect(state.templates()).toHaveLength(0);
  });

  it('should clear selected template on delete', async () => {
    mockService.listTemplates.mockResolvedValue([makeTemplate()]);
    await state.loadTemplates();
    state.selectTemplate('tpl-1');

    mockService.deleteTemplate.mockResolvedValue(true);
    await state.deleteTemplate('tpl-1');

    expect(state.selectedTemplateId()).toBeNull();
  });

  it('should toggle favorite', async () => {
    mockService.listTemplates.mockResolvedValue([makeTemplate()]);
    await state.loadTemplates();

    const favorited = makeTemplate({ isFavorite: true });
    mockService.toggleFavorite.mockResolvedValue(favorited);

    await state.toggleFavorite('tpl-1');
    expect(state.templates()[0].isFavorite).toBe(true);
  });

  it('should duplicate a template', async () => {
    const duplicate = makeTemplate({ id: 'tpl-dup', name: 'List Containers (Copy)' });
    mockService.duplicateTemplate.mockResolvedValue(duplicate);

    const result = await state.duplicateTemplate('tpl-1');
    expect(result?.id).toBe('tpl-dup');
    expect(state.templates()).toContainEqual(duplicate);
  });

  it('should select template', () => {
    state.selectTemplate('tpl-1');
    expect(state.selectedTemplateId()).toBe('tpl-1');
  });

  it('should compute selected template', async () => {
    mockService.listTemplates.mockResolvedValue([makeTemplate()]);
    await state.loadTemplates();

    state.selectTemplate('tpl-1');
    expect(state.selectedTemplate()?.id).toBe('tpl-1');
  });

  it('should filter by category', async () => {
    const templates = [
      makeTemplate({ id: '1', category: 'debugging' as any }),
      makeTemplate({ id: '2', category: 'networking' as any }),
    ];
    mockService.listTemplates.mockResolvedValue(templates);
    await state.loadTemplates();

    state.setCategoryFilter('debugging' as any);
    expect(state.filteredTemplates()).toHaveLength(1);
  });

  it('should filter by search query', async () => {
    const templates = [
      makeTemplate({ id: '1', name: 'List Containers', command: 'docker ps' }),
      makeTemplate({ id: '2', name: 'Stop Container', command: 'docker stop' }),
    ];
    mockService.listTemplates.mockResolvedValue(templates);
    await state.loadTemplates();

    state.setSearchQuery('stop');
    expect(state.filteredTemplates()).toHaveLength(1);
  });

  it('should filter favorites only', async () => {
    const templates = [
      makeTemplate({ id: '1', isFavorite: true }),
      makeTemplate({ id: '2', isFavorite: false }),
    ];
    mockService.listTemplates.mockResolvedValue(templates);
    await state.loadTemplates();

    state.setShowFavoritesOnly(true);
    expect(state.filteredTemplates()).toHaveLength(1);
  });

  it('should sort favorites first', async () => {
    const templates = [
      makeTemplate({ id: '1', name: 'Zebra', isFavorite: false }),
      makeTemplate({ id: '2', name: 'Alpha', isFavorite: true }),
    ];
    mockService.listTemplates.mockResolvedValue(templates);
    await state.loadTemplates();

    state.setSortOption('name');
    expect(state.filteredTemplates()[0].id).toBe('2'); // Favorite first
  });

  it('should compute stats', async () => {
    const templates = [
      makeTemplate({ id: '1', isFavorite: true, isBuiltIn: true }),
      makeTemplate({ id: '2', isFavorite: false, isBuiltIn: true }),
      makeTemplate({ id: '3', isFavorite: true, isBuiltIn: false }),
    ];
    mockService.listTemplates.mockResolvedValue(templates);
    await state.loadTemplates();

    const stats = state.stats();
    expect(stats.total).toBe(3);
    expect(stats.favorites).toBe(2);
    expect(stats.builtIn).toBe(2);
    expect(stats.custom).toBe(1);
  });

  it('should compute favorites list', async () => {
    const templates = [
      makeTemplate({ id: '1', isFavorite: true }),
      makeTemplate({ id: '2', isFavorite: false }),
    ];
    mockService.listTemplates.mockResolvedValue(templates);
    await state.loadTemplates();

    expect(state.favorites()).toHaveLength(1);
  });

  it('should clear all filters', () => {
    state.setCategoryFilter('debugging' as any);
    state.setRuntimeFilter('docker' as any);
    state.setSearchQuery('test');
    state.setSystemFilter('sys-1');
    state.setShowFavoritesOnly(true);
    state.setSortOption('recent');

    state.clearFilters();

    expect(state.categoryFilter()).toBeNull();
    expect(state.runtimeFilter()).toBeNull();
    expect(state.searchQuery()).toBe('');
    expect(state.systemFilter()).toBeNull();
    expect(state.showFavoritesOnly()).toBe(false);
    expect(state.sortOption()).toBe('name');
  });

  it('should get compatible templates', async () => {
    const templates = [
      makeTemplate({ id: '1', compatibility: { runtimes: ['docker', 'podman'] } as any }),
      makeTemplate({ id: '2', compatibility: { runtimes: ['podman'] } as any }),
    ];
    mockService.listTemplates.mockResolvedValue(templates);
    await state.loadTemplates();

    const compatible = state.getCompatibleTemplates('docker' as any);
    expect(compatible).toHaveLength(1);
    expect(compatible[0].id).toBe('1');
  });
});
