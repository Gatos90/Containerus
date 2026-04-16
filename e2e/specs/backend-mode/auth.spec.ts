import { test, expect, SERVER_URL } from '../../support/backend-mode/fixtures';
import { login, me, refresh, register } from '../../support/backend-mode/api';

/**
 * Auth flow (CON-39): register → login → refresh exercised against the real
 * containerus-server. This is the only spec that tests the server directly
 * over HTTP — the remaining specs in this suite go through the per-user
 * WebSocket paths that live on top of the same auth primitives.
 *
 * We skip the Angular UI here because tokens are stored in memory by
 * BackendService and not observable from the DOM; going through the API
 * gives us a fast, deterministic assertion surface.
 */
test.describe('backend-mode auth', () => {
  test('first user register → /me reports company admin', async () => {
    const email = `first+${Date.now().toString(36)}@containerus.local`;
    const { tokens } = await register(email, 'backend-mode-e2e-password');
    const profile = await me(tokens.accessToken);
    expect(profile.email).toBe(email);
    // First registration auto-bootstraps company and promotes the caller.
    expect(profile.isCompanyAdmin).toBe(true);
  });

  test('login issues a working access token', async () => {
    const email = `login+${Date.now().toString(36)}@containerus.local`;
    await register(email, 'backend-mode-e2e-password');
    const tokens = await login(email, 'backend-mode-e2e-password');
    const profile = await me(tokens.accessToken);
    expect(profile.email).toBe(email);
  });

  test('refresh rotates both tokens and invalidates the old refresh', async () => {
    const email = `refresh+${Date.now().toString(36)}@containerus.local`;
    const { tokens: initial } = await register(email, 'backend-mode-e2e-password');

    const rotated = await refresh(initial.refreshToken);
    expect(rotated.accessToken).not.toBe(initial.accessToken);
    expect(rotated.refreshToken).not.toBe(initial.refreshToken);
    // New access token resolves.
    await expect(me(rotated.accessToken)).resolves.toEqual(
      expect.objectContaining({ email }),
    );

    // Reusing the now-consumed refresh token must fail.
    const replay = await fetch(`${SERVER_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: initial.refreshToken }),
    });
    expect(replay.status).toBe(401);
  });

  test('logout revokes the current access token immediately', async () => {
    const email = `logout+${Date.now().toString(36)}@containerus.local`;
    const { tokens } = await register(email, 'backend-mode-e2e-password');

    const logoutRes = await fetch(`${SERVER_URL}/api/auth/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(logoutRes.status).toBe(204);

    const afterLogout = await fetch(`${SERVER_URL}/api/auth/me`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(afterLogout.status).toBe(401);
  });
});
