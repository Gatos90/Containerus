import { Injectable, effect, inject } from '@angular/core';
import { BackendService } from './backend.service';

/**
 * CON-122: client for `/api/ws/permissions`. Opens one socket per
 * connected backend, listens for `permissions.invalidated` events, and
 * drives `BackendService.refreshPermissionsFor(...)` so role/ACL edits
 * by an admin propagate to every live client within ~2s.
 *
 * Wiring: a single `effect()` watches `BackendService.connections`.
 * When a connection flips to `connected` (after login or
 * auto-reconnect) we open a socket; on any other status we tear it
 * down. That keeps the lifecycle logic off `BackendService`.
 */
interface SocketEntry {
  socket: WebSocket;
  /** Backoff timer handle (when scheduled). */
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  /** Current backoff delay in ms — doubles on each failure up to {@link MAX_BACKOFF_MS}. */
  nextBackoffMs: number;
  /** Set once auth succeeds + server sends `{"type":"connected"}`. */
  authed: boolean;
  /** True when `shutdown()` was called — stops reconnect attempts. */
  aborted: boolean;
}

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;

/**
 * Convert a backend HTTP(S) base URL into the permissions WebSocket
 * endpoint. Exported so unit tests can exercise the mapping
 * independently of the Angular injection context.
 */
export function buildPermissionsWsUrl(serverUrl: string): string {
  let base: URL;
  try {
    base = new URL(serverUrl);
  } catch {
    throw new Error(`Invalid server URL: ${serverUrl}`);
  }
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = base.pathname.replace(/\/$/, '') + '/api/ws/permissions';
  base.search = '';
  base.hash = '';
  return base.toString();
}

@Injectable({ providedIn: 'root' })
export class PermissionsWsService {
  private readonly backend = inject(BackendService);

  /** connectionId → active socket state. */
  private readonly sockets = new Map<string, SocketEntry>();

  /**
   * Track which connections were previously `connected` so that when
   * one transitions connected→anything-else we tear the socket down.
   * Using the signal alone isn't enough because we need the delta.
   */
  private readonly previousStatus = new Map<string, string>();

  constructor() {
    effect(() => {
      const conns = this.backend.connections();
      const seen = new Set<string>();

      for (const conn of conns) {
        seen.add(conn.id);
        const prev = this.previousStatus.get(conn.id);
        this.previousStatus.set(conn.id, conn.status);

        if (conn.status === 'connected' && conn.tokens?.accessToken) {
          // Start on first connect OR whenever a reconnect transitions
          // us back to connected — includes token-refresh flows, since
          // the access token may have changed while we were idle.
          if (!this.sockets.has(conn.id) || prev !== 'connected') {
            this.start(conn.id);
          }
        } else if (this.sockets.has(conn.id)) {
          this.stop(conn.id);
        }
      }

      // Drop state for connections that were removed entirely.
      for (const id of Array.from(this.sockets.keys())) {
        if (!seen.has(id)) this.stop(id);
      }
      for (const id of Array.from(this.previousStatus.keys())) {
        if (!seen.has(id)) this.previousStatus.delete(id);
      }
    });
  }

  private start(connectionId: string): void {
    // Tear down any stale socket first — e.g. if the access token
    // rotated we want the handshake to run again with the new one.
    this.stop(connectionId);

    const conn = this.backend.getConnection(connectionId);
    const token = conn?.tokens?.accessToken;
    if (!conn || !token) return;

    const url = this.buildWsUrl(conn.serverUrl);
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (err) {
      console.warn('[permissions-ws] failed to open socket:', err);
      this.scheduleReconnect(connectionId, INITIAL_BACKOFF_MS);
      return;
    }

    const entry: SocketEntry = {
      socket,
      reconnectTimer: null,
      nextBackoffMs: INITIAL_BACKOFF_MS,
      authed: false,
      aborted: false,
    };
    this.sockets.set(connectionId, entry);

    socket.addEventListener('open', () => {
      // Match the ws/terminal.rs first-message handshake so tokens stay
      // out of URLs + access logs.
      socket.send(JSON.stringify({ type: 'auth', token }));
    });

    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      let msg: { type?: string; scope?: string; projectId?: string; message?: string };
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case 'connected': {
          entry.authed = true;
          entry.nextBackoffMs = INITIAL_BACKOFF_MS;
          // After a reconnect we may have missed events while the
          // socket was down — do one defensive refetch so we converge.
          void this.backend.refreshPermissionsFor(connectionId);
          break;
        }
        case 'permissions.invalidated': {
          // `refreshPermissionsFor` is coalesced per connection, so a
          // burst of events from the server turns into one `/auth/me`
          // roundtrip. It also dismisses the CON-126 banner on the
          // refetch side, so we don't need to reach into that state
          // from here.
          void this.backend.refreshPermissionsFor(connectionId);
          break;
        }
        case 'error': {
          // Typically an auth failure. Close + reconnect; the effect
          // will re-issue the handshake with whatever token the
          // connection currently holds (it may have rotated).
          console.warn('[permissions-ws] server error:', msg.message);
          socket.close();
          break;
        }
        case 'pong':
          break;
      }
    });

    socket.addEventListener('close', () => this.handleClose(connectionId));
    socket.addEventListener('error', () => {
      // Browsers fire `error` *before* `close` when the TCP handshake
      // itself fails. Don't act here — let `close` schedule the
      // reconnect so backoff only advances once per failed attempt.
    });
  }

  private handleClose(connectionId: string): void {
    const entry = this.sockets.get(connectionId);
    if (!entry || entry.aborted) return;

    // Only schedule a reconnect while the BackendService still
    // considers this connection online; otherwise the lifecycle effect
    // will start us again on its own when appropriate.
    const conn = this.backend.getConnection(connectionId);
    if (!conn || conn.status !== 'connected' || !conn.tokens?.accessToken) {
      this.sockets.delete(connectionId);
      return;
    }

    const delay = entry.nextBackoffMs;
    entry.nextBackoffMs = Math.min(entry.nextBackoffMs * 2, MAX_BACKOFF_MS);
    this.scheduleReconnect(connectionId, delay);
  }

  private scheduleReconnect(connectionId: string, delayMs: number): void {
    const entry = this.sockets.get(connectionId);
    if (entry?.reconnectTimer) clearTimeout(entry.reconnectTimer);
    const timer = setTimeout(() => {
      const current = this.sockets.get(connectionId);
      if (!current || current.aborted) return;
      this.start(connectionId);
    }, delayMs);
    if (entry) {
      entry.reconnectTimer = timer;
    } else {
      // No prior entry (initial open failed). Store a shell so stop()
      // can clear the pending timer if needed.
      this.sockets.set(connectionId, {
        socket: null as unknown as WebSocket,
        reconnectTimer: timer,
        nextBackoffMs: Math.min(delayMs * 2, MAX_BACKOFF_MS),
        authed: false,
        aborted: false,
      });
    }
  }

  private stop(connectionId: string): void {
    const entry = this.sockets.get(connectionId);
    if (!entry) return;
    entry.aborted = true;
    if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
    if (entry.socket && entry.socket.readyState <= WebSocket.OPEN) {
      try {
        entry.socket.close();
      } catch {
        // no-op
      }
    }
    this.sockets.delete(connectionId);
  }

  private buildWsUrl(serverUrl: string): string {
    return buildPermissionsWsUrl(serverUrl);
  }
}
