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
  });

  describe('loadAvailableModels', () => {
    it('should return models list', async () => {
      const models = [{ id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' }];
      mockTauri.invoke.mockResolvedValue(models);
      const result = await service.loadAvailableModels();
      expect(result).toEqual(models);
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
  });
});
