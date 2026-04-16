import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the real-Docker E2E suite (CON-37).
 *
 * This is deliberately separate from `playwright.config.ts`, because these
 * tests require a reachable `docker` daemon and exercise real networking /
 * image pulls, which is slow and not appropriate to run on every commit.
 *
 * Run with: `REAL_DOCKER=1 pnpm test:e2e:real-docker`
 *
 * Tests live under `e2e/specs/real-docker/` and use a dedicated fixture that
 * stubs Tauri IPC with a shim that forwards container/image/volume/network
 * commands to the local docker CLI via a Node bridge.
 */
export default defineConfig({
  testDir: './e2e/specs/real-docker',
  // Real docker operations (pulls, network creates) must not interleave.
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report-real-docker', open: 'never' }]],

  use: {
    baseURL: 'http://127.0.0.1:1420',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'pnpm start',
    url: 'http://127.0.0.1:1420',
    timeout: 120_000,
    reuseExistingServer: true,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
