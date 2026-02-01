import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  LucideAngularModule,
  Sparkles,
  Terminal,
  X,
  CornerDownLeft,
  Play,
  AlertCircle,
  Loader2,
  Settings,
} from 'lucide-angular';
import { AiService } from '../../../../core/services/ai.service';
import { BlockFactoryService } from '../../services/block-factory.service';
import { BlockState } from '../../../../state/block.state';
import { CommandPreviewCardComponent } from '../command-preview-card/command-preview-card.component';

@Component({
  selector: 'app-ai-input-bar',
  templateUrl: './ai-input-bar.component.html',
  styleUrl: './ai-input-bar.component.css',
  imports: [FormsModule, LucideAngularModule, RouterLink, CommandPreviewCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiInputBarComponent implements OnInit {
  private readonly aiService = inject(AiService);
  private readonly blockFactory = inject(BlockFactoryService);
  private readonly blockState = inject(BlockState);

  // Track the current command block ID
  private currentCommandBlockId: string | null = null;

  // Lucide icons
  readonly Sparkles = Sparkles;
  readonly Terminal = Terminal;
  readonly X = X;
  readonly CornerDownLeft = CornerDownLeft;
  readonly Play = Play;
  readonly AlertCircle = AlertCircle;
  readonly Loader2 = Loader2;
  readonly Settings = Settings;

  // Inputs
  terminalContext = input<string>('');

  // Outputs
  executeCommand = output<string>();

  // State
  inputValue = signal('');
  isLoading = signal(false);
  error = signal<string | null>(null);

  // Preview state (for floating command preview card)
  previewCommand = signal<string | null>(null);
  previewExplanation = signal<string>('');
  previewIsDangerous = signal(false);

  // Computed
  isAiMode = computed(() => this.inputValue().startsWith('#'));
  isConfigured = this.aiService.isConfigured;

  ngOnInit(): void {
    // Load AI settings on init
    this.aiService.loadSettings().catch(() => {
      // Ignore errors on initial load
    });
  }

  async onSubmit(): Promise<void> {
    // Guard against double submission
    if (this.isLoading()) return;

    const value = this.inputValue().trim();
    if (!value) return;

    if (this.isAiMode()) {
      await this.handleAiQuery(value);
    } else {
      this.handleTerminalCommand(value);
    }
  }

  private async handleAiQuery(value: string): Promise<void> {
    const query = value.slice(1).trim(); // Remove # prefix
    if (!query) return;

    // Check if AI is configured
    if (!this.isConfigured()) {
      this.error.set('AI is not configured. Click the settings icon to set it up.');
      return;
    }

    // Clean up previous AI command block before creating new one
    this.cleanupPreviousAIBlock();

    this.isLoading.set(true);
    this.error.set(null);

    // Clear input immediately so user can type more
    this.inputValue.set('');

    // Get context for the AI
    const context = this.terminalContext();
    const contextLines = context ? context.split('\n').length : 0;

    // Create loading block immediately so user sees feedback
    const loadingBlockId = this.blockFactory.createLoadingAICommandBlock(
      query,
      contextLines > 0 ? contextLines : undefined
    );
    this.currentCommandBlockId = loadingBlockId;

    try {
      const suggestion = await this.aiService.getSuggestion(query, context);

      // If AI returned a command, update the loading block with response data
      if (suggestion.command && suggestion.command.trim() && loadingBlockId) {
        this.blockFactory.updateAICommandBlockWithResponse(loadingBlockId, suggestion);

        // Also show floating preview card for quick access
        this.previewCommand.set(suggestion.command);
        this.previewExplanation.set(suggestion.explanation);
        this.previewIsDangerous.set(suggestion.is_dangerous);
      } else {
        // No command returned - remove loading block and show response block instead
        if (loadingBlockId) {
          this.blockFactory.removeBlock(loadingBlockId);
        }
        this.blockFactory.createAIResponseBlock(suggestion.explanation, false);
        this.currentCommandBlockId = null;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Remove loading block and show error as a response block
      if (loadingBlockId) {
        this.blockFactory.removeBlock(loadingBlockId);
      }
      this.blockFactory.createAIResponseBlock(`Error: ${message}`, false);
      this.currentCommandBlockId = null;
      this.error.set(message);
    } finally {
      this.isLoading.set(false);
    }
  }

  private handleTerminalCommand(value: string): void {
    this.executeCommand.emit(value);
    this.inputValue.set('');
  }

  dismissError(): void {
    this.error.set(null);
  }

  onInputChange(value: string): void {
    this.inputValue.set(value);
  }

  // Preview card actions
  onPreviewInsert(command: string): void {
    this.inputValue.set(command);
    this.dismissPreview();
  }

  onPreviewExecute(command: string): void {
    this.executeCommand.emit(command);
    this.dismissPreview();
  }

  dismissPreview(): void {
    this.previewCommand.set(null);
    this.previewExplanation.set('');
    this.previewIsDangerous.set(false);
  }

  /**
   * Clean up previous AI command block before starting a new query
   */
  private cleanupPreviousAIBlock(): void {
    // Remove previous command block (if exists)
    if (this.currentCommandBlockId) {
      this.blockFactory.removeBlock(this.currentCommandBlockId);
      this.currentCommandBlockId = null;
    }
  }
}
