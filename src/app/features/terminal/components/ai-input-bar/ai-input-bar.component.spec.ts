import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Injector,
  runInInjectionContext,
  signal,
  ɵChangeDetectionScheduler,
  ɵEffectScheduler,
} from '@angular/core';
import { AiInputBarComponent } from './ai-input-bar.component';
import { AiService } from '../../../../core/services/ai.service';
import { BlockFactoryService } from '../../services/block-factory.service';
import { BlockState } from '../../../../state/block.state';

function makeComponent(overrides: {
  aiService?: Partial<AiService>;
  blockFactory?: Partial<BlockFactoryService>;
  blockState?: Partial<BlockState>;
} = {}) {
  const mockAiService: any = {
    loadSettings: vi.fn().mockResolvedValue(undefined),
    getSuggestion: vi.fn().mockResolvedValue({
      command: 'docker ps',
      explanation: 'Lists running containers',
      is_dangerous: false,
    }),
    isConfigured: signal(true),
    ...overrides.aiService,
  };

  const mockBlockFactory: any = {
    createLoadingAICommandBlock: vi.fn().mockReturnValue('block-123'),
    updateAICommandBlockWithResponse: vi.fn(),
    removeBlock: vi.fn(),
    createAIResponseBlock: vi.fn(),
    ...overrides.blockFactory,
  };

  const mockBlockState: any = {
    blocks: signal([]),
    ...overrides.blockState,
  };

  const injector = Injector.create({
    providers: [
      { provide: AiService, useValue: mockAiService },
      { provide: BlockFactoryService, useValue: mockBlockFactory },
      { provide: BlockState, useValue: mockBlockState },
      {
        provide: ɵChangeDetectionScheduler,
        useValue: { notify: vi.fn(), runningTick: false },
      },
      {
        provide: ɵEffectScheduler,
        useValue: {
          add: vi.fn(),
          remove: vi.fn(),
          schedule: vi.fn(),
          flush: vi.fn(),
        },
      },
    ],
  });

  const component = runInInjectionContext(injector, () => new AiInputBarComponent());
  return { component, mockAiService, mockBlockFactory, mockBlockState };
}

