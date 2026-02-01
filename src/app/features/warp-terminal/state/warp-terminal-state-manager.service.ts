import { Injectable, inject, signal } from '@angular/core';
import { WarpTerminalStore, type TerminalStateSnapshot } from './warp-terminal-store.service';

/**
 * WarpTerminalStateManager
 *
 * Manages per-system terminal state snapshots.
 * Stores snapshots in memory and coordinates with WarpTerminalStore
 * to save/restore state when switching between systems.
 */
@Injectable({ providedIn: 'root' })
export class WarpTerminalStateManager {
  private readonly store = inject(WarpTerminalStore);
  private readonly snapshots = new Map<string, TerminalStateSnapshot>();
  private readonly _activeSystemId = signal<string | null>(null);

  /** The currently active system ID */
  readonly activeSystemId = this._activeSystemId.asReadonly();

  /**
   * Switch terminal state to a different system.
   * Saves the current state (if any) and restores the target system's state.
   *
   * @param newSystemId The system ID to switch to, or null to clear
   */
  switchToSystem(newSystemId: string | null): void {
    const currentSystemId = this._activeSystemId();

    // No-op if switching to the same system
    if (currentSystemId === newSystemId) {
      return;
    }

    // Save current state before switching
    if (currentSystemId) {
      const snapshot = this.store.createSnapshot(currentSystemId);
      this.snapshots.set(currentSystemId, snapshot);
      console.log(`[StateManager] Saved snapshot for system: ${currentSystemId}`);
    }

    // Clear the store
    this.store.clearAllState();

    // Restore target system's state if available
    if (newSystemId) {
      const snapshot = this.snapshots.get(newSystemId);
      if (snapshot) {
        this.store.restoreFromSnapshot(snapshot);
        console.log(`[StateManager] Restored snapshot for system: ${newSystemId}`);
      } else {
        console.log(`[StateManager] No snapshot for system: ${newSystemId}, starting fresh`);
      }
    }

    // Update active system ID
    this._activeSystemId.set(newSystemId);
  }

  /**
   * Check if a system has a saved snapshot.
   */
  hasSnapshot(systemId: string): boolean {
    return this.snapshots.has(systemId);
  }

  /**
   * Clear the snapshot for a specific system.
   */
  clearSnapshot(systemId: string): void {
    this.snapshots.delete(systemId);
  }

  /**
   * Clear all snapshots.
   */
  clearAllSnapshots(): void {
    this.snapshots.clear();
  }
}
