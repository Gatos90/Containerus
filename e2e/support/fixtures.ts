import { test as base, expect, Page } from '@playwright/test';
import * as path from 'path';

const tauriMockPath = path.join(__dirname, 'tauri-mock.js');

/** Extended test fixture that injects the Tauri mock before Angular boots. */
export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    await page.addInitScript({ path: tauriMockPath });
    await use(page);
  },
});

export { expect };

/** Navigate to a route and wait for the Angular router outlet to settle. */
export async function navigateTo(page: Page, route: string): Promise<void> {
  await page.goto(route);
  await page.waitForSelector('router-outlet + *', { timeout: 10_000 });
}

/** Wait until no more network requests are in-flight (Angular loaded). */
export async function waitForAngular(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 15_000 });
}
