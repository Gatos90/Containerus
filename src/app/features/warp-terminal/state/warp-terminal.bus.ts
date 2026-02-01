import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import type { TerminalEvent } from '../models/terminal-events';

@Injectable({ providedIn: 'root' })
export class TerminalEventBus {
  private readonly subject = new Subject<TerminalEvent>();
  private subscriberCount = 0;

  readonly events$ = this.subject.asObservable();

  constructor() {
    console.log('[EventBus] Created');
  }

  emit(event: TerminalEvent): void {
    console.log('[EventBus] Emitting event:', event.type, event);
    this.subject.next(event);
  }

  // Debug helper to track subscribers
  subscribe(callback: (event: TerminalEvent) => void) {
    this.subscriberCount++;
    console.log('[EventBus] New subscriber, total:', this.subscriberCount);
    return this.events$.subscribe(callback);
  }
}
