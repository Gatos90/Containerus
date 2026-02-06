import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  HostListener,
  inject,
  OnDestroy,
  QueryList,
  signal,
  ViewChildren,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  LucideAngularModule,
  Square,
  Columns2,
  Grid2x2,
  X,
  ChevronUp,
  ChevronDown,
  Rows2,
  Maximize2,
  Minimize2,
  Sparkles,
  FolderOpen,
  Plus,
  Terminal as TerminalIcon,
  Box,
  Keyboard,
  ChevronRight,
  Server,
} from 'lucide-angular';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { TerminalState, DockedTerminal, DockedFileBrowser, LayoutMode, DEFAULT_TERMINAL_OPTIONS } from '../../../state/terminal.state';
import { TerminalService } from '../../../core/services/terminal.service';
import { SystemState } from '../../../state/system.state';
import { ContainerState } from '../../../state/container.state';
import { ToastState } from '../../../state/toast.state';
import { Container, getDisplayName, isRunning } from '../../../core/models/container.model';
import { WarpTerminalViewComponent } from '../../../features/warp-terminal/warp-terminal-view/warp-terminal-view.component';
import { FileBrowserViewComponent } from '../../../features/file-browser/file-browser-view/file-browser-view.component';

@Component({
  selector: 'app-terminal-workspace',
  templateUrl: './terminal-workspace.component.html',
  styleUrl: './terminal-workspace.component.css',
  imports: [CommonModule, LucideAngularModule, WarpTerminalViewComponent, FileBrowserViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TerminalWorkspaceComponent implements AfterViewInit, OnDestroy {
  @ViewChildren('terminalHost') terminalHosts!: QueryList<ElementRef<HTMLDivElement>>;

  readonly terminalState = inject(TerminalState);
  readonly systemState = inject(SystemState);
  readonly containerState = inject(ContainerState);
  private readonly terminalService = inject(TerminalService);
  private readonly toastState = inject(ToastState);

  readonly Square = Square;
  readonly Columns2 = Columns2;
  readonly Rows2 = Rows2;
  readonly Grid2x2 = Grid2x2;
  readonly X = X;
  readonly ChevronUp = ChevronUp;
  readonly ChevronDown = ChevronDown;
  readonly Maximize2 = Maximize2;
  readonly Minimize2 = Minimize2;
  readonly Sparkles = Sparkles;
  readonly FolderOpen = FolderOpen;
  readonly Plus = Plus;
  readonly TerminalIcon = TerminalIcon;
  readonly Box = Box;
  readonly Keyboard = Keyboard;
  readonly ChevronRight = ChevronRight;
  readonly Server = Server;
  readonly getDisplayName = getDisplayName;

  showNewMenu = signal(false);
  showShortcuts = signal(false);
  expandedSlotSystemId = signal<string | null>(null);
  dragTabIndex = signal<number | null>(null);
  dragTabType = signal<'terminal' | 'file-browser' | null>(null);
  dropTargetIndex = signal<number | null>(null);
  slotDropTarget = signal<number | null>(null);

  private resizeObservers = new Map<number, ResizeObserver>();
  private attachedTerminals = new Map<string, number>();
  private viewInitialized = false;
  private lastTerminalIds = new Set<string>();
  private lastSlotAssignments: string[] = [];

  constructor() {
    // Use effect to reactively re-attach terminals when STRUCTURAL changes occur
    // (terminals added/removed, slot assignments changed, dock minimized/expanded)
    // Does NOT trigger on property changes like displayMode toggle
    effect(() => {
      const slots = this.terminalState.slots();
      const terminals = this.terminalState.dockedTerminals();
      const isMinimized = this.terminalState.isDockMinimized();

      // Extract just the IDs and slot assignments to detect structural changes
      const currentIds = new Set(terminals.map(t => t.id));
      const currentSlotAssignments = slots.map(s => `${s.contentType}:${s.contentId ?? ''}`);

      // Detect structural changes only
      const terminalCountChanged = currentIds.size !== this.lastTerminalIds.size;
      const terminalsAddedOrRemoved = [...currentIds].some(id => !this.lastTerminalIds.has(id)) ||
                                       [...this.lastTerminalIds].some(id => !currentIds.has(id));
      const slotAssignmentsChanged = currentSlotAssignments.length !== this.lastSlotAssignments.length ||
                                      currentSlotAssignments.some((id, i) => id !== this.lastSlotAssignments[i]);

      const structuralChange = terminalCountChanged || terminalsAddedOrRemoved || slotAssignmentsChanged;

      // Update tracking
      this.lastTerminalIds = currentIds;
      this.lastSlotAssignments = currentSlotAssignments;

      // Only run after view is initialized, when NOT minimized, and on structural changes
      if (this.viewInitialized && !isMinimized && structuralChange) {
        // Clear stale attachment tracking for removed terminals
        for (const id of this.attachedTerminals.keys()) {
          if (!currentIds.has(id)) {
            this.attachedTerminals.delete(id);
          }
        }
        // Schedule attachment after Angular's change detection
        setTimeout(() => this.attachTerminalsToHosts(), 0);
      }
    });
  }

  ngAfterViewInit(): void {
    this.viewInitialized = true;
    this.attachTerminalsToHosts();

    // Watch for changes in terminal hosts (e.g., layout changes)
    this.terminalHosts.changes.subscribe(() => {
      this.attachTerminalsToHosts();
    });
  }

  ngOnDestroy(): void {
    this.resizeObservers.forEach(observer => observer.disconnect());
    this.resizeObservers.clear();
  }

  private attachTerminalsToHosts(): void {
    const hosts = this.terminalHosts.toArray();
    const slots = this.terminalState.slots();

    // Build a map of slotIndex -> host element using data attribute
    // (indices may not match when file browsers occupy some slots)
    const hostMap = new Map<number, ElementRef<HTMLDivElement>>();
    for (const host of hosts) {
      const slotAttr = host.nativeElement.getAttribute('data-slot-index');
      if (slotAttr !== null) {
        hostMap.set(parseInt(slotAttr, 10), host);
      }
    }

    slots.forEach((slot, index) => {
      if (slot.contentType !== 'terminal' || !slot.contentId) return;

      const host = hostMap.get(index);
      if (!host) return;

      const terminal = this.terminalState.getTerminalById(slot.contentId);
      if (!terminal) return;

      const hostElement = host.nativeElement;

      // Check if already attached to this host AND the terminal element is actually in it
      // (Angular may have recreated the host div when switching between content types)
      if (this.attachedTerminals.get(slot.contentId) === index) {
        const termEl = terminal.terminal?.element;
        if (termEl && hostElement.contains(termEl)) {
          return;
        }
      }

      // Re-attach terminal to new host
      this.attachTerminalToElement(terminal, hostElement, index);
      this.attachedTerminals.set(slot.contentId, index);
    });
  }

  private attachTerminalToElement(
    dockedTerminal: DockedTerminal,
    element: HTMLElement,
    slotIndex: number
  ): void {
    // Detach any OTHER terminal from this slot (don't dispose — keep alive for reattachment)
    for (const [termId, attachedSlot] of this.attachedTerminals.entries()) {
      if (attachedSlot === slotIndex && termId !== dockedTerminal.id) {
        const otherTerminal = this.terminalState.getTerminalById(termId);
        if (otherTerminal?.terminal?.element?.parentElement) {
          otherTerminal.terminal.element.remove();
        }
        this.attachedTerminals.delete(termId);
        break;
      }
    }

    // If terminal already exists, check if it needs to move to a new container
    if (dockedTerminal.terminal) {
      const terminalElement = dockedTerminal.terminal.element;
      const currentParent = terminalElement?.parentElement;

      // If terminal is already in the correct container, just refit and return
      if (currentParent === element) {
        dockedTerminal.fitAddon?.fit();
        return;
      }

      // Terminal exists but needs to move to new container (or was detached)
      if (terminalElement) {
        element.innerHTML = '';
        element.appendChild(terminalElement);
        dockedTerminal.fitAddon?.fit();

        // Resize PTY to match after refit
        this.terminalService.resize(
          dockedTerminal.session.id,
          dockedTerminal.terminal!.cols,
          dockedTerminal.terminal!.rows
        );

        // Focus the terminal
        dockedTerminal.terminal!.focus();

        // Update resize observer for new container
        if (this.resizeObservers.has(slotIndex)) {
          this.resizeObservers.get(slotIndex)?.disconnect();
        }
        const observer = new ResizeObserver(() => {
          dockedTerminal.fitAddon?.fit();
          this.terminalService.resize(
            dockedTerminal.session.id,
            dockedTerminal.terminal!.cols,
            dockedTerminal.terminal!.rows
          );
        });
        observer.observe(element);
        this.resizeObservers.set(slotIndex, observer);
        return;
      }

      // Terminal reference exists but no DOM element - dispose and recreate
      dockedTerminal.terminal.dispose();
      dockedTerminal.terminal = undefined;
      dockedTerminal.fitAddon = undefined;
      dockedTerminal.searchAddon = undefined;
    }

    // Create new terminal
    element.innerHTML = '';

    const terminal = new Terminal(dockedTerminal.terminalOptions);
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(new WebLinksAddon());

    // Open in new container - fresh event handlers!
    terminal.open(element);

    // Restore scroll history from serialized state
    if (dockedTerminal.serializedState) {
      terminal.write(dockedTerminal.serializedState);
    }

    // Connect to existing session - send terminal input to backend
    terminal.onData((data) => {
      this.terminalService.sendInput(dockedTerminal.session.id, data);
    });

    // Listen for output from backend session
    this.terminalService.onOutput(dockedTerminal.session.id, (data) => {
      terminal.write(data);
    });

    // Resize to fit new container
    fitAddon.fit();

    // Resize the PTY session to match terminal dimensions
    this.terminalService.resize(
      dockedTerminal.session.id,
      terminal.cols,
      terminal.rows
    );

    // Focus the terminal
    terminal.focus();

    // Store references in the docked terminal
    dockedTerminal.terminal = terminal;
    dockedTerminal.fitAddon = fitAddon;
    dockedTerminal.searchAddon = searchAddon;

    // Setup resize observer
    if (this.resizeObservers.has(slotIndex)) {
      this.resizeObservers.get(slotIndex)?.disconnect();
    }

    const observer = new ResizeObserver(() => {
      fitAddon.fit();
      // Also resize PTY on terminal resize
      this.terminalService.resize(
        dockedTerminal.session.id,
        terminal.cols,
        terminal.rows
      );
    });
    observer.observe(element);
    this.resizeObservers.set(slotIndex, observer);
  }

  getTerminalForSlot(index: number): DockedTerminal | null {
    return this.terminalState.getTerminalForSlot(index);
  }

  getFileBrowserForSlot(index: number): DockedFileBrowser | null {
    return this.terminalState.getFileBrowserForSlot(index);
  }

  isFileBrowserInSlot(id: string): boolean {
    return this.terminalState.isFileBrowserInSlot(id);
  }

  setLayout(mode: LayoutMode): void {
    this.terminalState.setLayoutMode(mode);
    // Need to re-attach terminals after layout change
    setTimeout(() => this.attachTerminalsToHosts(), 0);
  }

  setActiveSlot(index: number): void {
    this.terminalState.setActiveSlot(index);
    // Focus the terminal in this slot
    const dockedTerminal = this.terminalState.getTerminalForSlot(index);
    if (dockedTerminal?.terminal) {
      dockedTerminal.terminal.focus();
    }
  }

  focusTerminal(terminalId: string): void {
    this.terminalState.focusTerminal(terminalId);
    setTimeout(() => {
      this.attachTerminalsToHosts();
      // Focus will be handled by attachTerminalToElement via focusTerminalRobustly
    }, 0);
  }

  async closeTerminal(terminalId: string, event: Event): Promise<void> {
    event.stopPropagation();
    this.attachedTerminals.delete(terminalId);
    await this.terminalState.removeTerminal(terminalId);
  }

  toggleDockMinimized(): void {
    this.terminalState.toggleDockMinimized();
  }

  toggleDockFullscreen(): void {
    this.terminalState.toggleDockFullscreen();
  }

  toggleTerminalMode(terminalId: string | undefined): void {
    if (!terminalId) return;
    this.terminalState.toggleTerminalDisplayMode(terminalId);
    // DON'T clear attachedTerminals or call attachTerminalsToHosts!
    // The terminal stays attached and continues receiving PTY output.
    // CSS handles showing/hiding xterm vs warp view.
  }

  isTerminalInSlot(terminalId: string): boolean {
    return this.terminalState.isTerminalInSlot(terminalId);
  }

  trackByTerminalId(_: number, terminal: DockedTerminal): string {
    return terminal.id;
  }

  trackByIndex(index: number): number {
    return index;
  }

  onTerminalHostClick(slotIndex: number, event: Event): void {
    event.stopPropagation();
    const dockedTerminal = this.terminalState.getTerminalForSlot(slotIndex);
    if (dockedTerminal?.terminal) {
      dockedTerminal.terminal.focus();
    }
  }

  // --- File Browser Dock ---

  openFileBrowser(fb: DockedFileBrowser): void {
    this.terminalState.focusFileBrowser(fb.id);
  }

  closeFileBrowser(id: string, event: Event): void {
    event.stopPropagation();
    this.terminalState.removeFileBrowser(id);
  }

  trackByFileBrowserId(_: number, fb: DockedFileBrowser): string {
    return fb.id;
  }

  // --- New Terminal from dock ---

  toggleNewMenu(): void {
    this.showNewMenu.update(v => !v);
  }

  toggleSlotSystem(systemId: string): void {
    this.expandedSlotSystemId.update(id => id === systemId ? null : systemId);
  }

  toggleShortcuts(): void {
    this.showShortcuts.update(v => !v);
  }

  getRunningContainers(systemId: string): Container[] {
    const bySystem = this.containerState.containersBySystem();
    return (bySystem[systemId] ?? []).filter(isRunning);
  }

  async openNewTerminal(systemId: string, targetSlot?: number): Promise<void> {
    this.showNewMenu.set(false);
    const system = this.systemState.systems().find(s => s.id === systemId);
    if (!system) return;

    try {
      const session = await this.terminalService.startSession(systemId);
      const id = this.terminalState.generateTerminalId();
      this.terminalState.addTerminal({
        id,
        session,
        systemId,
        systemName: system.name,
        serializedState: '',
        terminalOptions: DEFAULT_TERMINAL_OPTIONS,
      }, targetSlot);
    } catch (err: any) {
      this.toastState.error(`Failed to open terminal: ${err?.message ?? err}`);
    }
  }

  async openContainerTerminal(systemId: string, container: Container, targetSlot?: number): Promise<void> {
    this.showNewMenu.set(false);
    const system = this.systemState.systems().find(s => s.id === systemId);
    if (!system) return;

    try {
      const session = await this.terminalService.startSession(systemId, container.id);
      const id = this.terminalState.generateTerminalId();
      this.terminalState.addTerminal({
        id,
        session,
        systemId,
        systemName: system.name,
        containerName: getDisplayName(container),
        serializedState: '',
        terminalOptions: DEFAULT_TERMINAL_OPTIONS,
      }, targetSlot);
    } catch (err: any) {
      this.toastState.error(`Failed to open container terminal: ${err?.message ?? err}`);
    }
  }

  openNewFileBrowser(systemId: string, targetSlot?: number, containerId?: string, containerName?: string, runtime?: string): void {
    this.showNewMenu.set(false);
    const system = this.systemState.systems().find(s => s.id === systemId);
    if (!system) return;

    const fb: DockedFileBrowser = {
      id: this.terminalState.generateFileBrowserId(),
      systemId,
      systemName: system.name,
      currentPath: '/',
    };
    if (containerId) fb.containerId = containerId;
    if (containerName) fb.containerName = containerName;
    if (runtime) fb.runtime = runtime as any;
    this.terminalState.addFileBrowser(fb, targetSlot);
  }

  // --- Slot index for tab badges ---

  getSlotIndex(terminalId: string): number {
    return this.terminalState.slots().findIndex(
      s => s.contentType === 'terminal' && s.contentId === terminalId
    );
  }

  getFileBrowserSlotIndex(fbId: string): number {
    return this.terminalState.slots().findIndex(
      s => s.contentType === 'file-browser' && s.contentId === fbId
    );
  }

  isSplitView(): boolean {
    return this.terminalState.layoutMode() !== 'single';
  }

  // --- Drag and drop for dock tabs ---

  private dragItemId: string | null = null;

  onTabDragStart(index: number, type: 'terminal' | 'file-browser', itemId: string): void {
    this.dragTabIndex.set(index);
    this.dragTabType.set(type);
    this.dragItemId = itemId;
  }

  onTabDragOver(event: DragEvent, index: number, type: 'terminal' | 'file-browser'): void {
    if (this.dragTabType() !== type) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    this.dropTargetIndex.set(index);
  }

  onTabDragLeave(event: DragEvent): void {
    // Only clear if leaving the tab element, not entering a child
    const related = event.relatedTarget as HTMLElement | null;
    const current = event.currentTarget as HTMLElement;
    if (related && current.contains(related)) return;
    this.dropTargetIndex.set(null);
  }

  onTabDrop(event: DragEvent, index: number, type: 'terminal' | 'file-browser'): void {
    event.preventDefault();
    const fromIndex = this.dragTabIndex();
    if (fromIndex === null || this.dragTabType() !== type || fromIndex === index) {
      this.resetDragState();
      return;
    }
    if (type === 'terminal') {
      this.terminalState.reorderTerminals(fromIndex, index);
    } else {
      this.terminalState.reorderFileBrowsers(fromIndex, index);
    }
    this.resetDragState();
  }

  onTabDragEnd(): void {
    this.resetDragState();
  }

  // --- Drag tabs onto grid slots ---

  onSlotDragOver(event: DragEvent, slotIndex: number): void {
    // Only allow drop when dragging a dock tab
    if (this.dragTabType() === null) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    this.slotDropTarget.set(slotIndex);
  }

  onSlotDragLeave(event: DragEvent): void {
    const related = event.relatedTarget as HTMLElement | null;
    const current = event.currentTarget as HTMLElement;
    if (related && current.contains(related)) return;
    this.slotDropTarget.set(null);
  }

  onSlotDrop(event: DragEvent, slotIndex: number): void {
    event.preventDefault();
    const type = this.dragTabType();
    const itemId = this.dragItemId;

    if (!type || !itemId) {
      this.resetDragState();
      return;
    }

    if (type === 'terminal') {
      this.terminalState.assignTerminalToSlot(itemId, slotIndex);
    } else {
      this.terminalState.assignFileBrowserToSlot(itemId, slotIndex);
    }
    this.terminalState.setActiveSlot(slotIndex);
    this.resetDragState();
  }

  private resetDragState(): void {
    this.dragTabIndex.set(null);
    this.dragTabType.set(null);
    this.dropTargetIndex.set(null);
    this.slotDropTarget.set(null);
    this.dragItemId = null;
  }

  // --- Keyboard shortcuts ---

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (!this.terminalState.isDockVisible()) return;

    // Ctrl+Shift+F — toggle fullscreen
    if (event.ctrlKey && event.shiftKey && event.key === 'F') {
      event.preventDefault();
      this.toggleDockFullscreen();
      return;
    }

    // Ctrl+Shift+M — toggle minimize
    if (event.ctrlKey && event.shiftKey && event.key === 'M') {
      event.preventDefault();
      this.toggleDockMinimized();
      return;
    }

    // Ctrl+1..4 — switch dock tabs by index
    if (event.ctrlKey && !event.shiftKey && !event.metaKey) {
      const num = parseInt(event.key, 10);
      if (num >= 1 && num <= 9) {
        const allItems = [
          ...this.terminalState.dockedTerminals().map(t => ({ type: 'terminal' as const, id: t.id })),
          ...this.terminalState.dockedFileBrowsers().map(f => ({ type: 'file-browser' as const, id: f.id })),
        ];
        const idx = num - 1;
        if (idx < allItems.length) {
          event.preventDefault();
          const item = allItems[idx];
          if (item.type === 'terminal') {
            this.focusTerminal(item.id);
          } else {
            this.terminalState.focusFileBrowser(item.id);
          }
        }
      }
    }
  }
}
