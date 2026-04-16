import { dockerAvailable, up, waitForServer } from './compose';

/**
 * Playwright `globalSetup` for the backend-mode suite.
 *
 * Brings up the docker compose stack (Postgres, containerus-server, sidecar
 * SSH target), waits for /api/health, and leaves it running for the suite.
 * Teardown happens in `global-teardown.ts`.
 */
export default async function globalSetup(): Promise<void> {
  if (!dockerAvailable()) {
    throw new Error('Docker is required for backend-mode E2E. Start Docker Desktop or export BACKEND_MODE_SKIP=1.');
  }
  up();
  await waitForServer();
}
