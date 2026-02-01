import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  LucideAngularModule,
  Zap,
  FileText,
  Loader2,
  ChevronDown,
  ChevronRight,
} from 'lucide-angular';
import { BlockState } from '../../../../state/block.state';

/**
 * AIPromptBlockComponent displays the user's AI query.
 *
 * Shows the query text with an icon indicator, optional
 * context line count badge with hover tooltip, and loading state.
 * Supports collapsing to show only the header.
 */
@Component({
  selector: 'app-ai-prompt-block',
  imports: [CommonModule, LucideAngularModule],
  template: `
    <div class="ai-prompt-block" [class.loading]="isLoading()" [class.collapsed]="isCollapsed()">
      <div class="prompt-header">
        <button type="button" class="collapse-toggle" (click)="onToggleCollapse()" title="Toggle collapse">
          <lucide-icon [img]="isCollapsed() ? ChevronRight : ChevronDown" class="w-4 h-4" />
        </button>
        @if (isLoading()) {
          <lucide-icon [img]="Loader2" class="w-4 h-4 text-purple-400 animate-spin" />
        } @else {
          <lucide-icon [img]="Zap" class="w-4 h-4 text-purple-400" />
        }
        <span class="prompt-label">{{ isLoading() ? 'Asking AI...' : 'AI Query' }}</span>
        @if (contextLines() && contextLines()! > 0) {
          <span class="context-badge" [title]="contextContent() || 'Terminal context included'">
            <lucide-icon [img]="FileText" class="w-3 h-3" />
            {{ contextLines() }} lines context
          </span>
        }
      </div>
      @if (!isCollapsed()) {
        <div class="prompt-content">
          <p>{{ query() }}</p>
        </div>
      }
    </div>
  `,
  styles: `
    .ai-prompt-block {
      font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
      font-size: 13px;
      line-height: 1.5;
      color: #fafafa;
      background-color: rgba(139, 92, 246, 0.1);
      border-left: 3px solid #8b5cf6;
      border-radius: 6px;
      padding: 10px 14px;
      margin: 6px 0;
      transition: padding 0.15s ease;
    }

    .ai-prompt-block.collapsed {
      padding: 8px 14px;
    }

    .ai-prompt-block.loading {
      border-left-color: #a78bfa;
    }

    .prompt-header {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 24px;
    }

    .ai-prompt-block:not(.collapsed) .prompt-header {
      margin-bottom: 8px;
    }

    .collapse-toggle {
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
      flex-shrink: 0;
    }

    .collapse-toggle:hover {
      background-color: rgba(255, 255, 255, 0.1);
      color: #fafafa;
    }

    .prompt-label {
      font-size: 11px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #a78bfa;
    }

    .context-badge {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 10px;
      color: #71717a;
      background-color: rgba(39, 39, 42, 0.8);
      padding: 2px 6px;
      border-radius: 4px;
      margin-left: auto;
      cursor: help;
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .context-badge:hover {
      background-color: rgba(63, 63, 70, 0.9);
      color: #a1a1aa;
    }

    .prompt-content {
      color: #e4e4e7;
      padding-left: 32px;
    }

    .prompt-content p {
      margin: 0;
      white-space: pre-wrap;
      overflow-wrap: break-word;
    }

    .animate-spin {
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AIPromptBlockComponent {
  private readonly blockState = inject(BlockState);

  readonly Zap = Zap;
  readonly FileText = FileText;
  readonly Loader2 = Loader2;
  readonly ChevronDown = ChevronDown;
  readonly ChevronRight = ChevronRight;

  // Inputs
  blockId = input.required<string>();
  query = input.required<string>();
  contextLines = input<number | undefined>(undefined);
  contextContent = input<string>('');
  isLoading = input(false);
  isCollapsed = input(false);

  // Outputs
  toggleCollapse = output<void>();

  onToggleCollapse(): void {
    this.blockState.toggleCollapse(this.blockId());
    this.toggleCollapse.emit();
  }
}
