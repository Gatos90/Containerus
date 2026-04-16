import { test, expect } from '../../support/backend-mode/fixtures';
import { SERVER_URL } from '../../support/backend-mode/compose';

/**
 * Shared-tier REST surface (CON-39). The list containers / images / volumes
 * endpoints all go through `connections::execute_shared()` — one SSH session
 * per system, not per user. The fixture's SSH target is the disposable
 * linuxserver/openssh-server image which doesn't have a docker CLI, so the
 * runtime commands will return a non-zero exit. We assert the server surfaces
 * the runtime failure cleanly (HTTP 5xx / error body) rather than hanging or
 * crashing the process — that's the actual regression we want caught.
 *
 * Container lifecycle against a real docker daemon is covered by
 * `e2e/specs/real-docker/` in LOCAL mode; here we're validating the
 * backend-mode HTTP → SSH plumbing, not docker itself.
 */
test.describe('backend-mode systems REST', () => {
  test('GET /api/systems/{id} returns the created system', async ({ backend }) => {
    const res = await fetch(`${SERVER_URL}/api/systems/${backend.systemId}`, {
      headers: { authorization: `Bearer ${backend.accessToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(backend.systemId);
    expect(body.hostname).toBe('127.0.0.1');
  });

  test('GET /api/systems/{id}/containers — shared SSH tier responds', async ({ backend }) => {
    const res = await fetch(`${SERVER_URL}/api/systems/${backend.systemId}/containers`, {
      headers: { authorization: `Bearer ${backend.accessToken}` },
    });
    // Target has no docker CLI, so expect a surfaced error rather than a
    // hung request. Accepting 200 (empty list parsed from empty `docker ps`
    // output — depends on runtime parser) or 5xx with JSON error body.
    expect([200, 500, 502]).toContain(res.status);
    if (res.status === 200) {
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    } else {
      const body = await res.json().catch(() => null);
      expect(body).not.toBeNull();
    }
  });

  test('unauthenticated REST calls are rejected', async ({ backend }) => {
    const res = await fetch(`${SERVER_URL}/api/systems/${backend.systemId}`);
    expect(res.status).toBe(401);
  });
});
