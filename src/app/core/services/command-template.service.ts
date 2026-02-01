import { Injectable } from '@angular/core';
import {
  CommandTemplate,
  CreateCommandTemplateRequest,
  UpdateCommandTemplateRequest,
} from '../models/command-template.model';
import { TauriService } from './tauri.service';

@Injectable({
  providedIn: 'root',
})
export class CommandTemplateService {
  constructor(private tauri: TauriService) {}

  /**
   * List all command templates
   */
  listTemplates(): Promise<CommandTemplate[]> {
    return this.tauri.invoke<CommandTemplate[]>('list_command_templates', {});
  }

  /**
   * Get a single command template by ID
   */
  getTemplate(id: string): Promise<CommandTemplate | null> {
    return this.tauri.invoke<CommandTemplate | null>('get_command_template', { id });
  }

  /**
   * Create a new command template
   */
  createTemplate(request: CreateCommandTemplateRequest): Promise<CommandTemplate> {
    return this.tauri.invoke<CommandTemplate>('create_command_template', { request });
  }

  /**
   * Update an existing command template
   */
  updateTemplate(request: UpdateCommandTemplateRequest): Promise<CommandTemplate> {
    return this.tauri.invoke<CommandTemplate>('update_command_template', { request });
  }

  /**
   * Delete a command template
   */
  deleteTemplate(id: string): Promise<boolean> {
    return this.tauri.invoke<boolean>('delete_command_template', { id });
  }

  /**
   * Toggle the favorite status of a command template
   */
  toggleFavorite(id: string): Promise<CommandTemplate> {
    return this.tauri.invoke<CommandTemplate>('toggle_command_favorite', { id });
  }

  /**
   * Duplicate a command template
   */
  duplicateTemplate(id: string): Promise<CommandTemplate> {
    return this.tauri.invoke<CommandTemplate>('duplicate_command_template', { id });
  }
}
