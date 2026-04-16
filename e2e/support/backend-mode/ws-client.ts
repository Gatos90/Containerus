/**
 * Thin WebSocket helper for backend-mode WS specs.
 *
 * Relies on Node's built-in `WebSocket` (stable since Node 21). If you're on
 * an older Node, install the `ws` package and swap the import — the helper
 * surface is deliberately small.
 *
 * The server's WS protocol is auth-first-message, so every helper here
 * exposes `send(...)` and a `next(kind)` that resolves to the next frame of
 * a given kind. That shape matches how the terminal/tunnel handshakes are
 * actually written on the server (auth → start → data) and keeps specs
 * readable.
 */

export type Frame =
  | { kind: 'text'; data: string; json: unknown | null }
  | { kind: 'binary'; data: Uint8Array }
  | { kind: 'close'; code: number; reason: string };

export interface WsSession {
  send(data: string | Uint8Array): void;
  sendJson(obj: unknown): void;
  next(kind?: Frame['kind']): Promise<Frame>;
  close(): Promise<void>;
}

function parseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function openWebSocket(url: string, timeoutMs = 10_000): Promise<WsSession> {
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';

  const queue: Frame[] = [];
  const waiters: Array<{ kind?: Frame['kind']; resolve: (f: Frame) => void; reject: (err: Error) => void }> = [];

  const deliver = (frame: Frame) => {
    for (let i = 0; i < waiters.length; i += 1) {
      const w = waiters[i];
      if (!w.kind || w.kind === frame.kind) {
        waiters.splice(i, 1);
        w.resolve(frame);
        return;
      }
    }
    queue.push(frame);
  };

  ws.addEventListener('message', (ev: MessageEvent) => {
    if (typeof ev.data === 'string') {
      deliver({ kind: 'text', data: ev.data, json: parseJson(ev.data) });
    } else if (ev.data instanceof ArrayBuffer) {
      deliver({ kind: 'binary', data: new Uint8Array(ev.data) });
    } else if (ev.data instanceof Uint8Array) {
      deliver({ kind: 'binary', data: ev.data });
    }
  });

  ws.addEventListener('close', (ev: CloseEvent) => {
    deliver({ kind: 'close', code: ev.code, reason: ev.reason });
    // Fail any remaining waiters so specs don't hang.
    while (waiters.length) {
      const w = waiters.shift()!;
      w.reject(new Error(`WebSocket closed (${ev.code}) before a ${w.kind ?? 'frame'} frame arrived`));
    }
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`WebSocket open timeout after ${timeoutMs}ms`)), timeoutMs);
    ws.addEventListener('open', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
    ws.addEventListener('error', (e: Event) => {
      clearTimeout(timeout);
      reject(new Error(`WebSocket error: ${(e as ErrorEvent).message ?? 'unknown'}`));
    }, { once: true });
  });

  return {
    send(data) {
      if (typeof data === 'string') ws.send(data);
      else ws.send(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
    },
    sendJson(obj) {
      ws.send(JSON.stringify(obj));
    },
    next(kind) {
      for (let i = 0; i < queue.length; i += 1) {
        if (!kind || queue[i].kind === kind) return Promise.resolve(queue.splice(i, 1)[0]);
      }
      return new Promise<Frame>((resolve, reject) => {
        waiters.push({ kind, resolve, reject });
      });
    },
    close() {
      return new Promise<void>((resolve) => {
        if (ws.readyState === WebSocket.CLOSED) return resolve();
        ws.addEventListener('close', () => resolve(), { once: true });
        ws.close();
      });
    },
  };
}
