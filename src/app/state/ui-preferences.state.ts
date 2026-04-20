import { Injectable, computed, effect, signal } from '@angular/core';

/**
 * Per-user UI preferences for the IA refactor (CON-124). Persisted to
 * localStorage so connection scope survives reloads.
 *
 * - `activeConnectionId`: which registered backend (or "local") is currently
 *   in focus. Drives the topbar tint + project/env pickers.
 * - `projectByConnection`: the last-picked project per connection.
 * - `envByConnection`: the last-picked environment per (connection, project).
 * - `disableConnectionTint`: opt-out toggle for the accent tint, surfaced in
 *   Settings → My account per CON-115 §8 Q6.
 */

const STORAGE_KEY = 'containerus_ui_preferences_v1';

export const LOCAL_CONNECTION_ID = 'local';

export interface UiPreferences {
  activeConnectionId: string;
  projectByConnection: Record<string, string>;
  envByConnection: Record<string, Record<string, string>>;
  disableConnectionTint: boolean;
}

const DEFAULT_PREFS: UiPreferences = {
  activeConnectionId: LOCAL_CONNECTION_ID,
  projectByConnection: {},
  envByConnection: {},
  disableConnectionTint: false,
};

@Injectable({ providedIn: 'root' })
export class UiPreferencesState {
  private readonly _prefs = signal<UiPreferences>(this.load());

  readonly activeConnectionId = computed(() => this._prefs().activeConnectionId);
  readonly disableConnectionTint = computed(() => this._prefs().disableConnectionTint);
  readonly isLocalMode = computed(() => this._prefs().activeConnectionId === LOCAL_CONNECTION_ID);

  constructor() {
    effect(() => {
      const prefs = this._prefs();
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
      } catch {
        // localStorage may be blocked (private mode); preferences degrade to in-memory.
      }
    });
  }

  setActiveConnection(connectionId: string): void {
    this._prefs.update((p) => ({ ...p, activeConnectionId: connectionId }));
  }

  projectFor(connectionId: string): string | null {
    return this._prefs().projectByConnection[connectionId] ?? null;
  }

  setProject(connectionId: string, projectId: string | null): void {
    this._prefs.update((p) => {
      const next = { ...p.projectByConnection };
      if (projectId) {
        next[connectionId] = projectId;
      } else {
        delete next[connectionId];
      }
      return { ...p, projectByConnection: next };
    });
  }

  envFor(connectionId: string, projectId: string): string | null {
    return this._prefs().envByConnection[connectionId]?.[projectId] ?? null;
  }

  setEnv(connectionId: string, projectId: string, envId: string | null): void {
    this._prefs.update((p) => {
      const forConn = { ...(p.envByConnection[connectionId] ?? {}) };
      if (envId) {
        forConn[projectId] = envId;
      } else {
        delete forConn[projectId];
      }
      return {
        ...p,
        envByConnection: { ...p.envByConnection, [connectionId]: forConn },
      };
    });
  }

  setDisableConnectionTint(disabled: boolean): void {
    this._prefs.update((p) => ({ ...p, disableConnectionTint: disabled }));
  }

  private load(): UiPreferences {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_PREFS };
      const parsed = JSON.parse(raw) as Partial<UiPreferences>;
      return {
        activeConnectionId: parsed.activeConnectionId ?? DEFAULT_PREFS.activeConnectionId,
        projectByConnection: parsed.projectByConnection ?? {},
        envByConnection: parsed.envByConnection ?? {},
        disableConnectionTint: parsed.disableConnectionTint ?? false,
      };
    } catch {
      return { ...DEFAULT_PREFS };
    }
  }
}
