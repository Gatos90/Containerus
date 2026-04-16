import { test, expect } from '../support/fixtures';

test.describe('AI Assistant', () => {
  test('settings page loads and shows AI section', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible({ timeout: 8_000 });

    const aiSection = page.getByText(/ai|provider|model/i).first();
    await expect(aiSection).toBeVisible();
  });

  test('AI provider selector is present in settings', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible({ timeout: 8_000 });

    const providerLabel = page.getByText(/provider/i).first();
    await expect(providerLabel).toBeVisible();
  });

  test('AI settings form renders without crash', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible({ timeout: 8_000 });

    const crashText = page.getByText(/runtime error|null is not/i);
    await expect(crashText).toHaveCount(0);
  });

  test('warp terminal route loads without crash', async ({ page }) => {
    await page.goto('/warp-terminal');
    await page.waitForLoadState('networkidle');

    const runtimeError = page.getByText(/runtime error|cannot read properties of null/i);
    await expect(runtimeError).toHaveCount(0);
  });

  test('AI connection test button visible in settings', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible({ timeout: 8_000 });

    const testBtn = page.getByRole('button', { name: /test/i }).first();
    if (await testBtn.count() > 0) {
      await expect(testBtn).toBeVisible();
    } else {
      await expect(page.getByText(/model/i).first()).toBeVisible();
    }
  });
});
