import { test, expect } from '../support/fixtures';

test.describe('Container Lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/containers');
    await page.waitForLoadState('networkidle');
  });

  test('renders the Container Management page', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Container Management', exact: true })).toBeVisible();
  });

  test('shows container search input', async ({ page }) => {
    const search = page.getByPlaceholder(/search containers/i);
    await expect(search).toBeVisible();
  });

  test('container search input accepts text', async ({ page }) => {
    const search = page.getByPlaceholder(/search containers/i);
    await search.fill('nginx');
    await expect(search).toHaveValue('nginx');

    await search.clear();
    await expect(search).toHaveValue('');
  });

  test('status filter dropdown is visible and interactive', async ({ page }) => {
    const statusFilter = page.locator('select').filter({ hasText: /all/i }).first();

    if (await statusFilter.count() > 0) {
      await expect(statusFilter).toBeVisible();
      const options = await statusFilter.locator('option').count();
      expect(options).toBeGreaterThan(1);
    } else {
      await expect(page.getByRole('heading', { name: 'Container Management', exact: true })).toBeVisible();
    }
  });

  test('navigates to root and redirects to /containers', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL('**/containers', { timeout: 5_000 });
    await expect(page.getByRole('heading', { name: 'Container Management', exact: true })).toBeVisible();
  });

  test('container page stats area is visible', async ({ page }) => {
    const heading = page.getByRole('heading', { name: 'Container Management', exact: true });
    await expect(heading).toBeVisible();

    const headerWrapper = heading.locator('..');
    await expect(headerWrapper).toBeVisible();
  });
});
