import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  OnDestroy,
  QueryList,
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
} from 'lucide-angular';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { TerminalState, DockedTerminal, LayoutMode } from '../../../state/terminal.state';
import { TerminalService } from '../../../core/services/terminal.service';
import { WarpTerminalViewComponent } from '../../../features/warp-terminal/warp-terminal-view/warp-terminal-view.component';

@Component({
  selector: 'app-terminal-workspace',
  templateUrl: './terminal-workspace.component.html',
  styleUrl: './terminal-workspace.component.css',
  imports: [CommonModule, LucideAngularModule, WarpTerminalViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TerminalWorkspaceComponent implements AfterViewInit, OnDestroy {
  @ViewChildren('terminalHost') terminalHosts!: QueryList<ElementRef<HTMLDivElement>>;

  readonly terminalState = inject(TerminalState);
  private readonly terminalService = inject(TerminalService);

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
      const currentSlotAssignments = slots.map(s => s.terminalId ?? '');

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

    slots.forEach((slot, index) => {
      if (!slot.terminalId || !hosts[index]) return;

      const terminal = this.terminalState.getTerminalById(slot.terminalId);
      if (!terminal) return;

      // Always attach xterm regardless of displayMode - it needs to receive PTY output
      // In warp mode, xterm is hidden via CSS but still captures output
      const hostElement = hosts[index].nativeElement;

      // Check if already attached to this host
      if (this.attachedTerminals.get(slot.terminalId) === index) {
        return;
      }

      // Re-attach terminal to new host
      this.attachTerminalToElement(terminal, hostElement, index);
      this.attachedTerminals.set(slot.terminalId, index);
    });
  }

  private attachTerminalToElement(
    dockedTerminal: DockedTerminal,
    element: HTMLElement,
    slotIndex: number
  ): void {
    // First, clean up any OTHER terminal that was attached to this slot
    // This prevents orphaned terminal instances when switching terminals
    for (const [termId, attachedSlot] of this.attachedTerminals.entries()) {
      if (attachedSlot === slotIndex && termId !== dockedTerminal.id) {
        const otherTerminal = this.terminalState.getTerminalById(termId);
        if (otherTerminal?.terminal) {
          // Serialize buffer state before disposing
          try {
            const buffer = otherTerminal.terminal.buffer.active;
            let content = '';
            for (let i = 0; i < buffer.length; i++) {
              const line = buffer.getLine(i);
              if (line) {
                content += line.translateToString(true) + '\r\n';
              }
            }
            otherTerminal.serializedState = content;
          } catch {
            // Ignore serialization errors
          }
          otherTerminal.terminal.dispose();
          otherTerminal.terminal = undefined;
          otherTerminal.fitAddon = undefined;
          otherTerminal.searchAddon = undefined;
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

      // Terminal exists but needs to move to new container
      if (terminalElement && currentParent) {
        element.innerHTML = '';
        element.appendChild(terminalElement);
        dockedTerminal.fitAddon?.fit();

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

      // Terminal reference exists but DOM is broken - dispose and recreate
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
}
