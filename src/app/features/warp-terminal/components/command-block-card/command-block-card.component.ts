import { CommonModule, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import {
  LucideAngularModule,
  CheckCircle2,
  XCircle,
  Loader2,
  Copy,
  Play,
  ChevronDown,
  ChevronRight,
  Terminal,
  FileText,
} from 'lucide-angular';
import type { CommandBlock } from '../../models/terminal-block.model';
import type { RenderedLine } from '../../models/terminal-output.model';
import { OutputViewportComponent } from '../output-viewport/output-viewport.component';

@Component({
  selector: 'app-command-block-card',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, OutputViewportComponent, DatePipe],
  templateUrl: './command-block-card.component.html',
  styleUrl: './command-block-card.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandBlockCardComponent {
  @Input() block!: CommandBlock;
  @Input() selected = false;
  @Input() highlightLines?: Set<number>;

  @Output() select = new EventEmitter<void>();
  @Output() copyCommand = new EventEmitter<void>();
  @Output() copyOutput = new EventEmitter<void>();
  @Output() rerun = new EventEmitter<void>();
  @Output() toggleCollapse = new EventEmitter<void>();
  @Output() textSelection = new EventEmitter<{ kind: 'text'; blockId: number } | { kind: 'none' }>();

  readonly CheckCircle2 = CheckCircle2;
  readonly XCircle = XCircle;
  readonly Loader2 = Loader2;
  readonly Copy = Copy;
  readonly Play = Play;
  readonly ChevronDown = ChevronDown;
  readonly ChevronRight = ChevronRight;
  readonly Terminal = Terminal;
  readonly FileText = FileText;

  get statusLabel(): string {
    switch (this.block.status.state) {
      case 'queued':
        return 'Queued';
      case 'running':
        return 'Running';
      case 'finished':
        return this.block.status.exitCode === 0 ? 'Success' : 'Failed';
      case 'cancelled':
        return 'Cancelled';
      default:
        return 'Idle';
    }
  }

  get statusTone(): string {
    switch (this.block.status.state) {
      case 'running':
        return 'running';
      case 'finished':
        return this.block.status.exitCode === 0 ? 'success' : 'failure';
      case 'cancelled':
        return 'failure';
      default:
        return 'queued';
    }
  }

  onTextSelection(active: boolean): void {
    if (active) {
      this.textSelection.emit({ kind: 'text', blockId: this.block.id });
    } else {
      this.textSelection.emit({ kind: 'none' });
    }
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
