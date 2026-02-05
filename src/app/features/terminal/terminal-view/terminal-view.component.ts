import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  HostBinding,
  inject,
  OnDestroy,
  OnInit,
  signal,
  ViewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, X, Maximize2, Minimize2, Command, Ship, Container, Apple, Search, ChevronUp, ChevronDown, PanelBottomOpen, Sparkles } from 'lucide-angular';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { SerializeAddon } from '@xterm/addon-serialize';
import { TerminalService, TerminalSession } from '../../../core/services/terminal.service';
import { SystemState } from '../../../state/system.state';
import { TerminalState, DockedTerminal, DEFAULT_TERMINAL_OPTIONS } from '../../../state/terminal.state';
import { CommandPaletteComponent } from '../../../shared/components/command-palette/command-palette.component';
import { VariableInputModalComponent } from '../../../shared/components/variable-input-modal/variable-input-modal.component';
import { CommandTemplate, parseVariables } from '../../../core/models/command-template.model';
import { ContainerRuntime } from '../../../core/models/container.model';
import { WarpTerminalViewComponent } from '../../warp-terminal/warp-terminal-view/warp-terminal-view.component';
import { CommandHistoryService } from '../../warp-terminal/state/command-history.service';
import { TerminalEventBus } from '../../warp-terminal/state/warp-terminal.bus';

