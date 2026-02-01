import { Injectable, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { TerminalEventBus } from './warp-terminal.bus';
import type { UserSubmittedCommand } from '../models/terminal-events';
import type { BlockSource } from '../models/terminal-block.model';

const SAMPLE_OUTPUT = [
  'Resolving dependencies...',
  'Downloading layers',
  'Extracting filesystem',
  'Running post-install scripts',
  'Completed with status 0',
];

@Injectable({ providedIn: 'root' })
export class MockTerminalBackend implements OnDestroy {
  private readonly subscriptions = new Subscription();
  private nextId = 1;

  constructor(private readonly eventBus: TerminalEventBus) {
    console.log('[MockBackend] Initializing and subscribing to events...');
    this.subscriptions.add(
      this.eventBus.events$.subscribe((event) => {
        if (event.type === 'UserSubmittedCommand') {
          this.handleUserCommand(event);
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  private handleUserCommand(event: UserSubmittedCommand): void {
    console.log('[MockBackend] Received UserSubmittedCommand:', event);

    // Skip all commands - they are now handled by AgentBackendService
    // AI commands and user commands both go through the PTY for real execution
    if (event.source === 'aiExecuted' || event.source === 'aiSuggested' || event.source === 'user') {
      console.log('[MockBackend] Skipping command, handled by AgentBackendService');
      return;
    }

    // This code path is now only for potential future sources (e.g., 'script', 'automation')
    const blockId = this.nextId++;
    const source: BlockSource = event.source ?? 'user';

    console.log(`[MockBackend] Creating block ${blockId} for command: ${event.text}`);
    this.eventBus.emit({
      type: 'BlockCreated',
      blockId,
      commandText: event.text,
      source,
    });

    setTimeout(() => {
      this.eventBus.emit({
        type: 'BlockStarted',
        blockId,
        startedAt: Date.now(),
      });

      this.streamOutput(blockId);
    }, 120);
  }

  private streamOutput(blockId: number): void {
    let lineIndex = 0;
    const interval = setInterval(() => {
      const message = SAMPLE_OUTPUT[lineIndex % SAMPLE_OUTPUT.length];
      const noise = lineIndex % 2 === 0 ? '...' : ' ✓';
      const payload = `${message}${noise}\n`;
      this.eventBus.emit({
        type: 'BlockOutputChunk',
        blockId,
        payload,
      });
      lineIndex += 1;

      if (lineIndex > SAMPLE_OUTPUT.length + 6) {
        clearInterval(interval);
        const exitCode = Math.random() > 0.15 ? 0 : 1;
        this.eventBus.emit({
          type: 'BlockEnded',
          blockId,
          exitCode,
          endedAt: Date.now(),
        });
      }
    }, 140);
  }
}
