import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  Settings,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  Bot,
  Key,
  Server,
  Thermometer,
  Hash,
  Info,
  Download,
  Trash2,
  Plus,
  Brain,
  MessageSquare,
} from 'lucide-angular';
import { AiService } from '../../../../core/services/ai.service';
import { AiSettingsState } from '../../../../state/ai-settings.state';
import {
  AI_PROVIDERS,
  AiModel,
  AiProviderType,
  ProviderInfo,
} from '../../../../core/models/ai-settings.model';

@Component({
  selector: 'app-settings-page',
  templateUrl: './settings-page.component.html',
  styleUrl: './settings-page.component.css',
  imports: [FormsModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPageComponent implements OnInit {
  private aiState = inject(AiSettingsState);
  private aiService = inject(AiService);

  // Icons
  readonly Settings = Settings;
  readonly CheckCircle2 = CheckCircle2;
  readonly XCircle = XCircle;
  readonly Loader2 = Loader2;
  readonly RefreshCw = RefreshCw;
  readonly Bot = Bot;
  readonly Key = Key;
  readonly Server = Server;
  readonly Thermometer = Thermometer;
  readonly Hash = Hash;
  readonly Info = Info;
  readonly Download = Download;
  readonly Trash2 = Trash2;
  readonly Plus = Plus;
  readonly Brain = Brain;
  readonly MessageSquare = MessageSquare;

  // Available providers
  readonly providers = AI_PROVIDERS;

  // Form state
  selectedProvider = signal<AiProviderType>('ollama');
  apiKey = signal<string>('');
  endpointUrl = signal<string>('http://localhost:11434');
  modelName = signal<string>('llama3.2');
  temperature = signal<number>(0.3);
  maxTokens = signal<number>(256);

  // Memory settings
  memoryEnabled = signal<boolean>(true);
  summaryModel = signal<string>('');
  summaryMaxTokens = signal<number>(100);

  // UI state
  availableModels = signal<AiModel[]>([]);
  isLoadingModels = signal(false);
  isTesting = signal(false);
  isSaving = signal(false);
  testResult = signal<'success' | 'error' | null>(null);
  testMessage = signal<string>('');
  saveMessage = signal<string>('');

  // Model management state (Ollama only)
  newModelName = signal<string>('');
  isPullingModel = signal(false);
  isDeletingModel = signal<string | null>(null);
  pullMessage = signal<string>('');

  // Custom model input (OpenAI-compatible)
  customModelName = signal<string>('');

  // Computed
  get currentProviderInfo(): ProviderInfo {
    return this.providers.find((p) => p.id === this.selectedProvider()) ?? this.providers[0];
  }

  // Get the currently selected model with all its info
  selectedModel = computed(() => {
    const modelId = this.modelName();
    return this.availableModels().find((m) => m.id === modelId);
  });

  // Dynamic max tokens limit based on selected model's context window
  maxTokensLimit = computed(() => {
    const model = this.selectedModel();
    if (model?.contextWindow) {
      return model.contextWindow;
    }
    return 1_000_000; // 1M default when undefined
  });

  ngOnInit(): void {
    this.loadSettings();
  }

  async loadSettings(): Promise<void> {
    try {
      await this.aiState.init();
      const settings = this.aiState.settings();
      if (settings) {
        this.selectedProvider.set(settings.provider);
        this.apiKey.set(settings.apiKey ?? '');

        // Use provider's default endpoint if stored endpoint is for a different provider
        const providerInfo = this.providers.find((p) => p.id === settings.provider);
        const isWrongEndpoint =
          providerInfo?.defaultEndpoint &&
          settings.endpointUrl !== providerInfo.defaultEndpoint &&
          this.isDefaultEndpoint(settings.endpointUrl);
        this.endpointUrl.set(isWrongEndpoint ? providerInfo!.defaultEndpoint! : settings.endpointUrl);

        this.modelName.set(settings.modelName);
        this.temperature.set(settings.temperature);
        this.maxTokens.set(settings.maxTokens);
        this.memoryEnabled.set(settings.memoryEnabled ?? true);
        this.summaryModel.set(settings.summaryModel ?? '');
        this.summaryMaxTokens.set(settings.summaryMaxTokens ?? 100);
      }
      await this.loadModels();
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  }

  private isDefaultEndpoint(url: string): boolean {
    return this.providers.some((p) => p.defaultEndpoint === url);
  }

  onProviderChange(providerId: string): void {
    this.selectedProvider.set(providerId as AiProviderType);
    const provider = this.providers.find((p) => p.id === providerId);
    if (provider) {
      if (provider.defaultEndpoint) {
        this.endpointUrl.set(provider.defaultEndpoint);
      }
      this.modelName.set(provider.defaultModel);
      this.summaryModel.set(''); // Reset to use default for new provider
      this.apiKey.set('');
      this.testResult.set(null);
      this.availableModels.set([]);
    }
  }

  async loadModels(): Promise<void> {
    this.isLoadingModels.set(true);
    try {
      // Only pass endpoint if it differs from provider default (let backend use its defaults)
      const providerDefault = this.currentProviderInfo.defaultEndpoint;
      const endpointToSend = this.endpointUrl() === providerDefault ? undefined : this.endpointUrl();

      const models = await this.aiState.loadModelsForProvider(
        this.selectedProvider(),
        this.apiKey() || undefined,
        endpointToSend
      );
      this.availableModels.set(models);

      // If current model is not in list, select first available
      if (models.length > 0 && !models.find((m) => m.id === this.modelName())) {
        this.onModelChange(models[0].id);
      }
    } catch (err) {
      console.error('Failed to load models:', err);
      this.availableModels.set([]);
    } finally {
      this.isLoadingModels.set(false);
    }
  }

  onModelChange(modelId: string): void {
    this.modelName.set(modelId);
    const model = this.availableModels().find((m) => m.id === modelId);
    if (model?.contextWindow) {
      // Clamp current maxTokens to not exceed context window
      if (this.maxTokens() > model.contextWindow) {
        this.maxTokens.set(model.contextWindow);
      }
      // Set max_tokens to a reasonable portion of context window
      // For shell commands, we don't need huge responses, so cap at 8K
      const suggestedMaxTokens = Math.min(
        Math.floor(model.contextWindow * 0.5), // 50% of context for response
        8192 // Cap at 8K for shell commands
      );
      this.maxTokens.set(Math.max(suggestedMaxTokens, 256)); // Minimum 256
    }
  }

  formatContextWindow(tokens: number): string {
    if (tokens >= 1_000_000) {
      return `${(tokens / 1_000_000).toFixed(1)}M`;
    } else if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(0)}K`;
    }
    return tokens.toString();
  }

  async testConnection(): Promise<void> {
    this.isTesting.set(true);
    this.testResult.set(null);
    this.testMessage.set('');

    try {
      // Only pass endpoint if it differs from provider default (let backend use its defaults)
      const providerDefault = this.currentProviderInfo.defaultEndpoint;
      const endpointToSend = this.endpointUrl() === providerDefault ? undefined : this.endpointUrl();

      const success = await this.aiState.testConnectionWithSettings(
        this.selectedProvider(),
        this.apiKey() || undefined,
        endpointToSend
      );

      if (success) {
        this.testResult.set('success');
        this.testMessage.set('Connection successful!');
        await this.loadModels();
      } else {
        this.testResult.set('error');
        this.testMessage.set('Connection failed. Please check your settings.');
      }
    } catch (err) {
      this.testResult.set('error');
      this.testMessage.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.isTesting.set(false);
    }
  }

  async saveSettings(): Promise<void> {
    this.isSaving.set(true);
    this.saveMessage.set('');

    try {
      await this.aiState.updateSettings(
        this.selectedProvider(),
        this.apiKey() || undefined,
        this.modelName(),
        this.endpointUrl(),
        this.temperature(),
        this.maxTokens(),
        this.memoryEnabled(),
        this.summaryModel() || undefined,
        this.summaryMaxTokens()
      );
      this.saveMessage.set('Settings saved successfully!');
      setTimeout(() => this.saveMessage.set(''), 3000);
    } catch (err) {
      this.saveMessage.set(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      this.isSaving.set(false);
    }
  }

  async pullModel(): Promise<void> {
    const modelName = this.newModelName().trim();
    if (!modelName) return;

    this.isPullingModel.set(true);
    this.pullMessage.set(`Pulling ${modelName}... This may take a few minutes.`);

    try {
      await this.aiService.pullOllamaModel(modelName, this.endpointUrl());
      this.pullMessage.set(`Successfully pulled ${modelName}!`);
      this.newModelName.set('');
      await this.loadModels();
      setTimeout(() => this.pullMessage.set(''), 5000);
    } catch (err) {
      this.pullMessage.set(err instanceof Error ? err.message : 'Failed to pull model');
    } finally {
      this.isPullingModel.set(false);
    }
  }

  async deleteModel(modelName: string): Promise<void> {
    if (!confirm(`Are you sure you want to delete "${modelName}"?`)) {
      return;
    }

    this.isDeletingModel.set(modelName);

    try {
      await this.aiService.deleteOllamaModel(modelName, this.endpointUrl());
      await this.loadModels();

      // If the deleted model was selected, select the first available
      if (this.modelName() === modelName) {
        const models = this.availableModels();
        if (models.length > 0) {
          this.onModelChange(models[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to delete model:', err);
    } finally {
      this.isDeletingModel.set(null);
    }
  }

  addCustomModel(): void {
    const modelId = this.customModelName().trim();
    if (!modelId) return;

    // Check if model already exists
    const existing = this.availableModels().find((m) => m.id === modelId);
    if (existing) {
      // Just select it
      this.modelName.set(modelId);
      this.customModelName.set('');
      return;
    }

    // Add custom model to list
    const customModel: AiModel = {
      id: modelId,
      name: modelId,
      provider: this.selectedProvider(),
    };
    this.availableModels.update((models) => [...models, customModel]);
    this.modelName.set(modelId);
    this.customModelName.set('');
  }
}
