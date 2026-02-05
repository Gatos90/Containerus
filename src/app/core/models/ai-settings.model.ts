/**
 * AI Provider type
 */
export type AiProviderType = 'ollama' | 'openai' | 'anthropic' | 'azure_openai' | 'groq' | 'gemini' | 'deepseek' | 'mistral';

/**
 * AI settings stored in the database
 */
export interface AiSettings {
  provider: AiProviderType;
  apiKey?: string;
  modelName: string;
  endpointUrl: string;
  temperature: number;
  maxTokens: number;
  /** Enable conversation memory via summarization */
  memoryEnabled: boolean;
  /** Model to use for summarizing exchanges (e.g., "claude-3-haiku", "gpt-4o-mini") */
  summaryModel?: string;
  /** Max tokens for each summary (default: 100) */
  summaryMaxTokens: number;
  /** API version for Azure OpenAI (e.g., "2024-10-21") */
  apiVersion?: string;
}

/**
 * AI model information
 */
export interface AiModel {
  id: string;
  name: string;
  provider: AiProviderType;
  contextWindow?: number;
  parameterSize?: string;
  quantizationLevel?: string;
}

/**
 * Request for shell suggestion
 */
export interface ShellSuggestionRequest {
  query: string;
  context?: string;
  os?: string;
  shell?: string;
}

/**
 * Structured shell command response from AI
 */
export interface ShellCommandResponse {
  command: string;
  explanation: string;
  is_dangerous: boolean;
  requires_sudo: boolean;
  affects_files: string[];
  alternatives: CommandAlternative[];
  warning?: string;
}

/**
 * Alternative command suggestion
 */
export interface CommandAlternative {
  command: string;
  description: string;
}

/**
 * Request to update AI settings
 */
export interface UpdateAiSettingsRequest {
  provider: string;
  api_key?: string;
  model_name: string;
  endpoint_url: string;
  temperature: number;
  max_tokens: number;
  memory_enabled: boolean;
  summary_model?: string;
  summary_max_tokens: number;
  api_version?: string;
}

/**
 * Provider display information
 */
export interface ProviderInfo {
  id: AiProviderType;
  name: string;
  description: string;
  requiresApiKey: boolean;
  defaultEndpoint?: string;
  defaultModel: string;
  /** Default model for summarization (smaller/cheaper) */
  defaultSummaryModel: string;
}

/**
 * Available AI providers configuration
 */
export const AI_PROVIDERS: ProviderInfo[] = [
  {
    id: 'ollama',
    name: 'Ollama',
    description: 'Local AI models running on your machine',
    requiresApiKey: false,
    defaultEndpoint: 'http://localhost:11434',
    defaultModel: 'llama3.2',
    defaultSummaryModel: 'llama3.2:1b',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT models from OpenAI',
    requiresApiKey: true,
    defaultEndpoint: 'https://api.openai.com',
    defaultModel: 'gpt-4o-mini',
    defaultSummaryModel: 'gpt-4o-mini',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude models from Anthropic',
    requiresApiKey: true,
    defaultEndpoint: 'https://api.anthropic.com',
    defaultModel: 'claude-3-5-haiku-20241022',
    defaultSummaryModel: 'claude-3-haiku-20240307',
  },
  {
    id: 'azure_openai',
    name: 'Azure OpenAI',
    description: 'OpenAI models via Azure deployments',
    requiresApiKey: true,
    defaultEndpoint: '',
    defaultModel: 'gpt-4o',
    defaultSummaryModel: 'gpt-4o-mini',
  },
  {
    id: 'groq',
    name: 'Groq',
    description: 'Ultra-fast inference with open models',
    requiresApiKey: true,
    defaultEndpoint: 'https://api.groq.com/openai',
    defaultModel: 'llama-3.3-70b-versatile',
    defaultSummaryModel: 'llama-3.1-8b-instant',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    description: 'Gemini models from Google',
    requiresApiKey: true,
    defaultEndpoint: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-2.0-flash',
    defaultSummaryModel: 'gemini-2.0-flash-lite',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek Chat and Reasoner models',
    requiresApiKey: true,
    defaultEndpoint: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    defaultSummaryModel: 'deepseek-chat',
  },
  {
    id: 'mistral',
    name: 'Mistral',
    description: 'Mistral and Codestral models',
    requiresApiKey: true,
    defaultEndpoint: 'https://api.mistral.ai',
    defaultModel: 'mistral-large-latest',
    defaultSummaryModel: 'mistral-small-latest',
  },
];
