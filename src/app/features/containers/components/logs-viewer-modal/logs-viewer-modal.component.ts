import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  X,
  RefreshCw,
  Copy,
  Download,
  FileText,
  AlertTriangle,
  Loader2,
  Clock,
  Search,
  ChevronUp,
  ChevronDown,
} from 'lucide-angular';
import { Container, getDisplayName } from '../../../../core/models/container.model';
import { ContainerService } from '../../../../core/services/container.service';
import { ClipboardService } from '../../../../core/services/clipboard.service';

@Component({
  selector: 'app-logs-viewer-modal',
  imports: [LucideAngularModule, FormsModule],
  templateUrl: './logs-viewer-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LogsViewerModalComponent {
  private containerService = inject(ContainerService);
  private clipboard = inject(ClipboardService);

  container = input.required<Container>();
  close = output<void>();

  // Icons
  readonly X = X;
  readonly RefreshCw = RefreshCw;
  readonly Copy = Copy;
  readonly Download = Download;
  readonly FileText = FileText;
  readonly AlertTriangle = AlertTriangle;
  readonly Loader2 = Loader2;
  readonly Clock = Clock;
  readonly Search = Search;
  readonly ChevronUp = ChevronUp;
  readonly ChevronDown = ChevronDown;

  // State
  logs = signal<string>('');
  isLoading = signal(true);
  error = signal<string | null>(null);
  tailSize = signal(500);
  showTimestamps = signal(true);
  searchQuery = signal('');
  currentMatchIndex = signal(0);

  logsContainerRef = viewChild<ElementRef<HTMLDivElement>>('logsContainer');

  containerName = computed(() => getDisplayName(this.container()));

  lineCount = computed(() => {
    const l = this.logs();
    if (!l) return 0;
    return l.split('\n').filter((line) => line.trim()).length;
  });

  matchCount = computed(() => {
    const query = this.searchQuery().trim();
    const l = this.logs();
    if (!query || !l) return 0;
    const regex = new RegExp(this.escapeRegex(query), 'gi');
    return (l.match(regex) || []).length;
  });

  // Only depends on logs and searchQuery - NOT currentMatchIndex
  // This prevents full re-render when navigating between matches
  highlightedLogs = computed(() => {
    const l = this.logs();
    if (!l) return '';

    // Escape HTML first
    let escaped = this.escapeHtml(l);

    const query = this.searchQuery().trim();
    if (!query) return escaped;

    // Highlight all matches with their index
    const regex = new RegExp(`(${this.escapeRegex(query)})`, 'gi');
    let matchIndex = 0;

    escaped = escaped.replace(regex, (match) => {
      matchIndex++;
      return `<mark class="search-match bg-yellow-500/30 text-yellow-200 px-0.5 rounded">${match}</mark>`;
    });

    return escaped;
  });

  constructor() {
    // Load logs when component initializes
    effect(() => {
      // Access container to track it
      this.container();
      // Load logs (untracked to avoid loops)
      this.loadLogs();
    });
  }

  async loadLogs(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);

    try {
      const c = this.container();
      const logs = await this.containerService.getLogs(
        c.systemId,
        c.id,
        c.runtime,
        this.tailSize(),
        this.showTimestamps()
      );
      this.logs.set(logs);

      // Auto-scroll to bottom after logs load
      setTimeout(() => this.scrollToBottom(), 50);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Unknown error');
      this.logs.set('');
    } finally {
      this.isLoading.set(false);
    }
  }

  onTailChange(value: number): void {
    this.tailSize.set(Number(value));
    this.loadLogs();
  }

  onTimestampsChange(value: boolean): void {
    this.showTimestamps.set(value);
    this.loadLogs();
  }

  async copyLogs(): Promise<void> {
    const l = this.logs();
    if (l) {
      await this.clipboard.copy(l);
    }
  }

  downloadLogs(): void {
    const l = this.logs();
    if (!l) return;

    const c = this.container();
    const filename = `${c.name || c.id.slice(0, 12)}-logs-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}.log`;

    const blob = new Blob([l], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();

    URL.revokeObjectURL(url);
  }

  private scrollToBottom(): void {
    const el = this.logsContainerRef()?.nativeElement;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close.emit();
    }
  }

  onSearchChange(query: string): void {
    this.searchQuery.set(query);
    this.currentMatchIndex.set(0);
    if (query.trim()) {
      // Wait for Angular to update the DOM with highlighted matches
      setTimeout(() => this.highlightAndScrollToMatch(0), 100);
    }
  }

  clearSearch(): void {
    this.searchQuery.set('');
    this.currentMatchIndex.set(0);
  }

  onMatchIndexInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = parseInt(input.value, 10);
    const count = this.matchCount();

    if (isNaN(value) || value < 1) {
      input.value = '1';
      this.jumpToMatch(0);
    } else if (value > count) {
      input.value = String(count);
      this.jumpToMatch(count - 1);
    } else {
      this.jumpToMatch(value - 1);
    }
  }

  private jumpToMatch(index: number): void {
    this.currentMatchIndex.set(index);
    setTimeout(() => this.highlightAndScrollToMatch(index), 0);
  }

  nextMatch(): void {
    const count = this.matchCount();
    if (count === 0) return;
    const next = (this.currentMatchIndex() + 1) % count;
    this.jumpToMatch(next);
  }

  previousMatch(): void {
    const count = this.matchCount();
    if (count === 0) return;
    const prev = (this.currentMatchIndex() - 1 + count) % count;
    this.jumpToMatch(prev);
  }

  private highlightAndScrollToMatch(index: number): void {
    const container = this.logsContainerRef()?.nativeElement;
    if (!container) return;

    // Get ALL marks and select by index (can't use data attributes - Angular sanitizer strips them)
    const allMarks = container.querySelectorAll('mark.search-match');

    // Remove previous current-match styling from all
    allMarks.forEach((mark) => {
      mark.classList.remove('current-match', 'bg-orange-500/60');
      mark.classList.add('bg-yellow-500/30');
    });

    // Get current mark by index
    const currentMark = allMarks[index] as HTMLElement | undefined;
    if (!currentMark) return;

    // Add current match styling
    currentMark.classList.remove('bg-yellow-500/30');
    currentMark.classList.add('current-match', 'bg-orange-500/60');

    // Scroll to center
    const markRect = currentMark.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const markRelativeTop = markRect.top - containerRect.top;
    const targetScroll =
      container.scrollTop + markRelativeTop - container.clientHeight / 2;

    container.scrollTo({
      top: Math.max(0, targetScroll),
      behavior: 'smooth',
    });
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
