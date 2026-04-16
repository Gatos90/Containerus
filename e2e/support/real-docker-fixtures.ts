import { test as base, expect, Page } from '@playwright/test';
import * as path from 'path';
import {
  LOCAL_SYSTEM_ID,
  dockerAvailable,
  listContainers,
  performContainerAction,
  inspectContainer,
  getContainerLogs,
  listImages,
  pullImage,
  removeImage,
  listVolumes,
  createVolume,
  removeVolume,
  listNetworks,
  createNetwork,
  removeNetwork,
  cleanupE2EResources,
} from './docker-bridge';

const tauriShimPath = path.join(__dirname, 'tauri-real-docker.js');

type DockerFixtures = {
  /** Deterministic prefix guaranteeing no collision across concurrent workers. */
  resourcePrefix: string;
};

export const test = base.extend<DockerFixtures>({
  page: async ({ page }, use) => {
    // Expose the Node-side bridge BEFORE injecting the IPC shim so
    // `window.__E2E_DOCKER__` exists by the time Angular boots.
    await page.exposeFunction('__e2eDocker_listContainers', (systemId: string) => listContainers(systemId));
    await page.exposeFunction('__e2eDocker_performContainerAction', (id: string, action: string) => performContainerAction(id, action));
    await page.exposeFunction('__e2eDocker_inspectContainer', (id: string) => inspectContainer(id));
    await page.exposeFunction('__e2eDocker_getContainerLogs', (id: string, tail: number) => getContainerLogs(id, tail));
    await page.exposeFunction('__e2eDocker_listImages', (systemId: string) => listImages(systemId));
    await page.exposeFunction('__e2eDocker_pullImage', async (image: string) => {
      const handle = pullImage(image);
      const { code, output } = await handle.done;
      if (code !== 0) throw new Error(`docker pull ${image} exited ${code}:\n${output}`);
      return output;
    });
    await page.exposeFunction('__e2eDocker_removeImage', (image: string) => removeImage(image));
    await page.exposeFunction('__e2eDocker_listVolumes', (systemId: string) => listVolumes(systemId));
    await page.exposeFunction('__e2eDocker_createVolume', (name: string) => createVolume(name));
    await page.exposeFunction('__e2eDocker_removeVolume', (name: string) => removeVolume(name));
    await page.exposeFunction('__e2eDocker_listNetworks', (systemId: string) => listNetworks(systemId));
    await page.exposeFunction('__e2eDocker_createNetwork', (name: string, driver: string) => createNetwork(name, driver));
    await page.exposeFunction('__e2eDocker_removeNetwork', (name: string) => removeNetwork(name));

    // Glue layer that the shim sees as `window.__E2E_DOCKER__`.
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      const call = (name: string) => (...fnArgs: unknown[]) => (w[name] as (...a: unknown[]) => Promise<unknown>)(...fnArgs);
      w.__E2E_DOCKER__ = {
        ready: true,
        listContainers: call('__e2eDocker_listContainers'),
        performContainerAction: call('__e2eDocker_performContainerAction'),
        inspectContainer: call('__e2eDocker_inspectContainer'),
        getContainerLogs: call('__e2eDocker_getContainerLogs'),
        listImages: call('__e2eDocker_listImages'),
        pullImage: call('__e2eDocker_pullImage'),
        removeImage: call('__e2eDocker_removeImage'),
        listVolumes: call('__e2eDocker_listVolumes'),
        createVolume: call('__e2eDocker_createVolume'),
        removeVolume: call('__e2eDocker_removeVolume'),
        listNetworks: call('__e2eDocker_listNetworks'),
        createNetwork: call('__e2eDocker_createNetwork'),
        removeNetwork: call('__e2eDocker_removeNetwork'),
      };
    });

    await page.addInitScript({ path: tauriShimPath });
    await use(page);
  },

  resourcePrefix: async ({}, use, testInfo) => {
    const prefix = `e2e-${testInfo.workerIndex}-${Date.now().toString(36)}-`;
    await use(prefix);
  },
});

test.beforeAll(async () => {
  if (!(await dockerAvailable())) {
    test.skip(true, 'docker daemon not reachable — set REAL_DOCKER=1 only when docker is available');
  }
});

test.afterEach(async () => {
  await cleanupE2EResources('e2e-');
});

export { expect, LOCAL_SYSTEM_ID };

/** Wait for Angular router-outlet to mount content. */
export async function waitForAppReady(page: Page): Promise<void> {
  await page.waitForSelector('router-outlet + *', { timeout: 15_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {
    /* dev-server keeps HMR sockets; networkidle may not reach. */
  });
}
