import { test, expect } from '../support/fixtures';

test.describe('Sidebar navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/containers');
    await page.waitForLoadState('networkidle');
  });

  test('sidebar exposes multiple primary nav links', async ({ page }) => {
    const navLinks = page.locator('nav a[routerlink], nav a[href]');
    const count = await navLinks.count();
    expect(count).toBeGreaterThan(3);
  });

  test('navigates from containers to images via sidebar', async ({ page }) => {
    const imagesLink = page.locator('nav a[routerlink="/images"], nav a[href="/images"]').first();
    await expect(imagesLink).toBeVisible();
    await imagesLink.click();

    await page.waitForURL('**/images', { timeout: 5_000 });
    await expect(page.getByRole('heading', { name: /image management/i })).toBeVisible({
      timeout: 8_000,
    });
  });

  test('navigates from containers to systems via sidebar', async ({ page }) => {
    const systemsLink = page
      .locator('nav a[routerlink="/systems"], nav a[href="/systems"]')
      .first();
    await expect(systemsLink).toBeVisible();
    await systemsLink.click();

    await page.waitForURL('**/systems', { timeout: 5_000 });
    await expect(page.getByRole('heading', { name: 'System Management', exact: true })).toBeVisible({
      timeout: 8_000,
    });
  });

  test('back/forward history preserves view', async ({ page }) => {
    await page.goto('/volumes');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: /volume management/i })).toBeVisible({
      timeout: 8_000,
    });

    await page.goto('/networks');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: /network management/i })).toBeVisible({
      timeout: 8_000,
    });

    await page.goBack();
    await expect(page.getByRole('heading', { name: /volume management/i })).toBeVisible({
      timeout: 8_000,
    });

    await page.goForward();
    await expect(page.getByRole('heading', { name: /network management/i })).toBeVisible({
      timeout: 8_000,
    });
  });
});
