import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandTemplateService } from './command-template.service';

describe('CommandTemplateService', () => {
  let service: CommandTemplateService;
  let mockTauri: any;

  beforeEach(() => {
    mockTauri = { invoke: vi.fn() };
    service = new CommandTemplateService(mockTauri);
  });

  it('should list templates', async () => {
    const templates = [{ id: '1', name: 'Test' }];
    mockTauri.invoke.mockResolvedValue(templates);

    const result = await service.listTemplates();
    expect(result).toEqual(templates);
    expect(mockTauri.invoke).toHaveBeenCalledWith('list_command_templates', {});
  });

  it('should get a template by id', async () => {
    const template = { id: '1', name: 'Test' };
    mockTauri.invoke.mockResolvedValue(template);

    const result = await service.getTemplate('1');
    expect(result).toEqual(template);
    expect(mockTauri.invoke).toHaveBeenCalledWith('get_command_template', { id: '1' });
  });

  it('should create a template', async () => {
    const request = { name: 'New', description: 'Desc', command: 'echo hi', category: 'custom' as any, tags: [], variables: [], compatibility: { runtimes: [] } };
    const created = { id: 'new-1', ...request };
    mockTauri.invoke.mockResolvedValue(created);

    const result = await service.createTemplate(request as any);
    expect(result).toEqual(created);
    expect(mockTauri.invoke).toHaveBeenCalledWith('create_command_template', { request });
  });

  it('should update a template', async () => {
    const request = { id: '1', name: 'Updated' };
    const updated = { id: '1', name: 'Updated' };
    mockTauri.invoke.mockResolvedValue(updated);

    const result = await service.updateTemplate(request as any);
    expect(result).toEqual(updated);
    expect(mockTauri.invoke).toHaveBeenCalledWith('update_command_template', { request });
  });

  it('should delete a template', async () => {
    mockTauri.invoke.mockResolvedValue(true);

    const result = await service.deleteTemplate('1');
    expect(result).toBe(true);
    expect(mockTauri.invoke).toHaveBeenCalledWith('delete_command_template', { id: '1' });
  });

  it('should toggle favorite', async () => {
    const template = { id: '1', isFavorite: true };
    mockTauri.invoke.mockResolvedValue(template);

    const result = await service.toggleFavorite('1');
    expect(result).toEqual(template);
    expect(mockTauri.invoke).toHaveBeenCalledWith('toggle_command_favorite', { id: '1' });
  });

  it('should duplicate a template', async () => {
    const duplicate = { id: 'dup-1', name: 'Test (Copy)' };
    mockTauri.invoke.mockResolvedValue(duplicate);

    const result = await service.duplicateTemplate('1');
    expect(result).toEqual(duplicate);
    expect(mockTauri.invoke).toHaveBeenCalledWith('duplicate_command_template', { id: '1' });
  });
});
