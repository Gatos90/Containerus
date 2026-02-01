import { CommonModule } from '@angular/common';
import { Component, HostListener, ViewChild, computed, effect, inject, input, OnInit, OnDestroy } from '@angular/core';
import { LucideAngularModule, ArrowDownToLine, Search, Sparkles, Terminal, Trash2 } from 'lucide-angular';
import { WarpTerminalStore } from '../state/warp-terminal-store.service';
import { WarpTerminalStateManager } from '../state/warp-terminal-state-manager.service';
import { MockTerminalBackend } from '../state/mock-terminal-backend.service';
import { AgentBackendService } from '../state/agent-backend.service';
import type { BlockId, BlockSource, SelectionState } from '../models/terminal-block.model';
import { BlockListComponent } from '../components/block-list/block-list.component';
import { ComposerBarComponent } from '../components/composer-bar/composer-bar.component';
import { SearchOverlayComponent } from '../components/search-overlay/search-overlay.component';

@Component({
  selector: 'app-warp-terminal-view',
  standalone: true,
  imports: [
    CommonModule,
    LucideAngularModule,
    BlockListComponent,
    ComposerBarComponent,
    SearchOverlayComponent,
  ],
  templateUrl: './warp-terminal-view.component.html',
  styleUrl: './warp-terminal-view.component.css',
})
export class WarpTerminalViewComponent implements OnInit, OnDestroy {
  readonly store = inject(WarpTerminalStore);
  private readonly stateManager = inject(WarpTerminalStateManager);
  private readonly mockBackend = inject(MockTerminalBackend);
  private readonly agentBackend = inject(AgentBackendService);

  // Input for the real terminal session ID from the parent terminal-view
  // When provided, AI commands will execute via the SSH/PTY session
  // When null, falls back to local subprocess execution
  terminalSessionId = input<string | null>(null);

  // Input for container ID when terminal is opened directly inside a container
  // When provided, the agent context will be set to container environment (Linux shell)
  containerId = input<string | null>(null);

  // Input for system ID to enable per-system state management
  // When switching systems, state is saved and restored automatically
  systemId = input<string | null>(null);

  constructor() {
    // Watch systemId changes and switch state accordingly
    effect(() => {
      const newSystemId = this.systemId();
      if (newSystemId) {
        this.stateManager.switchToSystem(newSystemId);
      }
    });
  }

  readonly ArrowDownToLine = ArrowDownToLine;
  readonly Search = Search;
  readonly Sparkles = Sparkles;
  readonly Terminal = Terminal;
  readonly Trash2 = Trash2;

  readonly blocks = this.store.blocks;
  readonly followMode = this.store.isFollowing;
  readonly selection = this.store.selection;
  readonly searchOpen = this.store.searchIsOpen;
  readonly searchQuery = this.store.searchText;
  readonly searchResults = this.store.searchResults;
  readonly isAiThinking = this.store.isAiThinking;
  readonly aiError = this.store.aiError;

  readonly highlightMap = computed(() => {
    const map = new Map<BlockId, Set<number>>();
    for (const result of this.searchResults()) {
      if (result.kind !== 'output' || result.lineIndex === undefined) continue;
      const set = map.get(result.blockId) ?? new Set<number>();
      set.add(result.lineIndex);
      map.set(result.blockId, set);
    }
    return map;
  });

  @ViewChild(BlockListComponent) blockList?: BlockListComponent;

  ngOnInit(): void {
    // Use the real terminal session ID if provided, otherwise fall back to synthetic ID
    const sessionId = this.terminalSessionId();
    const containerId = this.containerId();
    if (sessionId) {
      console.log('[WarpTerminalView] Using real terminal session:', sessionId);
      if (containerId) {
        console.log('[WarpTerminalView] Container context:', containerId);
      }
      this.agentBackend.initialize(sessionId, containerId).catch((error) => {
        console.error('[WarpTerminalView] Failed to initialize agent backend:', error);
      });
    } else {
      // Fallback for standalone testing - commands will run locally
      console.warn('[WarpTerminalView] No terminal session ID provided, AI commands will run locally');
      const fallbackId = `warp-terminal-${Date.now()}`;
      this.agentBackend.initialize(fallbackId, containerId).catch((error) => {
        console.error('[WarpTerminalView] Failed to initialize agent backend:', error);
      });
    }
  }

  ngOnDestroy(): void {
    this.agentBackend.destroy();
  }

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      this.toggleSearch(true);
      return;
    }

    if (event.key === 'Escape' && this.searchOpen()) {
      this.toggleSearch(false);
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
      const selection = this.selection();
      if (selection.kind === 'block') {
        event.preventDefault();
        this.copyBlockOutput(selection.blockId);
      }
    }

    // Ctrl+L to clear terminal
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      this.clearTerminal();
    }
  }

  submitCommand(payload: { text: string; mode: 'command' | 'ai' }): void {
    const text = payload.text.trim();
    if (!text) return;
    const source: BlockSource = payload.mode === 'ai' ? 'aiExecuted' : 'user';
    this.store.dispatch({
      type: 'UserSubmittedCommand',
      text,
      source,
    });
    this.store.dispatch({ type: 'UserToggledFollowMode', on: true });
  }

  selectBlock(blockId: BlockId | null): void {
    this.store.dispatch({ type: 'UserSelectedBlock', blockId });
  }

  setSelection(selection: SelectionState): void {
    this.store.setSelection(selection);
  }

  toggleCollapse(blockId: BlockId): void {
    this.store.toggleCollapse(blockId);
  }

  toggleSearch(open: boolean): void {
    this.store.dispatch({ type: 'UserToggledSearch', open });
  }

  updateSearch(query: string): void {
    this.store.setSearchQuery(query);
  }

  scrollToLatest(): void {
    this.store.dispatch({ type: 'UserToggledFollowMode', on: true });
    this.blockList?.scrollToBottom(true);
  }

  handleUserScroll(): void {
    this.store.dispatch({ type: 'UserScrolled' });
  }

  selectSearchResult(result: { blockId: BlockId; lineIndex?: number }): void {
    this.selectBlock(result.blockId);
    this.blockList?.scrollToBlock(result.blockId);
  }

  copyBlockCommand(blockId: BlockId): void {
    const block = this.blocks().find((item) => item.id === blockId);
    if (!block) return;
    navigator.clipboard.writeText(block.commandText);
  }

  copyBlockOutput(blockId: BlockId): void {
    const block = this.blocks().find((item) => item.id === blockId);
    if (!block) return;
    navigator.clipboard.writeText(block.renderState.getAllText());
  }

  rerunBlock(blockId: BlockId): void {
    const block = this.blocks().find((item) => item.id === blockId);
    if (!block) return;
    this.submitCommand({ text: block.commandText, mode: 'command' });
  }

  toggleFollowMode(): void {
    this.store.dispatch({ type: 'UserToggledFollowMode', on: !this.followMode() });
  }

  dismissAiError(): void {
    this.store.clearAiError();
  }

  cancelAiQuery(): void {
    this.agentBackend.cancelCurrentQuery();
  }

  clearTerminal(): void {
    this.store.clearTerminal();
  }
}
