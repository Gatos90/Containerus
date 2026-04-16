import { Injectable, NgZone, inject } from '@angular/core';
import { BackendService } from './backend.service';

export interface K8sWatchEvent {
  eventType: 'MODIFIED' | 'DELETED';
  kind: string;
  resource: any;
}

type WatchCallback = (event: K8sWatchEvent) => void;

interface WatchSession {
  ws: WebSocket;
  connectionId: string;
  clusterId: string;
  namespace: string;
  kinds: string[];
  callbacks: WatchCallback[];
  status: 'connecting' | 'live' | 'disconnected';
  retryTimeout?: ReturnType<typeof setTimeout>;
}

@Injectable({
  providedIn: 'root',
})
export class K8sWatchService {
  private backend = inject(BackendService);
  private zone = inject(NgZone);

  /** Active sessions keyed by `${connectionId}:${clusterId}:${namespace}` */
  private sessions = new Map<string, WatchSession>();

  /** Status change callbacks keyed by session key */
  private statusCallbacks = new Map<string, ((status: 'live' | 'disconnected' | 'connecting') => void)[]>();

  subscribe(
    connectionId: string,
    clusterId: string,
    namespace: string,
    kinds: string[],
    callback: WatchCallback,
    onStatusChange?: (status: 'live' | 'disconnected' | 'connecting') => void,
  ): () => void {
    const key = `${connectionId}:${clusterId}:${namespace}`;

    if (onStatusChange) {
      if (!this.statusCallbacks.has(key)) this.statusCallbacks.set(key, []);
      this.statusCallbacks.get(key)!.push(onStatusChange);
    }

    const existing = this.sessions.get(key);
    if (existing && existing.ws.readyState === WebSocket.OPEN) {
      existing.callbacks.push(callback);
      // Check if we need to subscribe to additional kinds
      const newKinds = kinds.filter(k => !existing.kinds.includes(k));
      if (newKinds.length > 0) {
        existing.kinds.push(...newKinds);
        // Re-subscribe is not supported in the current protocol;
        // the existing subscription already covers initial kinds
      }
      return () => this.unsubscribe(key, callback, onStatusChange);
    }

    this.connect(connectionId, clusterId, namespace, kinds, callback, key);
    return () => this.unsubscribe(key, callback, onStatusChange);
  }

  private connect(
    connectionId: string,
    clusterId: string,
    namespace: string,
    kinds: string[],
    callback: WatchCallback,
    key: string,
  ): void {
    const wsInfo = this.backend.getK8sWatchWsUrl(connectionId, clusterId);
    if (!wsInfo) return;

    const ws = new WebSocket(wsInfo.url);
    const session: WatchSession = {
      ws,
      connectionId,
      clusterId,
      namespace,
      kinds,
      callbacks: [callback],
      status: 'connecting',
    };
    this.sessions.set(key, session);
    this.notifyStatus(key, 'connecting');

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token: wsInfo.token }));
      ws.send(JSON.stringify({ type: 'subscribe', namespace, kinds }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'subscribed') {
          session.status = 'live';
          this.zone.run(() => this.notifyStatus(key, 'live'));
        } else if (msg.type === 'event') {
          const watchEvent: K8sWatchEvent = {
            eventType: msg.eventType,
            kind: msg.kind,
            resource: msg.resource,
          };
          this.zone.run(() => {
            for (const cb of session.callbacks) {
              cb(watchEvent);
            }
          });
        } else if (msg.type === 'error') {
          console.warn('K8s watch error:', msg.message);
        }
      } catch {
        // Ignore non-JSON
      }
    };

    ws.onerror = () => {
      // onclose will handle cleanup
    };

    ws.onclose = () => {
      session.status = 'disconnected';
      this.zone.run(() => this.notifyStatus(key, 'disconnected'));

      // Auto-retry after 5 seconds if still has callbacks
      if (session.callbacks.length > 0) {
        session.retryTimeout = setTimeout(() => {
          const currentSession = this.sessions.get(key);
          if (currentSession && currentSession.callbacks.length > 0) {
            this.connect(connectionId, clusterId, namespace, kinds, callback, key);
            // Preserve all existing callbacks
            const newSession = this.sessions.get(key);
            if (newSession) {
              newSession.callbacks = currentSession.callbacks;
            }
          }
        }, 5000);
      }
    };
  }

  private unsubscribe(
    key: string,
    callback: WatchCallback,
    onStatusChange?: (status: 'live' | 'disconnected' | 'connecting') => void,
  ): void {
    const session = this.sessions.get(key);
    if (session) {
      session.callbacks = session.callbacks.filter(cb => cb !== callback);
      if (session.callbacks.length === 0) {
        clearTimeout(session.retryTimeout);
        if (session.ws.readyState === WebSocket.OPEN) {
          session.ws.send(JSON.stringify({ type: 'close' }));
          session.ws.close();
        }
        this.sessions.delete(key);
      }
    }

    if (onStatusChange) {
      const cbs = this.statusCallbacks.get(key);
      if (cbs) {
        const idx = cbs.indexOf(onStatusChange);
        if (idx >= 0) cbs.splice(idx, 1);
        if (cbs.length === 0) this.statusCallbacks.delete(key);
      }
    }
  }

  private notifyStatus(key: string, status: 'live' | 'disconnected' | 'connecting'): void {
    const cbs = this.statusCallbacks.get(key) ?? [];
    for (const cb of cbs) {
      cb(status);
    }
  }

  /** Disconnect all sessions (e.g., on component destroy) */
  disconnectAll(): void {
    for (const [key, session] of this.sessions) {
      clearTimeout(session.retryTimeout);
      if (session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(JSON.stringify({ type: 'close' }));
        session.ws.close();
      }
    }
    this.sessions.clear();
    this.statusCallbacks.clear();
  }
}
