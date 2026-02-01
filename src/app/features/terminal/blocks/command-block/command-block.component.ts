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
  Check,
  X,
  Loader2,
  ChevronRight,
  ChevronDown,
  Copy,
  RotateCcw,
} from 'lucide-angular';

/**
 * CommandBlockComponent displays an executed command with its status.
 *
 * Features:
 * - Shows command text with syntax highlighting
 * - Status indicator (running/completed/failed)
 * - Collapse/expand toggle
 * - Copy command button
 * - Re-run command button
 */
@Component({
  selector: 'app-command-block',
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './command-block.component.html',
  styleUrl: './command-block.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandBlockComponent {
  // Icons
  readonly Check = Check;
  readonly X = X;
  readonly Loader2 = Loader2;
  readonly ChevronRight = ChevronRight;
  readonly ChevronDown = ChevronDown;
  readonly Copy = Copy;
  readonly RotateCcw = RotateCcw;

  // Inputs
  blockId = input.required<string>();
  command = input.required<string>();
  exitCode = input<number | null>(null);
  status = input<'running' | 'completed' | 'failed'>('running');
  isCollapsed = input(true);
  workingDirectory = input<string>('');
  duration = input<number | undefined>(undefined);

  // Outputs
  toggleCollapse = output<void>();
  copyCommand = output<string>();
  rerunCommand = output<string>();

  // Computed
  statusIcon = computed(() => {
    switch (this.status()) {
      case 'running':
        return this.Loader2;
      case 'completed':
        return this.exitCode() === 0 ? this.Check : this.X;
      case 'failed':
        return this.X;
    }
  });

  statusColor = computed(() => {
    if (this.status() === 'running') return 'text-blue-400';
    return this.exitCode() === 0 ? 'text-green-400' : 'text-red-400';
  });

  statusBorderColor = computed(() => {
    if (this.status() === 'running') return 'border-blue-400';
    return this.exitCode() === 0 ? 'border-green-500' : 'border-red-500';
  });

  isSuccess = computed(() => this.status() === 'completed' && this.exitCode() === 0);
  isError = computed(() => this.status() === 'failed' || (this.exitCode() !== null && this.exitCode() !== 0));
  isRunning = computed(() => this.status() === 'running');

  formattedDuration = computed(() => {
    const ms = this.duration();
    if (ms === undefined) return '';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return `${minutes}m ${seconds}s`;
  });

  onToggle(): void {
    this.toggleCollapse.emit();
  }

  onCopy(): void {
    this.copyCommand.emit(this.command());
  }

  onRerun(): void {
    this.rerunCommand.emit(this.command());
  }
}
