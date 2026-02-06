import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { AiSettingsState } from './ai-settings.state';
import { AiService } from '../core/services/ai.service';

describe('AiSettingsState', () => {
  let state: AiSettingsState;
  let mockAiService: any;

  beforeEach(() => {
    mockAiService = {
      settings: signal(null),
      availableModels: signal([]),
      isLoading: signal(false),
      error: signal(null),
      isConnected: signal(false),
      isConfigured: signal(false),
      loadSettings: vi.fn(),
      updateSettings: vi.fn(),
      testConnection: vi.fn(),
      testConnectionWithSettings: vi.fn(),
      loadModelsForProvider: vi.fn(),
      getSuggestion: vi.fn(),
    };

    const injector = Injector.create({
      providers: [
        { provide: AiService, useValue: mockAiService },
      ],
    });

    state = runInInjectionContext(injector, () => new AiSettingsState());
  });

  it('should delegate signals from AiService', () => {
    expect(state.settings()).toBeNull();
    expect(state.availableModels()).toEqual([]);
    expect(state.isLoading()).toBe(false);
    expect(state.error()).toBeNull();
    expect(state.isConnected()).toBe(false);
    expect(state.isConfigured()).toBe(false);
  });

  it('should compute provider name when not configured', () => {
    expect(state.providerName()).toBe('Not configured');
  });

  it('should compute provider name from settings', () => {
    mockAiService.settings.set({ provider: 'openai' });
    expect(state.providerName()).toBe('OpenAI');
  });

  it('should compute provider name for ollama', () => {
    mockAiService.settings.set({ provider: 'ollama' });
    expect(state.providerName()).toBe('Ollama');
  });

  it('should compute provider description', () => {
    mockAiService.settings.set({ provider: 'anthropic' });
    expect(state.providerDescription()).toBeTruthy();
  });

  it('should compute requiresApiKey', () => {
    // Ollama doesn't require API key
    mockAiService.settings.set({ provider: 'ollama' });
    expect(state.requiresApiKey()).toBe(false);

    // OpenAI requires API key
    mockAiService.settings.set({ provider: 'openai' });
    expect(state.requiresApiKey()).toBe(true);
  });

  it('should compute hasApiKey', () => {
    mockAiService.settings.set({ apiKey: 'sk-123' });
    expect(state.hasApiKey()).toBe(true);

    mockAiService.settings.set({ apiKey: '' });
    expect(state.hasApiKey()).toBe(false);
  });

  it('should compute status message - loading', () => {
    // settings is null
    expect(state.statusMessage()).toBe('Loading settings...');
  });

  it('should compute status message - not configured / needs API key', () => {
    mockAiService.settings.set({ provider: 'openai' });
    mockAiService.isConfigured.set(false);
    // OpenAI requires API key
    expect(state.statusMessage()).toBe('API key required');
  });

  it('should compute status message - not configured', () => {
    mockAiService.settings.set({ provider: 'ollama' });
    mockAiService.isConfigured.set(false);
    expect(state.statusMessage()).toBe('Not configured');
  });

  it('should compute status message - connected', () => {
    mockAiService.settings.set({ provider: 'ollama' });
    mockAiService.isConfigured.set(true);
    mockAiService.isConnected.set(true);
    expect(state.statusMessage()).toBe('Connected');
  });

  it('should compute status message - ready', () => {
    mockAiService.settings.set({ provider: 'ollama' });
    mockAiService.isConfigured.set(true);
    mockAiService.isConnected.set(false);
    expect(state.statusMessage()).toBe('Ready');
  });

  it('should init by loading settings', async () => {
    mockAiService.loadSettings.mockResolvedValue(undefined);

    await state.init();

    expect(mockAiService.loadSettings).toHaveBeenCalled();
  });

  it('should update settings', async () => {
    mockAiService.updateSettings.mockResolvedValue(undefined);

    await state.updateSettings('openai', 'sk-123', 'gpt-4', 'https://api.openai.com', 0.7, 1000);

    expect(mockAiService.updateSettings).toHaveBeenCalledWith({
      provider: 'openai',
      apiKey: 'sk-123',
      modelName: 'gpt-4',
      endpointUrl: 'https://api.openai.com',
      temperature: 0.7,
      maxTokens: 1000,
      memoryEnabled: true,
      summaryModel: undefined,
      summaryMaxTokens: 100,
      apiVersion: undefined,
    });
  });

  it('should test connection', async () => {
    mockAiService.testConnection.mockResolvedValue(true);

    const result = await state.testConnection();

    expect(result).toBe(true);
  });

  it('should test connection with settings', async () => {
    mockAiService.testConnectionWithSettings.mockResolvedValue(true);

    const result = await state.testConnectionWithSettings('openai', 'sk-123', 'https://api.openai.com');

    expect(result).toBe(true);
    expect(mockAiService.testConnectionWithSettings).toHaveBeenCalledWith('openai', 'sk-123', 'https://api.openai.com', undefined);
  });

  it('should load models for provider', async () => {
    const models = ['gpt-4', 'gpt-3.5-turbo'];
    mockAiService.loadModelsForProvider.mockResolvedValue(models);

    const result = await state.loadModelsForProvider('openai', 'sk-123');

    expect(result).toEqual(models);
  });

  it('should get suggestion', async () => {
    const response = {
      command: 'ls -la',
      explanation: 'Lists files',
      is_dangerous: false,
      requires_sudo: false,
      affects_files: [],
      alternatives: [],
    };
    mockAiService.getSuggestion.mockResolvedValue(response);

    const result = await state.getSuggestion('list files', 'context');

    expect(result).toEqual(response);
    expect(mockAiService.getSuggestion).toHaveBeenCalledWith('list files', 'context');
  });
});
