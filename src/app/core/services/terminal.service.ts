import { Injectable, NgZone } from '@angular/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { TauriService } from './tauri.service';

export interface TerminalSession {
  id: string;
  systemId: string;
  containerId?: string;
  shell: string;
}

@Injectable({
  providedIn: 'root',
})
export class TerminalService {
  private sessions = new Map<string, TerminalSession>();
  private listeners = new Map<string, UnlistenFn>();

  constructor(
    private tauri: TauriService,
    private zone: NgZone
  ) {}

  async startSession(
    systemId: string,
    containerId?: string,
    shell: string = '/bin/sh'
  ): Promise<TerminalSession> {
    const session = await this.tauri.invoke<TerminalSession>(
      'start_terminal_session',
      {
        systemId,
        containerId,
        shell,
      }
    );

    this.sessions.set(session.id, session);
    return session;
  }

  async sendInput(sessionId: string, data: string): Promise<void> {
    return this.tauri.invoke<void>('send_terminal_input', {
      sessionId,
      data,
    });
  }

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    return this.tauri.invoke<void>('resize_terminal', {
      sessionId,
      cols,
      rows,
    });
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.tauri.invoke<void>('close_terminal_session', { sessionId });

    const unlisten = this.listeners.get(sessionId);
    if (unlisten) {
      unlisten();
      this.listeners.delete(sessionId);
    }

    this.sessions.delete(sessionId);
  }

  async onOutput(
    sessionId: string,
    callback: (data: string) => void
  ): Promise<void> {
    const unlisten = await listen<{ sessionId: string; data: string }>(
      'terminal:output',
      (event) => {
        if (event.payload.sessionId === sessionId) {
          this.zone.run(() => callback(event.payload.data));
        }
      }
    );

    this.listeners.set(sessionId, unlisten);
  }

  getSession(sessionId: string): TerminalSession | undefined {
    return this.sessions.get(sessionId);
  }

  getAllSessions(): TerminalSession[] {
    return Array.from(this.sessions.values());
  }

  async fetchShellHistory(
    systemId: string,
    maxEntries = 500,
    filter?: string
  ): Promise<string[]> {
    return this.tauri.invoke<string[]>('fetch_shell_history', {
      systemId,
      maxEntries,
      filter,
    });
  }
}
