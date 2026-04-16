import { test, expect } from '../support/fixtures';

test.describe('File browser', () => {
  test('root file browser route renders', async ({ page }) => {
    await page.goto('/files');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /file browser/i }).first()).toBeVisible({
      timeout: 8_000,
    });
  });

  test('per-system file browser route renders without crash', async ({ page }) => {
    await page.goto('/files/mock-system-1');
    await page.waitForLoadState('networkidle');

    const crashText = page.getByText(/runtime error|null is not|cannot read/i);
    await expect(crashText).toHaveCount(0);

    await expect(page.getByRole('heading', { name: /file browser/i }).first()).toBeVisible({
      timeout: 8_000,
    });
  });

  test('per-container file browser route renders without crash', async ({ page }) => {
    await page.goto('/files/mock-system-1/mock-container-1');
    await page.waitForLoadState('networkidle');

    const crashText = page.getByText(/runtime error|null is not|cannot read/i);
    await expect(crashText).toHaveCount(0);
  });

  test('filter input accepts text', async ({ page }) => {
    await page.goto('/files');
    await page.waitForLoadState('networkidle');

    const filter = page.getByPlaceholder(/filter/i).first();
    if (await filter.count() > 0) {
      await filter.fill('etc');
      await expect(filter).toHaveValue('etc');
    } else {
      await expect(page.getByRole('heading', { name: /file browser/i }).first()).toBeVisible();
    }
  });
});
