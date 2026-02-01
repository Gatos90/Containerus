import { Injectable, inject, signal, computed } from '@angular/core';
import { TauriService } from './tauri.service';
import {
  AiSettings,
  AiModel,
  AiProviderType,
  ShellSuggestionRequest,
  ShellCommandResponse,
  UpdateAiSettingsRequest,
  AI_PROVIDERS,
} from '../models/ai-settings.model';

@Injectable({
  providedIn: 'root',
})
export class AiService {
  private tauri = inject(TauriService);

  // State signals
  private _settings = signal<AiSettings | null>(null);
  private _availableModels = signal<AiModel[]>([]);
  private _isLoading = signal(false);
  private _error = signal<string | null>(null);
  private _isConnected = signal(false);

  // Public readonly signals
  readonly settings = this._settings.asReadonly();
  readonly availableModels = this._availableModels.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly isConnected = this._isConnected.asReadonly();

  // Computed signals
  readonly currentProvider = computed(() => this._settings()?.provider ?? 'ollama');
  readonly currentProviderInfo = computed(() => {
    const provider = this.currentProvider();
    return AI_PROVIDERS.find((p) => p.id === provider) ?? AI_PROVIDERS[0];
  });
  readonly isConfigured = computed(() => {
    const settings = this._settings();
    if (!settings) return false;
    if (settings.provider === 'ollama') return true;
    return !!settings.apiKey;
  });

  /**
   * Load AI settings from the database
   */
  async loadSettings(): Promise<AiSettings> {
    this._isLoading.set(true);
    this._error.set(null);

    try {
      const response = await this.tauri.invoke<{
        provider: string;
        api_key?: string;
        model_name: string;
        endpoint_url: string;
        temperature: number;
        max_tokens: number;
        memory_enabled: boolean;
        summary_model?: string;
        summary_max_tokens: number;
      }>('get_ai_settings_cmd');

      const settings: AiSettings = {
        provider: response.provider as AiProviderType,
        apiKey: response.api_key,
        modelName: response.model_name,
        endpointUrl: response.endpoint_url,
        temperature: response.temperature,
        maxTokens: response.max_tokens,
        memoryEnabled: response.memory_enabled ?? true,
        summaryModel: response.summary_model,
        summaryMaxTokens: response.summary_max_tokens ?? 100,
      };

      this._settings.set(settings);
      return settings;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._error.set(message);
      throw err;
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Update AI settings
   */
  async updateSettings(settings: AiSettings): Promise<void> {
    this._isLoading.set(true);
    this._error.set(null);

    try {
      const request: UpdateAiSettingsRequest = {
        provider: settings.provider,
        api_key: settings.apiKey,
        model_name: settings.modelName,
        endpoint_url: settings.endpointUrl,
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
        memory_enabled: settings.memoryEnabled,
        summary_model: settings.summaryModel,
        summary_max_tokens: settings.summaryMaxTokens,
      };

      await this.tauri.invoke<void>('update_ai_settings_cmd', { request });
      this._settings.set(settings);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._error.set(message);
      throw err;
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Test the current AI connection
   */
  async testConnection(): Promise<boolean> {
    this._isLoading.set(true);
    this._error.set(null);

    try {
      await this.tauri.invoke<void>('test_ai_connection');
      this._isConnected.set(true);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._error.set(message);
      this._isConnected.set(false);
      return false;
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Test connection with specific settings (for settings UI preview)
   */
  async testConnectionWithSettings(
    provider: AiProviderType,
    apiKey?: string,
    endpointUrl?: string
  ): Promise<boolean> {
    this._isLoading.set(true);
    this._error.set(null);

    try {
      await this.tauri.invoke<void>('test_ai_connection_with_settings', {
        providerType: provider,
        apiKey,
        endpointUrl,
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._error.set(message);
      return false;
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Load available models for the current provider
   */
  async loadAvailableModels(): Promise<AiModel[]> {
    this._isLoading.set(true);
    this._error.set(null);

    try {
      const models = await this.tauri.invoke<AiModel[]>('list_ai_models');
      this._availableModels.set(models);
      return models;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._error.set(message);
      throw err;
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Load available models for a specific provider (for settings UI)
   */
  async loadModelsForProvider(
    provider: AiProviderType,
    apiKey?: string,
    endpointUrl?: string
  ): Promise<AiModel[]> {
    try {
      const models = await this.tauri.invoke<AiModel[]>('list_models_for_provider', {
        providerType: provider,
        apiKey,
        endpointUrl,
      });
      return models;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._error.set(message);
      throw err;
    }
  }

  /**
   * Get a shell command suggestion from the AI
   * Returns a structured response with command, explanation, and metadata
   */
  async getSuggestion(query: string, context?: string): Promise<ShellCommandResponse> {
    this._error.set(null);

    try {
      const os = this.detectOS();
      const shell = this.detectShell();

      const request: ShellSuggestionRequest = {
        query,
        context,
        os,
        shell,
      };

      return await this.tauri.invoke<ShellCommandResponse>('get_shell_suggestion', { request });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._error.set(message);
      throw err;
    }
  }

  /**
   * Detect the current OS
   */
  private detectOS(): string {
    const platform = navigator.platform.toLowerCase();
    if (platform.includes('win')) return 'windows';
    if (platform.includes('mac')) return 'macos';
    return 'linux';
  }

  /**
   * Detect the current shell
   */
  private detectShell(): string {
    const os = this.detectOS();
    if (os === 'windows') return 'powershell';
    return 'bash';
  }

  /**
   * Format bytes to human readable string
   */
  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Pull/download a model from Ollama
   */
  async pullOllamaModel(modelName: string, endpointUrl?: string): Promise<string> {
    this._error.set(null);

    try {
      const result = await this.tauri.invoke<string>('pull_ollama_model', {
        modelName,
        endpointUrl,
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._error.set(message);
      throw err;
    }
  }

  /**
   * Delete a model from Ollama
   */
  async deleteOllamaModel(modelName: string, endpointUrl?: string): Promise<void> {
    this._error.set(null);

    try {
      await this.tauri.invoke<void>('delete_ollama_model', {
        modelName,
        endpointUrl,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._error.set(message);
      throw err;
    }
  }
}
