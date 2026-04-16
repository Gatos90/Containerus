import { test, expect } from '../support/fixtures';

test.describe('Port Forwarding', () => {
  test('container list page loads without crashing', async ({ page }) => {
    await page.goto('/containers');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Container Management', exact: true })).toBeVisible();
    // Verify no crash
    const crashText = page.getByText(/runtime error|null is not/i);
    await expect(crashText).toHaveCount(0);
  });

  test('navigates to containers route correctly', async ({ page }) => {
    await page.goto('/containers');
    await page.waitForURL('**/containers', { timeout: 5_000 });
    await expect(page).toHaveURL(/containers/);
  });

  test('no active port forwards shown in empty state', async ({ page }) => {
    await page.goto('/containers');
    await page.waitForLoadState('networkidle');

    // With mocked empty data, port forward section should not list any forwards
    const pfRows = page.locator('[data-testid="port-forward-row"]');
    await expect(pfRows).toHaveCount(0);
  });

  test('settings page loads correctly', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Use exact match to avoid strict mode violation with multiple "Settings" headings
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible({ timeout: 8_000 });
  });

  test('networks page loads for network management', async ({ page }) => {
    await page.goto('/networks');
    await page.waitForLoadState('networkidle');

    // Network management heading
    const networkHeading = page.getByRole('heading').filter({ hasText: /network/i }).first();
    await expect(networkHeading).toBeVisible({ timeout: 8_000 });
  });
});
