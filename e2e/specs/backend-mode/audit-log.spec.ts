import { test, expect } from '../../support/backend-mode/fixtures';
import { SERVER_URL } from '../../support/backend-mode/compose';

/**
 * Audit log (CON-39). The bootstrap fixture creates a project, environment,
 * and system — each of those should produce an audit_log row via
 * `audit::log_action`. The feed endpoint under
 * `/api/projects/{project}/audit` must expose them to a company admin.
 */
test('audit feed surfaces system create action', async ({ backend }) => {
  const res = await fetch(
    `${SERVER_URL}/api/projects/${backend.projectId}/audit?resourceType=system`,
    { headers: { authorization: `Bearer ${backend.accessToken}` } },
  );
  expect(res.status).toBe(200);
  const entries = await res.json() as Array<{
    action: string;
    resourceType: string;
    resourceId?: string;
  }>;
  expect(Array.isArray(entries)).toBe(true);

  const systemEntries = entries.filter((e) => e.resourceType === 'system');
  // At least the `create` from bootstrap must be present.
  expect(systemEntries.length).toBeGreaterThan(0);
  expect(systemEntries.some((e) => (e.action ?? '').includes('create'))).toBe(true);
});

test('audit feed is project-scoped — unrelated project returns empty', async ({ backend }) => {
  // Create a second project the fixture user owns but never touches.
  const res = await fetch(`${SERVER_URL}/api/projects`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${backend.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ name: 'empty-project', slug: `empty-${Date.now().toString(36)}` }),
  });
  expect(res.status).toBeLessThan(400);
  const { id: otherProjectId } = await res.json();

  const feed = await fetch(
    `${SERVER_URL}/api/projects/${otherProjectId}/audit?resourceType=system`,
    { headers: { authorization: `Bearer ${backend.accessToken}` } },
  );
  expect(feed.status).toBe(200);
  const entries = await feed.json();
  expect(Array.isArray(entries)).toBe(true);
  // No systems added to this project → no system-scoped audit entries.
  expect(entries.filter((e: { resourceType: string }) => e.resourceType === 'system').length).toBe(0);
});
