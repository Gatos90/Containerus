import { test, expect } from '../support/fixtures';

test.describe('Settings page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible({
      timeout: 8_000,
    });
  });

  test('exposes AI and SSH tabs', async ({ page }) => {
    await expect(page.getByRole('button', { name: /^ai$/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^ssh$/i }).first()).toBeVisible();
  });

  test('SSH tab reveals SSH Config Files section', async ({ page }) => {
    await page.getByRole('button', { name: /^ssh$/i }).first().click();

    await expect(page.getByRole('heading', { name: /ssh config files/i })).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText(/configure which ssh config files to read/i)).toBeVisible();
  });

  test('switches between AI and SSH tabs without crash', async ({ page }) => {
    await page.getByRole('button', { name: /^ssh$/i }).first().click();
    await expect(page.getByRole('heading', { name: /ssh config files/i })).toBeVisible({
      timeout: 5_000,
    });

    await page.getByRole('button', { name: /^ai$/i }).first().click();
    const providerText = page.getByText(/provider/i).first();
    await expect(providerText).toBeVisible();

    const crashText = page.getByText(/runtime error|null is not/i);
    await expect(crashText).toHaveCount(0);
  });
});
