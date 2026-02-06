import { describe, it, expect } from 'vitest';
import { AI_PROVIDERS, AiProviderType, ProviderInfo } from './ai-settings.model';

describe('AI Settings Model', () => {
  describe('AI_PROVIDERS', () => {
    it('should contain all 8 providers', () => {
      expect(AI_PROVIDERS).toHaveLength(8);
    });

    it('should have unique IDs', () => {
      const ids = AI_PROVIDERS.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    const providerIds: AiProviderType[] = [
      'ollama', 'openai', 'anthropic', 'azure_openai',
      'groq', 'gemini', 'deepseek', 'mistral',
    ];

    it('should include all expected provider types', () => {
      const ids = AI_PROVIDERS.map((p) => p.id);
      for (const id of providerIds) {
        expect(ids).toContain(id);
      }
    });

    it('should have ollama as not requiring an API key', () => {
      const ollama = AI_PROVIDERS.find((p) => p.id === 'ollama')!;
      expect(ollama.requiresApiKey).toBe(false);
    });

    it('should have all non-ollama providers requiring an API key', () => {
      const nonOllama = AI_PROVIDERS.filter((p) => p.id !== 'ollama');
      for (const provider of nonOllama) {
        expect(provider.requiresApiKey).toBe(true);
      }
    });

    it('should have default models for all providers', () => {
      for (const provider of AI_PROVIDERS) {
        expect(provider.defaultModel).toBeTruthy();
        expect(provider.defaultSummaryModel).toBeTruthy();
      }
    });

    it('should have names for all providers', () => {
      for (const provider of AI_PROVIDERS) {
        expect(provider.name).toBeTruthy();
        expect(provider.description).toBeTruthy();
      }
    });

    it('should have proper default endpoints', () => {
      const ollama = AI_PROVIDERS.find((p) => p.id === 'ollama')!;
      expect(ollama.defaultEndpoint).toBe('http://localhost:11434');

      const openai = AI_PROVIDERS.find((p) => p.id === 'openai')!;
      expect(openai.defaultEndpoint).toBe('https://api.openai.com');

      const anthropic = AI_PROVIDERS.find((p) => p.id === 'anthropic')!;
      expect(anthropic.defaultEndpoint).toBe('https://api.anthropic.com');
    });
  });
});
