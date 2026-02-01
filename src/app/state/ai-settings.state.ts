import { Injectable, inject, computed } from '@angular/core';
import { AiService } from '../core/services/ai.service';
import { AI_PROVIDERS, ShellCommandResponse } from '../core/models/ai-settings.model';

@Injectable({
  providedIn: 'root',
})
export class AiSettingsState {
  private aiService = inject(AiService);

  // Delegate to service signals
  readonly settings = this.aiService.settings;
  readonly availableModels = this.aiService.availableModels;
  readonly isLoading = this.aiService.isLoading;
  readonly error = this.aiService.error;
  readonly isConnected = this.aiService.isConnected;
  readonly isConfigured = this.aiService.isConfigured;

  // Derived state
  readonly providerName = computed(() => {
    const provider = this.settings()?.provider;
    const info = AI_PROVIDERS.find((p) => p.id === provider);
    return info?.name ?? 'Not configured';
  });

  readonly providerDescription = computed(() => {
    const provider = this.settings()?.provider;
    const info = AI_PROVIDERS.find((p) => p.id === provider);
    return info?.description ?? '';
  });

  readonly requiresApiKey = computed(() => {
    const provider = this.settings()?.provider;
    const info = AI_PROVIDERS.find((p) => p.id === provider);
    return info?.requiresApiKey ?? false;
  });

  readonly hasApiKey = computed(() => {
    const settings = this.settings();
    return !!settings?.apiKey;
  });

  readonly statusMessage = computed(() => {
    if (!this.settings()) return 'Loading settings...';
    if (!this.isConfigured()) {
      if (this.requiresApiKey()) {
        return 'API key required';
      }
      return 'Not configured';
    }
    if (this.isConnected()) return 'Connected';
    return 'Ready';
  });

  /**
   * Load settings on init
   */
  async init(): Promise<void> {
    await this.aiService.loadSettings();
  }

  /**
   * Update settings
   */
  async updateSettings(
    provider: string,
    apiKey: string | undefined,
    modelName: string,
    endpointUrl: string,
    temperature: number,
    maxTokens: number,
    memoryEnabled: boolean = true,
    summaryModel?: string,
    summaryMaxTokens: number = 100
  ): Promise<void> {
    await this.aiService.updateSettings({
      provider: provider as 'ollama' | 'openai' | 'anthropic',
      apiKey,
      modelName,
      endpointUrl,
      temperature,
      maxTokens,
      memoryEnabled,
      summaryModel,
      summaryMaxTokens,
    });
  }

  /**
   * Test current connection
   */
  async testConnection(): Promise<boolean> {
    return this.aiService.testConnection();
  }

  /**
   * Test connection with specific settings
   */
  async testConnectionWithSettings(
    provider: string,
    apiKey?: string,
    endpointUrl?: string
  ): Promise<boolean> {
    return this.aiService.testConnectionWithSettings(
      provider as 'ollama' | 'openai' | 'anthropic',
      apiKey,
      endpointUrl
    );
  }

  /**
   * Load models for a provider
   */
  async loadModelsForProvider(
    provider: string,
    apiKey?: string,
    endpointUrl?: string
  ) {
    return this.aiService.loadModelsForProvider(
      provider as 'ollama' | 'openai' | 'anthropic',
      apiKey,
      endpointUrl
    );
  }

  /**
   * Get shell suggestion
   */
  async getSuggestion(query: string, context?: string): Promise<ShellCommandResponse> {
    return this.aiService.getSuggestion(query, context);
  }
}
