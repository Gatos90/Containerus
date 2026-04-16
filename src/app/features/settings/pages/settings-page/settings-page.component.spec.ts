import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { SettingsPageComponent } from './settings-page.component';
import { AiSettingsState } from '../../../../state/ai-settings.state';
import { AiService } from '../../../../core/services/ai.service';
import { SystemService } from '../../../../core/services/system.service';
import { UpdateState } from '../../../../state/update.state';
import { ChangelogState } from '../../../../state/changelog.state';
import { AiSettings } from '../../../../core/models/ai-settings.model';

// ---------------------------------------------------------------------------
// Module-level mocks for Tauri and Dialog plugins
// ---------------------------------------------------------------------------

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}));

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn().mockResolvedValue('1.2.3'),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDefaultSettings(overrides: Partial<AiSettings> = {}): AiSettings {
  return {
    provider: 'ollama',
    apiKey: '',
    modelName: 'llama3.2',
    endpointUrl: 'http://localhost:11434',
    temperature: 0.3,
    maxTokens: 256,
    memoryEnabled: true,
    summaryModel: '',
    summaryMaxTokens: 100,
    apiVersion: '',
    ...overrides,
  };
}

function makeComponent() {
  const settingsSignal = signal<AiSettings | null>(null);

  const mockAiState: Partial<AiSettingsState> = {
    settings: settingsSignal,
    init: vi.fn().mockResolvedValue(undefined),
    loadModelsForProvider: vi.fn().mockResolvedValue([]),
    testConnectionWithSettings: vi.fn().mockResolvedValue(true),
    updateSettings: vi.fn().mockResolvedValue(undefined),
  };

  const mockAiService: any = {
    loadSettings: vi.fn().mockResolvedValue(makeDefaultSettings()),
    pullOllamaModel: vi.fn().mockResolvedValue(undefined),
    deleteOllamaModel: vi.fn().mockResolvedValue(undefined),
  };

  const mockSystemService: any = {
    getAppSettings: vi.fn().mockResolvedValue({ sshConfigPaths: [] }),
    updateAppSettings: vi.fn().mockResolvedValue(undefined),
  };

  const mockUpdateState: any = {
    updateAvailable: signal(false),
    updateVersion: signal(''),
    downloading: signal(false),
  };

  const mockChangelogState: any = {
    showModal: signal(false),
    entries: signal([]),
  };

  const injector = Injector.create({
    providers: [
      { provide: AiSettingsState, useValue: mockAiState },
      { provide: AiService, useValue: mockAiService },
      { provide: SystemService, useValue: mockSystemService },
      { provide: UpdateState, useValue: mockUpdateState },
      { provide: ChangelogState, useValue: mockChangelogState },
    ],
  });

  const component = runInInjectionContext(injector, () => new SettingsPageComponent());

  return { component, mockAiState, mockAiService, mockSystemService, settingsSignal };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SettingsPageComponent', () => {
  let timers: ReturnType<typeof vi.useFakeTimers>;

  beforeEach(() => {
    timers = vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Instantiation
  // -------------------------------------------------------------------------

  describe('instantiation', () => {
    it('should create the component', () => {
      const { component } = makeComponent();
      expect(component).toBeTruthy();
    });

    it('should default to the "ai" tab', () => {
      const { component } = makeComponent();
      expect(component.activeTab()).toBe('ai');
    });

    it('should default provider to "ollama"', () => {
      const { component } = makeComponent();
      expect(component.selectedProvider()).toBe('ollama');
    });

    it('should initialise with empty SSH config paths', () => {
      const { component } = makeComponent();
      expect(component.sshConfigPaths()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // loadSettings
  // -------------------------------------------------------------------------

  describe('loadSettings', () => {
    it('should call aiState.init on load', async () => {
      const { component, mockAiState, settingsSignal } = makeComponent();
      settingsSignal.set(makeDefaultSettings());
      await component.loadSettings();
      expect(mockAiState.init).toHaveBeenCalled();
    });

    it('should populate form signals from settings', async () => {
      const { component, settingsSignal } = makeComponent();
      settingsSignal.set(
        makeDefaultSettings({
          provider: 'openai',
          apiKey: 'sk-test',
          modelName: 'gpt-4o-mini',
          endpointUrl: 'https://api.openai.com',
          temperature: 0.7,
          maxTokens: 1024,
          memoryEnabled: false,
          summaryModel: 'gpt-4o-mini',
          summaryMaxTokens: 200,
          apiVersion: '2024-10-21',
        })
      );
      await component.loadSettings();
      expect(component.selectedProvider()).toBe('openai');
      expect(component.apiKey()).toBe('sk-test');
      expect(component.modelName()).toBe('gpt-4o-mini');
      expect(component.temperature()).toBe(0.7);
      expect(component.maxTokens()).toBe(1024);
      expect(component.memoryEnabled()).toBe(false);
      expect(component.summaryModel()).toBe('gpt-4o-mini');
      expect(component.summaryMaxTokens()).toBe(200);
      expect(component.apiVersion()).toBe('2024-10-21');
    });

    it('should call loadModels after populating settings', async () => {
      const { component, mockAiState, settingsSignal } = makeComponent();
      settingsSignal.set(makeDefaultSettings());
      await component.loadSettings();
      expect(mockAiState.loadModelsForProvider).toHaveBeenCalled();
    });

    it('should not throw when settings are null', async () => {
      const { component, settingsSignal } = makeComponent();
      settingsSignal.set(null);
      await expect(component.loadSettings()).resolves.not.toThrow();
    });

    it('should handle errors from aiState.init gracefully', async () => {
      const { component, mockAiState } = makeComponent();
      (mockAiState.init as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('DB error'));
      await expect(component.loadSettings()).resolves.not.toThrow();
    });

    it('should restore correct endpoint when saved endpoint matches provider default', async () => {
      const { component, settingsSignal } = makeComponent();
      settingsSignal.set(makeDefaultSettings({ provider: 'ollama', endpointUrl: 'http://localhost:11434' }));
      await component.loadSettings();
      expect(component.endpointUrl()).toBe('http://localhost:11434');
    });
  });

  // -------------------------------------------------------------------------
  // onProviderChange
  // -------------------------------------------------------------------------

  describe('onProviderChange', () => {
    it('should set the selected provider', async () => {
      const { component } = makeComponent();
      await component.onProviderChange('openai');
      expect(component.selectedProvider()).toBe('openai');
    });

    it('should restore saved values when switching back to saved provider', async () => {
      const { component, mockAiService } = makeComponent();
      mockAiService.loadSettings.mockResolvedValueOnce(
        makeDefaultSettings({ provider: 'openai', apiKey: 'sk-saved', modelName: 'gpt-4o' })
      );
      await component.onProviderChange('openai');
      expect(component.apiKey()).toBe('sk-saved');
      expect(component.modelName()).toBe('gpt-4o');
    });

    it('should apply provider defaults when switching to a different provider', async () => {
      const { component, mockAiService } = makeComponent();
      // saved settings are for ollama; switch to anthropic
      mockAiService.loadSettings.mockResolvedValueOnce(
        makeDefaultSettings({ provider: 'ollama' })
      );
      await component.onProviderChange('anthropic');
      expect(component.endpointUrl()).toBe('https://api.anthropic.com');
      expect(component.apiKey()).toBe('');
    });

    it('should reset testResult on provider change', async () => {
      const { component } = makeComponent();
      component['testResult'].set('success');
      await component.onProviderChange('openai');
      expect(component['testResult']()).toBeNull();
    });

    it('should reload models on provider change', async () => {
      const { component, mockAiState } = makeComponent();
      await component.onProviderChange('openai');
      expect(mockAiState.loadModelsForProvider).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // loadModels
  // -------------------------------------------------------------------------

  describe('loadModels', () => {
    it('should set isLoadingModels while fetching', async () => {
      const { component, mockAiState } = makeComponent();
      let resolveFn!: (v: any) => void;
      (mockAiState.loadModelsForProvider as ReturnType<typeof vi.fn>).mockReturnValueOnce(
        new Promise((r) => (resolveFn = r))
      );
      const loadPromise = component.loadModels();
      expect(component.isLoadingModels()).toBe(true);
      resolveFn([]);
      await loadPromise;
      expect(component.isLoadingModels()).toBe(false);
    });

    it('should populate availableModels with returned list', async () => {
      const { component, mockAiState } = makeComponent();
      const models = [
        { id: 'llama3.2', name: 'Llama 3.2', provider: 'ollama' as const },
        { id: 'mistral', name: 'Mistral', provider: 'ollama' as const },
      ];
      (mockAiState.loadModelsForProvider as ReturnType<typeof vi.fn>).mockResolvedValueOnce(models);
      await component.loadModels();
      expect(component.availableModels()).toEqual(models);
    });

    it('should auto-select first model when current model not in list', async () => {
      const { component, mockAiState } = makeComponent();
      component['modelName'].set('old-model');
      const models = [{ id: 'llama3.2', name: 'Llama 3.2', provider: 'ollama' as const }];
      (mockAiState.loadModelsForProvider as ReturnType<typeof vi.fn>).mockResolvedValueOnce(models);
      await component.loadModels();
      expect(component.modelName()).toBe('llama3.2');
    });

    it('should set availableModels to empty array on error', async () => {
      const { component, mockAiState } = makeComponent();
      (mockAiState.loadModelsForProvider as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('timeout'));
      component['availableModels'].set([{ id: 'old', name: 'Old', provider: 'ollama' }]);
      await component.loadModels();
      expect(component.availableModels()).toEqual([]);
    });

    it('should always set isLoadingModels to false after error', async () => {
      const { component, mockAiState } = makeComponent();
      (mockAiState.loadModelsForProvider as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('err'));
      await component.loadModels();
      expect(component.isLoadingModels()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // formatContextWindow
  // -------------------------------------------------------------------------

  describe('formatContextWindow', () => {
    it('should format millions correctly', () => {
      const { component } = makeComponent();
      expect(component.formatContextWindow(1_000_000)).toBe('1.0M');
      expect(component.formatContextWindow(2_500_000)).toBe('2.5M');
    });

    it('should format thousands correctly', () => {
      const { component } = makeComponent();
      expect(component.formatContextWindow(128_000)).toBe('128K');
      expect(component.formatContextWindow(8_000)).toBe('8K');
    });

    it('should return raw number for small values', () => {
      const { component } = makeComponent();
      expect(component.formatContextWindow(512)).toBe('512');
      expect(component.formatContextWindow(999)).toBe('999');
    });
  });

  // -------------------------------------------------------------------------
  // testConnection
  // -------------------------------------------------------------------------

  describe('testConnection', () => {
    it('should set isTesting true while testing then false after', async () => {
      const { component, mockAiState } = makeComponent();
      let resolveFn!: (v: boolean) => void;
      (mockAiState.testConnectionWithSettings as ReturnType<typeof vi.fn>).mockReturnValueOnce(
        new Promise((r) => (resolveFn = r))
      );
      const testPromise = component.testConnection();
      expect(component.isTesting()).toBe(true);
      resolveFn(true);
      await testPromise;
      expect(component.isTesting()).toBe(false);
    });

    it('should set testResult to "success" on success', async () => {
      const { component, mockAiState } = makeComponent();
      (mockAiState.testConnectionWithSettings as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      await component.testConnection();
      expect(component['testResult']()).toBe('success');
      expect(component['testMessage']()).toBe('Connection successful!');
    });

    it('should set testResult to "error" on failure', async () => {
      const { component, mockAiState } = makeComponent();
      (mockAiState.testConnectionWithSettings as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
      await component.testConnection();
      expect(component['testResult']()).toBe('error');
      expect(component['testMessage']()).toContain('failed');
    });

    it('should set testResult to "error" on exception', async () => {
      const { component, mockAiState } = makeComponent();
      (mockAiState.testConnectionWithSettings as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));
      await component.testConnection();
      expect(component['testResult']()).toBe('error');
      expect(component['testMessage']()).toBe('Network error');
    });

    it('should reload models after a successful test', async () => {
      const { component, mockAiState } = makeComponent();
      (mockAiState.testConnectionWithSettings as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      await component.testConnection();
      // loadModels internally calls loadModelsForProvider — it will have been
      // called at minimum twice (once for the success path loadModels call)
      expect(mockAiState.loadModelsForProvider).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // saveSettings
  // -------------------------------------------------------------------------

  describe('saveSettings', () => {
    it('should call aiState.updateSettings with current form values', async () => {
      const { component, mockAiState } = makeComponent();
      component['selectedProvider'].set('openai');
      component['apiKey'].set('sk-key');
      component['modelName'].set('gpt-4o');
      component['endpointUrl'].set('https://api.openai.com');
      component['temperature'].set(0.5);
      component['maxTokens'].set(512);
      component['memoryEnabled'].set(true);
      component['summaryModel'].set('gpt-4o-mini');
      component['summaryMaxTokens'].set(150);
      component['apiVersion'].set('');

      await component.saveSettings();

      expect(mockAiState.updateSettings).toHaveBeenCalledWith(
        'openai',
        'sk-key',
        'gpt-4o',
        'https://api.openai.com',
        0.5,
        512,
        true,
        'gpt-4o-mini',
        150,
        undefined
      );
    });

    it('should set isSaving while saving then clear it', async () => {
      const { component, mockAiState } = makeComponent();
      let resolveFn!: () => void;
      (mockAiState.updateSettings as ReturnType<typeof vi.fn>).mockReturnValueOnce(
        new Promise<void>((r) => (resolveFn = r))
      );
      const savePromise = component.saveSettings();
      expect(component.isSaving()).toBe(true);
      resolveFn();
      await savePromise;
      expect(component.isSaving()).toBe(false);
    });

    it('should set saveMessage on success and clear after timeout', async () => {
      const { component } = makeComponent();
      await component.saveSettings();
      expect(component['saveMessage']()).toBe('Settings saved successfully!');
      timers.runAllTimers();
      expect(component['saveMessage']()).toBe('');
    });

    it('should set error saveMessage on failure', async () => {
      const { component, mockAiState } = makeComponent();
      (mockAiState.updateSettings as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Save failed'));
      await component.saveSettings();
      expect(component['saveMessage']()).toBe('Save failed');
    });

    it('should update savedAi snapshot after a successful save', async () => {
      const { component } = makeComponent();
      component['selectedProvider'].set('anthropic');
      await component.saveSettings();
      expect(component['savedAi']()?.provider).toBe('anthropic');
    });
  });

  // -------------------------------------------------------------------------
  // pullModel
  // -------------------------------------------------------------------------

  describe('pullModel', () => {
    it('should do nothing when newModelName is empty', async () => {
      const { component, mockAiService } = makeComponent();
      component['newModelName'].set('');
      await component.pullModel();
      expect(mockAiService.pullOllamaModel).not.toHaveBeenCalled();
    });

    it('should call aiService.pullOllamaModel with trimmed name', async () => {
      const { component, mockAiService } = makeComponent();
      component['newModelName'].set('  mistral  ');
      await component.pullModel();
      expect(mockAiService.pullOllamaModel).toHaveBeenCalledWith('mistral', expect.any(String));
    });

    it('should set pullMessage during pull', async () => {
      const { component, mockAiService } = makeComponent();
      component['newModelName'].set('mistral');
      let resolveFn!: () => void;
      mockAiService.pullOllamaModel.mockReturnValueOnce(
        new Promise<void>((r) => (resolveFn = r))
      );
      const pullPromise = component.pullModel();
      expect(component['pullMessage']()).toContain('mistral');
      resolveFn();
      await pullPromise;
    });

    it('should clear newModelName after a successful pull', async () => {
      const { component, mockAiService } = makeComponent();
      component['newModelName'].set('mistral');
      mockAiService.pullOllamaModel.mockResolvedValueOnce(undefined);
      await component.pullModel();
      expect(component['newModelName']()).toBe('');
    });

    it('should set error pullMessage on failure', async () => {
      const { component, mockAiService } = makeComponent();
      component['newModelName'].set('bad-model');
      mockAiService.pullOllamaModel.mockRejectedValueOnce(new Error('Not found'));
      await component.pullModel();
      expect(component['pullMessage']()).toBe('Not found');
    });

    it('should always reset isPullingModel when done', async () => {
      const { component, mockAiService } = makeComponent();
      component['newModelName'].set('mistral');
      mockAiService.pullOllamaModel.mockRejectedValueOnce(new Error('err'));
      await component.pullModel();
      expect(component['isPullingModel']()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // deleteModel
  // -------------------------------------------------------------------------

  describe('deleteModel', () => {
    beforeEach(() => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
    });

    it('should call aiService.deleteOllamaModel when confirmed', async () => {
      const { component, mockAiService } = makeComponent();
      await component.deleteModel('llama3.2');
      expect(mockAiService.deleteOllamaModel).toHaveBeenCalledWith('llama3.2', expect.any(String));
    });

    it('should not delete when user cancels confirm', async () => {
      const { component, mockAiService } = makeComponent();
      vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
      await component.deleteModel('llama3.2');
      expect(mockAiService.deleteOllamaModel).not.toHaveBeenCalled();
    });

    it('should auto-select first available model when deleted model was selected', async () => {
      const { component, mockAiService, mockAiState } = makeComponent();
      component['modelName'].set('llama3.2');
      const remaining = [{ id: 'mistral', name: 'Mistral', provider: 'ollama' as const }];
      (mockAiState.loadModelsForProvider as ReturnType<typeof vi.fn>).mockResolvedValueOnce(remaining);
      await component.deleteModel('llama3.2');
      expect(component.modelName()).toBe('mistral');
    });

    it('should clear isDeletingModel after successful delete', async () => {
      const { component } = makeComponent();
      await component.deleteModel('llama3.2');
      expect(component['isDeletingModel']()).toBeNull();
    });

    it('should clear isDeletingModel even after an error', async () => {
      const { component, mockAiService } = makeComponent();
      mockAiService.deleteOllamaModel.mockRejectedValueOnce(new Error('delete failed'));
      await component.deleteModel('llama3.2');
      expect(component['isDeletingModel']()).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // addCustomModel
  // -------------------------------------------------------------------------

  describe('addCustomModel', () => {
    it('should do nothing when customModelName is empty', () => {
      const { component } = makeComponent();
      component['customModelName'].set('');
      const before = component.availableModels().length;
      component.addCustomModel();
      expect(component.availableModels().length).toBe(before);
    });

    it('should add a new model to availableModels', () => {
      const { component } = makeComponent();
      component['customModelName'].set('my-custom-model');
      component['availableModels'].set([]);
      component.addCustomModel();
      const found = component.availableModels().find((m) => m.id === 'my-custom-model');
      expect(found).toBeDefined();
      expect(found?.name).toBe('my-custom-model');
    });

    it('should set modelName to the new model id', () => {
      const { component } = makeComponent();
      component['customModelName'].set('my-custom-model');
      component.addCustomModel();
      expect(component.modelName()).toBe('my-custom-model');
    });

    it('should clear customModelName after adding', () => {
      const { component } = makeComponent();
      component['customModelName'].set('my-custom-model');
      component.addCustomModel();
      expect(component['customModelName']()).toBe('');
    });

    it('should just select existing model without duplicating if already in list', () => {
      const { component } = makeComponent();
      component['availableModels'].set([{ id: 'existing', name: 'Existing', provider: 'ollama' }]);
      component['customModelName'].set('existing');
      component.addCustomModel();
      expect(component.availableModels().filter((m) => m.id === 'existing').length).toBe(1);
      expect(component.modelName()).toBe('existing');
    });
  });

  // -------------------------------------------------------------------------
  // SSH Settings
  // -------------------------------------------------------------------------

  describe('loadSshSettings', () => {
    it('should populate sshConfigPaths from settings', async () => {
      const { component, mockSystemService } = makeComponent();
      mockSystemService.getAppSettings.mockResolvedValueOnce({
        sshConfigPaths: ['/home/user/.ssh/config', '/etc/ssh/ssh_config'],
      });
      await component.loadSshSettings();
      expect(component.sshConfigPaths()).toEqual(['/home/user/.ssh/config', '/etc/ssh/ssh_config']);
    });

    it('should default to empty array when sshConfigPaths is missing', async () => {
      const { component, mockSystemService } = makeComponent();
      mockSystemService.getAppSettings.mockResolvedValueOnce({});
      await component.loadSshSettings();
      expect(component.sshConfigPaths()).toEqual([]);
    });

    it('should not throw on getAppSettings error', async () => {
      const { component, mockSystemService } = makeComponent();
      mockSystemService.getAppSettings.mockRejectedValueOnce(new Error('not found'));
      await expect(component.loadSshSettings()).resolves.not.toThrow();
    });
  });

  describe('saveSshSettings', () => {
    it('should call systemService.updateAppSettings with non-empty paths', async () => {
      const { component, mockSystemService } = makeComponent();
      component['sshConfigPaths'].set(['/valid/path', '  ', '/another/path']);
      await component.saveSshSettings();
      expect(mockSystemService.updateAppSettings).toHaveBeenCalledWith({
        sshConfigPaths: ['/valid/path', '/another/path'],
      });
    });

    it('should set sshSaveMessage on success', async () => {
      const { component } = makeComponent();
      await component.saveSshSettings();
      expect(component['sshSaveMessage']()).toBe('SSH settings saved!');
      timers.runAllTimers();
      expect(component['sshSaveMessage']()).toBe('');
    });

    it('should set error sshSaveMessage on failure', async () => {
      const { component, mockSystemService } = makeComponent();
      mockSystemService.updateAppSettings.mockRejectedValueOnce(new Error('Permission denied'));
      await component.saveSshSettings();
      expect(component['sshSaveMessage']()).toBe('Permission denied');
    });

    it('should always clear isSavingSsh after save', async () => {
      const { component, mockSystemService } = makeComponent();
      mockSystemService.updateAppSettings.mockRejectedValueOnce(new Error('err'));
      await component.saveSshSettings();
      expect(component.isSavingSsh()).toBe(false);
    });
  });

  describe('addSshConfigPath', () => {
    it('should append an empty string to sshConfigPaths', () => {
      const { component } = makeComponent();
      component['sshConfigPaths'].set(['/existing/path']);
      component.addSshConfigPath();
      expect(component.sshConfigPaths()).toEqual(['/existing/path', '']);
    });
  });

  describe('removeSshConfigPath', () => {
    it('should remove the path at the given index', () => {
      const { component } = makeComponent();
      component['sshConfigPaths'].set(['/a', '/b', '/c']);
      component.removeSshConfigPath(1);
      expect(component.sshConfigPaths()).toEqual(['/a', '/c']);
    });

    it('should remove the first path correctly', () => {
      const { component } = makeComponent();
      component['sshConfigPaths'].set(['/a', '/b']);
      component.removeSshConfigPath(0);
      expect(component.sshConfigPaths()).toEqual(['/b']);
    });
  });

  describe('updateSshConfigPath', () => {
    it('should update the path at the given index', () => {
      const { component } = makeComponent();
      component['sshConfigPaths'].set(['/old', '/other']);
      component.updateSshConfigPath(0, '/new/path');
      expect(component.sshConfigPaths()[0]).toBe('/new/path');
      expect(component.sshConfigPaths()[1]).toBe('/other');
    });

    it('should not mutate other indices', () => {
      const { component } = makeComponent();
      component['sshConfigPaths'].set(['/a', '/b', '/c']);
      component.updateSshConfigPath(2, '/z');
      expect(component.sshConfigPaths()).toEqual(['/a', '/b', '/z']);
    });
  });

  // -------------------------------------------------------------------------
  // isDefaultEndpoint (private, tested via loadSettings behaviour)
  // -------------------------------------------------------------------------

  describe('isDefaultEndpoint (private via loadSettings)', () => {
    it('should use provider default endpoint when stored endpoint matches a different provider', async () => {
      // Simulate settings saved for ollama but now switching to openai default endpoint mismatch
      const { component, settingsSignal } = makeComponent();
      // Store an ollama endpoint but claim we're using openai provider
      settingsSignal.set(
        makeDefaultSettings({
          provider: 'openai',
          endpointUrl: 'http://localhost:11434', // this is ollama's default
        })
      );
      await component.loadSettings();
      // Should replace with openai's default endpoint
      expect(component.endpointUrl()).toBe('https://api.openai.com');
    });
  });

  // -------------------------------------------------------------------------
  // currentProviderInfo getter
  // -------------------------------------------------------------------------

  describe('currentProviderInfo', () => {
    it('should return provider info matching selectedProvider', () => {
      const { component } = makeComponent();
      component['selectedProvider'].set('anthropic');
      expect(component.currentProviderInfo.id).toBe('anthropic');
      expect(component.currentProviderInfo.name).toBe('Anthropic');
    });

    it('should fall back to first provider when id is unknown', () => {
      const { component } = makeComponent();
      (component['selectedProvider'] as any).set('unknown' as any);
      expect(component.currentProviderInfo).toBe(component.providers[0]);
    });
  });

  // -------------------------------------------------------------------------
  // Dirty detection
  // -------------------------------------------------------------------------

  describe('dirty detection', () => {
    it('isAiDirty should be false when snapshot matches current state', async () => {
      const { component, settingsSignal } = makeComponent();
      settingsSignal.set(makeDefaultSettings());
      await component.loadSettings();
      expect(component.isAiDirty()).toBe(false);
    });

    it('isAiDirty should be true after changing provider', async () => {
      const { component, settingsSignal } = makeComponent();
      settingsSignal.set(makeDefaultSettings());
      await component.loadSettings();
      component['selectedProvider'].set('openai');
      expect(component.isAiDirty()).toBe(true);
    });

    it('isSshDirty should be false after loadSshSettings', async () => {
      const { component, mockSystemService } = makeComponent();
      mockSystemService.getAppSettings.mockResolvedValueOnce({ sshConfigPaths: ['/a'] });
      await component.loadSshSettings();
      expect(component.isSshDirty()).toBe(false);
    });

    it('isSshDirty should be true after addSshConfigPath', async () => {
      const { component, mockSystemService } = makeComponent();
      mockSystemService.getAppSettings.mockResolvedValueOnce({ sshConfigPaths: [] });
      await component.loadSshSettings();
      component.addSshConfigPath();
      expect(component.isSshDirty()).toBe(true);
    });

    it('hasUnsavedChanges should combine ai and ssh dirty flags', async () => {
      const { component, settingsSignal, mockSystemService } = makeComponent();
      settingsSignal.set(makeDefaultSettings());
      mockSystemService.getAppSettings.mockResolvedValueOnce({ sshConfigPaths: [] });
      await component.loadSettings();
      await component.loadSshSettings();
      expect(component.hasUnsavedChanges()).toBe(false);
      component['temperature'].set(0.9);
      expect(component.hasUnsavedChanges()).toBe(true);
    });
  });
});
