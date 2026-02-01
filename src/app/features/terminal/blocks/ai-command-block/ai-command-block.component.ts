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
  Terminal,
  Play,
  Copy,
  AlertTriangle,
  ShieldAlert,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  FolderOpen,
  FileCode,
  Layers,
  RotateCcw,
  Zap,
  FileText,
  Loader2,
} from 'lucide-angular';

/**
 * AICommandBlockComponent displays an AI-suggested command.
 *
 * Features:
 * - Command preview with syntax highlighting
 * - Explanation of what the command does
 * - Danger/sudo warnings
 * - Insert/Execute/Reject actions
 * - Alternative commands (collapsible)
 */
@Component({
  selector: 'app-ai-command-block',
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './ai-command-block.component.html',
  styleUrl: './ai-command-block.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AICommandBlockComponent {
  // Icons
  readonly Terminal = Terminal;
  readonly Play = Play;
  readonly Copy = Copy;
  readonly AlertTriangle = AlertTriangle;
  readonly ShieldAlert = ShieldAlert;
  readonly Check = Check;
  readonly X = X;
  readonly ChevronDown = ChevronDown;
  readonly ChevronRight = ChevronRight;
  readonly Lightbulb = Lightbulb;
  readonly FolderOpen = FolderOpen;
  readonly FileCode = FileCode;
  readonly Layers = Layers;
  readonly RotateCcw = RotateCcw;
  readonly Zap = Zap;
  readonly FileText = FileText;
  readonly Loader2 = Loader2;

  // Inputs
  blockId = input.required<string>();
  query = input<string>('');
  contextLines = input<number | undefined>(undefined);
  isLoading = input(false);
  command = input<string>('');
  explanation = input<string>('');
  isDangerous = input(false);
  requiresSudo = input(false);
  affectsFiles = input<string[]>([]);
  alternatives = input<Array<{ command: string; description: string }>>([]);
  warning = input<string | undefined>(undefined);
  status = input<'pending' | 'inserted' | 'executed' | 'rejected'>('pending');
  isCollapsed = input(false);

  // Outputs
  insert = output<string>();
  execute = output<string>();
  reject = output<void>();
  copyCommand = output<string>();
  toggleCollapse = output<void>();

  // Local state
  showAlternatives = false;
  showAffectsFiles = false;

  // Note: Auto-collapse is handled by BlockFactoryService.wireUpAICommandOutputs()

  // Computed
  isPending = computed(() => this.status() === 'pending');
  isInserted = computed(() => this.status() === 'inserted');
  isExecuted = computed(() => this.status() === 'executed');
  isRejected = computed(() => this.status() === 'rejected');

  statusIcon = computed(() => {
    switch (this.status()) {
      case 'pending':
        return this.Terminal;
      case 'inserted':
        return this.Copy;
      case 'executed':
        return this.Check;
      case 'rejected':
        return this.X;
    }
  });

  statusColor = computed(() => {
    switch (this.status()) {
      case 'pending':
        return 'text-green-400';
      case 'inserted':
        return 'text-blue-400';
      case 'executed':
        return 'text-green-400';
      case 'rejected':
        return 'text-zinc-500';
    }
  });

  borderColor = computed(() => {
    if (this.isDangerous()) return 'border-red-500';
    switch (this.status()) {
      case 'pending':
        return 'border-green-500';
      case 'inserted':
        return 'border-blue-500';
      case 'executed':
        return 'border-green-500';
      case 'rejected':
        return 'border-zinc-600';
    }
  });

  hasAlternatives = computed(() => this.alternatives().length > 0);

  statusBadgeClass = computed(() => {
    switch (this.status()) {
      case 'inserted':
        return 'status-badge-inserted';
      case 'executed':
        return 'status-badge-executed';
      case 'rejected':
        return 'status-badge-rejected';
      default:
        return '';
    }
  });

  statusText = computed(() => {
    switch (this.status()) {
      case 'inserted':
        return 'Inserted';
      case 'executed':
        return 'Executed';
      case 'rejected':
        return 'Rejected';
      default:
        return '';
    }
  });

  onInsert(): void {
    this.insert.emit(this.command());
  }

  onExecute(): void {
    this.execute.emit(this.command());
  }

  onReject(): void {
    this.reject.emit();
  }

  onCopy(): void {
    this.copyCommand.emit(this.command());
  }

  toggleAlternatives(): void {
    this.showAlternatives = !this.showAlternatives;
  }

  toggleAffectsFiles(): void {
    this.showAffectsFiles = !this.showAffectsFiles;
  }

  onInsertAlternative(command: string): void {
    this.insert.emit(command);
  }

  onExecuteAlternative(command: string): void {
    this.execute.emit(command);
  }

  onToggleCollapse(): void {
    this.toggleCollapse.emit();
  }
}
