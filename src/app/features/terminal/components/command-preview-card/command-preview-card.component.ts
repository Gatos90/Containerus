import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  LucideAngularModule,
  Play,
  Copy,
  X,
  AlertTriangle,
  Sparkles,
} from 'lucide-angular';

/**
 * CommandPreviewCardComponent displays a floating preview of the AI-suggested command
 * positioned just above the input bar for quick access.
 *
 * Shows:
 * - Command with $ prompt
 * - Brief explanation
 * - Quick action buttons (Run, Insert, Dismiss)
 * - Danger indicator if applicable
 */
@Component({
  selector: 'app-command-preview-card',
  imports: [CommonModule, LucideAngularModule],
  template: `
    @if (command()) {
      <div class="preview-card" [class.dangerous]="isDangerous()">
        <div class="preview-header">
          <lucide-icon [img]="Sparkles" class="w-4 h-4 text-purple-400" />
          <span class="preview-label">AI Suggestion</span>
          @if (isDangerous()) {
            <span class="danger-badge">
              <lucide-icon [img]="AlertTriangle" class="w-3 h-3" />
              Caution
            </span>
          }
          <button type="button" class="btn-dismiss" (click)="onDismiss()" title="Dismiss">
            <lucide-icon [img]="X" class="w-4 h-4" />
          </button>
        </div>

        <div class="preview-command">
          <span class="command-prompt">$</span>
          <code>{{ command() }}</code>
        </div>

        @if (explanation()) {
          <p class="preview-explanation">{{ truncatedExplanation() }}</p>
        }

        <div class="preview-actions">
          <button
            type="button"
            class="btn btn-primary"
            [class.btn-danger]="isDangerous()"
            (click)="onExecute()"
          >
            <lucide-icon [img]="Play" class="w-4 h-4" />
            Run
          </button>
          <button type="button" class="btn btn-secondary" (click)="onInsert()">
            <lucide-icon [img]="Copy" class="w-4 h-4" />
            Insert
          </button>
        </div>
      </div>
    }
  `,
  styles: `
    .preview-card {
      position: absolute;
      bottom: 100%;
      left: 0;
      right: 0;
      margin-bottom: 8px;
      background-color: rgba(24, 24, 27, 0.95);
      border: 1px solid rgba(139, 92, 246, 0.3);
      border-radius: 8px;
      padding: 12px;
      box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(8px);
      animation: slideUp 0.2s ease-out;
    }

    .preview-card.dangerous {
      border-color: rgba(239, 68, 68, 0.4);
    }

    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .preview-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 10px;
    }

    .preview-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #a78bfa;
    }

    .danger-badge {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 10px;
      font-weight: 500;
      padding: 2px 6px;
      border-radius: 4px;
      background-color: rgba(239, 68, 68, 0.2);
      color: #f87171;
      margin-left: auto;
      margin-right: 8px;
    }

    .btn-dismiss {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      padding: 0;
      background: none;
      border: none;
      border-radius: 4px;
      color: #71717a;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .btn-dismiss:hover {
      background-color: rgba(255, 255, 255, 0.1);
      color: #fafafa;
    }

    .preview-command {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      background-color: rgba(0, 0, 0, 0.3);
      border-radius: 6px;
      padding: 10px 12px;
      margin-bottom: 8px;
    }

    .command-prompt {
      color: #4ade80;
      font-weight: 600;
      font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
      user-select: none;
    }

    .preview-command code {
      flex: 1;
      font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
      font-size: 13px;
      color: #fafafa;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .preview-explanation {
      margin: 0 0 10px 0;
      font-size: 12px;
      color: #a1a1aa;
      line-height: 1.4;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .preview-actions {
      display: flex;
      gap: 8px;
    }

    .btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 500;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .btn:focus-visible {
      outline: 2px solid #3b82f6;
      outline-offset: 2px;
    }

    .btn-primary {
      background-color: #22c55e;
      color: #ffffff;
    }

    .btn-primary:hover {
      background-color: #16a34a;
    }

    .btn-primary.btn-danger {
      background-color: #ef4444;
    }

    .btn-primary.btn-danger:hover {
      background-color: #dc2626;
    }

    .btn-secondary {
      background-color: #3f3f46;
      color: #fafafa;
    }

    .btn-secondary:hover {
      background-color: #52525b;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandPreviewCardComponent {
  // Icons
  readonly Play = Play;
  readonly Copy = Copy;
  readonly X = X;
  readonly AlertTriangle = AlertTriangle;
  readonly Sparkles = Sparkles;

  // Inputs
  command = input<string | null>(null);
  explanation = input<string>('');
  isDangerous = input(false);

  // Outputs
  insert = output<string>();
  execute = output<string>();
  dismiss = output<void>();

  // Computed
  truncatedExplanation = computed(() => {
    const exp = this.explanation();
    if (exp.length > 120) {
      return exp.substring(0, 117) + '...';
    }
    return exp;
  });

  onInsert(): void {
    const cmd = this.command();
    if (cmd) {
      this.insert.emit(cmd);
    }
  }

  onExecute(): void {
    const cmd = this.command();
    if (cmd) {
      this.execute.emit(cmd);
    }
  }

  onDismiss(): void {
    this.dismiss.emit();
  }
}
