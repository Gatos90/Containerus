import { test, expect } from '../support/fixtures';

/**
 * Smoke tests for routes that were previously uncovered. Verifies each page loads,
 * renders its heading, and does not throw a runtime error with mocked Tauri IPC.
 */
const cases: Array<{ route: string; heading: RegExp }> = [
  { route: '/images', heading: /image management/i },
  { route: '/volumes', heading: /volume management/i },
  { route: '/networks', heading: /network management/i },
  { route: '/commands', heading: /^commands$/i },
  { route: '/compose', heading: /compose projects/i },
  { route: '/backends', heading: /backends/i },
  { route: '/backend-connect', heading: /connect to backend/i },
  { route: '/login', heading: /login|create account/i },
  { route: '/k8s', heading: /^clusters$/i },
  { route: '/audit-log', heading: /audit log/i },
];

test.describe('Route smoke tests', () => {
  for (const { route, heading } of cases) {
    test(`${route} loads without crash`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState('networkidle');

      await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible({
        timeout: 8_000,
      });

      const crashText = page.getByText(/runtime error|cannot read properties of null|null is not/i);
      await expect(crashText).toHaveCount(0);
    });
  }

  test('unknown route does not crash the shell', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');
    await page.waitForLoadState('networkidle');

    const crashText = page.getByText(/runtime error|cannot read properties of null/i);
    await expect(crashText).toHaveCount(0);
  });
});