describe('AiInputBarComponent', () => {
  describe('initial state', () => {
    it('should create', () => {
      const { component } = makeComponent();
      expect(component).toBeTruthy();
    });

    it('should start with empty inputValue', () => {
      const { component } = makeComponent();
      expect(component.inputValue()).toBe('');
    });

    it('should start with isLoading false', () => {
      const { component } = makeComponent();
      expect(component.isLoading()).toBe(false);
    });

    it('should start with no error', () => {
      const { component } = makeComponent();
      expect(component.error()).toBeNull();
    });

    it('should start with no preview command', () => {
      const { component } = makeComponent();
      expect(component.previewCommand()).toBeNull();
    });
  });

  describe('ngOnInit', () => {
    it('should call aiService.loadSettings on init', () => {
      const { component, mockAiService } = makeComponent();
      component.ngOnInit();
      expect(mockAiService.loadSettings).toHaveBeenCalled();
    });

    it('should not throw if loadSettings fails', async () => {
      const { component, mockAiService } = makeComponent();
      mockAiService.loadSettings.mockRejectedValue(new Error('no settings'));

      await expect(
        new Promise<void>((resolve) => {
          component.ngOnInit();
          setTimeout(resolve, 10);
        })
      ).resolves.toBeUndefined();
    });
  });

  describe('isAiMode computed', () => {
    it('should be false when input does not start with #', () => {
      const { component } = makeComponent();
      component.inputValue.set('docker ps');
      expect(component.isAiMode()).toBe(false);
    });

    it('should be true when input starts with #', () => {
      const { component } = makeComponent();
      component.inputValue.set('# list containers');
      expect(component.isAiMode()).toBe(true);
    });

    it('should be true with just #', () => {
      const { component } = makeComponent();
      component.inputValue.set('#');
      expect(component.isAiMode()).toBe(true);
    });
  });

  describe('onInputChange', () => {
    it('should update inputValue signal', () => {
      const { component } = makeComponent();
      component.onInputChange('docker run nginx');
      expect(component.inputValue()).toBe('docker run nginx');
    });
  });

  describe('dismissError', () => {
    it('should clear the error signal', () => {
      const { component } = makeComponent();
      component.error.set('some error');

      component.dismissError();

      expect(component.error()).toBeNull();
    });
  });

  describe('dismissPreview', () => {
    it('should clear previewCommand, previewExplanation, and previewIsDangerous', () => {
      const { component } = makeComponent();
      component.previewCommand.set('docker ps');
      component.previewExplanation.set('some explanation');
      component.previewIsDangerous.set(true);

      component.dismissPreview();

      expect(component.previewCommand()).toBeNull();
      expect(component.previewExplanation()).toBe('');
      expect(component.previewIsDangerous()).toBe(false);
    });
  });

  describe('onPreviewInsert', () => {
    it('should set inputValue to the command and dismiss preview', () => {
      const { component } = makeComponent();
      component.previewCommand.set('docker info');
      component.previewExplanation.set('some exp');

      component.onPreviewInsert('docker info');

      expect(component.inputValue()).toBe('docker info');
      expect(component.previewCommand()).toBeNull();
    });
  });

  describe('onPreviewExecute', () => {
    it('should emit executeCommand with the command', () => {
      const { component } = makeComponent();
      const executeSpy = vi.fn();
      component.executeCommand.subscribe(executeSpy);

      component.onPreviewExecute('docker stop myapp');

      expect(executeSpy).toHaveBeenCalledWith('docker stop myapp');
    });

    it('should dismiss preview after execute', () => {
      const { component } = makeComponent();
      component.previewCommand.set('docker stop myapp');
      component.executeCommand.subscribe(vi.fn());

      component.onPreviewExecute('docker stop myapp');

      expect(component.previewCommand()).toBeNull();
    });
  });

  describe('onSubmit (terminal command mode)', () => {
    it('should emit executeCommand for non-AI input', async () => {
      const { component } = makeComponent();
      const executeSpy = vi.fn();
      component.executeCommand.subscribe(executeSpy);
      component.inputValue.set('docker ps');

      await component.onSubmit();

      expect(executeSpy).toHaveBeenCalledWith('docker ps');
    });

    it('should clear inputValue after terminal command submission', async () => {
      const { component } = makeComponent();
      component.executeCommand.subscribe(vi.fn());
      component.inputValue.set('docker ps');

      await component.onSubmit();

      expect(component.inputValue()).toBe('');
    });

    it('should not submit when input is empty', async () => {
      const { component, mockAiService } = makeComponent();
      const executeSpy = vi.fn();
      component.executeCommand.subscribe(executeSpy);
      component.inputValue.set('   ');

      await component.onSubmit();

      expect(executeSpy).not.toHaveBeenCalled();
      expect(mockAiService.getSuggestion).not.toHaveBeenCalled();
    });

    it('should not submit when already loading', async () => {
      const { component, mockAiService } = makeComponent();
      component.isLoading.set(true);
      component.inputValue.set('docker ps');
      const executeSpy = vi.fn();
      component.executeCommand.subscribe(executeSpy);

      await component.onSubmit();

      expect(executeSpy).not.toHaveBeenCalled();
      expect(mockAiService.getSuggestion).not.toHaveBeenCalled();
    });
  });

  describe('onSubmit (AI mode)', () => {
    it('should call aiService.getSuggestion for AI query', async () => {
      const { component, mockAiService } = makeComponent();
      component.inputValue.set('# list all containers');

      await component.onSubmit();

      expect(mockAiService.getSuggestion).toHaveBeenCalledWith(
        'list all containers',
        expect.any(String)
      );
    });

    it('should show error when AI is not configured', async () => {
      const { component } = makeComponent({
        aiService: { isConfigured: signal(false) },
      });
      component.inputValue.set('# list containers');

      await component.onSubmit();

      expect(component.error()).toContain('AI is not configured');
    });

    it('should create loading block before calling AI', async () => {
      const { component, mockBlockFactory } = makeComponent();
      component.inputValue.set('# list containers');

      await component.onSubmit();

      expect(mockBlockFactory.createLoadingAICommandBlock).toHaveBeenCalledWith(
        'list containers',
        // contextLines is undefined when terminalContext is empty
        undefined
      );
    });

    it('should update block with response when AI returns a command', async () => {
      const { component, mockBlockFactory, mockAiService } = makeComponent();
      mockAiService.getSuggestion.mockResolvedValue({
        command: 'docker ps -a',
        explanation: 'Lists all containers',
        is_dangerous: false,
      });
      component.inputValue.set('# list containers');

      await component.onSubmit();

      expect(mockBlockFactory.updateAICommandBlockWithResponse).toHaveBeenCalledWith(
        'block-123',
        expect.objectContaining({ command: 'docker ps -a' })
      );
    });

    it('should set preview signals when AI returns a command', async () => {
      const { component, mockAiService } = makeComponent();
      mockAiService.getSuggestion.mockResolvedValue({
        command: 'docker ps',
        explanation: 'Lists running containers',
        is_dangerous: true,
      });
      component.inputValue.set('# list containers');

      await component.onSubmit();

      expect(component.previewCommand()).toBe('docker ps');
      expect(component.previewExplanation()).toBe('Lists running containers');
      expect(component.previewIsDangerous()).toBe(true);
    });

    it('should remove loading block and create response block when AI returns no command', async () => {
      const { component, mockBlockFactory, mockAiService } = makeComponent();
      mockAiService.getSuggestion.mockResolvedValue({
        command: '',
        explanation: 'I could not generate a command',
        is_dangerous: false,
      });
      component.inputValue.set('# explain docker');

      await component.onSubmit();

      expect(mockBlockFactory.removeBlock).toHaveBeenCalledWith('block-123');
      expect(mockBlockFactory.createAIResponseBlock).toHaveBeenCalledWith(
        'I could not generate a command',
        false
      );
    });

    it('should handle AI errors gracefully', async () => {
      const { component, mockAiService, mockBlockFactory } = makeComponent();
      mockAiService.getSuggestion.mockRejectedValue(new Error('AI service down'));
      component.inputValue.set('# list containers');

      await component.onSubmit();

      expect(component.error()).toBe('AI service down');
      expect(mockBlockFactory.removeBlock).toHaveBeenCalledWith('block-123');
      expect(mockBlockFactory.createAIResponseBlock).toHaveBeenCalledWith(
        'Error: AI service down',
        false
      );
    });

    it('should reset isLoading to false after AI call completes', async () => {
      const { component } = makeComponent();
      component.inputValue.set('# list containers');

      await component.onSubmit();

      expect(component.isLoading()).toBe(false);
    });

    it('should clear inputValue immediately when in AI mode', async () => {
      const { component, mockAiService } = makeComponent();
      // Make the getSuggestion promise not resolve immediately
      let resolveAi!: (v: any) => void;
      mockAiService.getSuggestion.mockReturnValue(
        new Promise((resolve) => { resolveAi = resolve; })
      );
      component.inputValue.set('# list containers');

      const submitPromise = component.onSubmit();
      // Input should be cleared before AI responds
      expect(component.inputValue()).toBe('');

      // Resolve the AI call
      resolveAi({ command: 'docker ps', explanation: 'test', is_dangerous: false });
      await submitPromise;
    });
  });
});
