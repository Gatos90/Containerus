import { Injectable, inject, signal, computed } from '@angular/core';
import { TerminalService } from '../../../core/services/terminal.service';

export interface HistoryEntry {
  text: string;
  source: 'user' | 'ai' | 'shell'; // user = typed by user, ai = executed by AI agent, shell = from remote history
  timestamp: number;
}

@Injectable({ providedIn: 'root' })
export class CommandHistoryService {
  private readonly terminalService = inject(TerminalService);

  private readonly STORAGE_KEY = 'warp-command-history';
  private readonly MAX_ENTRIES = 500; // Increased to accommodate shell history

  private readonly _history = signal<HistoryEntry[]>(this.loadFromStorage());
  private readonly loadedSystems = new Set<string>();
  private currentSystemId: string | null = null;

  readonly history = this._history.asReadonly();
  readonly commands = computed(() => this._history().map((e) => e.text));

  add(text: string, source: 'user' | 'ai' = 'user'): void {
    const trimmed = text.trim();
    if (!trimmed) return;

    this._history.update((entries) => {
      // Remove duplicate if exists
      const filtered = entries.filter((e) => e.text !== trimmed);
      // Add new entry at start
      const updated = [
        { text: trimmed, source, timestamp: Date.now() },
        ...filtered,
      ].slice(0, this.MAX_ENTRIES);

      this.saveToStorage(updated);
      return updated;
    });
  }

  getAll(): string[] {
    return this._history().map((e) => e.text);
  }

  clear(): void {
    this._history.set([]);
    localStorage.removeItem(this.STORAGE_KEY);
  }

  /**
   * Load shell history from a remote system via SSH.
   * Only loads once per system per app session to avoid duplicates.
   */
  async loadRemoteHistory(systemId: string): Promise<void> {
    // Track current system for remote searches
    this.currentSystemId = systemId;

    // Only load once per system per session
    if (this.loadedSystems.has(systemId)) return;
    this.loadedSystems.add(systemId);

    try {
      const remoteCommands = await this.terminalService.fetchShellHistory(
        systemId
      );

      if (remoteCommands.length === 0) return;

      // Add remote commands (with older timestamps so they sort after recent commands)
      this._history.update((entries) => {
        const existingTexts = new Set(entries.map((e) => e.text));
        const newEntries = remoteCommands
          .filter((cmd) => !existingTexts.has(cmd))
          .map((text, i) => ({
            text,
            source: 'shell' as const,
            // Older timestamps so they appear after recent commands
            timestamp: Date.now() - (remoteCommands.length - i) * 1000,
          }));

        const updated = [...entries, ...newEntries].slice(0, this.MAX_ENTRIES);
        this.saveToStorage(updated);
        return updated;
      });
    } catch (error) {
      console.warn('Failed to load remote shell history:', error);
    }
  }

  /**
   * Search remote shell history using grep on the remote system.
   * Returns matching commands from the entire history file.
   */
  async searchRemoteHistory(query: string): Promise<string[]> {
    if (!this.currentSystemId || !query.trim()) {
      return [];
    }

    try {
      return await this.terminalService.fetchShellHistory(
        this.currentSystemId,
        100, // Limit search results
        query
      );
    } catch (error) {
      console.warn('Failed to search remote history:', error);
      return [];
    }
  }

  private loadFromStorage(): HistoryEntry[] {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  private saveToStorage(entries: HistoryEntry[]): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // Ignore storage errors
    }
  }
}
