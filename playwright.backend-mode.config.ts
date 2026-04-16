import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for backend-mode E2E (CON-39).
 *
 * These specs exercise the containerus-server + Postgres stack end-to-end:
 * register/login/refresh over HTTP, the shared-tier SSH REST path, and the
 * per-user WebSocket PTY/tunnel paths that `connections/mod.rs` tiers.
 *
 * Running: `BACKEND_MODE=1 pnpm test:e2e:backend`
 *
 * Requires Docker. The global setup boots a throwaway compose stack bound
 * to loopback; teardown removes containers and volumes unless you set
 * `BACKEND_MODE_KEEP=1` to inspect state across runs.
 *
 * Deliberately separate from both `playwright.config.ts` (fast, mocked
 * Tauri) and `playwright.real-docker.config.ts` (real local docker daemon).
 */
export default defineConfig({
  testDir: './e2e/specs/backend-mode',
  // The WS specs use real SSH sessions; keep them serial so the shared
  // containerus-server process isn't racing on the same SSH pool entry.
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report-backend-mode', open: 'never' }]],

  globalSetup: './e2e/support/backend-mode/global-setup.ts',
  globalTeardown: './e2e/support/backend-mode/global-teardown.ts',

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
