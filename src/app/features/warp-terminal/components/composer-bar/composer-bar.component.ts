import { CommonModule } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  Output,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, ArrowRight, Sparkles, Search, History } from 'lucide-angular';
import { Subject, debounceTime, distinctUntilChanged, switchMap, from } from 'rxjs';
import { CommandHistoryService } from '../../state/command-history.service';
import { AiService } from '../../../../core/services/ai.service';
import { WarpTerminalStore } from '../../state/warp-terminal-store.service';

@Component({
  selector: 'app-composer-bar',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  templateUrl: './composer-bar.component.html',
  styleUrl: './composer-bar.component.css',
})
export class ComposerBarComponent {
  @Output() submit = new EventEmitter<{ text: string; mode: 'command' | 'ai' }>();

  @ViewChild('composerInput') composerInput?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('historyList') historyList?: ElementRef<HTMLDivElement>;

  private historyService = inject(CommandHistoryService);
  private destroyRef = inject(DestroyRef);
  private aiService = inject(AiService);
  private store = inject(WarpTerminalStore);

  readonly isAiConfigured = this.aiService.isConfigured;
  readonly currentCwd = this.store.currentCwd;

  readonly ArrowRight = ArrowRight;
  readonly Sparkles = Sparkles;
  readonly Search = Search;
  readonly History = History;

  readonly mode = signal<'command' | 'ai'>('command');
  value = '';

  // History popup state
  readonly showHistoryPopup = signal(false);
  readonly historyFilter = signal('');
  readonly selectedHistoryIndex = signal(0);
  readonly displayLimit = signal(50);

  // Remote search state
  private readonly searchSubject = new Subject<string>();
  readonly remoteSearchResults = signal<string[]>([]);
  readonly isSearching = signal(false);

  readonly filteredHistory = computed(() => {
    const filter = this.historyFilter().toLowerCase();
    const remoteResults = this.remoteSearchResults();

    // If we have remote search results for a filter, use those
    if (filter && remoteResults.length > 0) {
      return remoteResults.slice().reverse(); // Reverse: newest at bottom
    }

    // Otherwise use local history
    const limit = this.displayLimit();
    const all = this.historyService.getAll();

    let filtered: string[];
    if (!filter) {
      filtered = all.slice(0, limit);
    } else {
      filtered = all.filter((cmd) => cmd.toLowerCase().includes(filter)).slice(0, limit);
    }

    // Reverse so newest is at bottom, oldest at top
    return filtered.reverse();
  });

  // Check if more history is available to load
  readonly hasMoreHistory = computed(() => {
    const filter = this.historyFilter().toLowerCase();
    const limit = this.displayLimit();
    const all = this.historyService.getAll();

    if (!filter) {
      return all.length > limit;
    }
    return all.filter((cmd) => cmd.toLowerCase().includes(filter)).length > limit;
  });

  private historyIndex: number | null = null;
  private draftValue = '';

  constructor() {
    // Set up debounced remote search
    this.searchSubject
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((query) => {
          if (!query.trim()) {
            this.isSearching.set(false);
            return from([[]]);
          }
          this.isSearching.set(true);
          return from(this.historyService.searchRemoteHistory(query));
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((results) => {
        this.remoteSearchResults.set(results);
        this.isSearching.set(false);
        // Reset selection to bottom when results arrive
        if (results.length > 0) {
          this.selectedHistoryIndex.set(results.length - 1);
          setTimeout(() => this.scrollToBottom(), 0);
        }
      });
  }

  toggleMode(): void {
    // Don't allow switching to AI mode if not configured
    if (this.mode() === 'command' && !this.isAiConfigured()) {
      return;
    }
    this.mode.update((current) => (current === 'command' ? 'ai' : 'command'));
  }

  onInputChange(): void {
    // Auto-activate AI mode when typing # at start (if configured)
    if (this.value.startsWith('#') && this.mode() === 'command' && this.isAiConfigured()) {
      this.mode.set('ai');
      // Remove the # prefix since we're now in AI mode
      this.value = this.value.slice(1);
    }
  }

  onKeyDown(event: KeyboardEvent): void {
    const input = this.composerInput?.nativeElement;
    if (!input) return;

    // Enter: Send command or select history item
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (this.showHistoryPopup()) {
        this.selectHistoryItem();
      } else {
        this.send();
      }
      return;
    }

    // Escape: Close popup
    if (event.key === 'Escape' && this.showHistoryPopup()) {
      event.preventDefault();
      this.closeHistoryPopup();
      return;
    }

    // Arrow Up: Open popup or navigate within it
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!this.showHistoryPopup()) {
        this.openHistoryPopup();
      } else {
        this.navigatePopup(-1);
      }
      return;
    }

