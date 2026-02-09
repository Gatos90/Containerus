import { Injectable, NgZone } from '@angular/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { TauriService } from './tauri.service';
import { BackendService } from './backend.service';
import { ContainerRuntime } from '../models/container.model';

export interface TerminalSession {
  id: string;
  systemId: string;
  containerId?: string;
  shell: string;
}

/** Tracks a WebSocket-based terminal session for backend systems. */
interface WsSession {
  ws: WebSocket;
  sessionId: string;
  outputCallback?: (data: string) => void;
}

@Injectable({
  providedIn: 'root',
})
export class TerminalService {
  private sessions = new Map<string, TerminalSession>();
  private listeners = new Map<string, UnlistenFn>();

  /** WebSocket sessions for backend-managed systems. Keyed by local session ID. */
  private wsSessions = new Map<string, WsSession>();

  constructor(
    private tauri: TauriService,
    private zone: NgZone,
    private backend: BackendService,
  ) {}

  async startSession(
    systemId: string,
    containerId?: string,
    shell: string = '/bin/sh',
    cols: number = 80,
    rows: number = 24,
    runtime?: ContainerRuntime,
  ): Promise<TerminalSession> {
    const connId = this.backend.getBackendForSystem(systemId);

    if (connId) {
      return this.startWsSession(connId, systemId, containerId, shell, cols, rows, runtime);
    }

    const session = await this.tauri.invoke<TerminalSession>(
      'start_terminal_session',
      {
        systemId,
        containerId,
        shell,
        cols,
        rows,
        runtime: runtime || undefined,
      }
    );

    this.sessions.set(session.id, session);
    return session;
  }

  async sendInput(sessionId: string, data: string): Promise<void> {
    const wsSess = this.wsSessions.get(sessionId);
    if (wsSess) {
      if (wsSess.ws.readyState === WebSocket.OPEN) {
        // Send as binary for raw terminal input
        const encoder = new TextEncoder();
        wsSess.ws.send(encoder.encode(data));
      } else {
        console.warn(`Terminal session ${sessionId}: WebSocket not open (state=${wsSess.ws.readyState}), input dropped`);
      }
      return;
    }

    return this.tauri.invoke<void>('send_terminal_input', {
      sessionId,
      data,
    });
  }

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    const wsSess = this.wsSessions.get(sessionId);
    if (wsSess) {
      if (wsSess.ws.readyState === WebSocket.OPEN) {
        wsSess.ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      } else {
        console.warn(`Terminal session ${sessionId}: resize dropped, WebSocket not open (state=${wsSess.ws.readyState})`);
      }
      return;
    }

    return this.tauri.invoke<void>('resize_terminal', {
      sessionId,
      cols,
      rows,
    });
  }

  async closeSession(sessionId: string): Promise<void> {
    const wsSess = this.wsSessions.get(sessionId);
    if (wsSess) {
      if (wsSess.ws.readyState === WebSocket.OPEN) {
        wsSess.ws.send(JSON.stringify({ type: 'close' }));
        wsSess.ws.close();
      }
      // Let the onclose handler clean up wsSessions and sessions
      return;
    }

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
    const wsSess = this.wsSessions.get(sessionId);
    if (wsSess) {
      // Store callback — WebSocket onmessage already calls it
      wsSess.outputCallback = callback;
      return;
    }

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

  // ==========================================================================
  // WebSocket terminal for backend systems
  // ==========================================================================

  private startWsSession(
    connectionId: string,
    systemId: string,
    containerId?: string,
    shell: string = '/bin/sh',
    cols: number = 80,
    rows: number = 24,
    runtime?: ContainerRuntime,
  ): Promise<TerminalSession> {
    return new Promise<TerminalSession>((resolve, reject) => {
      const wsInfo = this.backend.getTerminalWsUrl(connectionId, systemId);
      if (!wsInfo) {
        reject(new Error('Backend not connected or no token'));
        return;
      }

      const ws = new WebSocket(wsInfo.url);
      ws.binaryType = 'arraybuffer';

      const localSessionId = crypto.randomUUID();
      let connected = false;
      let settled = false;

      const connectionTimeout = setTimeout(() => {
        if (!connected && !settled) {
          settled = true;
          ws.close();
          reject(new Error('Terminal connection timed out'));
        }
      }, 30000);

      ws.onopen = () => {
        // Authenticate via first message (avoids token in URL query string)
        ws.send(JSON.stringify({ type: 'auth', token: wsInfo.token }));
        // Then send start message to initiate PTY
        ws.send(JSON.stringify({
          type: 'start',
          cols,
          rows,
          shell,
          containerId: containerId || undefined,
          runtime: runtime || undefined,
        }));
      };

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          // Binary data = terminal output
          const decoder = new TextDecoder();
          const text = decoder.decode(event.data);
          const wsSess = this.wsSessions.get(localSessionId);
          if (wsSess?.outputCallback) {
            this.zone.run(() => wsSess.outputCallback!(text));
          }
          return;
        }

        // Text data = JSON control message
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'connected') {
            connected = true;
            clearTimeout(connectionTimeout);
            const session: TerminalSession = {
              id: localSessionId,
              systemId,
              containerId,
              shell,
            };
            this.sessions.set(localSessionId, session);
            this.wsSessions.set(localSessionId, { ws, sessionId: msg.sessionId });
            resolve(session);
          } else if (msg.type === 'error' && !connected && !settled) {
            settled = true;
            clearTimeout(connectionTimeout);
            ws.close();
            reject(new Error(msg.message || 'Terminal connection failed'));
          } else if (msg.type === 'error' && connected) {
            // Post-connection error — surface to the terminal output
            const wsSess = this.wsSessions.get(localSessionId);
            if (wsSess?.outputCallback) {
              this.zone.run(() => wsSess.outputCallback!(`\r\n\x1b[31m[Error: ${msg.message || 'Unknown error'}]\x1b[0m\r\n`));
            }
          }
        } catch {
          // Ignore non-JSON text
        }
      };

      ws.onerror = () => {
        clearTimeout(connectionTimeout);
        if (!connected && !settled) {
          settled = true;
          reject(new Error('WebSocket connection failed'));
        }
      };

      ws.onclose = () => {
        clearTimeout(connectionTimeout);
        if (connected) {
          const wsSess = this.wsSessions.get(localSessionId);
          if (wsSess?.outputCallback) {
            this.zone.run(() => wsSess.outputCallback!('\r\n\x1b[33m[Session disconnected]\x1b[0m\r\n'));
          }
        }
        this.wsSessions.delete(localSessionId);
        this.sessions.delete(localSessionId);
        if (!connected && !settled) {
          settled = true;
          reject(new Error('WebSocket closed before connected'));
        }
      };
    });
  }
}