@Component({
  selector: 'app-terminal-view',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, CommandPaletteComponent, VariableInputModalComponent, WarpTerminalViewComponent],
  templateUrl: './terminal-view.component.html',
  styleUrl: './terminal-view.component.css',
})
export class TerminalViewComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('terminalContainer') terminalContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private terminalService = inject(TerminalService);
  private systemState = inject(SystemState);
  private terminalState = inject(TerminalState);
  private historyService = inject(CommandHistoryService);
  private eventBus = inject(TerminalEventBus);

  readonly X = X;
  readonly Maximize2 = Maximize2;
  readonly Minimize2 = Minimize2;
  readonly Command = Command;
  readonly Ship = Ship;
  readonly Container = Container;
  readonly Apple = Apple;
  readonly Search = Search;
  readonly ChevronUp = ChevronUp;
  readonly ChevronDown = ChevronDown;
  readonly PanelBottomOpen = PanelBottomOpen;
  readonly Sparkles = Sparkles;

  showCommandPalette = false;
  showVariableInput = false;
  showSearchBar = false;
  searchQuery = '';
  pendingCommand: string | null = null;
  pendingTemplate: CommandTemplate | null = null;

  private terminal: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private searchAddon: SearchAddon | null = null;
  private serializeAddon: SerializeAddon | null = null;
  private resizeObserver: ResizeObserver | null = null;

  // Buffer to accumulate typed characters for command history
  private inputBuffer = '';

  session: TerminalSession | null = null;
  systemId: string | null = null;
  containerId: string | null = null;
  isFullscreen = false;
  showWarpTerminal = signal(false);

  @HostBinding('class.warp-enabled')
  get warpEnabled(): boolean {
    return this.showWarpTerminal();
  }

  // Output buffer for AI context
  private readonly MAX_CONTEXT_LINES = 50;
  private outputBuffer = signal<string[]>([]);

  getRecentOutput(): string {
    return this.outputBuffer().join('');
  }

  ngOnInit(): void {
    this.systemId = this.route.snapshot.paramMap.get('systemId');
    this.containerId = this.route.snapshot.paramMap.get('containerId');
  }

  async ngAfterViewInit(): Promise<void> {
    await this.initTerminal();
  }

  ngOnDestroy(): void {
    this.cleanup();
  }

  private async initTerminal(): Promise<void> {
    this.terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#09090b',
        foreground: '#fafafa',
        cursor: '#fafafa',
        cursorAccent: '#09090b',
        selectionBackground: '#3f3f46',
        black: '#18181b',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#f4f4f5',
        brightBlack: '#52525b',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#fafafa',
      },
    });

    this.fitAddon = new FitAddon();
    this.searchAddon = new SearchAddon();
    this.serializeAddon = new SerializeAddon();

    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(new WebLinksAddon());
    this.terminal.loadAddon(this.searchAddon);
    this.terminal.loadAddon(this.serializeAddon);

    this.terminal.open(this.terminalContainer.nativeElement);
    this.fitAddon.fit();

    // Handle Ctrl+F for search and Escape to close search
    this.terminal.attachCustomKeyEventHandler((event) => {
      if (event.ctrlKey && event.key === 'f') {
        event.preventDefault();
        this.openSearch();
        return false;
      }
      if (event.key === 'Escape' && this.showSearchBar) {
        this.closeSearch();
        return false;
      }
      return true;
    });

    this.resizeObserver = new ResizeObserver(() => {
      this.fitAddon?.fit();
      if (this.session && this.terminal) {
        this.terminalService.resize(
          this.session.id,
          this.terminal.cols,
          this.terminal.rows
        );
      }
    });
    this.resizeObserver.observe(this.terminalContainer.nativeElement);

    this.terminal.onData((data) => {
      if (this.session) {
        // Capture command for history before sending
        this.processInputForHistory(data);

        this.terminalService.sendInput(this.session.id, data);
      }
    });

    await this.startSession();
  }

  private async startSession(): Promise<void> {
    // Clear input buffer for new session
    this.inputBuffer = '';

    if (!this.systemId) {
      this.terminal?.writeln('Error: No system specified');
      return;
    }

    try {
      this.terminal?.writeln('Connecting...');

      this.session = await this.terminalService.startSession(
        this.systemId,
        this.containerId ?? undefined,
        '/bin/sh'
      );

      await this.terminalService.onOutput(this.session.id, (data) => {
        this.terminal?.write(data);

        // Capture output for AI context
        this.outputBuffer.update(lines => {
          const newLines = [...lines, data];
          // Keep only the last MAX_CONTEXT_LINES worth of output
          if (newLines.length > this.MAX_CONTEXT_LINES) {
            return newLines.slice(-this.MAX_CONTEXT_LINES);
          }
          return newLines;
        });
      });

      if (this.terminal) {
        await this.terminalService.resize(
          this.session.id,
          this.terminal.cols,
          this.terminal.rows
        );
      }

      this.terminal?.clear();

      // Load shell history from remote system for Warp composer
      this.historyService.loadRemoteHistory(this.systemId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.terminal?.writeln(`\r\nFailed to connect: ${message}`);
    }
  }

  getSystemName(): string {
    if (!this.systemId) return 'Unknown';
    const system = this.systemState
      .systems()
      .find((s) => s.id === this.systemId);
    return system?.name ?? this.systemId;
  }

  getCurrentRuntime(): ContainerRuntime {
    if (!this.systemId) return 'docker';
    const system = this.systemState
      .systems()
      .find((s) => s.id === this.systemId);
    return system?.primaryRuntime ?? 'docker';
  }

  getRuntimeIcon(): typeof Ship {
    const runtime = this.getCurrentRuntime();
    switch (runtime) {
      case 'docker':
        return Ship;
      case 'podman':
        return Container;
      case 'apple':
        return Apple;
      default:
        return Container;
    }
  }

  toggleFullscreen(): void {
    this.isFullscreen = !this.isFullscreen;
    if (this.isFullscreen) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }

  toggleWarpTerminal(): void {
    this.showWarpTerminal.update((value) => !value);
    setTimeout(() => {
      this.fitAddon?.fit();
    }, 0);
  }

  async close(): Promise<void> {
    if (this.session) {
      await this.terminalService.closeSession(this.session.id);
    }
    this.router.navigate(['/containers']);
  }

  private cleanup(): void {
    this.resizeObserver?.disconnect();
    this.terminal?.dispose();

    if (this.session) {
      this.terminalService.closeSession(this.session.id);
    }
  }

  openCommandPalette(): void {
    this.showCommandPalette = true;
  }

  closeCommandPalette(): void {
    this.showCommandPalette = false;
    this.terminal?.focus();
  }

  onCommandSelect(event: { command: string; template: CommandTemplate }): void {
    const variables = parseVariables(event.command);

    if (variables.length > 0) {
      // Command has variables - show variable input modal
      this.pendingCommand = event.command;
      this.pendingTemplate = event.template;
      this.showCommandPalette = false;
      this.showVariableInput = true;
    } else {
      // No variables - execute directly
      this.executeCommand(event.command);
    }
  }

  closeVariableInput(): void {
    this.showVariableInput = false;
    this.pendingCommand = null;
    this.pendingTemplate = null;
    this.terminal?.focus();
  }

  executeCommand(command: string): void {
    if (this.session && command) {
      if (this.showWarpTerminal()) {
        // Route through warp terminal event bus for block-based UI
        this.eventBus.emit({
          type: 'UserSubmittedCommand',
          text: command,
          source: 'user',
        });
      } else {
        // Direct PTY when warp is disabled
        this.terminalService.sendInput(this.session.id, command + '\n');
      }
    }
    this.closeCommandPalette();
    this.closeVariableInput();
  }

  openSearch(): void {
    this.showSearchBar = true;
    setTimeout(() => this.searchInput?.nativeElement.focus(), 0);
  }

  closeSearch(): void {
    this.showSearchBar = false;
    this.searchQuery = '';
    this.searchAddon?.clearDecorations();
    this.terminal?.focus();
  }

  onSearchInput(): void {
    if (this.searchQuery) {
      this.searchAddon?.findNext(this.searchQuery, {
        caseSensitive: false,
      });
    } else {
      this.searchAddon?.clearDecorations();
    }
  }

  findNext(): void {
    if (this.searchQuery) {
      this.searchAddon?.findNext(this.searchQuery);
    }
  }

  findPrevious(): void {
    if (this.searchQuery) {
      this.searchAddon?.findPrevious(this.searchQuery);
    }
  }

  /**
   * Process terminal input for command history capture.
   * Accumulates characters and saves command on Enter.
   */
  private processInputForHistory(data: string): void {
    for (const char of data) {
      const code = char.charCodeAt(0);

      if (char === '\r' || char === '\n') {
        // Enter pressed - save command if valid
        const command = this.inputBuffer.trim();
        if (command && !this.isControlSequence(command)) {
          this.historyService.add(command, 'user');
        }
        this.inputBuffer = '';
      } else if (char === '\x7f' || char === '\b') {
        // Backspace - remove last character
        this.inputBuffer = this.inputBuffer.slice(0, -1);
      } else if (code === 27) {
        // Escape sequence start - clear buffer (user using arrow keys, etc.)
        this.inputBuffer = '';
      } else if (code >= 32 && code < 127) {
        // Printable ASCII character - append to buffer
        this.inputBuffer += char;
      }
      // Ignore other control characters
    }
  }

  /**
   * Check if text is only control sequences (not a real command).
   */
  private isControlSequence(text: string): boolean {
    // Filter out empty or whitespace-only
    if (!text.trim()) return true;

    // Filter out escape sequences that might have slipped through
    if (text.startsWith('\x1b')) return true;

    return false;
  }

  popOutToDock(): void {
    if (!this.terminal || !this.session || !this.serializeAddon) {
      return;
    }

    // Serialize terminal state (captures scroll history and buffer content)
    const serializedState = this.serializeAddon.serialize();

    // Create a docked terminal entry with serialized state
    const dockedTerminal: DockedTerminal = {
      id: this.terminalState.generateTerminalId(),
      session: this.session,
      systemId: this.systemId!,
      containerId: this.containerId ?? undefined,
      systemName: this.getSystemName(),
      containerName: this.containerId?.slice(0, 12),
      serializedState: serializedState,
      terminalOptions: DEFAULT_TERMINAL_OPTIONS,
      displayMode: this.showWarpTerminal() ? 'warp' : 'xterm',
    };

    // Add to dock
    this.terminalState.addTerminal(dockedTerminal);

    // Disconnect resize observer
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    // Dispose the old terminal - we have the state serialized
    this.terminal.dispose();

    // Clear local references
    this.terminal = null;
    this.fitAddon = null;
    this.searchAddon = null;
    this.serializeAddon = null;
    this.session = null;

    // Navigate back to containers list
    this.router.navigate(['/containers']);
  }
}
