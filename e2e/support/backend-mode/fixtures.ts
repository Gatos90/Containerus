import { test as base, expect } from '@playwright/test';
import { bootstrapFixture, type BackendFixture } from './api';
import { SERVER_URL } from './compose';

export { SERVER_URL };
export { expect };

type Fixtures = {
  backend: BackendFixture;
};

/**
 * Worker-scoped bootstrap: the compose stack is brought up once by the global
 * setup (see `backend-mode.setup.ts`) and each spec just registers a fresh
 * user + project to get an isolated JWT. Register-new-each-time is cheaper
 * than resetting the DB between specs and keeps the suite parallelizable.
 */
export const test = base.extend<Fixtures>({
  backend: async ({}, use) => {
    const fixture = await bootstrapFixture();
    await use(fixture);
  },
});
