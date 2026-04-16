import { test, expect } from '../support/fixtures';

test.describe('Terminal Session', () => {
  test('terminal route is accessible', async ({ page }) => {
    await page.goto('/terminal');
    await page.waitForLoadState('networkidle');

    const terminalRoot = page.locator('app-terminal-view').or(
      page.locator('.flex.flex-col.h-full.bg-zinc-950')
    ).first();
    await expect(terminalRoot).toBeVisible({ timeout: 10_000 });
  });

  test('terminal shows connection status indicator', async ({ page }) => {
    await page.goto('/terminal');
    await page.waitForLoadState('networkidle');

    const statusDot = page.locator('div.w-2.h-2.rounded-full').first();
    await expect(statusDot).toBeVisible({ timeout: 8_000 });
  });

  test('terminal header renders without crash', async ({ page }) => {
    await page.goto('/terminal');
    await page.waitForLoadState('networkidle');

    const header = page.locator('div.bg-zinc-900.border-b').first();
    await expect(header).toBeVisible({ timeout: 8_000 });

    const crashText = page.getByText(/runtime error|null is not|undefined is not/i);
    await expect(crashText).toHaveCount(0);
  });

  test('sidebar navigation links are visible', async ({ page }) => {
    await page.goto('/containers');
    await page.waitForLoadState('networkidle');

    const navLinks = page.locator('nav a[routerlink], nav a[href]');
    const count = await navLinks.count();
    expect(count).toBeGreaterThan(3);
  });

  test('terminal with path params renders without crash', async ({ page }) => {
    await page.goto('/terminal/mock-system-1');
    await page.waitForLoadState('networkidle');

    const errorMsg = page.getByText(/runtime error|null is not/i);
    await expect(errorMsg).toHaveCount(0);
  });
});
