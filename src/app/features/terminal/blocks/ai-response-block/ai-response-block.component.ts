import {
  Component,
  ChangeDetectionStrategy,
  input,
  computed,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Bot, Loader2 } from 'lucide-angular';
import { MarkdownService } from '@/core/services/markdown.service';

/**
 * AIResponseBlockComponent displays the AI's text response.
 *
 * Shows the response content with a streaming indicator when
 * the response is still being generated.
 */
@Component({
  selector: 'app-ai-response-block',
  imports: [CommonModule, LucideAngularModule],
  template: `
    <div class="ai-response-block" [class.streaming]="isStreaming()">
      <div class="response-header">
        <lucide-icon
          [img]="isStreaming() ? Loader2 : Bot"
          class="w-4 h-4"
          [class.animate-spin]="isStreaming()"
          [class.text-blue-400]="isStreaming()"
          [class.text-zinc-400]="!isStreaming()"
        />
        <span class="response-label">
          {{ isStreaming() ? 'Thinking...' : 'AI Response' }}
        </span>
      </div>
      <div class="response-content" [innerHTML]="formattedContent()"></div>
      @if (isStreaming()) {
        <span class="cursor">▋</span>
      }
    </div>
  `,
  styles: `
    .ai-response-block {
      font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
      font-size: 13px;
      line-height: 1.6;
      color: #fafafa;
      background-color: rgba(39, 39, 42, 0.5);
      border-radius: 6px;
      padding: 8px 12px;
      margin: 4px 0;
    }

    .ai-response-block.streaming {
      border-left: 3px solid #3b82f6;
    }

    .response-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 6px;
    }

    .response-label {
      font-size: 11px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #71717a;
    }

    .response-content {
      color: #d4d4d8;
    }

    .response-content p {
      margin: 0 0 8px 0;
    }

    .response-content p:last-child {
      margin-bottom: 0;
    }

    .response-content pre {
      background-color: rgba(0, 0, 0, 0.4);
      border-radius: 4px;
      padding: 10px 12px;
      margin: 8px 0;
      overflow-x: auto;
      font-size: 12px;
    }

    .response-content pre code {
      font-family: inherit;
      background: none;
      padding: 0;
    }

    .response-content code {
      background-color: rgba(0, 0, 0, 0.3);
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 12px;
    }

    .response-content h1,
    .response-content h2,
    .response-content h3,
    .response-content h4 {
      margin: 12px 0 6px 0;
      font-weight: 600;
      color: #fafafa;
    }

    .response-content h1 { font-size: 18px; }
    .response-content h2 { font-size: 16px; }
    .response-content h3 { font-size: 14px; }
    .response-content h4 { font-size: 13px; }

    .response-content ul,
    .response-content ol {
      margin: 6px 0;
      padding-left: 20px;
    }

    .response-content li {
      margin: 2px 0;
    }

    .response-content a {
      color: #60a5fa;
      text-decoration: underline;
    }

    .response-content a:hover {
      color: #93c5fd;
    }

    .response-content blockquote {
      border-left: 3px solid #3b82f6;
      margin: 8px 0;
      padding-left: 12px;
      color: #a1a1aa;
    }

    .response-content hr {
      border: none;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      margin: 12px 0;
    }

    .response-content table {
      border-collapse: collapse;
      margin: 8px 0;
      width: auto;
      max-width: 100%;
      display: block;
      overflow-x: auto;
    }

    .response-content th,
    .response-content td {
      border: 1px solid rgba(255, 255, 255, 0.2);
      padding: 12px 16px;
      text-align: left;
      white-space: nowrap;
    }

    .response-content th {
      background-color: rgba(0, 0, 0, 0.3);
      font-weight: 600;
      text-align: center;
    }

    .cursor {
      display: inline-block;
      animation: blink 1s step-end infinite;
      color: #3b82f6;
    }

    @keyframes blink {
      50% { opacity: 0; }
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .animate-spin {
      animation: spin 1s linear infinite;
    }

    .text-blue-400 {
      color: #60a5fa;
    }

    .text-zinc-400 {
      color: #a1a1aa;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AIResponseBlockComponent {
  readonly Bot = Bot;
  readonly Loader2 = Loader2;

  private markdown = inject(MarkdownService);

  // Inputs
  blockId = input.required<string>();
  content = input.required<string>();
  isStreaming = input(false);
  isCollapsed = input(false);

  // Format content with markdown rendering using marked library
  formattedContent = computed(() => {
    return this.markdown.parse(this.content());
  });
}
