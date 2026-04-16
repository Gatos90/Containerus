import { test, expect } from '../../support/backend-mode/fixtures';
import { SERVER_URL } from '../../support/backend-mode/compose';
import { openWebSocket, type Frame } from '../../support/backend-mode/ws-client';

/**
 * Per-user WebSocket PTY (CON-39). Validates:
 * - auth-first handshake rejects missing/invalid tokens
 * - start message kicks off a real SSH PTY via the per-user `connect()` tier
 * - bytes sent as binary arrive as `Data` channel frames back through the WS
 *
 * This is the spec that exercises `connections/mod.rs`'s per-user SSH path
 * which nothing else in CI covers today.
 */
const wsUrl = () => SERVER_URL.replace(/^http/, 'ws');

async function awaitText(
  next: (kind?: Frame['kind']) => Promise<Frame>,
  timeoutMs = 15_000,
): Promise<Frame & { kind: 'text' }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for text frame');
    const frame = await next();
    if (frame.kind === 'text') return frame;
    // ignore stray binary/close frames during handshake
    if (frame.kind === 'close') throw new Error(`Closed (${frame.code}): ${frame.reason}`);
  }
}

test('terminal WS: rejects start message before auth', async ({ backend }) => {
  const session = await openWebSocket(`${wsUrl()}/api/ws/terminal/${backend.systemId}`);
  try {
    // Skip the auth frame — send start directly. Server should reject or close.
    session.sendJson({ type: 'start', cols: 80, rows: 24, shell: '/bin/sh' });
    const frame = await Promise.race([
      session.next(),
      new Promise<Frame>((_, rej) => setTimeout(() => rej(new Error('no frame')), 10_000)),
    ]);
    // Server either sends an auth-timeout error after 30s, or keeps waiting.
    // Since we time out before 30s we should not have seen a "connected".
    if (frame.kind === 'text') {
      const json = frame.json as { type?: string } | null;
      expect(json?.type).not.toBe('connected');
    } else if (frame.kind === 'close') {
      expect(frame.code).not.toBe(1000);
    }
  } finally {
    await session.close();
  }
});

test('terminal WS: auth with bad token returns error and closes', async ({ backend }) => {
  const session = await openWebSocket(`${wsUrl()}/api/ws/terminal/${backend.systemId}`);
  try {
    session.sendJson({ type: 'auth', token: 'not-a-real-jwt' });
    const err = await awaitText(session.next.bind(session));
    const json = err.json as { type?: string; message?: string } | null;
    expect(json?.type).toBe('error');
    expect(json?.message ?? '').toMatch(/invalid|expired/i);
  } finally {
    await session.close();
  }
});

test('terminal WS: auth + start + echo round-trips through the PTY', async ({ backend }) => {
  const session = await openWebSocket(`${wsUrl()}/api/ws/terminal/${backend.systemId}`);
  try {
    session.sendJson({ type: 'auth', token: backend.accessToken });
    session.sendJson({ type: 'start', cols: 120, rows: 30, shell: '/bin/sh' });

    // Server emits {"type":"connected","sessionId":...} after PTY is ready.
    const deadline = Date.now() + 30_000;
    let connectedSeen = false;
    while (!connectedSeen) {
      if (Date.now() > deadline) throw new Error('Never saw "connected" frame');
      const frame = await session.next();
      if (frame.kind === 'text' && (frame.json as { type?: string } | null)?.type === 'connected') {
        connectedSeen = true;
      } else if (frame.kind === 'close') {
        throw new Error(`Closed during handshake: ${frame.code} ${frame.reason}`);
      }
    }

    // Write a unique marker; wait for it in the binary output stream.
    const marker = `CON39-${Math.random().toString(36).slice(2, 10)}`;
    session.send(new TextEncoder().encode(`echo ${marker}\n`));

    const output: string[] = [];
    const outputDeadline = Date.now() + 30_000;
    while (Date.now() < outputDeadline) {
      const frame = await session.next();
      if (frame.kind === 'binary') {
        output.push(new TextDecoder().decode(frame.data));
        if (output.join('').includes(marker)) return;
      } else if (frame.kind === 'close') {
        throw new Error(`Closed while waiting for echo: ${frame.code}`);
      }
    }
    throw new Error(`Never saw marker "${marker}" in PTY output. Got:\n${output.join('')}`);
  } finally {
    await session.close();
  }
});
