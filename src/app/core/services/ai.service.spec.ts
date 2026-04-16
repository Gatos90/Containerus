import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiService } from './ai.service';

// Mock Angular DI
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual('@angular/core');
  return {
    ...actual as any,
    inject: vi.fn((token: any) => {
      if (token.name === 'TauriService' || token === Object) {
        return mockTauri;
      }
      return undefined;
    }),
  };
});

let mockTauri: { invoke: ReturnType<typeof vi.fn> };

describe('AiService', () => {
  let service: AiService;

  beforeEach(() => {
    mockTauri = { invoke: vi.fn() };
    // Construct with manual injection since we're outside Angular DI
    service = new (AiService as any)();
    // Manually set the private tauri field
    (service as any).tauri = mockTauri;
  });

  describe('formatBytes', () => {
    it('should format zero bytes', () => {
      expect(service.formatBytes(0)).toBe('0 Bytes');
    });

    it('should format bytes', () => {
      expect(service.formatBytes(500)).toBe('500 Bytes');
    });

    it('should format kilobytes', () => {
      expect(service.formatBytes(1024)).toBe('1 KB');
    });

    it('should format megabytes', () => {
      expect(service.formatBytes(1024 * 1024)).toBe('1 MB');
    });

    it('should format gigabytes', () => {
      expect(service.formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
    });

    it('should format with decimal precision', () => {
      expect(service.formatBytes(1536)).toBe('1.5 KB');
    });
  });

  describe('loadSettings', () => {
    it('should load and transform settings from backend', async () => {
      mockTauri.invoke.mockResolvedValue({
        provider: 'openai',
        api_key: 'sk-test',
        model_name: 'gpt-4o',
        endpoint_url: 'https://api.openai.com',
        temperature: 0.7,
        max_tokens: 1024,
        memory_enabled: true,
        summary_model: 'gpt-4o-mini',
        summary_max_tokens: 100,
      });

      const result = await service.loadSettings();
      expect(result.provider).toBe('openai');
      expect(result.apiKey).toBe('sk-test');
      expect(result.modelName).toBe('gpt-4o');
      expect(result.endpointUrl).toBe('https://api.openai.com');
      expect(result.temperature).toBe(0.7);
      expect(result.maxTokens).toBe(1024);
      expect(result.memoryEnabled).toBe(true);
      expect(result.summaryModel).toBe('gpt-4o-mini');
    });

    it('should set error on failure', async () => {
      mockTauri.invoke.mockRejectedValue(new Error('DB error'));
      await expect(service.loadSettings()).rejects.toThrow('DB error');
    });
  });

  describe('updateSettings', () => {
    it('should transform and send settings to backend', async () => {
      mockTauri.invoke.mockResolvedValue(undefined);
      await service.updateSettings({
        provider: 'anthropic',
        apiKey: 'sk-ant-test',
        modelName: 'claude-3-5-sonnet',
        endpointUrl: 'https://api.anthropic.com',
        temperature: 0.3,
        maxTokens: 256,
        memoryEnabled: true,
        summaryMaxTokens: 100,
      });

      expect(mockTauri.invoke).toHaveBeenCalledWith('update_ai_settings_cmd', {
        request: expect.objectContaining({
          provider: 'anthropic',
          api_key: 'sk-ant-test',
          model_name: 'claude-3-5-sonnet',
        }),
      });
    });
  });

  describe('testConnection', () => {
    it('should return true on success', async () => {
      mockTauri.invoke.mockResolvedValue(undefined);
      const result = await service.testConnection();
      expect(result).toBe(true);
    });

    it('should return false on failure', async () => {
      mockTauri.invoke.mockRejectedValue(new Error('Connection failed'));
      const result = await service.testConnection();
      expect(result).toBe(false);
    });
  });

  describe('testConnectionWithSettings', () => {
    it('should pass settings correctly', async () => {
      mockTauri.invoke.mockResolvedValue(undefined);
      const result = await service.testConnectionWithSettings('openai', 'sk-test', 'https://api.openai.com');
      expect(result).toBe(true);
      expect(mockTauri.invoke).toHaveBeenCalledWith('test_ai_connection_with_settings', {
        providerType: 'openai',
        apiKey: 'sk-test',
        endpointUrl: 'https://api.openai.com',
        apiVersion: undefined,
      });
    });

    it('should return false and set error on failure', async () => {
      mockTauri.invoke.mockRejectedValue(new Error('Invalid API key'));
      const result = await service.testConnectionWithSettings('anthropic', 'bad-key');
      expect(result).toBe(false);
      expect(service.error()).toContain('Invalid API key');
    });

    it('should include apiVersion when provided', async () => {
      mockTauri.invoke.mockResolvedValue(undefined);
      await service.testConnectionWithSettings('azure', 'key', 'https://endpoint', '2024-01');
      expect(mockTauri.invoke).toHaveBeenCalledWith('test_ai_connection_with_settings', {
        providerType: 'azure',
        apiKey: 'key',
        endpointUrl: 'https://endpoint',
        apiVersion: '2024-01',
      });
    });
  });

  describe('loadAvailableModels', () => {
    it('should return models list', async () => {
      const models = [{ id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' }];
      mockTauri.invoke.mockResolvedValue(models);
      const result = await service.loadAvailableModels();
      expect(result).toEqual(models);
      expect(service.availableModels()).toEqual(models);
    });

    it('should throw and set error on failure', async () => {
      mockTauri.invoke.mockRejectedValue(new Error('models unavailable'));
      await expect(service.loadAvailableModels()).rejects.toThrow('models unavailable');
      expect(service.error()).toContain('models unavailable');
    });
  });

  describe('loadModelsForProvider', () => {
    it('should return models for provider', async () => {
      const models = [{ id: 'claude-3-5', name: 'Claude 3.5', provider: 'anthropic' }];
      mockTauri.invoke.mockResolvedValue(models);
      const result = await service.loadModelsForProvider('anthropic', 'sk-ant');
      expect(result).toEqual(models);
      expect(mockTauri.invoke).toHaveBeenCalledWith('list_models_for_provider', {
        providerType: 'anthropic',
        apiKey: 'sk-ant',
        endpointUrl: undefined,
        apiVersion: undefined,
      });
    });

    it('should throw and set error on failure', async () => {
      mockTauri.invoke.mockRejectedValue(new Error('provider error'));
      await expect(service.loadModelsForProvider('openai')).rejects.toThrow('provider error');
      expect(service.error()).toContain('provider error');
    });
  });

  describe('getSuggestion', () => {
    it('should send query with OS and shell context', async () => {
      mockTauri.invoke.mockResolvedValue({
        command: 'ls -la',
        explanation: 'List files',
        is_dangerous: false,
        requires_sudo: false,
        affects_files: [],
        alternatives: [],
      });

      const result = await service.getSuggestion('list files');
      expect(result.command).toBe('ls -la');
      expect(mockTauri.invoke).toHaveBeenCalledWith('get_shell_suggestion', {
        request: expect.objectContaining({
          query: 'list files',
        }),
      });
    });

    it('should include context when provided', async () => {
      mockTauri.invoke.mockResolvedValue({ command: 'grep -r foo .', explanation: '' });
      await service.getSuggestion('search for foo', '/some/dir');
      expect(mockTauri.invoke).toHaveBeenCalledWith('get_shell_suggestion', {
        request: expect.objectContaining({
          query: 'search for foo',
          context: '/some/dir',
        }),
      });
    });

    it('should throw and set error on failure', async () => {
      mockTauri.invoke.mockRejectedValue(new Error('AI unavailable'));
      await expect(service.getSuggestion('do something')).rejects.toThrow('AI unavailable');
      expect(service.error()).toContain('AI unavailable');
    });
  });

  describe('pullOllamaModel', () => {
    it('should pull model and return result', async () => {
      mockTauri.invoke.mockResolvedValue('Model pulled successfully');
      const result = await service.pullOllamaModel('llama3');
      expect(result).toBe('Model pulled successfully');
      expect(mockTauri.invoke).toHaveBeenCalledWith('pull_ollama_model', {
        modelName: 'llama3',
        endpointUrl: undefined,
      });
    });

    it('should include endpointUrl when provided', async () => {
      mockTauri.invoke.mockResolvedValue('ok');
      await service.pullOllamaModel('llama3', 'http://localhost:11434');
      expect(mockTauri.invoke).toHaveBeenCalledWith('pull_ollama_model', {
        modelName: 'llama3',
        endpointUrl: 'http://localhost:11434',
      });
    });

    it('should throw and set error on failure', async () => {
      mockTauri.invoke.mockRejectedValue(new Error('pull failed'));
      await expect(service.pullOllamaModel('bad-model')).rejects.toThrow('pull failed');
      expect(service.error()).toContain('pull failed');
    });
  });

  describe('deleteOllamaModel', () => {
    it('should delete model', async () => {
      mockTauri.invoke.mockResolvedValue(undefined);
      await service.deleteOllamaModel('llama3');
      expect(mockTauri.invoke).toHaveBeenCalledWith('delete_ollama_model', {
        modelName: 'llama3',
        endpointUrl: undefined,
      });
    });

    it('should include endpointUrl when provided', async () => {
      mockTauri.invoke.mockResolvedValue(undefined);
      await service.deleteOllamaModel('llama3', 'http://localhost:11434');
      expect(mockTauri.invoke).toHaveBeenCalledWith('delete_ollama_model', {
        modelName: 'llama3',
        endpointUrl: 'http://localhost:11434',
      });
    });

    it('should throw and set error on failure', async () => {
      mockTauri.invoke.mockRejectedValue(new Error('not found'));
      await expect(service.deleteOllamaModel('missing-model')).rejects.toThrow('not found');
      expect(service.error()).toContain('not found');
    });
  });
});
