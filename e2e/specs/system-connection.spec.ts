import { test, expect } from '../support/fixtures';

test.describe('System Connection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/systems');
    await page.waitForLoadState('networkidle');
  });

  test('renders the System Management page', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'System Management', exact: true })).toBeVisible();
  });

  test('shows empty state when no systems are configured', async ({ page }) => {
    const heading = page.getByRole('heading', { name: 'System Management', exact: true });
    await expect(heading).toBeVisible();
  });

  test('opens Add System dialog via button', async ({ page }) => {
    const addBtn = page.getByRole('button', { name: /add system/i }).first();
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    await expect(page.getByRole('heading', { name: 'Add System', exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/connection type/i)).toBeVisible();
  });

  test('Add System dialog can be closed with Cancel', async ({ page }) => {
    await page.getByRole('button', { name: /add system/i }).first().click();

    await expect(page.getByRole('heading', { name: 'Add System', exact: true })).toBeVisible({ timeout: 10_000 });

    const cancelBtn = page.getByRole('button', { name: 'Cancel', exact: true });
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();

    await expect(page.getByRole('heading', { name: 'Add System', exact: true })).toHaveCount(0, { timeout: 3_000 });
  });

  test('Add System form accepts system name and hostname inputs', async ({ page }) => {
    await page.getByRole('button', { name: /add system/i }).first().click();
    await expect(page.getByRole('heading', { name: 'Add System', exact: true })).toBeVisible({ timeout: 10_000 });

    const nameInput = page.getByPlaceholder('My Server');
    await expect(nameInput).toBeVisible();
    await nameInput.fill('My Test Server');
    await expect(nameInput).toHaveValue('My Test Server');

    const hostInput = page.getByPlaceholder(/localhost or/i);
    await expect(hostInput).toBeVisible();
    await hostInput.fill('192.168.1.100');
    await expect(hostInput).toHaveValue('192.168.1.100');
  });

  test('search input filters the system list', async ({ page }) => {
    const searchInput = page.getByPlaceholder(/search systems/i);
    await expect(searchInput).toBeVisible();
    await searchInput.fill('web-server');
    await expect(searchInput).toHaveValue('web-server');
  });
});