    // Arrow Down: Navigate in popup or close
    if (event.key === 'ArrowDown' && this.showHistoryPopup()) {
      event.preventDefault();
      this.navigatePopup(1);
      return;
    }
  }

  send(): void {
    const text = this.value.trim();
    if (!text) return;

    // Add to shared history service
    this.historyService.add(text, 'user');

    this.historyIndex = null;
    this.draftValue = '';
    this.submit.emit({ text, mode: this.mode() });
    this.value = '';
    this.composerInput?.nativeElement.focus();
  }

  private navigateHistory(direction: -1 | 1): void {
    const history = this.historyService.getAll();
    if (history.length === 0) return;

    if (this.historyIndex === null) {
      this.draftValue = this.value;
      this.historyIndex = 0;
    } else {
      this.historyIndex = Math.min(
        history.length,
        Math.max(0, this.historyIndex + direction)
      );
    }

    if (this.historyIndex >= history.length) {
      this.historyIndex = null;
      this.value = this.draftValue;
      return;
    }

    this.value = history[this.historyIndex];
    setTimeout(() => {
      const input = this.composerInput?.nativeElement;
      if (input) {
        input.selectionStart = input.selectionEnd = input.value.length;
      }
    }, 0);
  }

  openHistoryPopup(): void {
    this.historyFilter.set('');
    this.displayLimit.set(50);
    this.showHistoryPopup.set(true);
    // Start selection at bottom (newest command)
    const items = this.filteredHistory();
    this.selectedHistoryIndex.set(Math.max(0, items.length - 1));
    // Scroll to bottom after DOM updates
    setTimeout(() => this.scrollToBottom(), 0);
  }

  closeHistoryPopup(): void {
    this.showHistoryPopup.set(false);
    this.displayLimit.set(50); // Reset limit
    this.composerInput?.nativeElement.focus();
  }

  navigatePopup(direction: 1 | -1): void {
    const items = this.filteredHistory();
    if (items.length === 0) return;

    const currentIndex = this.selectedHistoryIndex();

    // Arrow Up (-1) moves towards top (older), Arrow Down (1) moves towards bottom (newer)
    const newIndex = currentIndex + direction;

    // At top and going up - try to load more
    if (newIndex < 0) {
      if (this.hasMoreHistory()) {
        const previousLength = items.length;
        this.loadMoreHistory();
        // Calculate how many new items were added at the top
        const newItems = this.filteredHistory();
        const addedCount = newItems.length - previousLength;
        // Position at the last newly loaded item (just above previous top)
        this.selectedHistoryIndex.set(Math.max(0, addedCount - 1));
        this.scrollSelectedIntoView();
      }
      // Don't wrap - stay at top
      return;
    }

    // At bottom and going down - don't wrap, stay at bottom
    if (newIndex >= items.length) {
      return;
    }

    this.selectedHistoryIndex.set(newIndex);
    this.scrollSelectedIntoView();
  }

  private loadMoreHistory(): void {
    this.displayLimit.update((limit) => limit + 50);
  }

  private scrollToBottom(): void {
    const list = this.historyList?.nativeElement;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }

  private scrollSelectedIntoView(): void {
    setTimeout(() => {
      const list = this.historyList?.nativeElement;
      if (!list) return;

      const selectedItem = list.querySelector('.history-item.selected') as HTMLElement;
      if (selectedItem) {
        selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }, 0);
  }

  selectHistoryItem(index?: number): void {
    const items = this.filteredHistory();
    const idx = index ?? this.selectedHistoryIndex();
    if (idx >= 0 && idx < items.length) {
      this.value = items[idx];
      this.closeHistoryPopup();
    }
  }

  onHistoryFilterInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.historyFilter.set(value);
    this.displayLimit.set(50); // Reset limit on filter change

    // Clear remote results when filter changes (will be updated by subscription)
    this.remoteSearchResults.set([]);

    // Trigger remote search
    this.searchSubject.next(value);

    // Set selection to bottom (newest matching command) and scroll
    setTimeout(() => {
      const items = this.filteredHistory();
      this.selectedHistoryIndex.set(Math.max(0, items.length - 1));
      this.scrollToBottom();
    }, 0);
  }
}
