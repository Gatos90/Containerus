import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import type { OutputSection, RenderedLine } from '../../models/terminal-output.model';
import { LucideAngularModule, ChevronDown, ChevronRight } from 'lucide-angular';
import { MarkdownService } from '@/core/services/markdown.service';

@Component({
  selector: 'app-output-section',
  imports: [LucideAngularModule],
  template: `
    @switch (section().type) {
      @case ('thinking') {
        <!-- AI Thinking: always visible, no collapse -->
        <div class="section section-thinking">
          @for (item of linesWithIndex(); track item.index) {
            <div class="output-line">
              @for (span of item.line.spans; track span) {
                <span [class]="getAnsiClasses(span.styleToken)">{{ span.text || ' ' }}</span>
              }
            </div>
          }
        </div>
      }
      @case ('command') {
        <!-- Command header: always visible -->
        <div class="section section-command">
          @for (item of linesWithIndex(); track item.index) {
            <div class="output-line">
              @for (span of item.line.spans; track span) {
                <span [class]="getAnsiClasses(span.styleToken)">{{ span.text || ' ' }}</span>
              }
            </div>
          }
        </div>
      }
      @case ('output') {
        <!-- Terminal output: collapsible, collapsed by default -->
        <div class="section section-output">
          <button
            class="section-toggle"
            (click)="toggle.emit()"
            [attr.aria-expanded]="!section().isCollapsed"
          >
            <lucide-icon
              [img]="section().isCollapsed ? ChevronRight : ChevronDown"
              [size]="14"
            />
            <span class="toggle-label">Output ({{ section().lineCount }} lines)</span>
          </button>
          @if (!section().isCollapsed) {
            <div class="section-content">
              @for (item of linesWithIndex(); track item.index) {
                <div class="output-line">
                  @for (span of item.line.spans; track span) {
                    <span [class]="getAnsiClasses(span.styleToken)">{{ span.text || ' ' }}</span>
                  }
                </div>
              }
            </div>
          }
        </div>
      }
      @case ('response') {
        <!-- AI response: rendered as markdown -->
        <div class="section section-response" [innerHTML]="responseHtml()"></div>
      }
    }
  `,
  styles: `
    .section {
      margin-bottom: 4px;
    }

    .section-thinking {
      color: var(--text-muted);
    }

    .section-command {
      color: var(--text-primary);
    }

    .section-output {
      margin-left: 0;
    }

    .section-toggle {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      margin: 4px 0;
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      background: rgba(30, 30, 36, 0.6);
      color: var(--text-secondary);
      font-size: 11px;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .section-toggle:hover {
      background: rgba(40, 40, 48, 0.8);
      border-color: rgba(255, 255, 255, 0.15);
      color: var(--text-primary);
    }

    .toggle-label {
      user-select: none;
    }

    .section-content {
      margin-top: 4px;
      padding-left: 8px;
      border-left: 2px solid var(--border-subtle);
    }

    /* Use ::ng-deep to pierce Angular view encapsulation for innerHTML content */
    :host ::ng-deep .section-response {
      color: var(--text-primary);
      line-height: 1.5;
    }

    :host ::ng-deep .section-response p {
      margin: 0 0 8px 0;
    }

    :host ::ng-deep .section-response p:last-child {
      margin-bottom: 0;
    }

    :host ::ng-deep .section-response pre {
      background-color: rgba(0, 0, 0, 0.4);
      border-radius: 4px;
      padding: 10px 12px;
      margin: 8px 0;
      overflow-x: auto;
      font-size: 12px;
    }

    :host ::ng-deep .section-response pre code {
      background: none;
      padding: 0;
    }

    :host ::ng-deep .section-response code {
      background-color: rgba(0, 0, 0, 0.3);
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 12px;
    }

    :host ::ng-deep .section-response h1,
    :host ::ng-deep .section-response h2,
    :host ::ng-deep .section-response h3,
    :host ::ng-deep .section-response h4 {
      margin: 12px 0 6px 0;
      font-weight: 600;
    }

    :host ::ng-deep .section-response ul,
    :host ::ng-deep .section-response ol {
      margin: 6px 0;
      padding-left: 20px;
    }

    :host ::ng-deep .section-response li {
      margin: 2px 0;
    }

    :host ::ng-deep .section-response a {
      color: #60a5fa;
      text-decoration: underline;
    }

    :host ::ng-deep .section-response blockquote {
      border-left: 3px solid #3b82f6;
      margin: 8px 0;
      padding-left: 12px;
      color: var(--text-muted);
    }

    .streaming-text {
      white-space: pre-wrap;
      font-family: inherit;
      margin: 0;
      background: none;
      padding: 0;
      border: none;
    }

    :host ::ng-deep .section-response table {
      border-collapse: collapse;
      margin: 12px 0;
      width: 100%;
      max-width: 100%;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 6px;
      overflow: hidden;
    }

    :host ::ng-deep .section-response th,
    :host ::ng-deep .section-response td {
      border: 1px solid rgba(255, 255, 255, 0.2);
      padding: 12px 16px;
      text-align: left;
      word-wrap: break-word;
    }

    :host ::ng-deep .section-response th {
      background-color: rgba(255, 255, 255, 0.1);
      font-weight: 600;
      color: var(--text-primary);
      text-align: center;
    }

    :host ::ng-deep .section-response tr:nth-child(even) td {
      background-color: rgba(255, 255, 255, 0.02);
    }

    :host ::ng-deep .section-response tr:hover td {
      background-color: rgba(255, 255, 255, 0.05);
    }

    .output-line {
      height: 20px;
      white-space: pre;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OutputSectionComponent {
  private markdown = inject(MarkdownService);

  readonly section = input.required<OutputSection>();
  readonly lines = input.required<RenderedLine[]>();
  readonly isStreaming = input(false);
  readonly toggle = output<void>();

  readonly ChevronDown = ChevronDown;
  readonly ChevronRight = ChevronRight;

  readonly linesWithIndex = computed(() =>
    this.lines().map((line, index) => ({ index, line }))
  );

  /** Render response sections as markdown (incrementally during streaming) */
  readonly responseHtml = computed(() => {
    if (this.section().type !== 'response') return '';
    const text = this.lines()
      .map((line) => line.spans.map((s) => s.text).join(''))
      .join('\n');

    // Use incremental parsing during streaming to handle incomplete structures
    // (tables, code blocks) gracefully while still rendering completed markdown
    if (this.isStreaming()) {
      return this.markdown.parseIncremental(text);
    }

    return this.markdown.parse(text);
  });

  /**
   * Convert styleToken to CSS class names.
   * The styleToken contains space-separated tokens like "bold dim fg-1".
   * We prefix each with "ansi-" to get the CSS class.
   */
  getAnsiClasses(styleToken: string): string {
    if (!styleToken || styleToken === 'text') {
      return '';
    }
    return styleToken
      .split(' ')
      .filter((t) => t.length > 0)
      .map((t) => `ansi-${t}`)
      .join(' ');
  }
}
