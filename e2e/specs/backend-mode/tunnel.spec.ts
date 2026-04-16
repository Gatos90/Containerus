import { test, expect } from '../../support/backend-mode/fixtures';
import { SERVER_URL } from '../../support/backend-mode/compose';
import { openWebSocket } from '../../support/backend-mode/ws-client';

/**
 * Port-forward tunnel WebSocket (CON-39).
 *
 * Scope for this spec is the auth/pre-flight path of `/api/ws/tunnel/:system`.
 * Full payload round-trip requires the destination to pass the SSRF guard
 * (CON-46 hardening blocks all private IP ranges), which in turn requires
 * the per-system allowlist shipped in CON-54. Payload coverage is tracked
 * in the CON-39 follow-up issue rather than bolted on here.
 */
const wsUrl = () => SERVER_URL.replace(/^http/, 'ws');

test('tunnel WS: bad token → error frame', async ({ backend }) => {
  const session = await openWebSocket(`${wsUrl()}/api/ws/tunnel/${backend.systemId}`);
  try {
    session.sendJson({ type: 'auth', token: 'not-a-real-jwt', host: '127.0.0.1', port: 22 });
    const frame = await session.next('text');
    const json = frame.kind === 'text' ? (frame.json as { type?: string; message?: string } | null) : null;
    expect(json?.type).toBe('error');
    expect(json?.message ?? '').toMatch(/invalid|expired|token/i);
  } finally {
    await session.close();
  }
});

test('tunnel WS: SSRF guard blocks private-range destination (127.0.0.1)', async ({ backend }) => {
  const session = await openWebSocket(`${wsUrl()}/api/ws/tunnel/${backend.systemId}`);
  try {
    // Valid JWT, but destination is in the blocked loopback range. Server
    // must refuse BEFORE opening the SSH direct-tcpip channel.
    session.sendJson({
      type: 'auth',
      token: backend.accessToken,
      host: '127.0.0.1',
      port: 22,
    });

    const frame = await session.next('text');
    expect(frame.kind).toBe('text');
    if (frame.kind !== 'text') return; // type guard
    const json = frame.json as { type?: string; message?: string } | null;
    expect(json?.type).toBe('error');
    // Server message reads "Tunnel destination is blocked" / "blocked address".
    expect(json?.message ?? '').toMatch(/block/i);
  } finally {
    await session.close();
  }
});

test('tunnel WS: SSRF guard blocks cloud metadata IP (169.254.169.254)', async ({ backend }) => {
  const session = await openWebSocket(`${wsUrl()}/api/ws/tunnel/${backend.systemId}`);
  try {
    session.sendJson({
      type: 'auth',
      token: backend.accessToken,
      host: '169.254.169.254',
      port: 80,
    });
    const frame = await session.next('text');
    const json = frame.kind === 'text' ? (frame.json as { type?: string; message?: string } | null) : null;
    expect(json?.type).toBe('error');
    expect(json?.message ?? '').toMatch(/block/i);
  } finally {
    await session.close();
  }
});

// Full payload round-trip: see CON-39 follow-up once CON-54 allowlist is on Ai-Test.
test.skip('tunnel WS: bytes round-trip through the SSH direct-tcpip channel', () => {
  // Requires an allowlisted destination. See CON-54.
});
